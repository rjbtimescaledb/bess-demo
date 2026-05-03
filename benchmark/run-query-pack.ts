#!/usr/bin/env npx tsx
/**
 * BESS Query Pack v1: Tiger Cloud vs RDS PostgreSQL
 * Runs every query from bess_query_pack_v1.md against both databases.
 */

import pg from 'pg';

const TIGER_URL = process.env.TIGER_URL || 'postgresql://tsdbadmin:mwmnqt4xebbtcpbc@yptymhxg0b.n3fd3x7z3d.tsdb.cloud.timescale.com:39953/tsdb?sslmode=require';
const RDS_URL = process.env.RDS_URL || 'postgresql://RJB:wF%3A%3A0t.DMm-mPMGxbn%3Cqv~KAQaHz@rjb-bess-rds.c544ymuo4glo.eu-central-1.rds.amazonaws.com:5432/postgres?uselibpqcompat=true&sslmode=require';

const WARMUP = 2;
const RUNS = 5;

interface QueryDef {
  id: string;
  name: string;
  section: string;
  tiger: string;
  rds: string;
  explain?: boolean; // run EXPLAIN ANALYZE version too
}

// ============================================================
// Query Pack v1 — adapted for both Tiger Cloud and RDS
// ============================================================

const queryPack: QueryDef[] = [
  // --- Section 1: Real-Time Operations ---
  {
    id: 'Q1',
    name: 'Latest Fleet State',
    section: 'Real-Time Operations',
    tiger: `
      SELECT DISTINCT ON (s.site_id)
        s.site_id, s.name AS site_name, t.bucket AS latest_time,
        t.avg_site_power_mw, t.avg_soc_pct AS soc_pct,
        t.avg_soh_pct AS soh_pct, t.avg_inverter_temp_c, t.avg_rack_temp_c
      FROM public.sites s
      JOIN public.telemetry_1min t ON t.site_id = s.site_id
      ORDER BY s.site_id, t.bucket DESC`,
    rds: `
      SELECT DISTINCT ON (s.site_id)
        s.site_id, s.name AS site_name, t.ts AS latest_time,
        t.site_power_mw AS avg_site_power_mw, t.state_of_charge_pct AS soc_pct,
        t.state_of_health_pct AS soh_pct, t.inverter_temp_c AS avg_inverter_temp_c,
        t.rack_temp_c AS avg_rack_temp_c
      FROM public.sites s
      JOIN public.telemetry_raw t ON t.site_id = s.site_id
      ORDER BY s.site_id, t.ts DESC`,
  },
  {
    id: 'Q7',
    name: 'Dispatch Readiness',
    section: 'Real-Time Operations',
    tiger: `
      SELECT s.name AS site_name, l.avg_soc_pct, l.avg_soh_pct,
        CASE WHEN l.avg_soc_pct >= 60 AND l.avg_soh_pct >= 95 THEN 'READY' ELSE 'NOT_READY' END AS status
      FROM (
        SELECT DISTINCT ON (site_id) site_id, avg_soc_pct, avg_soh_pct
        FROM public.telemetry_1min ORDER BY site_id, bucket DESC
      ) l
      JOIN public.sites s ON s.site_id = l.site_id`,
    rds: `
      SELECT s.name AS site_name, l.state_of_charge_pct AS avg_soc_pct,
        l.state_of_health_pct AS avg_soh_pct,
        CASE WHEN l.state_of_charge_pct >= 60 AND l.state_of_health_pct >= 95 THEN 'READY' ELSE 'NOT_READY' END AS status
      FROM (
        SELECT DISTINCT ON (site_id) site_id, state_of_charge_pct, state_of_health_pct
        FROM public.telemetry_raw ORDER BY site_id, ts DESC
      ) l
      JOIN public.sites s ON s.site_id = l.site_id`,
  },
  {
    id: 'Q8',
    name: 'Revenue Opportunity',
    section: 'Real-Time Operations',
    tiger: `
      SELECT s.name AS site_name, o.region, lp.market, lp.price_usd_mwh,
        ls.avg_soc_pct, s.capacity_mw
      FROM (
        SELECT DISTINCT ON (site_id) site_id, avg_soc_pct
        FROM public.telemetry_1min ORDER BY site_id, bucket DESC
      ) ls
      JOIN public.sites s ON s.site_id = ls.site_id
      JOIN public.organizations o ON o.org_id = s.org_id
      LEFT JOIN (
        SELECT DISTINCT ON (region) region, market, price_usd_mwh
        FROM public.market_price_signals ORDER BY region, ts DESC
      ) lp ON lp.region = o.region
      ORDER BY lp.price_usd_mwh DESC`,
    rds: `
      SELECT s.name AS site_name, o.region, lp.market, lp.price_usd_mwh,
        ls.state_of_charge_pct AS avg_soc_pct, s.capacity_mw
      FROM (
        SELECT DISTINCT ON (site_id) site_id, state_of_charge_pct
        FROM public.telemetry_raw ORDER BY site_id, ts DESC
      ) ls
      JOIN public.sites s ON s.site_id = ls.site_id
      JOIN public.organizations o ON o.org_id = s.org_id
      LEFT JOIN (
        SELECT DISTINCT ON (region) region, market, price_usd_mwh
        FROM public.market_price_signals ORDER BY region, ts DESC
      ) lp ON lp.region = o.region
      ORDER BY lp.price_usd_mwh DESC`,
  },

  // --- Section 5: Timescale Proof ---
  {
    id: 'Q13',
    name: 'Raw Aggregation (15min bucket, 1h)',
    section: 'Timescale Proof',
    explain: true,
    tiger: `
      SELECT
        time_bucket('15 minutes', ts) AS bucket,
        avg(site_power_mw),
        avg(state_of_charge_pct)
      FROM public.telemetry_raw
      WHERE ts >= now() - INTERVAL '1 hour'
      GROUP BY bucket`,
    rds: `
      SELECT
        date_trunc('hour', ts) + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM ts) / 15) AS bucket,
        avg(site_power_mw),
        avg(state_of_charge_pct)
      FROM public.telemetry_raw
      WHERE ts >= now() - INTERVAL '1 hour'
      GROUP BY 1`,
  },
  {
    id: 'Q14',
    name: 'CAGG Aggregation (15min, 1h)',
    section: 'Timescale Proof',
    explain: true,
    tiger: `
      SELECT bucket, avg_site_power_mw, avg_soc_pct
      FROM public.telemetry_15min
      WHERE bucket >= now() - INTERVAL '1 hour'`,
    rds: `
      SELECT
        date_trunc('hour', ts) + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM ts) / 15) AS bucket,
        avg(site_power_mw) AS avg_site_power_mw,
        avg(state_of_charge_pct) AS avg_soc_pct
      FROM public.telemetry_raw
      WHERE ts >= now() - INTERVAL '1 hour'
      GROUP BY 1`,
  },
  {
    id: 'Q15',
    name: 'Compression Stats',
    section: 'Timescale Proof',
    tiger: `
      SELECT hypertable_name, total_chunks, compressed_chunks,
             pg_size_pretty(before_compression_total_bytes) AS before_size,
             pg_size_pretty(after_compression_total_bytes) AS after_size,
             ROUND(before_compression_total_bytes::numeric / NULLIF(after_compression_total_bytes,0), 1) AS ratio
      FROM timescaledb_information.hypertable_compression_stats
      WHERE hypertable_name = 'telemetry_raw'`,
    rds: `
      SELECT 'telemetry_raw' AS table_name,
             pg_size_pretty(pg_total_relation_size('telemetry_raw')) AS total_size,
             pg_size_pretty(pg_table_size('telemetry_raw')) AS data_size,
             pg_size_pretty(pg_indexes_size('telemetry_raw')) AS index_size,
             'N/A (no compression)' AS compression_ratio`,
  },
];

