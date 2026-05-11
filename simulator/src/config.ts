export interface SimConfig {
  mode: string;
  telemetryIntervalMs: number;
  batchSize: number;
  alarmProbability: number;
  dispatchIntervalMin: number;
  perAssetTelemetry: boolean;
  maintenanceProbability: number; // per-asset per-day
}

const configs: Record<string, SimConfig> = {
  small: {
    mode: 'small',
    telemetryIntervalMs: 10_000,
    batchSize: 100,
    alarmProbability: 0.003,
    dispatchIntervalMin: 15,
    perAssetTelemetry: true,
    maintenanceProbability: 0.02,
  },
  large: {
    mode: 'large',
    telemetryIntervalMs: 2_000,
    batchSize: 500,
    alarmProbability: 0.005,
    dispatchIntervalMin: 5,
    perAssetTelemetry: true,
    maintenanceProbability: 0.02,
  },
  terabyte: {
    mode: 'terabyte',
    telemetryIntervalMs: 1_000,
    batchSize: 1000,
    alarmProbability: 0.01,
    dispatchIntervalMin: 2,
    perAssetTelemetry: true,
    maintenanceProbability: 0.03,
  },
};

// Every SimConfig field can be overridden via env var:
//   SIM_TELEMETRY_INTERVAL_MS=5000
//   SIM_BATCH_SIZE=200
//   SIM_ALARM_PROBABILITY=0.005
//   SIM_DISPATCH_INTERVAL_MIN=10
//   SIM_PER_ASSET_TELEMETRY=true
//   SIM_MAINTENANCE_PROBABILITY=0.02
function applyEnvOverrides(config: SimConfig): SimConfig {
  const c = { ...config };
  if (process.env.SIM_TELEMETRY_INTERVAL_MS) c.telemetryIntervalMs = parseInt(process.env.SIM_TELEMETRY_INTERVAL_MS);
  if (process.env.SIM_BATCH_SIZE) c.batchSize = parseInt(process.env.SIM_BATCH_SIZE);
  if (process.env.SIM_ALARM_PROBABILITY) c.alarmProbability = parseFloat(process.env.SIM_ALARM_PROBABILITY);
  if (process.env.SIM_DISPATCH_INTERVAL_MIN) c.dispatchIntervalMin = parseInt(process.env.SIM_DISPATCH_INTERVAL_MIN);
  if (process.env.SIM_PER_ASSET_TELEMETRY) c.perAssetTelemetry = process.env.SIM_PER_ASSET_TELEMETRY === 'true';
  if (process.env.SIM_MAINTENANCE_PROBABILITY) c.maintenanceProbability = parseFloat(process.env.SIM_MAINTENANCE_PROBABILITY);
  return c;
}

export function getConfig(): SimConfig {
  const mode = process.env.SIMULATION_MODE || 'small';
  const base = configs[mode];
  if (!base) {
    throw new Error(`Unknown SIMULATION_MODE: ${mode}. Use: small, large, terabyte`);
  }
  return applyEnvOverrides(base);
}
