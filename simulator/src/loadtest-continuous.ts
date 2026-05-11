import 'dotenv/config';
import pg from 'pg';

// ============================================================
// Always-on read traffic simulator.
// Runs forever, mimicking N concurrent dashboard users.
// Deploy alongside the write simulator on Fly.io.
// ============================================================

const SITE_IDS = [
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0001-000000000002',
  '00000000-0000-0000-0001-000000000003',
  '00000000-0000-0000-0001-000000000004',
  '00000000-0000-0000-0001-000000000005',
];

function randomSite(): string {
  return SITE_IDS[Math.floor(Math.random() * SITE_IDS.length)];
}

interface QueryDef {
  name: string;
  weight: number;
  sql: () => { text: string; params: unknown[] };
}

const QUERIES: QueryDef[] = [
  { name: 'fleet_snapshot', weight: 20, sql: () => ({
    text: `SELECT s.name, t.avg_site_power_mw, t.avg_soc_pct, t.avg_soh_pct, t.bucket
           FROM sites s LEFT JOIN LATERAL (
             SELECT avg_site_power_mw, avg_soc_pct, avg_soh_pct, bucket
             FROM telemetry_1min WHERE site_id = s.site_id ORDER BY bucket DESC LIMIT 1
           ) t ON TRUE ORDER BY s.name`,
    params: [],
  })},
  { name: 'site_power_1h', weight: 15, sql: () => ({
    text: `SELECT bucket, avg_site_power_mw, avg_soc_pct, avg_inverter_temp_c
           FROM telemetry_1min WHERE site_id = $1 AND bucket > NOW() - INTERVAL '1 hour'
           ORDER BY bucket`,
    params: [randomSite()],
  })},
  { name: 'site_power_24h', weight: 10, sql: () => ({
    text: `SELECT bucket, avg_site_power_mw, avg_soc_pct, sample_count
           FROM telemetry_15min WHERE site_id = $1 AND bucket > NOW() - INTERVAL '24 hours'
           ORDER BY bucket`,
    params: [randomSite()],
  })},
  { name: 'active_alarms', weight: 15, sql: () => ({
    text: `SELECT a.ts, s.name, a.severity, a.alarm_code
           FROM alarms_events a JOIN sites s ON s.site_id = a.site_id
           WHERE a.resolved_at IS NULL ORDER BY a.ts DESC LIMIT 50`,
    params: [],
  })},
  { name: 'alarm_count', weight: 10, sql: () => ({
    text: `SELECT severity, COUNT(*) FROM alarms_events WHERE resolved_at IS NULL GROUP BY severity`,
    params: [],
  })},
  { name: 'soc_24h', weight: 5, sql: () => ({
    text: `SELECT bucket, avg_soc_pct, min_soc_pct, max_soc_pct
           FROM telemetry_15min WHERE site_id = $1 AND bucket > NOW() - INTERVAL '24 hours'
           ORDER BY bucket`,
    params: [randomSite()],
  })},
  { name: 'utilization', weight: 3, sql: () => ({
    text: `SELECT s.name, MAX(t.avg_site_power_mw) AS peak, s.capacity_mw
           FROM telemetry_15min t JOIN sites s ON s.site_id = t.site_id
           WHERE t.bucket > NOW() - INTERVAL '24 hours'
           GROUP BY s.name, s.capacity_mw`,
    params: [],
  })},
  { name: 'market_prices', weight: 8, sql: () => ({
    text: `SELECT time_bucket('15 minutes', ts) AS period, market, AVG(price_usd_mwh) AS price
           FROM market_price_signals WHERE ts > NOW() - INTERVAL '24 hours'
           GROUP BY period, market ORDER BY period DESC LIMIT 100`,
    params: [],
  })},
  { name: 'thermal_check', weight: 5, sql: () => ({
    text: `SELECT site_id, MAX(max_inverter_temp_c) AS max_temp, MAX(max_rack_temp_c) AS max_rack
           FROM telemetry_1min WHERE site_id = $1 AND bucket > NOW() - INTERVAL '15 minutes'
           GROUP BY site_id`,
    params: [randomSite()],
  })},
  { name: 'dispatch_recent', weight: 5, sql: () => ({
    text: `SELECT d.ts, s.name, d.command_type, d.target_power_mw, d.status
           FROM dispatch_commands d JOIN sites s ON s.site_id = d.site_id
           ORDER BY d.ts DESC LIMIT 30`,
    params: [],
  })},
  { name: 'compression_stats', weight: 2, sql: () => ({
    text: `SELECT pg_size_pretty(SUM(before_compression_total_bytes)) AS before,
                  pg_size_pretty(SUM(after_compression_total_bytes)) AS after,
                  ROUND(SUM(before_compression_total_bytes)::numeric / NULLIF(SUM(after_compression_total_bytes), 0), 1) AS ratio
           FROM hypertable_compression_stats('telemetry_raw')`,
    params: [],
  })},
];

const weighted: QueryDef[] = [];
for (const q of QUERIES) for (let i = 0; i < q.weight; i++) weighted.push(q);

function pick(): QueryDef {
  return weighted[Math.floor(Math.random() * weighted.length)];
}

// Rolling stats
let totalQueries = 0;
let totalErrors = 0;
let windowQueries = 0;
let windowErrors = 0;
let windowTotalMs = 0;
let windowStart = Date.now();
const startedAt = Date.now();

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  return `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

async function userLoop(pool: pg.Pool, thinkMs: number) {
  while (true) {
    const q = pick();
    const { text, params } = q.sql();
    const t0 = Date.now();
    try {
      await pool.query(text, params);
      const ms = Date.now() - t0;
      windowTotalMs += ms;
      windowQueries++;
      totalQueries++;
    } catch {
      windowErrors++;
      totalErrors++;
      totalQueries++;
    }
    const jitter = thinkMs * (0.3 + Math.random() * 1.4);
    await new Promise(r => setTimeout(r, jitter));
  }
}

async function main() {
  const users = parseInt(process.env.LOAD_USERS || '10');
  const thinkMs = parseInt(process.env.LOAD_THINK_MS || '500');

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: Math.min(users + 2, 20),
  });

  console.log('='.repeat(50));
  console.log('[Read Traffic] Continuous Dashboard Simulation');
  console.log('='.repeat(50));
  console.log(`  Users: ${users} | Think: ${thinkMs}ms | Queries: ${QUERIES.length} types`);
  console.log('');

  // Launch users
  for (let i = 0; i < users; i++) userLoop(pool, thinkMs);

  // Log every 30s
  setInterval(() => {
    const now = Date.now();
    const windowSec = (now - windowStart) / 1000;
    const qps = (windowQueries / windowSec).toFixed(1);
    const avgMs = windowQueries > 0 ? (windowTotalMs / windowQueries).toFixed(0) : '-';
    const uptime = formatUptime(now - startedAt);
    const totalQps = (totalQueries / ((now - startedAt) / 1000)).toFixed(1);

    console.log(
      `[${uptime}] ${qps} qps (avg ${totalQps}) | avg_latency: ${avgMs}ms | total: ${totalQueries.toLocaleString()}` +
      (totalErrors > 0 ? ` | errors: ${totalErrors}` : '')
    );

    windowQueries = 0;
    windowErrors = 0;
    windowTotalMs = 0;
    windowStart = now;
  }, 30_000);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log(`\n[Read Traffic] Stopped. ${totalQueries.toLocaleString()} queries, ${totalErrors} errors.`);
    await pool.end();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await pool.end();
    process.exit(0);
  });
}

main().catch(err => { console.error(err); process.exit(1); });
