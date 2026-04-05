export interface SimConfig {
  mode: string;
  telemetryIntervalMs: number;
  batchSize: number;
  alarmProbability: number;
  dispatchIntervalMin: number;
}

const configs: Record<string, SimConfig> = {
  small: {
    mode: 'small',
    telemetryIntervalMs: 10_000,
    batchSize: 50,
    alarmProbability: 0.002,
    dispatchIntervalMin: 15,
  },
  large: {
    mode: 'large',
    telemetryIntervalMs: 2_000,
    batchSize: 200,
    alarmProbability: 0.005,
    dispatchIntervalMin: 5,
  },
  terabyte: {
    mode: 'terabyte',
    telemetryIntervalMs: 1_000,
    batchSize: 500,
    alarmProbability: 0.01,
    dispatchIntervalMin: 2,
  },
};

export function getConfig(): SimConfig {
  const mode = process.env.SIMULATION_MODE || 'small';
  const config = configs[mode];
  if (!config) {
    throw new Error(`Unknown SIMULATION_MODE: ${mode}. Use: small, large, terabyte`);
  }
  return config;
}
