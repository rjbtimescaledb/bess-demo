import 'dotenv/config';
import { getSites, getAssets, batchInsertTelemetry, batchInsertAlarms, insertDispatch, insertMarketPrices, close } from './db.js';
import { BESSSimulator } from './generator.js';
import { getConfig } from './config.js';

async function main() {
  const daysArg = process.argv.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) :
               process.argv.includes('--days') ? parseInt(process.argv[process.argv.indexOf('--days') + 1]) : 30;

  console.log(`[Backfill] Generating ${days} days of historical data...`);

  const config = getConfig();
  const sites = await getSites();
  const assets = await getAssets();

  if (sites.length === 0) {
    console.error('[Backfill] No sites found. Run sql/004_seed.sql first.');
    process.exit(1);
  }

  console.log(`[Backfill] Found ${sites.length} sites, ${assets.length} assets`);

  const sim = new BESSSimulator(sites, assets, {
    ...config,
    alarmProbability: config.alarmProbability * 0.5, // Slightly fewer alarms in backfill
  });

  const now = new Date();
  const start = new Date(now.getTime() - days * 86_400_000);
  const intervalMs = 10_000; // Always 10s intervals for backfill
  const totalTicks = Math.floor((now.getTime() - start.getTime()) / intervalMs);

  console.log(`[Backfill] Time range: ${start.toISOString()} -> ${now.toISOString()}`);
  console.log(`[Backfill] Total ticks: ${totalTicks.toLocaleString()}`);

  const batchSize = 1000;
  let telemetryBatch: unknown[][] = [];
  let alarmBatch: unknown[][] = [];
  let marketBatch: unknown[][] = [];
  let totalTelemetry = 0;
  let totalAlarms = 0;
  let totalDispatches = 0;
  let totalMarket = 0;
  const startMs = Date.now();

  for (let i = 0; i < totalTicks; i++) {
    const ts = new Date(start.getTime() + i * intervalMs);
    const tick = sim.generateTick(ts);

    telemetryBatch.push(...tick.telemetry);
    alarmBatch.push(...tick.alarms);

    // Market prices every 5 minutes
    if (i % 30 === 0) {
      marketBatch.push(...tick.marketPrices);
    }

    // Dispatches immediately
    for (const d of tick.dispatches) {
      await insertDispatch(d);
      totalDispatches++;
    }

    // Flush telemetry batch
    if (telemetryBatch.length >= batchSize) {
      await batchInsertTelemetry(telemetryBatch);
      totalTelemetry += telemetryBatch.length;
      telemetryBatch = [];
    }

    // Flush alarm batch
    if (alarmBatch.length >= 100) {
      await batchInsertAlarms(alarmBatch);
      totalAlarms += alarmBatch.length;
      alarmBatch = [];
    }

    // Flush market batch
    if (marketBatch.length >= 100) {
      await insertMarketPrices(marketBatch);
      totalMarket += marketBatch.length;
      marketBatch = [];
    }

    // Progress logging
    if ((totalTelemetry + telemetryBatch.length) % 10_000 < sites.length) {
      const pct = ((i / totalTicks) * 100).toFixed(1);
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
      const rate = Math.round(totalTelemetry / Math.max(1, (Date.now() - startMs) / 1000));
      process.stdout.write(
        `\r[Backfill] ${pct}% | ${totalTelemetry.toLocaleString()} rows | ${rate} rows/s | ${elapsed}s elapsed`
      );
    }
  }

  // Flush remaining
  if (telemetryBatch.length > 0) {
    await batchInsertTelemetry(telemetryBatch);
    totalTelemetry += telemetryBatch.length;
  }
  if (alarmBatch.length > 0) {
    await batchInsertAlarms(alarmBatch);
    totalAlarms += alarmBatch.length;
  }
  if (marketBatch.length > 0) {
    await insertMarketPrices(marketBatch);
    totalMarket += marketBatch.length;
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('\n');
  console.log('='.repeat(50));
  console.log('[Backfill] Complete!');
  console.log(`  Telemetry rows: ${totalTelemetry.toLocaleString()}`);
  console.log(`  Alarm events:   ${totalAlarms.toLocaleString()}`);
  console.log(`  Dispatches:     ${totalDispatches.toLocaleString()}`);
  console.log(`  Market prices:  ${totalMarket.toLocaleString()}`);
  console.log(`  Elapsed time:   ${elapsed}s`);
  console.log(`  Avg rate:       ${Math.round(totalTelemetry / parseFloat(elapsed))} rows/s`);
  console.log('='.repeat(50));

  await close();
}

main().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