// ============================================================
// Runner
// ============================================================

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function p95(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)] || s[s.length - 1];
}

async function runQuery(pool: pg.Pool, sql: string): Promise<{ ms: number; rows: number; data: any[] }> {
  const start = performance.now();
  const res = await pool.query(sql);
  return { ms: performance.now() - start, rows: res.rowCount || 0, data: res.rows };
}

async function main() {
  const tigerPool = new pg.Pool({
    connectionString: TIGER_URL, ssl: { rejectUnauthorized: false },
    max: 3, statement_timeout: 120000, query_timeout: 120000,
  });
  const rdsPool = new pg.Pool({
    connectionString: RDS_URL, ssl: { rejectUnauthorized: false },
    max: 3, statement_timeout: 120000, query_timeout: 120000,
  });
  tigerPool.on('error', () => {});
  rdsPool.on('error', () => {});

  // Header
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║         BESS Query Pack v1 — Tiger Cloud vs RDS PostgreSQL          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Connection info
  const tv = await tigerPool.query('SELECT version()');
  const rv = await rdsPool.query('SELECT version()');
  console.log(`  Tiger Cloud : ${tv.rows[0].version.split(',')[0]}`);
  console.log(`  RDS         : ${rv.rows[0].version.split(',')[0]}`);
  console.log(`  Warmup: ${WARMUP} | Measured runs: ${RUNS}`);
  console.log('');

  interface Result {
    id: string;
    name: string;
    section: string;
    tigerMedian: number;
    tigerP95: number;
    tigerRows: number;
    tigerData: any[];
    rdsMedian: number;
    rdsP95: number;
    rdsRows: number;
    rdsData: any[];
    tigerErr?: string;
    rdsErr?: string;
  }

  const results: Result[] = [];
  let currentSection = '';

  for (const q of queryPack) {
    if (q.section !== currentSection) {
      currentSection = q.section;
      console.log(`\n  ── ${currentSection} ${'─'.repeat(55 - currentSection.length)}`);
    }

    process.stdout.write(`  ${q.id} ${q.name.padEnd(45)}`);

    // Warmup
    for (let i = 0; i < WARMUP; i++) {
      try { await runQuery(tigerPool, q.tiger); } catch {}
      try { await runQuery(rdsPool, q.rds); } catch {}
    }

    // Measured
    const tigerTimes: number[] = [];
    const rdsTimes: number[] = [];
    let tigerRows = 0, rdsRows = 0;
    let tigerData: any[] = [], rdsData: any[] = [];
    let tigerErr: string | undefined, rdsErr: string | undefined;

    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await runQuery(tigerPool, q.tiger);
        tigerTimes.push(r.ms);
        tigerRows = r.rows;
        if (i === 0) tigerData = r.data;
      } catch (e) {
        tigerErr = (e as Error).message.slice(0, 60);
        tigerTimes.push(-1);
      }
      try {
        const r = await runQuery(rdsPool, q.rds);
        rdsTimes.push(r.ms);
        rdsRows = r.rows;
        if (i === 0) rdsData = r.data;
      } catch (e) {
        rdsErr = (e as Error).message.slice(0, 60);
        rdsTimes.push(-1);
      }
    }

    const validTiger = tigerTimes.filter(t => t >= 0);
    const validRds = rdsTimes.filter(t => t >= 0);
    const tMed = validTiger.length ? median(validTiger) : -1;
    const rMed = validRds.length ? median(validRds) : -1;
    const tP95 = validTiger.length ? p95(validTiger) : -1;
    const rP95 = validRds.length ? p95(validRds) : -1;

    results.push({
      id: q.id, name: q.name, section: q.section,
      tigerMedian: tMed, tigerP95: tP95, tigerRows, tigerData,
      rdsMedian: rMed, rdsP95: rP95, rdsRows, rdsData,
      tigerErr, rdsErr,
    });

    // Print inline result
    const tStr = tMed >= 0 ? `${tMed.toFixed(0)}ms` : 'ERR';
    const rStr = rMed >= 0 ? `${rMed.toFixed(0)}ms` : 'ERR';
    let comparison = '';
    if (tMed > 0 && rMed > 0) {
      const ratio = rMed / tMed;
      if (ratio > 1.1) comparison = `Tiger ${ratio.toFixed(1)}x faster`;
      else if (ratio < 0.9) comparison = `RDS ${(1/ratio).toFixed(1)}x faster`;
      else comparison = '~equal';
    }
    console.log(`${tStr.padStart(8)} │ ${rStr.padStart(8)} │ ${comparison}`);
  }

  // ============================================================
  // EXPLAIN ANALYZE for proof queries
  // ============================================================
  console.log('\n');
  console.log('  ── EXPLAIN ANALYZE (Q13 & Q14) ─────────────────────────────────────');

  for (const q of queryPack.filter(q => q.explain)) {
    console.log(`\n  ${q.id} — ${q.name}`);

    console.log('  Tiger Cloud:');
    try {
      const res = await tigerPool.query('EXPLAIN ANALYZE ' + q.tiger);
      for (const row of res.rows) {
        console.log(`    ${row['QUERY PLAN']}`);
      }
    } catch (e) {
      console.log(`    ERROR: ${(e as Error).message.slice(0, 80)}`);
    }

    console.log('  RDS:');
    try {
      const res = await rdsPool.query('EXPLAIN ANALYZE ' + q.rds);
      for (const row of res.rows) {
        console.log(`    ${row['QUERY PLAN']}`);
      }
    } catch (e) {
      console.log(`    ERROR: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  // ============================================================
  // Summary Table
  // ============================================================
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                         RESULTS SUMMARY                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const hdr = `  ${'ID'.padEnd(5)} ${'Query'.padEnd(40)} ${'Tiger (p50)'.padStart(12)} ${'RDS (p50)'.padStart(12)} ${'Tiger (p95)'.padStart(12)} ${'RDS (p95)'.padStart(12)} ${'Rows T/R'.padStart(12)} ${'Winner'.padStart(10)}`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));

  let tigerWins = 0, rdsWins = 0;

  for (const r of results) {
    const tStr = r.tigerMedian >= 0 ? `${r.tigerMedian.toFixed(0)}ms` : r.tigerErr?.slice(0, 8) || 'ERR';
    const rStr = r.rdsMedian >= 0 ? `${r.rdsMedian.toFixed(0)}ms` : r.rdsErr?.slice(0, 8) || 'ERR';
    const tP95Str = r.tigerP95 >= 0 ? `${r.tigerP95.toFixed(0)}ms` : '-';
    const rP95Str = r.rdsP95 >= 0 ? `${r.rdsP95.toFixed(0)}ms` : '-';
    const rowsStr = `${r.tigerRows}/${r.rdsRows}`;

    let winner = 'tie';
    if (r.tigerMedian > 0 && r.rdsMedian > 0) {
      const ratio = r.rdsMedian / r.tigerMedian;
      if (ratio > 1.1) { winner = `Tiger ${ratio.toFixed(1)}x`; tigerWins++; }
      else if (ratio < 0.9) { winner = `RDS ${(1/ratio).toFixed(1)}x`; rdsWins++; }
    }

    console.log(`  ${r.id.padEnd(5)} ${r.name.padEnd(40)} ${tStr.padStart(12)} ${rStr.padStart(12)} ${tP95Str.padStart(12)} ${rP95Str.padStart(12)} ${rowsStr.padStart(12)} ${winner.padStart(10)}`);
  }

  console.log('  ' + '─'.repeat(hdr.length - 2));
  console.log(`  Tiger wins: ${tigerWins} | RDS wins: ${rdsWins} | Ties: ${results.length - tigerWins - rdsWins}`);

  // ============================================================
  // Q15 — Compression / Storage comparison
  // ============================================================
  console.log('\n');
  console.log('  ── Storage & Compression (Q15) ─────────────────────────────────────');
  const q15 = results.find(r => r.id === 'Q15');
  if (q15) {
    console.log('\n  Tiger Cloud (TimescaleDB compression):');
    if (q15.tigerData.length) {
      for (const row of q15.tigerData) {
        console.log(`    Hypertable: ${row.hypertable_name}`);
        console.log(`    Chunks: ${row.total_chunks} total, ${row.compressed_chunks} compressed`);
        console.log(`    Before: ${row.before_size} → After: ${row.after_size} (${row.ratio}x compression)`);
      }
    } else {
      console.log('    No compression data available');
    }

    console.log('\n  RDS (vanilla PostgreSQL):');
    if (q15.rdsData.length) {
      for (const row of q15.rdsData) {
        console.log(`    Table: ${row.table_name}`);
        console.log(`    Total size: ${row.total_size} (data: ${row.data_size}, indexes: ${row.index_size})`);
        console.log(`    Compression: ${row.compression_ratio}`);
      }
    }
  }

  // Overall storage
  console.log('\n  Full storage comparison:');
  try {
    const tStorage = await tigerPool.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
             (SELECT pg_size_pretty(SUM(total_bytes)) FROM hypertable_detailed_size('telemetry_raw')) AS telemetry_size
    `);
    const rStorage = await rdsPool.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
             pg_size_pretty(pg_total_relation_size('telemetry_raw')) AS telemetry_size
    `);
    console.log(`    Tiger Cloud DB: ${tStorage.rows[0].db_size} (telemetry: ${tStorage.rows[0].telemetry_size})`);
    console.log(`    RDS DB:         ${rStorage.rows[0].db_size} (telemetry: ${rStorage.rows[0].telemetry_size})`);
  } catch (e) {
    // Fallback
    try {
      const rStorage = await rdsPool.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
               pg_size_pretty(pg_total_relation_size('telemetry_raw')) AS telemetry_size
      `);
      console.log(`    RDS DB: ${rStorage.rows[0].db_size} (telemetry: ${rStorage.rows[0].telemetry_size})`);
    } catch {}
  }

  console.log('\n' + '═'.repeat(72));
  console.log('  Note: Tiger Cloud has ~6.6B rows + CAGGs; RDS has ~25M rows (raw only)');
  console.log('  Tiger Cloud queries hit pre-computed CAGGs; RDS scans raw telemetry_raw');
  console.log('═'.repeat(72));
  console.log('');

  await tigerPool.end();
  await rdsPool.end();
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
