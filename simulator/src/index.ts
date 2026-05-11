import 'dotenv/config';
import { getSites, getAssets, batchInsertTelemetry, batchInsertAlarms, insertDispatch, insertMarketPrices, batchInsertMaintenance, close } from './db.js';
import { BESSSimulator } from './generator.js';
import { getConfig } from './config.js';

// ============================================================
// High-throughput live ingest with buffered writes.
// Decouples tick generation (fast) from DB flushes (batched).
// ============================================================

interface IngestStats {
  telemetry: number;
  alarms: number;
  dispatches: number;
  market: number;
  errors: number;
  flushes: number;
  startedAt: number;
  windowStart: number;
  windowTelemetry: number;
}

// Buffers accumulate rows between flushes
interface WriteBuffers {
  telemetry: unknown[][];
  alarms: unknown[][];
  dispatches: unknown[][];
  market: unknown[][];
  maintenance: unknown[][];
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  return `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message;
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.error(`[Ingest] ${label} failed (attempt ${attempt}/${maxRetries}): ${msg}. Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        console.error(`[Ingest] ${label} failed after ${maxRetries} attempts: ${msg}`);
        return null;
      }
    }
  }
  return null;
}

async function flushBuffers(buffers: WriteBuffers, stats: IngestStats): Promise<void> {
  // Telemetry — split into chunks of 1000 rows max (avoid param limit)
  const telRows = buffers.telemetry.splice(0);
  for (let i = 0; i < telRows.length; i += 1000) {
    const chunk = telRows.slice(i, i + 1000);
    const result = await withRetry(() => batchInsertTelemetry(chunk), 'telemetry');
    if (result !== null) {
      stats.telemetry += chunk.length;
      stats.windowTelemetry += chunk.length;
    } else {
      stats.errors++;
    }
  }

  // Alarms
  const almRows = buffers.alarms.splice(0);
  if (almRows.length > 0) {
    const result = await withRetry(() => batchInsertAlarms(almRows), 'alarms');
    if (result !== null) stats.alarms += almRows.length;
    else stats.errors++;
  }

  // Dispatches
  const dspRows = buffers.dispatches.splice(0);
  for (const d of dspRows) {
    const result = await withRetry(() => insertDispatch(d), 'dispatch');
    if (result !== null) stats.dispatches++;
    else stats.errors++;
  }

  // Market
  const mktRows = buffers.market.splice(0);
  if (mktRows.length > 0) {
    const result = await withRetry(() => insertMarketPrices(mktRows), 'market');
    if (result !== null) stats.market += mktRows.length;
    else stats.errors++;
  }

  // Maintenance
  const maintRows = buffers.maintenance.splice(0);
  if (maintRows.length > 0) {
    await withRetry(() => batchInsertMaintenance(maintRows), 'maintenance');
  }

  stats.flushes++;
}

