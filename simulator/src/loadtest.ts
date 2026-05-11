import 'dotenv/config';
import pg from 'pg';

// ============================================================
// Simulated read traffic: dashboard users, ops engineers,
// trading desk analysts hitting Tiger Cloud concurrently
// alongside live 8K rows/sec write ingest.
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

// Each query represents a real user action
interface QueryProfile {
  name: string;
  persona: string;     // who runs this
  weight: number;      // relative frequency
  sql: () => { text: string; params: unknown[] };
}

const QUERIES: QueryProfile[] = [
  {
    name: 'fleet_snapshot',
    persona: 'ops_dashboard',
    weight: 20,   // most common — dashboard auto-refresh
    sql: () => ({
      text: `SELECT s.name, t.avg_site_power_mw, t.avg_soc_pct, t.avg_soh_pct, t.bucket
             FROM sites s LEFT JOIN LATERAL (
               SELECT avg_site_power_mw, avg_soc_pct, avg_soh_pct, bucket
               FROM telemetry_1min WHERE site_id = s.site_id ORDER BY bucket DESC LIMIT 1
             ) t ON TRUE ORDER BY s.name`,
      params: [],
    }),
  },
  {
    name: 'site_power_1h',
    persona: 'ops_engineer',
    weight: 15,
    sql: () => ({
      text: `SELECT bucket, avg_site_power_mw, avg_soc_pct, avg_inverter_temp_c
             FROM telemetry_1min
             WHERE site_id = $1 AND bucket > NOW() - INTERVAL '1 hour'
             ORDER BY bucket`,
      params: [randomSite()],
    }),
  },
  {
    name: 'site_power_24h',
    persona: 'ops_engineer',
    weight: 10,
    sql: () => ({
      text: `SELECT bucket, avg_site_power_mw, avg_soc_pct, avg_inverter_temp_c, sample_count
             FROM telemetry_15min
             WHERE site_id = $1 AND bucket > NOW() - INTERVAL '24 hours'
             ORDER BY bucket`,
      params: [randomSite()],
    }),
  },
  {
    name: 'active_alarms',
    persona: 'ops_dashboard',
    weight: 15,
    sql: () => ({
      text: `SELECT a.ts, s.name, a.severity, a.alarm_code, a.message
             FROM alarms_events a JOIN sites s ON s.site_id = a.site_id
             WHERE a.resolved_at IS NULL
             ORDER BY a.ts DESC LIMIT 50`,
      params: [],
    }),
  },
  {
    name: 'alarm_count_by_severity',
    persona: 'ops_dashboard',
    weight: 10,
    sql: () => ({
      text: `SELECT severity, COUNT(*) FROM alarms_events
             WHERE resolved_at IS NULL GROUP BY severity`,
      params: [],
    }),
  },
  {
    name: 'soc_trend_7d',
    persona: 'asset_manager',
    weight: 5,
    sql: () => ({
      text: `SELECT bucket, avg_soc_pct, min_soc_pct, max_soc_pct
             FROM telemetry_1hour
             WHERE site_id = $1 AND bucket > NOW() - INTERVAL '7 days'
             ORDER BY bucket`,
      params: [randomSite()],
    }),
  },
  {
    name: 'peak_utilization_24h',
    persona: 'asset_manager',
    weight: 5,
    sql: () => ({
      text: `SELECT s.name,
                    MAX(t.max_site_power_mw) AS peak_mw,
                    s.capacity_mw,
                    ROUND((MAX(t.max_site_power_mw) / s.capacity_mw * 100)::numeric, 1) AS util_pct
             FROM telemetry_1hour t JOIN sites s ON s.site_id = t.site_id
             WHERE t.bucket > NOW() - INTERVAL '24 hours'
             GROUP BY s.name, s.capacity_mw ORDER BY util_pct DESC`,
      params: [],
    }),
  },
  {
    name: 'thermal_hotspots',
    persona: 'ops_engineer',
    weight: 5,
    sql: () => ({
      text: `SELECT t.asset_id, MAX(t.inverter_temp_c) AS max_temp, MAX(t.rack_temp_c) AS max_rack
             FROM telemetry_raw t
             WHERE t.site_id = $1 AND t.ts > NOW() - INTERVAL '30 minutes'
             GROUP BY t.asset_id ORDER BY max_temp DESC`,
      params: [randomSite()],
    }),
  },
  {
    name: 'market_prices_24h',
    persona: 'trader',
    weight: 8,
    sql: () => ({
      text: `SELECT time_bucket('15 minutes', ts) AS period, market,
                    AVG(price_usd_mwh) AS avg_price, MIN(price_usd_mwh) AS min_price, MAX(price_usd_mwh) AS max_price
             FROM market_price_signals
             WHERE ts > NOW() - INTERVAL '24 hours'
             GROUP BY period, market ORDER BY period DESC LIMIT 100`,
      params: [],
    }),
  },
  {
    name: 'compression_stats',
    persona: 'platform_demo',
    weight: 2,
    sql: () => ({
      text: `SELECT pg_size_pretty(SUM(before_compression_total_bytes)) AS before,
                    pg_size_pretty(SUM(after_compression_total_bytes)) AS after,
                    ROUND(SUM(before_compression_total_bytes)::numeric / NULLIF(SUM(after_compression_total_bytes), 0), 1) AS ratio
             FROM hypertable_compression_stats('telemetry_raw')`,
      params: [],
    }),
  },
  {
    name: 'cell_voltage_check',
    persona: 'bms_engineer',
    weight: 3,
    sql: () => ({
      text: `SELECT asset_id, AVG(cell_voltage_avg) AS avg_v,
                    MIN(cell_voltage_min) AS min_v, MAX(cell_voltage_max) AS max_v
             FROM telemetry_raw
             WHERE site_id = $1 AND ts > NOW() - INTERVAL '10 minutes'
             GROUP BY asset_id`,
      params: [randomSite()],
    }),
  },
  {
    name: 'dispatch_history',
    persona: 'trader',
    weight: 2,
    sql: () => ({
      text: `SELECT d.ts, s.name, d.command_type, d.target_power_mw, d.duration_min, d.status
             FROM dispatch_commands d JOIN sites s ON s.site_id = d.site_id
             ORDER BY d.ts DESC LIMIT 50`,
      params: [],
    }),
  },
];

