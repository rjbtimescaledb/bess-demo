import 'dotenv/config';
import { getSites, getAssets, batchInsertTelemetry, batchInsertAlarms, insertDispatch, insertMarketPrices, close } from './db.js';
import { BESSSimulator } from './generator.js';
import { getConfig } from './config.js';

async function main() {
  const config = getConfig();
  console.log(`[Simulator] Starting in ${config.mode} mode`);
  console.log(`[Simulator] Telemetry interval: ${config.telemetryIntervalMs}ms, Batch size: ${config.batchSize}`);

  const sites = await getSites();
  const assets = await getAssets();

  if (sites.length === 0) {
    console.error('[Simulator] No sites found. Run sql/004_seed.sql first.');
    process.exit(1);
  }

  console.log(`[Simulator] Loaded ${sites.length} sites, ${assets.length} assets`);
  for (const site of sites) {
    console.log(`  - ${site.name} (${site.capacity_mw}MW / ${site.capacity_mwh}MWh)`);
  }

  const sim = new BESSSimulator(sites, assets, config);

  let totalTelemetry = 0;
  let totalAlarms = 0;
  let totalDispatches = 0;
  let lastLogTime = Date.now();
  let running = true;

  const shutdown = async () => {
    console.log('\n[Simulator] Shutting down...');
    running = false;
    await close();
    console.log(`[Simulator] Final stats: ${totalTelemetry} telemetry, ${totalAlarms} alarms, ${totalDispatches} dispatches`);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[Simulator] Live telemetry generation started. Press Ctrl+C to stop.\n');

  let marketTickCounter = 0;

  while (running) {
    const ts = new Date();
    const tick = sim.generateTick(ts);

    try {
      // Telemetry
      if (tick.telemetry.length > 0) {
        await batchInsertTelemetry(tick.telemetry);
        totalTelemetry += tick.telemetry.length;
      }

      // Alarms
      if (tick.alarms.length > 0) {
        await batchInsertAlarms(tick.alarms);
        totalAlarms += tick.alarms.length;
      }

      // Dispatches
      for (const d of tick.dispatches) {
        await insertDispatch(d);
        totalDispatches++;
      }

      // Market prices every ~5 minutes (30 ticks at 10s interval)
      marketTickCounter++;
      const marketEveryN = Math.max(1, Math.round(300_000 / config.telemetryIntervalMs));
      if (marketTickCounter >= marketEveryN) {
        await insertMarketPrices(tick.marketPrices);
        marketTickCounter = 0;
      }
    } catch (err) {
      console.error('[Simulator] Insert error:', (err as Error).message);
    }

    // Log stats every 30 seconds
    if (Date.now() - lastLogTime >= 30_000) {
      const rate = Math.round(totalTelemetry / ((Date.now() - lastLogTime) / 1000));
      console.log(
        `[Simulator] Telemetry: ${totalTelemetry} | Alarms: ${totalAlarms} | Dispatches: ${totalDispatches} | ~${tick.telemetry.length * (1000 / config.telemetryIntervalMs)} rows/s`
      );
      lastLogTime = Date.now();
    }

    // Wait for next tick
    await new Promise(resolve => setTimeout(resolve, config.telemetryIntervalMs));
  }
}

main().catch((err) => {
  console.error('[Simulator] Fatal error:', err);
  process.exit(1);
});