async function main() {
  const config = getConfig();

  // Target rows/sec from env, default based on mode
  const targetRowsPerSec = parseInt(process.env.SIM_TARGET_ROWS_PER_SEC || '0');
  const flushIntervalMs = parseInt(process.env.SIM_FLUSH_INTERVAL_MS || '500');

  console.log('='.repeat(60));
  console.log('[Simulator] BESS Live Telemetry Ingest');
  console.log('='.repeat(60));

  const sites = await getSites();
  const assets = await getAssets();

  if (sites.length === 0) {
    console.error('[Simulator] No sites found. Run sql/004_seed.sql first.');
    process.exit(1);
  }

  const rowsPerTick = config.perAssetTelemetry ? assets.length : sites.length;

  // Calculate tick interval to hit target rows/sec
  let tickIntervalMs: number;
  if (targetRowsPerSec > 0) {
    const ticksPerSec = targetRowsPerSec / rowsPerTick;
    tickIntervalMs = Math.max(1, Math.round(1000 / ticksPerSec));
  } else {
    tickIntervalMs = config.telemetryIntervalMs;
  }

  const effectiveRowsPerSec = (rowsPerTick * 1000 / tickIntervalMs);

  console.log(`  Mode:              ${config.mode}`);
  console.log(`  Per-asset:         ${config.perAssetTelemetry}`);
  console.log(`  Rows/tick:         ${rowsPerTick}`);
  console.log(`  Tick interval:     ${tickIntervalMs}ms`);
  console.log(`  Flush interval:    ${flushIntervalMs}ms`);
  console.log(`  Target rows/sec:   ~${effectiveRowsPerSec.toFixed(0)}`);
  console.log(`  Alarm probability: ${config.alarmProbability}`);
  console.log('');

  for (const site of sites) {
    const siteAssets = assets.filter(a => a.site_id === site.site_id);
    console.log(`  ${site.name} (${site.capacity_mw}MW) - ${siteAssets.length} assets`);
  }

  // Override the config interval so the physics engine scales correctly
  const sim = new BESSSimulator(sites, assets, {
    ...config,
    telemetryIntervalMs: tickIntervalMs,
  });

  const stats: IngestStats = {
    telemetry: 0, alarms: 0, dispatches: 0, market: 0, errors: 0, flushes: 0,
    startedAt: Date.now(), windowStart: Date.now(), windowTelemetry: 0,
  };

  const buffers: WriteBuffers = {
    telemetry: [], alarms: [], dispatches: [], market: [], maintenance: [],
  };

  let running = true;
  let marketCounter = 0;
  const marketEveryN = Math.max(1, Math.round(300_000 / tickIntervalMs));

  const shutdown = async () => {
    console.log('\n[Simulator] Shutting down...');
    running = false;
    // Final flush
    if (buffers.telemetry.length > 0) {
      console.log(`[Simulator] Flushing ${buffers.telemetry.length} remaining rows...`);
      await flushBuffers(buffers, stats);
    }
    await close();
    const uptime = formatUptime(Date.now() - stats.startedAt);
    const avgRate = (stats.telemetry / ((Date.now() - stats.startedAt) / 1000)).toFixed(1);
    console.log(`[Simulator] Final stats (${uptime}):`);
    console.log(`  Telemetry: ${stats.telemetry.toLocaleString()} (avg ${avgRate} rows/s)`);
    console.log(`  Alarms: ${stats.alarms.toLocaleString()} | Dispatches: ${stats.dispatches.toLocaleString()} | Market: ${stats.market.toLocaleString()}`);
    console.log(`  Flushes: ${stats.flushes.toLocaleString()} | Errors: ${stats.errors}`);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Flush timer — runs independently of tick generation
  const flushTimer = setInterval(async () => {
    if (buffers.telemetry.length > 0) {
      await flushBuffers(buffers, stats);
    }
  }, flushIntervalMs);

  // Stats timer
  const statsTimer = setInterval(() => {
    const now = Date.now();
    const windowSec = (now - stats.windowStart) / 1000;
    const windowRate = (stats.windowTelemetry / windowSec).toFixed(1);
    const totalRate = (stats.telemetry / ((now - stats.startedAt) / 1000)).toFixed(1);
    const uptime = formatUptime(now - stats.startedAt);
    const bufSize = buffers.telemetry.length;

    console.log(
      `[${uptime}] ${windowRate} rows/s (avg ${totalRate}) | total: ${stats.telemetry.toLocaleString()} tel, ${stats.alarms.toLocaleString()} alm, ${stats.dispatches.toLocaleString()} dsp | buf: ${bufSize} | flushes: ${stats.flushes}` +
      (stats.errors > 0 ? ` | err: ${stats.errors}` : '')
    );

    stats.windowStart = now;
    stats.windowTelemetry = 0;
  }, 10_000);

  console.log(`\n[Simulator] Live ingest started. Ctrl+C to stop.\n`);

  // For sub-10ms intervals, batch multiple ticks per iteration to avoid spin loops.
  // E.g. at 8ms tick / 500ms flush, generate ~62 ticks per flush cycle.
  const ticksPerBatch = tickIntervalMs < 10
    ? Math.ceil(flushIntervalMs / Math.max(1, tickIntervalMs))
    : 1;
  const batchIntervalMs = tickIntervalMs < 10
    ? flushIntervalMs  // generate a full batch every flush interval
    : tickIntervalMs;

  if (ticksPerBatch > 1) {
    console.log(`[Simulator] High-rate mode: ${ticksPerBatch} ticks per ${batchIntervalMs}ms batch\n`);
  }

  // Main tick loop — uses setInterval-friendly timing
  const tickTimer = setInterval(() => {
    if (!running) return;

    for (let t = 0; t < ticksPerBatch; t++) {
      const ts = new Date();
      const tick = sim.generateTick(ts);

      buffers.telemetry.push(...tick.telemetry);
      buffers.alarms.push(...tick.alarms);
      buffers.dispatches.push(...tick.dispatches);
      if (tick.maintenanceLogs.length > 0) buffers.maintenance.push(...tick.maintenanceLogs);

      marketCounter++;
      if (marketCounter >= marketEveryN) {
        buffers.market.push(...tick.marketPrices);
        marketCounter = 0;
      }
    }
  }, batchIntervalMs);

  // Keep process alive
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!running) {
        clearInterval(check);
        clearInterval(tickTimer);
        clearInterval(flushTimer);
        clearInterval(statsTimer);
        resolve();
      }
    }, 500);
  });
}

main().catch((err) => {
  console.error('[Simulator] Fatal error:', err);
  process.exit(1);
});