// Build weighted selection array
const weightedQueries: QueryProfile[] = [];
for (const q of QUERIES) {
  for (let i = 0; i < q.weight; i++) weightedQueries.push(q);
}

function pickQuery(): QueryProfile {
  return weightedQueries[Math.floor(Math.random() * weightedQueries.length)];
}

// Stats tracking
interface LatencyBucket {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  errors: number;
  samples: number[];  // for percentile calc
}

const stats = new Map<string, LatencyBucket>();
let globalStart = 0;
let totalQueries = 0;
let totalErrors = 0;

function record(name: string, ms: number, error: boolean) {
  let bucket = stats.get(name);
  if (!bucket) {
    bucket = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, errors: 0, samples: [] };
    stats.set(name, bucket);
  }
  bucket.count++;
  if (error) {
    bucket.errors++;
    totalErrors++;
  } else {
    bucket.totalMs += ms;
    bucket.minMs = Math.min(bucket.minMs, ms);
    bucket.maxMs = Math.max(bucket.maxMs, ms);
    bucket.samples.push(ms);
    // Keep reservoir of 1000 samples for percentiles
    if (bucket.samples.length > 1000) bucket.samples.shift();
  }
  totalQueries++;
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

function printReport() {
  const elapsed = (Date.now() - globalStart) / 1000;
  const qps = (totalQueries / elapsed).toFixed(1);

  console.log('\n' + '='.repeat(100));
  console.log(`  LOAD TEST REPORT  |  ${totalQueries} queries in ${elapsed.toFixed(0)}s  |  ${qps} queries/sec  |  ${totalErrors} errors`);
  console.log('='.repeat(100));
  console.log(
    '  ' +
    'Query'.padEnd(25) +
    'Persona'.padEnd(16) +
    'Count'.padStart(7) +
    'Avg'.padStart(8) +
    'p50'.padStart(8) +
    'p95'.padStart(8) +
    'p99'.padStart(8) +
    'Max'.padStart(8) +
    'Err'.padStart(5)
  );
  console.log('-'.repeat(100));

  const sorted = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [name, b] of sorted) {
    const query = QUERIES.find(q => q.name === name)!;
    const avg = b.count - b.errors > 0 ? (b.totalMs / (b.count - b.errors)).toFixed(0) : '-';
    const p50 = percentile(b.samples, 50).toFixed(0);
    const p95 = percentile(b.samples, 95).toFixed(0);
    const p99 = percentile(b.samples, 99).toFixed(0);
    const max = b.maxMs === 0 ? '-' : b.maxMs.toFixed(0);
    console.log(
      '  ' +
      name.padEnd(25) +
      query.persona.padEnd(16) +
      String(b.count).padStart(7) +
      `${avg}ms`.padStart(8) +
      `${p50}ms`.padStart(8) +
      `${p95}ms`.padStart(8) +
      `${p99}ms`.padStart(8) +
      `${max}ms`.padStart(8) +
      String(b.errors).padStart(5)
    );
  }
  console.log('='.repeat(100));
}

