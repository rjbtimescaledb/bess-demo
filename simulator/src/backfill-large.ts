import 'dotenv/config';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getSites, getAssets } from './db.js';
import { BESSSimulator } from './generator.js';
import { getConfig } from './config.js';

// ============================================================
// High-performance backfill using PostgreSQL COPY protocol
// Generates 5 years of tiered-resolution telemetry data
// ============================================================

interface TierConfig {
  label: string;
  startDaysAgo: number;
  endDaysAgo: number;
  intervalSeconds: number;
}

// Tiered intervals — matches how real SCADA historians archive data:
// Recent data is dense, older data is progressively coarser
const TIERS: TierConfig[] = [
  { label: 'Last 7 days',    startDaysAgo: 7,    endDaysAgo: 0,    intervalSeconds: 10 },
  { label: '7d - 30d',       startDaysAgo: 30,   endDaysAgo: 7,    intervalSeconds: 30 },
  { label: '30d - 90d',      startDaysAgo: 90,   endDaysAgo: 30,   intervalSeconds: 60 },
  { label: '90d - 1 year',   startDaysAgo: 365,  endDaysAgo: 90,   intervalSeconds: 120 },
  { label: '1 - 3 years',    startDaysAgo: 1095, endDaysAgo: 365,  intervalSeconds: 300 },
  { label: '3 - 5 years',    startDaysAgo: 1825, endDaysAgo: 1095, intervalSeconds: 300 },
];

function estimateRows(tiers: TierConfig[], siteCount: number): number {
  let total = 0;
  for (const t of tiers) {
    const durationSec = (t.startDaysAgo - t.endDaysAgo) * 86400;
    total += Math.floor(durationSec / t.intervalSeconds) * siteCount;
  }
  return total;
}

// Generate telemetry rows as tab-separated lines for COPY
function* generateTelemetryStream(
  sim: BESSSimulator,
  tier: TierConfig,
  now: Date,
): Generator<string> {
  const startMs = now.getTime() - tier.startDaysAgo * 86_400_000;
  const endMs = now.getTime() - tier.endDaysAgo * 86_400_000;
  const intervalMs = tier.intervalSeconds * 1000;
  const totalTicks = Math.floor((endMs - startMs) / intervalMs);

  for (let i = 0; i < totalTicks; i++) {
    const ts = new Date(startMs + i * intervalMs);
    const tick = sim.generateTick(ts);

    for (const row of tick.telemetry) {
      // tab-separated: ts, site_id, asset_id, and 14 numeric fields
      yield row.map(v => v === null ? '\\N' : String(v)).join('\t') + '\n';
    }
  }
}

// Generate alarms as tab-separated lines
function* generateAlarmStream(
  sim: BESSSimulator,
  tier: TierConfig,
  now: Date,
): Generator<string> {
  const startMs = now.getTime() - tier.startDaysAgo * 86_400_000;
  const endMs = now.getTime() - tier.endDaysAgo * 86_400_000;
  const intervalMs = tier.intervalSeconds * 1000;
  const totalTicks = Math.floor((endMs - startMs) / intervalMs);

  for (let i = 0; i < totalTicks; i++) {
    const ts = new Date(startMs + i * intervalMs);
    const tick = sim.generateTick(ts);

    for (const row of tick.alarms) {
      yield row.map(v => v === null ? '\\N' : String(v)).join('\t') + '\n';
    }
  }
}

// Generate market prices
function* generateMarketStream(
  sim: BESSSimulator,
  tier: TierConfig,
  now: Date,
): Generator<string> {
  const startMs = now.getTime() - tier.startDaysAgo * 86_400_000;
  const endMs = now.getTime() - tier.endDaysAgo * 86_400_000;
  // Market prices every 5 minutes regardless of tier
  const intervalMs = 300_000;
  const totalTicks = Math.floor((endMs - startMs) / intervalMs);

  for (let i = 0; i < totalTicks; i++) {
    const ts = new Date(startMs + i * intervalMs);
    const tick = sim.generateTick(ts);

    for (const row of tick.marketPrices) {
      yield row.map(v => v === null ? '\\N' : String(v)).join('\t') + '\n';
    }
  }
}

