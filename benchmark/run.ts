#!/usr/bin/env npx tsx
/**
 * BESS Demo: Tiger Cloud vs RDS PostgreSQL Benchmark
 * Runs identical logical queries against both databases and compares latency.
 */

import pg from 'pg';

// ============================================================
// Configuration
// ============================================================

const TIGER_URL = process.env.TIGER_URL || 'postgresql://tsdbadmin:mwmnqt4xebbtcpbc@yptymhxg0b.n3fd3x7z3d.tsdb.cloud.timescale.com:39953/tsdb?sslmode=require';
const RDS_URL = process.env.RDS_URL || 'postgresql://RJB:wF%3A%3A0t.DMm-mPMGxbn%3Cqv~KAQaHz@rjb-bess-rds.c544ymuo4glo.eu-central-1.rds.amazonaws.com:5432/postgres?uselibpqcompat=true&sslmode=require';

const WARMUP_RUNS = 2;
const MEASURED_RUNS = 5;

// Pick a site_id that exists in both DBs
const SITE_ID = '00000000-0000-0000-0001-000000000001'; // Mojave

// ============================================================
// Query Definitions
// ============================================================

interface QueryDef {
  name: string;
  category: string;
  tiger: string;
  rds: string;
  params?: unknown[];
}

const queries: QueryDef[] = [
  // ---- Reference / Metadata ----
  {
    name: 'Fleet overview (sites + org)',
    category: 'Metadata',
    tiger: `SELECT s.*, o.name AS org_name FROM sites s JOIN organizations o ON o.org_id = s.org_id ORDER BY s.name`,
    rds: `SELECT s.*, o.name AS org_name FROM sites s JOIN organizations o ON o.org_id = s.org_id ORDER BY s.name`,
  },
  {
    name: 'Site detail + counts',
    category: 'Metadata',
    tiger: `SELECT s.*, (SELECT COUNT(*) FROM battery_assets WHERE site_id = s.site_id) AS assets,
            (SELECT COUNT(*) FROM pcs_inverters WHERE site_id = s.site_id) AS inverters
            FROM sites s WHERE s.site_id = $1`,
    rds: `SELECT s.*, (SELECT COUNT(*) FROM battery_assets WHERE site_id = s.site_id) AS assets,
          (SELECT COUNT(*) FROM pcs_inverters WHERE site_id = s.site_id) AS inverters
          FROM sites s WHERE s.site_id = $1`,
    params: [SITE_ID],
  },

  // ---- Point-in-time telemetry ----
  {
    name: 'Latest telemetry (1 site, last 10min)',
    category: 'Telemetry',
    tiger: `SELECT * FROM telemetry_1min WHERE site_id = $1 AND bucket > NOW() - INTERVAL '10 minutes' ORDER BY bucket DESC LIMIT 1`,
    rds: `SELECT ts, site_id, AVG(site_power_mw) AS avg_site_power_mw, AVG(state_of_charge_pct) AS avg_soc_pct,
          AVG(state_of_health_pct) AS avg_soh_pct, AVG(round_trip_efficiency) AS avg_rte
          FROM telemetry_raw WHERE site_id = $1 AND ts > NOW() - INTERVAL '10 minutes'
          GROUP BY ts, site_id ORDER BY ts DESC LIMIT 1`,
    params: [SITE_ID],
  },
  {
    name: 'Latest telemetry per site (fleet)',
    category: 'Telemetry',
    tiger: `SELECT DISTINCT ON (site_id) site_id, avg_site_power_mw, avg_soc_pct, avg_soh_pct
            FROM telemetry_1min WHERE bucket > NOW() - INTERVAL '10 minutes'
            ORDER BY site_id, bucket DESC`,
    rds: `SELECT DISTINCT ON (site_id) site_id, site_power_mw, state_of_charge_pct, state_of_health_pct
          FROM telemetry_raw WHERE ts > NOW() - INTERVAL '10 minutes'
          ORDER BY site_id, ts DESC`,
  },

  // ---- Time-range aggregation ----
  {
    name: '24h telemetry history (1 site, 1min buckets)',
    category: 'Aggregation',
    tiger: `SELECT bucket AS time, avg_site_power_mw, avg_soc_pct, avg_discharge_power_mw
            FROM telemetry_1min WHERE site_id = $1 AND bucket > NOW() - INTERVAL '24 hours'
            ORDER BY bucket`,
    rds: `SELECT date_trunc('minute', ts) AS time,
          AVG(site_power_mw) AS avg_site_power_mw, AVG(state_of_charge_pct) AS avg_soc_pct,
          AVG(discharge_power_mw) AS avg_discharge_power_mw
          FROM telemetry_raw WHERE site_id = $1 AND ts > NOW() - INTERVAL '24 hours'
          GROUP BY date_trunc('minute', ts) ORDER BY time`,
    params: [SITE_ID],
  },
  {
    name: '7d telemetry history (1 site, 15min buckets)',
    category: 'Aggregation',
    tiger: `SELECT bucket AS time, avg_site_power_mw, avg_soc_pct
            FROM telemetry_15min WHERE site_id = $1 AND bucket > NOW() - INTERVAL '7 days'
            ORDER BY bucket`,
    rds: `SELECT date_trunc('hour', ts) + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM ts) / 15) AS time,
          AVG(site_power_mw) AS avg_site_power_mw, AVG(state_of_charge_pct) AS avg_soc_pct
          FROM telemetry_raw WHERE site_id = $1 AND ts > NOW() - INTERVAL '7 days'
          GROUP BY 1 ORDER BY time`,
    params: [SITE_ID],
  },
  {
    name: '30d telemetry history (1 site, 1h buckets)',
    category: 'Aggregation',
    tiger: `SELECT bucket AS time, avg_site_power_mw, avg_soc_pct
            FROM telemetry_1hour WHERE site_id = $1 AND bucket > NOW() - INTERVAL '30 days'
            ORDER BY bucket`,
    rds: `SELECT date_trunc('hour', ts) AS time,
          AVG(site_power_mw) AS avg_site_power_mw, AVG(state_of_charge_pct) AS avg_soc_pct
          FROM telemetry_raw WHERE site_id = $1 AND ts > NOW() - INTERVAL '30 days'
          GROUP BY date_trunc('hour', ts) ORDER BY time`,
    params: [SITE_ID],
  },
  {
    name: '30d fleet-wide hourly aggregation (all sites)',
    category: 'Aggregation',
    tiger: `SELECT site_id, bucket AS time, avg_site_power_mw, avg_soc_pct
            FROM telemetry_1hour WHERE bucket > NOW() - INTERVAL '30 days'
            ORDER BY site_id, bucket`,
    rds: `SELECT site_id, date_trunc('hour', ts) AS time,
          AVG(site_power_mw) AS avg_site_power_mw, AVG(state_of_charge_pct) AS avg_soc_pct
          FROM telemetry_raw WHERE ts > NOW() - INTERVAL '30 days'
          GROUP BY site_id, date_trunc('hour', ts) ORDER BY site_id, time`,
  },

  // ---- Alarms ----
  {
    name: 'Active alarms (unresolved)',
    category: 'Alarms',
    tiger: `SELECT a.*, s.name AS site_name FROM alarms_events a JOIN sites s ON s.site_id = a.site_id
            WHERE resolved_at IS NULL ORDER BY a.ts DESC LIMIT 100`,
    rds: `SELECT a.*, s.name AS site_name FROM alarms_events a JOIN sites s ON s.site_id = a.site_id
          WHERE resolved_at IS NULL ORDER BY a.ts DESC LIMIT 100`,
  },
  {
    name: 'Alarm severity stats',
    category: 'Alarms',
    tiger: `SELECT severity, COUNT(*) FROM alarms_events WHERE resolved_at IS NULL GROUP BY severity`,
    rds: `SELECT severity, COUNT(*) FROM alarms_events WHERE resolved_at IS NULL GROUP BY severity`,
  },
  {
    name: 'Alarm hourly counts (7d)',
    category: 'Alarms',
    tiger: `SELECT time_bucket('1 hour', ts) AS hour, severity, COUNT(*)
            FROM alarms_events WHERE ts > NOW() - INTERVAL '7 days'
            GROUP BY hour, severity ORDER BY hour`,
    rds: `SELECT date_trunc('hour', ts) AS hour, severity, COUNT(*)
          FROM alarms_events WHERE ts > NOW() - INTERVAL '7 days'
          GROUP BY hour, severity ORDER BY hour`,
  },

  // ---- Analytics / Decision-support ----
  {
    name: 'Dispatch readiness (fleet)',
    category: 'Analytics',
    tiger: `WITH latest_telemetry AS (
              SELECT DISTINCT ON (site_id) site_id, avg_soc_pct AS soc, avg_soh_pct AS soh, avg_site_power_mw AS power
              FROM telemetry_1min WHERE bucket > NOW() - INTERVAL '10 minutes' ORDER BY site_id, bucket DESC
            ),
            active_critical AS (
              SELECT site_id, COUNT(*) AS cnt FROM alarms_events
              WHERE resolved_at IS NULL AND severity IN ('critical','emergency') GROUP BY site_id
            )
            SELECT s.site_id, s.name, s.capacity_mw, ROUND(lt.soc::numeric,1) AS soc_pct,
                   COALESCE(ac.cnt,0) AS critical_alarms,
                   ROUND(GREATEST(0, LEAST(100, lt.soc*0.5 + (lt.soh-90)*5 - COALESCE(ac.cnt,0)*25))::numeric,0) AS readiness
            FROM sites s LEFT JOIN latest_telemetry lt ON lt.site_id = s.site_id
            LEFT JOIN active_critical ac ON ac.site_id = s.site_id ORDER BY readiness DESC`,
    rds: `WITH latest_telemetry AS (
            SELECT DISTINCT ON (site_id) site_id, state_of_charge_pct AS soc, state_of_health_pct AS soh, site_power_mw AS power
            FROM telemetry_raw WHERE ts > NOW() - INTERVAL '10 minutes' ORDER BY site_id, ts DESC
          ),
          active_critical AS (
            SELECT site_id, COUNT(*) AS cnt FROM alarms_events
            WHERE resolved_at IS NULL AND severity IN ('critical','emergency') GROUP BY site_id
          )
          SELECT s.site_id, s.name, s.capacity_mw, ROUND(lt.soc::numeric,1) AS soc_pct,
                 COALESCE(ac.cnt,0) AS critical_alarms,
                 ROUND(GREATEST(0, LEAST(100, lt.soc*0.5 + (lt.soh-90)*5 - COALESCE(ac.cnt,0)*25))::numeric,0) AS readiness
          FROM sites s LEFT JOIN latest_telemetry lt ON lt.site_id = s.site_id
          LEFT JOIN active_critical ac ON ac.site_id = s.site_id ORDER BY readiness DESC`,
  },
  {
    name: 'Missed revenue analysis (7d)',
    category: 'Analytics',
    tiger: `WITH hourly_state AS (
              SELECT t.bucket, t.site_id, t.avg_soc_pct AS soc, t.avg_site_power_mw AS power_mw,
                     t.avg_discharge_power_mw AS discharge_mw, s.capacity_mw, s.name, s.timezone
              FROM telemetry_1hour t JOIN sites s ON s.site_id = t.site_id
              WHERE t.bucket >= NOW() - INTERVAL '7 days'
            ),
            hourly_prices AS (
              SELECT time_bucket('1 hour', ts) AS bucket, market, AVG(price_usd_mwh) AS price
              FROM market_price_signals WHERE ts >= NOW() - INTERVAL '7 days' GROUP BY 1, market
            )
            SELECT hs.name, COUNT(*) FILTER (WHERE hp.price > 60) AS high_price_hours,
                   COALESCE(SUM(CASE WHEN hp.price > 60 AND hs.discharge_mw < hs.capacity_mw * 0.3 AND hs.soc > 20
                     THEN ROUND(((hs.capacity_mw * 0.8 - GREATEST(hs.discharge_mw,0)) * hp.price)::numeric, 0) ELSE 0 END), 0) AS missed_rev
            FROM hourly_state hs LEFT JOIN hourly_prices hp ON hp.bucket = hs.bucket
              AND hp.market = CASE WHEN hs.timezone='America/Los_Angeles' THEN 'CAISO'
                WHEN hs.timezone='America/Chicago' THEN 'ERCOT' ELSE 'PJM' END
            GROUP BY hs.name ORDER BY missed_rev DESC`,
    rds: `WITH hourly_state AS (
            SELECT date_trunc('hour', t.ts) AS bucket, t.site_id,
                   AVG(t.state_of_charge_pct) AS soc, AVG(t.site_power_mw) AS power_mw,
                   AVG(t.discharge_power_mw) AS discharge_mw, s.capacity_mw, s.name, s.timezone
            FROM telemetry_raw t JOIN sites s ON s.site_id = t.site_id
            WHERE t.ts >= NOW() - INTERVAL '7 days'
            GROUP BY date_trunc('hour', t.ts), t.site_id, s.capacity_mw, s.name, s.timezone
          ),
          hourly_prices AS (
            SELECT date_trunc('hour', ts) AS bucket, market, AVG(price_usd_mwh) AS price
            FROM market_price_signals WHERE ts >= NOW() - INTERVAL '7 days' GROUP BY 1, market
          )
          SELECT hs.name, COUNT(*) FILTER (WHERE hp.price > 60) AS high_price_hours,
                 COALESCE(SUM(CASE WHEN hp.price > 60 AND hs.discharge_mw < hs.capacity_mw * 0.3 AND hs.soc > 20
                   THEN ROUND(((hs.capacity_mw * 0.8 - GREATEST(hs.discharge_mw,0)) * hp.price)::numeric, 0) ELSE 0 END), 0) AS missed_rev
          FROM hourly_state hs LEFT JOIN hourly_prices hp ON hp.bucket = hs.bucket
            AND hp.market = CASE WHEN hs.timezone='America/Los_Angeles' THEN 'CAISO'
              WHEN hs.timezone='America/Chicago' THEN 'ERCOT' ELSE 'PJM' END
          GROUP BY hs.name ORDER BY missed_rev DESC`,
  },

  // ---- Raw scan ----
  {
    name: 'Estimated telemetry row count',
    category: 'Raw Scan',
    tiger: `SELECT reltuples::BIGINT AS est_rows FROM pg_class WHERE relname = 'telemetry_raw'`,
    rds: `SELECT reltuples::BIGINT AS est_rows FROM pg_class WHERE relname = 'telemetry_raw'`,
  },
  {
    name: 'Raw telemetry scan (1 site, 1h)',
    category: 'Raw Scan',
    tiger: `SELECT * FROM telemetry_raw WHERE site_id = $1 AND ts > NOW() - INTERVAL '1 hour' ORDER BY ts DESC`,
    rds: `SELECT * FROM telemetry_raw WHERE site_id = $1 AND ts > NOW() - INTERVAL '1 hour' ORDER BY ts DESC`,
    params: [SITE_ID],
  },

  // ---- Storage / compression (Tiger Cloud advantage) ----
  {
    name: 'Table sizes',
    category: 'Storage',
    tiger: `SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
            pg_total_relation_size(c.oid) AS bytes
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND c.relname IN ('telemetry_raw','alarms_events','dispatch_commands','market_price_signals')
            ORDER BY pg_total_relation_size(c.oid) DESC`,
    rds: `SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
          pg_total_relation_size(c.oid) AS bytes
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname IN ('telemetry_raw','alarms_events','dispatch_commands','market_price_signals')
          ORDER BY pg_total_relation_size(c.oid) DESC`,
  },
];

