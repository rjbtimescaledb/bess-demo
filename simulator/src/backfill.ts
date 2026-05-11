import 'dotenv/config';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getSites, getAssets } from './db.js';
import { BESSSimulator } from './generator.js';
import { getConfig } from './config.js';

// ============================================================
// Unified backfill using PostgreSQL COPY protocol.
// Supports 30-day quick fill or multi-year deep history.
// Uses tiered resolution: dense recent data, coarser older data.
// ============================================================

interface TierConfig {
  label: string;
  startDaysAgo: number;
  endDaysAgo: number;
  intervalSeconds: number;
}

function buildTiers(totalDays: number, dense = false): TierConfig[] {
  if (dense) {
    // Dense mode: fixed 10s intervals across entire range (~1.9B rows for 3yr × 200 assets)
    return [{
      label: `Full ${totalDays}d dense (10s)`,
      startDaysAgo: totalDays,
      endDaysAgo: 0,
      intervalSeconds: 10,
    }];
  }

  const tiers: TierConfig[] = [];
  const boundaries = [
    { days: 7,    interval: 10,  label: 'Last 7 days' },
    { days: 30,   interval: 30,  label: '7d - 30d' },
    { days: 90,   interval: 60,  label: '30d - 90d' },
    { days: 365,  interval: 120, label: '90d - 1yr' },
    { days: 1095, interval: 300, label: '1yr - 3yr' },
    { days: 1825, interval: 300, label: '3yr - 5yr' },
    { days: 3650, interval: 600, label: '5yr - 10yr' },
  ];

  let prevDays = 0;
  for (const b of boundaries) {
    if (prevDays >= totalDays) break;
    const start = Math.min(b.days, totalDays);
    if (start > prevDays) {
      tiers.push({
        label: b.label,
        startDaysAgo: start,
        endDaysAgo: prevDays,
        intervalSeconds: b.interval,
      });
    }
    prevDays = b.days;
  }
  return tiers;
}

function estimateRows(tiers: TierConfig[], rowsPerTick: number): number {
  let total = 0;
  for (const t of tiers) {
    const durationSec = (t.startDaysAgo - t.endDaysAgo) * 86400;
    total += Math.floor(durationSec / t.intervalSeconds) * rowsPerTick;
  }
  return total;
}

// Stream generator: yields tab-separated rows for COPY
function* generateTierData(
  sim: BESSSimulator,
  tier: TierConfig,
  now: Date,
  table: 'telemetry' | 'alarms' | 'dispatches' | 'market',
): Generator<string> {
  const startMs = now.getTime() - tier.startDaysAgo * 86_400_000;
  const endMs = now.getTime() - tier.endDaysAgo * 86_400_000;
  const intervalMs = table === 'market' ? 300_000 : tier.intervalSeconds * 1000;
  const totalTicks = Math.floor((endMs - startMs) / intervalMs);

  for (let i = 0; i < totalTicks; i++) {
    const ts = new Date(startMs + i * intervalMs);
    const tick = sim.generateTick(ts);

    const rows = table === 'telemetry' ? tick.telemetry
               : table === 'alarms' ? tick.alarms
               : table === 'dispatches' ? tick.dispatches
               : tick.marketPrices;

    for (const row of rows) {
      yield row.map(v => v === null || v === undefined ? '\\N' : String(v)).join('\t') + '\n';
    }
  }
}