async function copyTable(
  pool: pg.Pool,
  table: string,
  columns: string[],
  generator: Generator<string>,
  label: string,
): Promise<number> {
  const client = await pool.connect();
  let rowCount = 0;

  try {
    const copyQuery = `COPY ${table} (${columns.join(',')}) FROM STDIN WITH (FORMAT text)`;
    const stream = client.query(copyFrom(copyQuery));

    // Convert generator to readable stream with buffering
    const BUFFER_SIZE = 4096;
    let buffer = '';

    const readable = new Readable({
      read() {
        while (true) {
          const { value, done } = generator.next();
          if (done) {
            if (buffer.length > 0) {
              this.push(buffer);
            }
            this.push(null);
            return;
          }

          rowCount++;
          buffer += value;

          if (buffer.length >= BUFFER_SIZE) {
            const shouldContinue = this.push(buffer);
            buffer = '';
            if (rowCount % 100_000 === 0) {
              process.stdout.write(`\r  [${label}] ${(rowCount).toLocaleString()} rows`);
            }
            if (!shouldContinue) return;
          }
        }
      },
    });

    await pipeline(readable, stream);
    process.stdout.write(`\r  [${label}] ${rowCount.toLocaleString()} rows - done\n`);
  } finally {
    client.release();
  }

  return rowCount;
}

