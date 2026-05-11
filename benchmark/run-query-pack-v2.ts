#!/usr/bin/env npx tsx
/**
 * BESS Core Query Pack v2: Tiger Cloud vs RDS PostgreSQL
 * Runs all 10 queries against both databases.
 */

import pg from 'pg';

const TIGER_URL = process.env.TIGER_URL || 'postgresql://tsdbadmin:mwmnqt4xebbtcpbc@yptymhxg0b.n3fd3x7z3d.tsdb.cloud.timescale.com:39953/tsdb?sslmode=require';
const RDS_URL = process.env.RDS_URL || 'postgresql://RJB:wF%3A%3A0t.DMm-mPMGxbn%3Cqv~KAQaHz@rjb-bess-rds.c544ymuo4glo.eu-central-1.rds.amazonaws.com:5432/postgres?uselibpqcompat=true&sslmode=require';

const WARMUP = 2;
const RUNS = 5;
const SITE_ID = '00000000-0000-0000-0001-000000000001'; // Mojave

interface QueryDef {
  id: string;
  name: string;
  category: string;
  tiger: string;
  rds: string;
  params?: unknown[];
}

const queryPack: QueryDef[] = [
  // ── Category 1: Operational ──
  {
    id: 'Q1A', name: 'Latest Fleet State', category: 'Operational',
    tiger: `SELECT DISTINCT ON (s.site_id) s.site_id, s.name, t.bucket,
      ROUND(t.avg_site_power_mw::numeric,1) AS power, ROUND(t.avg_soc_pct::numeric,1) AS soc,
      ROUND(t.avg_soh_pct::numeric,1) AS soh
      FROM sites s JOIN telemetry_1min t ON t.site_id = s.site_id
      WHERE t.bucket > NOW() - INTERVAL '10 minutes' ORDER BY s.site_id, t.bucket DESC`,
    rds: `SELECT DISTINCT ON (s.site_id) s.site_id, s.name, t.ts,
      ROUND(t.site_power_mw::numeric,1) AS power, ROUND(t.state_of_charge_pct::numeric,1) AS soc,
      ROUND(t.state_of_health_pct::numeric,1) AS soh
      FROM sites s JOIN telemetry_raw t ON t.site_id = s.site_id
      WHERE t.ts > NOW() - INTERVAL '10 minutes' ORDER BY s.site_id, t.ts DESC`,
  },
  {
    id: 'Q1B', name: 'Active Alarms by Site', category: 'Operational',
    tiger: `SELECT s.name, a.severity, COUNT(*), MIN(a.ts) AS oldest
      FROM alarms_events a JOIN sites s ON s.site_id = a.site_id
      WHERE a.resolved_at IS NULL GROUP BY s.name, a.severity
      ORDER BY CASE a.severity WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END, count(*) DESC`,
    rds: `SELECT s.name, a.severity, COUNT(*), MIN(a.ts) AS oldest
      FROM alarms_events a JOIN sites s ON s.site_id = a.site_id
      WHERE a.resolved_at IS NULL GROUP BY s.name, a.severity
      ORDER BY CASE a.severity WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END, count(*) DESC`,
  },

  // ── Category 2: Historical ──
  {
    id: 'Q2A', name: 'Power Trend (24h, per-site)', category: 'Historical',
    tiger: `SELECT bucket AS time, avg_site_power_mw AS power, avg_soc_pct AS soc
      FROM telemetry_15min WHERE site_id = $1 AND bucket >= NOW() - INTERVAL '24 hours' ORDER BY bucket`,
    rds: `SELECT date_trunc('hour', ts) + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM ts)/15) AS time,
      AVG(site_power_mw) AS power, AVG(state_of_charge_pct) AS soc
      FROM telemetry_raw WHERE site_id = $1 AND ts >= NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY time`,
    params: [SITE_ID],
  },
  {
    id: 'Q2B', name: 'Asset Health Degradation (30d)', category: 'Historical',
    tiger: `WITH weekly_soh AS (
        SELECT site_id, CASE WHEN bucket >= NOW()-'7d' THEN 'now' WHEN bucket >= NOW()-'14d' THEN 'last_week'
          WHEN bucket >= NOW()-'30d' THEN 'month_ago' END AS period, AVG(avg_soh_pct) AS avg_soh
        FROM telemetry_1hour WHERE bucket >= NOW() - INTERVAL '30 days' GROUP BY site_id, period
      ), pivoted AS (
        SELECT site_id, MAX(CASE WHEN period='now' THEN avg_soh END) AS soh_now,
          MAX(CASE WHEN period='last_week' THEN avg_soh END) AS soh_lw,
          MAX(CASE WHEN period='month_ago' THEN avg_soh END) AS soh_mo
        FROM weekly_soh WHERE period IS NOT NULL GROUP BY site_id
      )
      SELECT s.name, ROUND(p.soh_now::numeric,2) AS soh_now, ROUND((p.soh_now-p.soh_mo)::numeric,3) AS degradation,
        CASE WHEN (p.soh_now-p.soh_mo)*12 < -2 THEN 'CRITICAL' WHEN (p.soh_now-p.soh_mo)*12 < -1 THEN 'WATCH' ELSE 'NORMAL' END AS status
      FROM pivoted p JOIN sites s ON s.site_id = p.site_id ORDER BY degradation ASC`,
    rds: `WITH weekly_soh AS (
        SELECT site_id, CASE WHEN ts >= NOW()-INTERVAL '7 days' THEN 'now' WHEN ts >= NOW()-INTERVAL '14 days' THEN 'last_week'
          WHEN ts >= NOW()-INTERVAL '30 days' THEN 'month_ago' END AS period, AVG(state_of_health_pct) AS avg_soh
        FROM telemetry_raw WHERE ts >= NOW() - INTERVAL '30 days' GROUP BY site_id, period
      ), pivoted AS (
        SELECT site_id, MAX(CASE WHEN period='now' THEN avg_soh END) AS soh_now,
          MAX(CASE WHEN period='last_week' THEN avg_soh END) AS soh_lw,
          MAX(CASE WHEN period='month_ago' THEN avg_soh END) AS soh_mo
        FROM weekly_soh WHERE period IS NOT NULL GROUP BY site_id
      )
      SELECT s.name, ROUND(p.soh_now::numeric,2) AS soh_now, ROUND((p.soh_now-p.soh_mo)::numeric,3) AS degradation,
        CASE WHEN (p.soh_now-p.soh_mo)*12 < -2 THEN 'CRITICAL' WHEN (p.soh_now-p.soh_mo)*12 < -1 THEN 'WATCH' ELSE 'NORMAL' END AS status
      FROM pivoted p JOIN sites s ON s.site_id = p.site_id ORDER BY degradation ASC`,
  },

  // ── Category 3: Dashboard ──
  {
    id: 'Q3A', name: 'Multi-Resolution (7d, 15min)', category: 'Dashboard',
    tiger: `SELECT bucket AS time, avg_site_power_mw AS power, avg_soc_pct AS soc
      FROM telemetry_15min WHERE site_id = $1 AND bucket >= NOW() - INTERVAL '7 days' ORDER BY bucket`,
    rds: `SELECT date_trunc('hour', ts) + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM ts)/15) AS time,
      AVG(site_power_mw) AS power, AVG(state_of_charge_pct) AS soc
      FROM telemetry_raw WHERE site_id = $1 AND ts >= NOW() - INTERVAL '7 days'
      GROUP BY 1 ORDER BY time`,
    params: [SITE_ID],
  },
  {
    id: 'Q3B', name: 'Fleet Utilization Ranking (24h)', category: 'Dashboard',
    tiger: `SELECT s.name, s.capacity_mw, ROUND(AVG(t.avg_site_power_mw)::numeric,1) AS avg_power,
      ROUND((AVG(t.avg_site_power_mw)/NULLIF(s.capacity_mw,0)*100)::numeric,1) AS util_pct,
      ROUND(AVG(t.avg_soc_pct)::numeric,1) AS soc, ROUND(AVG(t.avg_rte)::numeric,1) AS rte
      FROM telemetry_15min t JOIN sites s ON s.site_id = t.site_id
      WHERE t.bucket >= NOW() - INTERVAL '24 hours' GROUP BY s.name, s.capacity_mw ORDER BY util_pct DESC`,
    rds: `SELECT s.name, s.capacity_mw, ROUND(AVG(t.site_power_mw)::numeric,1) AS avg_power,
      ROUND((AVG(t.site_power_mw)/NULLIF(s.capacity_mw,0)*100)::numeric,1) AS util_pct,
      ROUND(AVG(t.state_of_charge_pct)::numeric,1) AS soc, ROUND(AVG(t.round_trip_efficiency)::numeric,1) AS rte
      FROM telemetry_raw t JOIN sites s ON s.site_id = t.site_id
      WHERE t.ts >= NOW() - INTERVAL '24 hours' GROUP BY s.name, s.capacity_mw ORDER BY util_pct DESC`,
  },

  // ── Category 4: Decisioning ──
  {
    id: 'Q4A', name: 'Dispatch Readiness (scored)', category: 'Decisioning',
    tiger: `WITH latest AS (
        SELECT DISTINCT ON (site_id) site_id, avg_soc_pct AS soc, avg_soh_pct AS soh, avg_site_power_mw AS power
        FROM telemetry_1min WHERE bucket > NOW()-'10 min' ORDER BY site_id, bucket DESC
      ), alarms AS (
        SELECT site_id, COUNT(*) AS cnt FROM alarms_events WHERE resolved_at IS NULL AND severity IN ('critical','emergency') GROUP BY site_id
      )
      SELECT s.name, ROUND(lt.soc::numeric,1) AS soc, COALESCE(al.cnt,0) AS alarms,
        ROUND((lt.soc/100.0*s.capacity_mwh*0.85)::numeric,1) AS avail_mwh,
        ROUND(GREATEST(0,LEAST(100, lt.soc*0.5+(lt.soh-90)*5-COALESCE(al.cnt,0)*25))::numeric,0) AS score
      FROM sites s LEFT JOIN latest lt ON lt.site_id=s.site_id LEFT JOIN alarms al ON al.site_id=s.site_id ORDER BY score DESC`,
    rds: `WITH latest AS (
        SELECT DISTINCT ON (site_id) site_id, state_of_charge_pct AS soc, state_of_health_pct AS soh, site_power_mw AS power
        FROM telemetry_raw WHERE ts > NOW()-INTERVAL '10 minutes' ORDER BY site_id, ts DESC
      ), alarms AS (
        SELECT site_id, COUNT(*) AS cnt FROM alarms_events WHERE resolved_at IS NULL AND severity IN ('critical','emergency') GROUP BY site_id
      )
      SELECT s.name, ROUND(lt.soc::numeric,1) AS soc, COALESCE(al.cnt,0) AS alarms,
        ROUND((lt.soc/100.0*s.capacity_mwh*0.85)::numeric,1) AS avail_mwh,
        ROUND(GREATEST(0,LEAST(100, lt.soc*0.5+(lt.soh-90)*5-COALESCE(al.cnt,0)*25))::numeric,0) AS score
      FROM sites s LEFT JOIN latest lt ON lt.site_id=s.site_id LEFT JOIN alarms al ON al.site_id=s.site_id ORDER BY score DESC`,
  },
  {
    id: 'Q4B', name: 'Revenue Opportunity (real-time)', category: 'Decisioning',
    tiger: `WITH latest AS (
        SELECT DISTINCT ON (site_id) site_id, avg_soc_pct AS soc, avg_site_power_mw AS power
        FROM telemetry_1min WHERE bucket > NOW()-'10 min' ORDER BY site_id, bucket DESC
      ), prices AS (
        SELECT DISTINCT ON (market) market, price_usd_mwh FROM market_price_signals WHERE ts > NOW()-'30 min' ORDER BY market, ts DESC
      )
      SELECT s.name, lp.market, ROUND(lp.price_usd_mwh::numeric,2) AS price,
        ROUND(GREATEST(0,s.capacity_mw-GREATEST(lt.power,0))::numeric,1) AS avail_mw,
        ROUND((GREATEST(0,s.capacity_mw-GREATEST(lt.power,0))*lp.price_usd_mwh)::numeric,0) AS rev_per_hr
      FROM sites s LEFT JOIN latest lt ON lt.site_id=s.site_id
      CROSS JOIN prices lp WHERE lp.market = CASE WHEN s.timezone IN ('America/Los_Angeles','America/Phoenix') THEN 'CAISO'
        WHEN s.timezone='America/Chicago' THEN 'ERCOT' ELSE 'PJM' END
      ORDER BY rev_per_hr DESC`,
    rds: `WITH latest AS (
        SELECT DISTINCT ON (site_id) site_id, state_of_charge_pct AS soc, site_power_mw AS power
        FROM telemetry_raw WHERE ts > NOW()-INTERVAL '10 minutes' ORDER BY site_id, ts DESC
      ), prices AS (
        SELECT DISTINCT ON (market) market, price_usd_mwh FROM market_price_signals WHERE ts > NOW()-INTERVAL '30 minutes' ORDER BY market, ts DESC
      )
      SELECT s.name, lp.market, ROUND(lp.price_usd_mwh::numeric,2) AS price,
        ROUND(GREATEST(0,s.capacity_mw-GREATEST(lt.power,0))::numeric,1) AS avail_mw,
        ROUND((GREATEST(0,s.capacity_mw-GREATEST(lt.power,0))*lp.price_usd_mwh)::numeric,0) AS rev_per_hr
      FROM sites s LEFT JOIN latest lt ON lt.site_id=s.site_id
      CROSS JOIN prices lp WHERE lp.market = CASE WHEN s.timezone IN ('America/Los_Angeles','America/Phoenix') THEN 'CAISO'
        WHEN s.timezone='America/Chicago' THEN 'ERCOT' ELSE 'PJM' END
      ORDER BY rev_per_hr DESC`,
  },

  // ── Category 5: Revenue & Proof ──
  {
    id: 'Q5A', name: 'Missed Revenue (7d)', category: 'Revenue Analytics',
    tiger: `WITH hourly_state AS (
        SELECT t.bucket, t.site_id, t.avg_soc_pct AS soc, t.avg_discharge_power_mw AS discharge_mw,
          s.capacity_mw, s.name, s.timezone
        FROM telemetry_1hour t JOIN sites s ON s.site_id=t.site_id WHERE t.bucket >= NOW()-'7 days'
      ), hourly_prices AS (
        SELECT time_bucket('1 hour', ts) AS bucket, market, AVG(price_usd_mwh) AS price
        FROM market_price_signals WHERE ts >= NOW()-'7 days' GROUP BY 1, market
      )
      SELECT hs.name, COUNT(*) FILTER (WHERE hp.price > 60) AS high_price_hrs,
        COALESCE(SUM(CASE WHEN hp.price>60 AND hs.discharge_mw<hs.capacity_mw*0.3 AND hs.soc>20
          THEN ROUND(((hs.capacity_mw*0.8-GREATEST(hs.discharge_mw,0))*hp.price)::numeric,0) ELSE 0 END),0) AS missed_rev
      FROM hourly_state hs LEFT JOIN hourly_prices hp ON hp.bucket=hs.bucket
        AND hp.market = CASE WHEN hs.timezone IN ('America/Los_Angeles','America/Phoenix') THEN 'CAISO'
          WHEN hs.timezone='America/Chicago' THEN 'ERCOT' ELSE 'PJM' END
      GROUP BY hs.name, hs.site_id ORDER BY missed_rev DESC`,
    rds: `WITH hourly_state AS (
        SELECT date_trunc('hour', t.ts) AS bucket, t.site_id, AVG(t.state_of_charge_pct) AS soc,
          AVG(t.discharge_power_mw) AS discharge_mw, s.capacity_mw, s.name, s.timezone
        FROM telemetry_raw t JOIN sites s ON s.site_id=t.site_id WHERE t.ts >= NOW()-INTERVAL '7 days'
        GROUP BY date_trunc('hour', t.ts), t.site_id, s.capacity_mw, s.name, s.timezone
      ), hourly_prices AS (
        SELECT date_trunc('hour', ts) AS bucket, market, AVG(price_usd_mwh) AS price
        FROM market_price_signals WHERE ts >= NOW()-INTERVAL '7 days' GROUP BY 1, market
      )
      SELECT hs.name, COUNT(*) FILTER (WHERE hp.price > 60) AS high_price_hrs,
        COALESCE(SUM(CASE WHEN hp.price>60 AND hs.discharge_mw<hs.capacity_mw*0.3 AND hs.soc>20
          THEN ROUND(((hs.capacity_mw*0.8-GREATEST(hs.discharge_mw,0))*hp.price)::numeric,0) ELSE 0 END),0) AS missed_rev
      FROM hourly_state hs LEFT JOIN hourly_prices hp ON hp.bucket=hs.bucket
        AND hp.market = CASE WHEN hs.timezone IN ('America/Los_Angeles','America/Phoenix') THEN 'CAISO'
          WHEN hs.timezone='America/Chicago' THEN 'ERCOT' ELSE 'PJM' END
      GROUP BY hs.name, hs.site_id ORDER BY missed_rev DESC`,
  },
  {
    id: 'Q5B', name: 'Platform Proof', category: 'Platform',
    tiger: `SELECT
      (SELECT reltuples::bigint FROM pg_class WHERE relname='telemetry_raw') AS est_rows,
      (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE hypertable_name='telemetry_raw') AS chunks,
      (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE hypertable_name='telemetry_raw' AND is_compressed) AS compressed,
      (SELECT COUNT(*) FROM timescaledb_information.continuous_aggregates) AS caggs,
      pg_size_pretty(pg_database_size(current_database())) AS db_size`,
    rds: `SELECT
      (SELECT reltuples::bigint FROM pg_class WHERE relname='telemetry_raw') AS est_rows,
      pg_size_pretty(pg_total_relation_size('telemetry_raw')) AS telemetry_size,
      pg_size_pretty(pg_database_size(current_database())) AS db_size,
      'N/A' AS chunks, 'N/A' AS caggs`,
  },
];