async function simulateUser(pool: pg.Pool, userId: number, thinkTimeMs: number) {
  while (true) {
    const q = pickQuery();
    const { text, params } = q.sql();
    const start = Date.now();

    try {
      await pool.query(text, params);
      record(q.name, Date.now() - start, false);
    } catch (err) {
      record(q.name, Date.now() - start, true);
    }

    // Simulate human think time (reading the dashboard before next action)
    const jitter = thinkTimeMs * (0.5 + Math.random());
    await new Promise(r => setTimeout(r, jitter));
  }
}

async function main() {
  const concurrentUsers = parseInt(process.env.LOAD_USERS || '10');
  const thinkTimeMs = parseInt(process.env.LOAD_THINK_MS || '500');
  const durationSec = parseInt(process.env.LOAD_DURATION_SEC || '60');

  console.log('='.repeat(60));
  console.log('[Load Test] Simulated Dashboard Traffic');
  console.log('='.repeat(60));
  console.log(`  Concurrent users:  ${concurrentUsers}`);
  console.log(`  Think time:        ${thinkTimeMs}ms (avg between queries)`);
  console.log(`  Duration:          ${durationSec}s`);
  console.log(`  Query mix:         ${QUERIES.length} query types`);
  console.log('');
  console.log('  Personas:');
  const personas = [...new Set(QUERIES.map(q => q.persona))];
  for (const p of personas) {
    const pQueries = QUERIES.filter(q => q.persona === p);
    const totalWeight = pQueries.reduce((s, q) => s + q.weight, 0);
    console.log(`    ${p.padEnd(18)} ${pQueries.length} queries, ${totalWeight}% of traffic`);
  }
  console.log('');

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: Math.min(concurrentUsers + 2, 20),
  });

  globalStart = Date.now();

  // Periodic progress
  const progress = setInterval(() => {
    const elapsed = (Date.now() - globalStart) / 1000;
    const qps = (totalQueries / elapsed).toFixed(1);
    const remaining = durationSec - elapsed;
    console.log(`  [${elapsed.toFixed(0)}s] ${qps} qps | ${totalQueries} queries | ${totalErrors} errors | ${remaining.toFixed(0)}s remaining`);
  }, 10_000);

  // Launch concurrent users
  console.log(`[Load Test] Starting ${concurrentUsers} simulated users...\n`);
  const users = Array.from({ length: concurrentUsers }, (_, i) =>
    simulateUser(pool, i, thinkTimeMs)
  );

  // Run for duration
  await new Promise(r => setTimeout(r, durationSec * 1000));

  clearInterval(progress);
  printReport();

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[Load Test] Fatal:', err);
  process.exit(1);
});