async function main() {
  const yearsArg = process.argv.find(a => a.startsWith('--years='));
  const years = yearsArg ? parseInt(yearsArg.split('=')[1]) : 5;

  // Filter tiers based on requested years
  const maxDays = years * 365;
  const tiers = TIERS.filter(t => t.endDaysAgo < maxDays).map(t => ({
    ...t,
    startDaysAgo: Math.min(t.startDaysAgo, maxDays),
  }));

  const config = getConfig();
  const sites = await getSites();
  const assets = await getAssets();

  if (sites.length === 0) {
    console.error('[Backfill] No sites found. Run sql/004_seed.sql first.');
    process.exit(1);
  }

  const estRows = estimateRows(tiers, sites.length);
  console.log('='.repeat(60));
  console.log(`[Backfill] High-Performance ${years}-Year Historical Load`);
  console.log('='.repeat(60));
  console.log(`Sites: ${sites.length} | Assets: ${assets.length}`);
  console.log(`Estimated telemetry rows: ~${(estRows / 1_000_000).toFixed(1)}M`);
  console.log('');
  console.log('Tier plan:');
  for (const t of tiers) {
    const durationDays = t.startDaysAgo - t.endDaysAgo;
    const rows = Math.floor((durationDays * 86400) / t.intervalSeconds) * sites.length;
    console.log(`  ${t.label.padEnd(16)} ${t.intervalSeconds}s interval  ~${(rows / 1000).toFixed(0)}K rows`);
  }
  console.log('');

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  // Update retention policy to keep 5+ years of data
  console.log('[Setup] Updating retention policy for 5-year history...');
  try {
    await pool.query(`SELECT remove_retention_policy('telemetry_raw', if_exists => true)`);
    await pool.query(`SELECT add_retention_policy('telemetry_raw', INTERVAL '${years + 1} years')`);
    console.log(`  Retention set to ${years + 1} years`);
  } catch (err) {
    console.log(`  Retention update: ${(err as Error).message}`);
  }

  const startTime = Date.now();
  let totalTelemetry = 0;
  let totalAlarms = 0;
  let totalMarket = 0;
  const now = new Date();

  const TELEMETRY_COLS = [
    'ts', 'site_id', 'asset_id', 'site_power_mw', 'charge_power_mw', 'discharge_power_mw',
    'state_of_charge_pct', 'state_of_health_pct', 'round_trip_efficiency',
    'inverter_temp_c', 'rack_temp_c', 'cell_voltage_avg', 'cell_voltage_min', 'cell_voltage_max',
    'ambient_temp_c', 'grid_frequency_hz', 'grid_voltage_kv',
  ];

  const ALARM_COLS = ['ts', 'site_id', 'asset_id', 'alarm_code', 'severity', 'message', 'resolved_at'];
  const MARKET_COLS = ['ts', 'market', 'region', 'price_usd_mwh'];

  // Process each tier from oldest to newest
  for (const tier of [...tiers].reverse()) {
    console.log(`\n--- ${tier.label} (${tier.intervalSeconds}s interval) ---`);

    // Create a fresh simulator for each tier to avoid state carryover issues
    const sim = new BESSSimulator(sites, assets, {
      ...config,
      telemetryIntervalMs: tier.intervalSeconds * 1000,
      alarmProbability: config.alarmProbability * Math.min(tier.intervalSeconds / 10, 5), // Scale alarm rate with interval
    });

    // Telemetry
    const telGen = generateTelemetryStream(sim, tier, now);
    const telRows = await copyTable(pool, 'telemetry_raw', TELEMETRY_COLS, telGen, `telemetry`);
    totalTelemetry += telRows;

    // Alarms (new simulator instance to avoid double-processing)
    const alarmSim = new BESSSimulator(sites, assets, {
      ...config,
      telemetryIntervalMs: tier.intervalSeconds * 1000,
      alarmProbability: config.alarmProbability * Math.min(tier.intervalSeconds / 10, 3),
    });
    const almGen = generateAlarmStream(alarmSim, tier, now);
    const almRows = await copyTable(pool, 'alarms_events', ALARM_COLS, almGen, `alarms`);
    totalAlarms += almRows;

    // Market prices
    const mktSim = new BESSSimulator(sites, assets, config);
    const mktGen = generateMarketStream(mktSim, tier, now);
    const mktRows = await copyTable(pool, 'market_price_signals', MARKET_COLS, mktGen, `market`);
    totalMarket += mktRows;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`  Cumulative: ${totalTelemetry.toLocaleString()} tel | ${totalAlarms.toLocaleString()} alarms | ${elapsed}s`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = Math.round(totalTelemetry / parseFloat(elapsed));

  console.log('\n' + '='.repeat(60));
  console.log('[Backfill] Complete!');
  console.log(`  Telemetry rows: ${totalTelemetry.toLocaleString()}`);
  console.log(`  Alarm events:   ${totalAlarms.toLocaleString()}`);
  console.log(`  Market prices:  ${totalMarket.toLocaleString()}`);
  console.log(`  Elapsed time:   ${elapsed}s`);
  console.log(`  Avg throughput:  ${rate.toLocaleString()} rows/s`);
  console.log('='.repeat(60));

  // Trigger compression on old chunks
  console.log('\n[Post-load] Manually compressing old chunks...');
  try {
    const res = await pool.query(`
      SELECT compress_chunk(c.chunk_name::regclass)
      FROM timescaledb_information.chunks c
      WHERE c.hypertable_name = 'telemetry_raw'
        AND NOT c.is_compressed
        AND c.range_end < NOW() - INTERVAL '2 days'
      ORDER BY c.range_start
    `);
    console.log(`  Compressed ${res.rowCount} chunks`);
  } catch (err) {
    console.log(`  Compression: ${(err as Error).message}`);
  }

  // Show compression stats
  try {
    const stats = await pool.query(`
      SELECT
        pg_size_pretty(SUM(before_compression_total_bytes)) AS before,
        pg_size_pretty(SUM(after_compression_total_bytes)) AS after,
        ROUND(SUM(before_compression_total_bytes)::numeric / NULLIF(SUM(after_compression_total_bytes), 0), 1) AS ratio
      FROM hypertable_compression_stats('telemetry_raw')
    `);
    if (stats.rows[0]?.before) {
      console.log(`\n  Compression results:`);
      console.log(`    Before: ${stats.rows[0].before}`);
      console.log(`    After:  ${stats.rows[0].after}`);
      console.log(`    Ratio:  ${stats.rows[0].ratio}x`);
    }
  } catch {
    console.log('  (compression stats not yet available)');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