// ── Runner ──

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function runQuery(pool: pg.Pool, sql: string, params?: unknown[]): Promise<{ ms: number; rows: number }> {
  const start = performance.now();
  const res = await pool.query(sql, params);
  return { ms: performance.now() - start, rows: res.rowCount || 0 };
}

async function main() {
  const tigerPool = new pg.Pool({ connectionString: TIGER_URL, ssl: { rejectUnauthorized: false }, max: 3, statement_timeout: 120000, query_timeout: 120000 });
  const rdsPool = new pg.Pool({ connectionString: RDS_URL, ssl: { rejectUnauthorized: false }, max: 3, statement_timeout: 120000, query_timeout: 120000 });
  tigerPool.on('error', () => {});
  rdsPool.on('error', () => {});

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║       BESS Core Query Pack v2 — Tiger Cloud vs RDS PostgreSQL       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const tv = await tigerPool.query('SELECT version()');
  const rv = await rdsPool.query('SELECT version()');
  console.log(`  Tiger Cloud : ${tv.rows[0].version.split(',')[0]}`);
  console.log(`  RDS         : ${rv.rows[0].version.split(',')[0]}`);

  try {
    const tc = await tigerPool.query("SELECT reltuples::bigint AS est FROM pg_class WHERE relname='telemetry_raw'");
    const rc = await rdsPool.query("SELECT reltuples::bigint AS est FROM pg_class WHERE relname='telemetry_raw'");
    console.log(`  Tiger rows  : ~${parseInt(tc.rows[0]?.est || 0).toLocaleString()}`);
    console.log(`  RDS rows    : ~${parseInt(rc.rows[0]?.est || 0).toLocaleString()}`);
  } catch {}
  console.log(`  Warmup: ${WARMUP} | Measured runs: ${RUNS}`);
  console.log('');

  interface Result {
    id: string; name: string; category: string;
    tigerMedian: number; rdsMedian: number; tigerRows: number; rdsRows: number;
  }
  const results: Result[] = [];
  let currentCat = '';

  for (const q of queryPack) {
    if (q.category !== currentCat) { currentCat = q.category; console.log(`\n  ── ${currentCat} ${'─'.repeat(55 - currentCat.length)}`); }
    process.stdout.write(`  ${q.id}  ${q.name.padEnd(40)}`);

    for (let i = 0; i < WARMUP; i++) {
      try { await runQuery(tigerPool, q.tiger, q.params); } catch {}
      try { await runQuery(rdsPool, q.rds, q.params); } catch {}
    }

    const tTimes: number[] = [], rTimes: number[] = [];
    let tRows = 0, rRows = 0;
    for (let i = 0; i < RUNS; i++) {
      try { const r = await runQuery(tigerPool, q.tiger, q.params); tTimes.push(r.ms); tRows = r.rows; } catch { tTimes.push(-1); }
      try { const r = await runQuery(rdsPool, q.rds, q.params); rTimes.push(r.ms); rRows = r.rows; } catch { rTimes.push(-1); }
    }

    const tMed = median(tTimes.filter(t => t >= 0));
    const rMed = median(rTimes.filter(t => t >= 0));
    results.push({ id: q.id, name: q.name, category: q.category, tigerMedian: tMed, rdsMedian: rMed, tigerRows: tRows, rdsRows: rRows });

    const tStr = tMed >= 0 ? `${tMed.toFixed(0)}ms` : 'ERR';
    const rStr = rMed >= 0 ? `${rMed.toFixed(0)}ms` : 'ERR';
    let cmp = '';
    if (tMed > 0 && rMed > 0) {
      const ratio = rMed / tMed;
      if (ratio > 1.1) cmp = `Tiger ${ratio.toFixed(1)}x faster`;
      else if (ratio < 0.9) cmp = `RDS ${(1/ratio).toFixed(1)}x faster`;
      else cmp = '~equal';
    }
    console.log(`${tStr.padStart(8)} │ ${rStr.padStart(8)} │ ${cmp}`);
  }

  // Summary
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                         RESULTS SUMMARY                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const hdr = `  ${'ID'.padEnd(5)} ${'Query'.padEnd(38)} ${'Tiger (p50)'.padStart(12)} ${'RDS (p50)'.padStart(12)} ${'Rows T/R'.padStart(12)} ${'Winner'.padStart(15)}`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));

  let tigerWins = 0, rdsWins = 0;
  for (const r of results) {
    const tStr = r.tigerMedian >= 0 ? `${r.tigerMedian.toFixed(0)}ms` : 'ERR';
    const rStr = r.rdsMedian >= 0 ? `${r.rdsMedian.toFixed(0)}ms` : 'ERR';
    const rowsStr = `${r.tigerRows}/${r.rdsRows}`;
    let winner = 'tie';
    if (r.tigerMedian > 0 && r.rdsMedian > 0) {
      const ratio = r.rdsMedian / r.tigerMedian;
      if (ratio > 1.1) { winner = `Tiger ${ratio.toFixed(1)}x`; tigerWins++; }
      else if (ratio < 0.9) { winner = `RDS ${(1/ratio).toFixed(1)}x`; rdsWins++; }
    }
    console.log(`  ${r.id.padEnd(5)} ${r.name.padEnd(38)} ${tStr.padStart(12)} ${rStr.padStart(12)} ${rowsStr.padStart(12)} ${winner.padStart(15)}`);
  }

  console.log('  ' + '─'.repeat(hdr.length - 2));
  console.log(`  Tiger wins: ${tigerWins} | RDS wins: ${rdsWins} | Ties: ${results.length - tigerWins - rdsWins}`);

  // Storage
  console.log('\n  STORAGE:');
  try {
    const ts = await tigerPool.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS s");
    const rs = await rdsPool.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS s");
    const rt = await rdsPool.query("SELECT pg_size_pretty(pg_total_relation_size('telemetry_raw')) AS s");
    console.log(`    Tiger Cloud DB:  ${ts.rows[0].s}`);
    console.log(`    RDS DB:          ${rs.rows[0].s} (telemetry: ${rt.rows[0].s})`);
  } catch {}

  console.log('\n' + '═'.repeat(72));

  await tigerPool.end();
  await rdsPool.end();
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