async function copyStream(
  pool: pg.Pool,
  table: string,
  columns: string[],
  generator: Generator<string>,
  label: string,
): Promise<number> {
  let totalRows = 0;
  const CHUNK_LIMIT = parseInt(process.env.COPY_CHUNK_SIZE || '2000000');

  while (true) {
    let chunkRows = 0;
    let done = false;
    let retries = 0;
    const MAX_RETRIES = 3;

    while (retries <= MAX_RETRIES) {
      const client = await pool.connect();
      // Catch client-level errors to prevent unhandled 'error' event crash
      let clientError: Error | null = null;
      const errorHandler = (err: Error) => { clientError = err; };
      client.on('error', errorHandler);
      try {
        const copyQuery = `COPY ${table} (${columns.join(',')}) FROM STDIN WITH (FORMAT text)`;
        const stream = client.query(copyFrom(copyQuery));

        const BUFFER_SIZE = 8192;
        let buffer = '';

        const readable = new Readable({
          read() {
            while (true) {
              if (chunkRows >= CHUNK_LIMIT) {
                if (buffer.length > 0) this.push(buffer);
                buffer = '';
                this.push(null);
                return;
              }
              const result = generator.next();
              if (result.done) {
                done = true;
                if (buffer.length > 0) this.push(buffer);
                this.push(null);
                return;
              }
              chunkRows++;
              totalRows++;
              buffer += result.value;
              if (buffer.length >= BUFFER_SIZE) {
                const shouldContinue = this.push(buffer);
                buffer = '';
                if (totalRows % 100_000 === 0) {
                  process.stdout.write(`\r  [${label}] ${totalRows.toLocaleString()} rows`);
                }
                if (!shouldContinue) return;
              }
            }
          },
        });

        await pipeline(readable, stream);
        if (clientError) throw clientError;
        break; // success, exit retry loop
      } catch (err: any) {
        const code = err?.code || clientError?.code;
        if ((code === 'EPIPE' || code === 'ETIMEDOUT' || code === 'ECONNRESET') && retries < MAX_RETRIES) {
          retries++;
          process.stdout.write(`\n  [${label}] Connection lost (${code}), retry ${retries}/${MAX_RETRIES}...`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw err;
      } finally {
        client.removeListener('error', errorHandler);
        try { client.release(); } catch {}
      }
    }

    if (done) break;
    process.stdout.write(`\r  [${label}] ${totalRows.toLocaleString()} rows (chunk done, reconnecting)`);
  }

  process.stdout.write(`\r  [${label}] ${totalRows.toLocaleString()} rows - done\n`);
  return totalRows;
}

const TELEMETRY_COLS = [
  'ts', 'site_id', 'asset_id', 'site_power_mw', 'charge_power_mw', 'discharge_power_mw',
  'state_of_charge_pct', 'state_of_health_pct', 'round_trip_efficiency',
  'inverter_temp_c', 'rack_temp_c', 'cell_voltage_avg', 'cell_voltage_min', 'cell_voltage_max',
  'ambient_temp_c', 'grid_frequency_hz', 'grid_voltage_kv',
];
const ALARM_COLS = ['ts', 'site_id', 'asset_id', 'alarm_code', 'severity', 'message', 'resolved_at'];
const DISPATCH_COLS = ['ts', 'site_id', 'command_type', 'target_power_mw', 'duration_min', 'source', 'status', 'executed_at', 'completed_at'];
const MARKET_COLS = ['ts', 'market', 'region', 'price_usd_mwh'];

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  let days = 30;
  let endDate: Date | null = null;
  let dense = false;
  let resume = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--days=')) days = parseInt(args[i].split('=')[1]);
    else if (args[i] === '--days' && args[i + 1]) days = parseInt(args[++i]);
    else if (args[i].startsWith('--years=')) days = parseInt(args[i].split('=')[1]) * 365;
    else if (args[i] === '--years' && args[i + 1]) days = parseInt(args[++i]) * 365;
    else if (args[i].startsWith('--end=')) endDate = new Date(args[i].split('=')[1]);
    else if (args[i] === '--end' && args[i + 1]) endDate = new Date(args[++i]);
    else if (args[i] === '--dense') dense = true;
    else if (args[i] === '--resume') resume = true;
  }
  if (process.env.BACKFILL_END_DATE) endDate = new Date(process.env.BACKFILL_END_DATE);
  if (process.env.BACKFILL_DENSE === 'true') dense = true;
  if (process.env.BACKFILL_RESUME === 'true') resume = true;

  const config = getConfig();
  const sites = await getSites();
  const assets = await getAssets();

  if (sites.length === 0) {
    console.error('[Backfill] No sites found. Run sql/004_seed.sql first.');
    process.exit(1);
  }

  const tiers = buildTiers(days, dense);
  const rowsPerTick = config.perAssetTelemetry ? assets.length : sites.length;
  const estRows = estimateRows(tiers, rowsPerTick);

  console.log('='.repeat(60));
  console.log(`[Backfill] ${days >= 365 ? `${(days / 365).toFixed(1)}-Year` : `${days}-Day`} Historical Load`);
  console.log('='.repeat(60));
  console.log(`  Sites: ${sites.length} | Assets: ${assets.length} | Per-asset: ${config.perAssetTelemetry}`);
  console.log(`  Rows per tick: ${rowsPerTick}`);
  console.log(`  Estimated telemetry: ~${(estRows / 1_000_000).toFixed(1)}M rows`);
  console.log('');
  console.log('  Tier plan:');
  for (const t of tiers) {
    const durationDays = t.startDaysAgo - t.endDaysAgo;
    const rows = Math.floor((durationDays * 86400) / t.intervalSeconds) * rowsPerTick;
    console.log(`    ${t.label.padEnd(16)} ${String(t.intervalSeconds).padStart(4)}s  ~${(rows / 1000).toFixed(0)}K rows`);
  }
  console.log('');

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  // Prevent unhandled pool errors from crashing the process
  pool.on('error', (err) => {
    console.error(`\n  [Pool] Background error: ${err.message}`);
  });

  // Resume mode: check DB for existing data and adjust start
  if (resume) {
    try {
      const res = await pool.query(`SELECT MAX(ts) AS latest FROM telemetry_raw`);
      if (res.rows[0]?.latest) {
        const latestTs = new Date(res.rows[0].latest);
        const now = endDate || new Date();
        const remainingMs = now.getTime() - latestTs.getTime();
        const remainingDays = Math.ceil(remainingMs / 86_400_000);
        if (remainingDays < days) {
          console.log(`[Resume] Found existing data up to ${latestTs.toISOString()}`);
          console.log(`[Resume] Adjusting from ${days} days to ${remainingDays} days remaining`);
          days = remainingDays;
          // Rebuild tiers with adjusted days
          const newTiers = buildTiers(days, dense);
          tiers.length = 0;
          tiers.push(...newTiers);
        }
      }
    } catch (err) {
      console.log(`[Resume] Could not check existing data: ${(err as Error).message}`);
    }
  }

  // Skip retention policy management — retention is handled externally
  const years = Math.ceil(days / 365);
  if (false && years > 1) {
    console.log(`[Setup] Ensuring retention covers ${years + 1} years...`);
    try {
      await pool.query(`SELECT remove_retention_policy('telemetry_raw', if_exists => true)`);
      await pool.query(`SELECT add_retention_policy('telemetry_raw', INTERVAL '${years + 1} years')`);
      console.log(`  Retention set to ${years + 1} years\n`);
    } catch (err) {
      console.log(`  Retention: ${(err as Error).message}\n`);
    }
  }

  const startTime = Date.now();
  let totalTelemetry = 0;
  let totalAlarms = 0;
  let totalDispatches = 0;
  let totalMarket = 0;
  const now = endDate || new Date();
  if (endDate) {
    console.log(`  End date override: ${endDate.toISOString()}`);
  }

  // Process tiers from oldest to newest (single simulator preserves state continuity)
  for (const tier of [...tiers].reverse()) {
    console.log(`--- ${tier.label} (${tier.intervalSeconds}s) ---`);

    // ONE simulator instance per tier — all tables use the same state
    const sim = new BESSSimulator(sites, assets, {
      ...config,
      telemetryIntervalMs: tier.intervalSeconds * 1000,
      alarmProbability: config.alarmProbability * Math.min(tier.intervalSeconds / 10, 5),
    });

    // Telemetry
    const telGen = generateTierData(sim, tier, now, 'telemetry');
    totalTelemetry += await copyStream(pool, 'telemetry_raw', TELEMETRY_COLS, telGen, 'telemetry');

    // Alarms (re-run same time range — separate sim to avoid double state mutation)
    const almSim = new BESSSimulator(sites, assets, {
      ...config,
      telemetryIntervalMs: tier.intervalSeconds * 1000,
      alarmProbability: config.alarmProbability * Math.min(tier.intervalSeconds / 10, 3),
    });
    const almGen = generateTierData(almSim, tier, now, 'alarms');
    totalAlarms += await copyStream(pool, 'alarms_events', ALARM_COLS, almGen, 'alarms');

    // Dispatches
    const dspSim = new BESSSimulator(sites, assets, {
      ...config,
      telemetryIntervalMs: tier.intervalSeconds * 1000,
    });
    const dspGen = generateTierData(dspSim, tier, now, 'dispatches');
    totalDispatches += await copyStream(pool, 'dispatch_commands', DISPATCH_COLS, dspGen, 'dispatches');

    // Market prices (5-min resolution regardless of tier)
    const mktSim = new BESSSimulator(sites, assets, config);
    const mktGen = generateTierData(mktSim, tier, now, 'market');
    totalMarket += await copyStream(pool, 'market_price_signals', MARKET_COLS, mktGen, 'market');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`  Cumulative: ${totalTelemetry.toLocaleString()} tel | ${totalAlarms.toLocaleString()} alm | ${totalDispatches.toLocaleString()} dsp | ${elapsed}s\n`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = Math.round(totalTelemetry / parseFloat(elapsed));

  console.log('='.repeat(60));
  console.log('[Backfill] Complete!');
  console.log(`  Telemetry:   ${totalTelemetry.toLocaleString()} rows`);
  console.log(`  Alarms:      ${totalAlarms.toLocaleString()}`);
  console.log(`  Dispatches:  ${totalDispatches.toLocaleString()}`);
  console.log(`  Market:      ${totalMarket.toLocaleString()}`);
  console.log(`  Elapsed:     ${elapsed}s`);
  console.log(`  Throughput:  ${rate.toLocaleString()} rows/s`);
  console.log('='.repeat(60));

  // Post-load: compress old chunks
  console.log('\n[Post-load] Compressing old chunks...');
  try {
    const res = await pool.query(`
      DO $$
      DECLARE chunk RECORD; cnt INT := 0;
      BEGIN
        FOR chunk IN
          SELECT chunk_schema || '.' || chunk_name AS full_name
          FROM timescaledb_information.chunks
          WHERE hypertable_name = 'telemetry_raw'
            AND NOT is_compressed
            AND range_end < NOW() - INTERVAL '2 days'
          ORDER BY range_start
        LOOP
          PERFORM compress_chunk(chunk.full_name::regclass);
          cnt := cnt + 1;
          IF cnt % 200 = 0 THEN RAISE NOTICE 'Compressed % chunks...', cnt; END IF;
        END LOOP;
        RAISE NOTICE 'Compressed % total chunks', cnt;
      END $$;
    `);
    console.log('  Compression complete');
  } catch (err) {
    console.log(`  Compression: ${(err as Error).message}`);
  }

  // Show stats
  try {
    const stats = await pool.query(`
      SELECT
        pg_size_pretty(SUM(before_compression_total_bytes)) AS before,
        pg_size_pretty(SUM(after_compression_total_bytes)) AS after,
        ROUND(SUM(before_compression_total_bytes)::numeric / NULLIF(SUM(after_compression_total_bytes), 0), 1) AS ratio
      FROM hypertable_compression_stats('telemetry_raw')
    `);
    if (stats.rows[0]?.before) {
      console.log(`\n  Compression: ${stats.rows[0].before} → ${stats.rows[0].after} (${stats.rows[0].ratio}x)`);
    }
  } catch { /* skip */ }

  await pool.end();
}

main().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