// ============================================================
// Benchmark Runner
// ============================================================

interface RunResult {
  name: string;
  category: string;
  tigerMs: number[];
  rdsMs: number[];
  tigerRows: number;
  rdsRows: number;
  tigerMedian: number;
  rdsMedian: number;
  speedup: number;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function runQuery(pool: pg.Pool, sql: string, params?: unknown[]): Promise<{ ms: number; rows: number }> {
  const start = performance.now();
  const res = await pool.query(sql, params);
  const ms = performance.now() - start;
  return { ms, rows: res.rowCount || 0 };
}

async function main() {
  console.log('='.repeat(70));
  console.log('  BESS Demo: Tiger Cloud vs RDS PostgreSQL Benchmark');
  console.log('='.repeat(70));
  console.log(`  Warmup runs: ${WARMUP_RUNS} | Measured runs: ${MEASURED_RUNS}`);
  console.log(`  Queries: ${queries.length}`);
  console.log('');

  const tigerPool = new pg.Pool({ connectionString: TIGER_URL, ssl: { rejectUnauthorized: false }, max: 3, statement_timeout: 120000, query_timeout: 120000 });
  const rdsPool = new pg.Pool({ connectionString: RDS_URL, ssl: { rejectUnauthorized: false }, max: 3, statement_timeout: 120000, query_timeout: 120000 });

  // Handle pool errors gracefully
  tigerPool.on('error', () => {});
  rdsPool.on('error', () => {});

  // Verify connections
  const tigerVer = await tigerPool.query('SELECT version()');
  const rdsVer = await rdsPool.query('SELECT version()');
  console.log(`  Tiger Cloud: ${tigerVer.rows[0].version.split(' ').slice(0, 2).join(' ')}`);
  console.log(`  RDS:         ${rdsVer.rows[0].version.split(' ').slice(0, 2).join(' ')}`);

  // Check row counts (estimated, fast)
  try {
    const tigerCount = await tigerPool.query("SELECT reltuples::BIGINT AS est FROM pg_class WHERE relname = 'telemetry_raw'");
    const rdsCount = await rdsPool.query("SELECT reltuples::BIGINT AS est FROM pg_class WHERE relname = 'telemetry_raw'");
    console.log(`  Tiger rows:  ~${parseInt(tigerCount.rows[0]?.est || 0).toLocaleString()} (estimated)`);
    console.log(`  RDS rows:    ~${parseInt(rdsCount.rows[0]?.est || 0).toLocaleString()} (estimated)`);
  } catch { console.log('  (row count estimation failed)'); }
  console.log('');

  const results: RunResult[] = [];

  for (const q of queries) {
    process.stdout.write(`  ${q.name.padEnd(50)}`);

    // Warmup
    for (let i = 0; i < WARMUP_RUNS; i++) {
      try { await runQuery(tigerPool, q.tiger, q.params); } catch {}
      try { await runQuery(rdsPool, q.rds, q.params); } catch {}
    }

    // Measured runs
    const tigerMs: number[] = [];
    const rdsMs: number[] = [];
    let tigerRows = 0;
    let rdsRows = 0;

    for (let i = 0; i < MEASURED_RUNS; i++) {
      try {
        const t = await runQuery(tigerPool, q.tiger, q.params);
        tigerMs.push(t.ms);
        tigerRows = t.rows;
      } catch (err) {
        tigerMs.push(-1);
      }

      try {
        const r = await runQuery(rdsPool, q.rds, q.params);
        rdsMs.push(r.ms);
        rdsRows = r.rows;
      } catch (err) {
        rdsMs.push(-1);
      }
    }

    const tigerMedian = median(tigerMs.filter(m => m >= 0));
    const rdsMedian = median(rdsMs.filter(m => m >= 0));
    const speedup = rdsMedian > 0 ? rdsMedian / tigerMedian : 0;

    results.push({
      name: q.name,
      category: q.category,
      tigerMs,
      rdsMs,
      tigerRows,
      rdsRows,
      tigerMedian,
      rdsMedian,
      speedup,
    });

    const tigerStr = tigerMedian >= 0 ? `${tigerMedian.toFixed(0)}ms` : 'ERR';
    const rdsStr = rdsMedian >= 0 ? `${rdsMedian.toFixed(0)}ms` : 'ERR';
    const speedupStr = speedup > 1 ? `${speedup.toFixed(1)}x faster` : speedup > 0 ? `${(1 / speedup).toFixed(1)}x slower` : '';
    console.log(`Tiger: ${tigerStr.padStart(8)} | RDS: ${rdsStr.padStart(8)} | ${speedupStr}`);
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log('');
  console.log('='.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('='.repeat(70));
  console.log('');

  // Table header
  const hdr = `${'Query'.padEnd(45)} ${'Tiger'.padStart(10)} ${'RDS'.padStart(10)} ${'Speedup'.padStart(12)} ${'Winner'.padStart(8)}`;
  console.log(hdr);
  console.log('-'.repeat(hdr.length));

  let tigerWins = 0;
  let rdsWins = 0;
  let currentCategory = '';

  for (const r of results) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      console.log(`\n  [${currentCategory}]`);
    }

    const tigerStr = r.tigerMedian >= 0 ? `${r.tigerMedian.toFixed(0)}ms` : 'ERR';
    const rdsStr = r.rdsMedian >= 0 ? `${r.rdsMedian.toFixed(0)}ms` : 'ERR';
    let speedupStr: string;
    let winner: string;

    if (r.tigerMedian < 0 || r.rdsMedian < 0) {
      speedupStr = 'N/A';
      winner = '?';
    } else if (r.speedup > 1.1) {
      speedupStr = `${r.speedup.toFixed(1)}x`;
      winner = 'Tiger';
      tigerWins++;
    } else if (r.speedup < 0.9) {
      speedupStr = `${(1 / r.speedup).toFixed(1)}x`;
      winner = 'RDS';
      rdsWins++;
    } else {
      speedupStr = '~equal';
      winner = 'tie';
    }

    console.log(`  ${r.name.padEnd(43)} ${tigerStr.padStart(10)} ${rdsStr.padStart(10)} ${speedupStr.padStart(12)} ${winner.padStart(8)}`);
  }

  console.log('');
  console.log('-'.repeat(hdr.length));
  console.log(`  Tiger Cloud wins: ${tigerWins} | RDS wins: ${rdsWins} | Ties: ${results.length - tigerWins - rdsWins}`);
  console.log('');

  // Storage comparison
  console.log('  STORAGE COMPARISON:');
  const storageTiger = results.find(r => r.name === 'Table sizes');
  if (storageTiger) {
    try {
      const tRes = await tigerPool.query(queries.find(q => q.name === 'Table sizes')!.tiger);
      const rRes = await rdsPool.query(queries.find(q => q.name === 'Table sizes')!.rds);
      console.log('');
      console.log(`  ${'Table'.padEnd(25)} ${'Tiger Cloud'.padStart(15)} ${'RDS'.padStart(15)} ${'Ratio'.padStart(10)}`);
      console.log('  ' + '-'.repeat(65));

      let tigerTotal = 0;
      let rdsTotal = 0;

      for (const tRow of tRes.rows) {
        const rRow = rRes.rows.find((r: any) => r.relname === tRow.relname);
        const tBytes = parseInt(tRow.bytes);
        const rBytes = rRow ? parseInt(rRow.bytes) : 0;
        tigerTotal += tBytes;
        rdsTotal += rBytes;
        const ratio = tBytes > 0 ? (rBytes / tBytes).toFixed(1) + 'x' : 'N/A';
        console.log(`  ${tRow.relname.padEnd(25)} ${tRow.total_size.padStart(15)} ${(rRow?.total_size || 'N/A').padStart(15)} ${ratio.padStart(10)}`);
      }

      const tigerPretty = tigerTotal > 1e9 ? `${(tigerTotal / 1e9).toFixed(2)} GB` : `${(tigerTotal / 1e6).toFixed(0)} MB`;
      const rdsPretty = rdsTotal > 1e9 ? `${(rdsTotal / 1e9).toFixed(2)} GB` : `${(rdsTotal / 1e6).toFixed(0)} MB`;
      const storageRatio = tigerTotal > 0 ? (rdsTotal / tigerTotal).toFixed(1) : 'N/A';
      console.log('  ' + '-'.repeat(65));
      console.log(`  ${'TOTAL'.padEnd(25)} ${tigerPretty.padStart(15)} ${rdsPretty.padStart(15)} ${(storageRatio + 'x').padStart(10)}`);
    } catch (err) {
      console.log(`  Error getting storage stats: ${(err as Error).message}`);
    }
  }

  console.log('');
  console.log('='.repeat(70));

  await tigerPool.end();
  await rdsPool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
