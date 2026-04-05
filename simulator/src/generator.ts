import type { SiteRow, AssetRow } from './db.js';
import type { SimConfig } from './config.js';

function gauss(mean = 0, stddev = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return mean + stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

const ALARM_CODES = [
  { code: 'CELL_OVERVOLT', severity: 'warning', msg: 'Cell voltage exceeded upper threshold' },
  { code: 'CELL_UNDERVOLT', severity: 'warning', msg: 'Cell voltage below lower threshold' },
  { code: 'RACK_OVERTEMP', severity: 'critical', msg: 'Battery rack temperature exceeded limit' },
  { code: 'INVERTER_FAULT', severity: 'critical', msg: 'PCS inverter reported fault condition' },
  { code: 'COMM_LOSS', severity: 'warning', msg: 'Communication loss with BMS controller' },
  { code: 'BMS_WARNING', severity: 'info', msg: 'BMS reported minor diagnostic warning' },
  { code: 'HVAC_FAULT', severity: 'warning', msg: 'HVAC cooling system fault detected' },
  { code: 'GRID_DISCONNECT', severity: 'emergency', msg: 'Grid interconnection breaker opened' },
  { code: 'SOC_LOW', severity: 'info', msg: 'State of charge below recommended minimum' },
  { code: 'SOC_HIGH', severity: 'info', msg: 'State of charge above recommended maximum' },
];

const DISPATCH_TYPES = [
  'frequency_response',
  'peak_shaving',
  'energy_arbitrage',
  'demand_response',
  'capacity_reserve',
  'renewable_firming',
];

const MARKETS = [
  { market: 'CAISO', region: 'US-WEST' },
  { market: 'ERCOT', region: 'US-SOUTH' },
  { market: 'PJM', region: 'US-EAST' },
];

interface SiteState {
  site: SiteRow;
  assets: AssetRow[];
  soc: number;           // 0-100
  soh: number;           // 97-100
  mode: 'charging' | 'discharging' | 'idle' | 'standby';
  activePower: number;   // MW, positive = discharge
  activeAlarms: Map<string, { start: Date; resolvesAt: Date }>;
  demandResponseActive: boolean;
  drEndsAt: Date | null;
}

export class BESSSimulator {
  private states: Map<string, SiteState> = new Map();
  private config: SimConfig;
  private startTime: Date;

  constructor(sites: SiteRow[], assets: AssetRow[], config: SimConfig) {
    this.config = config;
    this.startTime = new Date();

    for (const site of sites) {
      const siteAssets = assets.filter(a => a.site_id === site.site_id);
      this.states.set(site.site_id, {
        site,
        assets: siteAssets,
        soc: 40 + Math.random() * 40, // Start between 40-80%
        soh: 98.5 + Math.random() * 1.2,
        mode: 'idle',
        activePower: 0,
        activeAlarms: new Map(),
        demandResponseActive: false,
        drEndsAt: null,
      });
    }
  }

  private getLocalHour(ts: Date, timezone: string): number {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
      const parts = fmt.formatToParts(ts);
      const hourPart = parts.find(p => p.type === 'hour');
      return hourPart ? parseInt(hourPart.value) : ts.getUTCHours();
    } catch {
      return ts.getUTCHours();
    }
  }

  private getAmbientTemp(ts: Date, lat: number): number {
    const hour = ts.getUTCHours() + ts.getUTCMinutes() / 60;
    const dayOfYear = Math.floor((ts.getTime() - new Date(ts.getFullYear(), 0, 0).getTime()) / 86400000);
    // Daily cycle: coolest at 5am, warmest at 3pm
    const dailyCycle = Math.sin((hour - 5) / 24 * 2 * Math.PI) * 8;
    // Seasonal: warmer in summer (northern hemisphere)
    const seasonal = Math.sin((dayOfYear - 80) / 365 * 2 * Math.PI) * 6;
    // Latitude effect: lower latitudes are warmer
    const latEffect = (40 - Math.abs(lat)) * 0.4;
    const base = 22 + latEffect + seasonal + dailyCycle;
    return base + gauss(0, 1.5);
  }

  private getMarketPrice(ts: Date, market: string): number {
    const hour = ts.getUTCHours();
    // Base price pattern
    let base = 35;
    if (hour >= 6 && hour < 10) base = 50 + (hour - 6) * 8; // Morning ramp
    else if (hour >= 10 && hour < 15) base = 25 - Math.random() * 15; // Solar oversupply
    else if (hour >= 15 && hour < 21) base = 60 + (hour - 15) * 10; // Evening peak
    else base = 30;

    // Market-specific adjustments
    if (market === 'ERCOT') base *= 1.15; // Texas volatility
    if (market === 'CAISO') base *= (hour >= 10 && hour < 15 ? 0.6 : 1.1);

    // Random spikes (2% chance)
    if (Math.random() < 0.02) base = 200 + Math.random() * 300;
    // Negative prices during solar glut (midday CAISO)
    if (market === 'CAISO' && hour >= 11 && hour < 14 && Math.random() < 0.15) {
      base = -5 - Math.random() * 15;
    }

    return base + gauss(0, 5);
  }

  generateTick(ts: Date): {
    telemetry: unknown[][];
    alarms: unknown[][];
    dispatches: unknown[][];
    marketPrices: unknown[][];
  } {
    const telemetry: unknown[][] = [];
    const alarms: unknown[][] = [];
    const dispatches: unknown[][] = [];
    const marketPrices: unknown[][] = [];

    for (const state of this.states.values()) {
      const { site } = state;
      const localHour = this.getLocalHour(ts, site.timezone);
      const intervalHours = this.config.telemetryIntervalMs / 3_600_000;

      // Determine operating mode based on time of day
      let targetPowerFraction = 0; // fraction of capacity, negative = charge
      if (localHour >= 10 && localHour < 15) {
        // Solar charging window
        const ramp = localHour < 11 ? (localHour - 10) : localHour > 14 ? (15 - localHour) : 1;
        targetPowerFraction = -(0.6 + Math.random() * 0.3) * ramp;
        state.mode = 'charging';
      } else if (localHour >= 16 && localHour < 21) {
        // Evening discharge
        const ramp = localHour < 17 ? (localHour - 16) : localHour > 20 ? (21 - localHour) : 1;
        targetPowerFraction = (0.5 + Math.random() * 0.3) * ramp;
        state.mode = 'discharging';
      } else if (localHour >= 6 && localHour < 10) {
        // Morning ramp - light charging
        targetPowerFraction = -(0.1 + Math.random() * 0.15);
        state.mode = 'charging';
      } else {
        // Night idle with trickle
        targetPowerFraction = -(0.02 + Math.random() * 0.03);
        state.mode = 'idle';
      }

      // Demand response override
      if (state.demandResponseActive && state.drEndsAt) {
        if (ts >= state.drEndsAt) {
          state.demandResponseActive = false;
          state.drEndsAt = null;
        } else {
          targetPowerFraction = 0.85 + Math.random() * 0.1;
          state.mode = 'discharging';
        }
      }

      // Trigger demand response randomly
      if (!state.demandResponseActive && Math.random() < (this.config.dispatchIntervalMin / 60 / 60) * (this.config.telemetryIntervalMs / 1000)) {
        const durationMin = 5 + Math.floor(Math.random() * 25);
        state.demandResponseActive = true;
        state.drEndsAt = new Date(ts.getTime() + durationMin * 60_000);
        targetPowerFraction = 0.9;
        state.mode = 'discharging';

        const cmdType = DISPATCH_TYPES[Math.floor(Math.random() * DISPATCH_TYPES.length)];
        const completedAt = new Date(ts.getTime() + durationMin * 60_000);
        dispatches.push([
          ts.toISOString(), site.site_id, cmdType,
          Math.round(site.capacity_mw * 0.9 * 10) / 10,
          durationMin, 'auto_dispatch', 'completed',
          ts.toISOString(), completedAt.toISOString(),
        ]);
      }

      // SoC limits
      if (state.soc <= 8) targetPowerFraction = Math.min(targetPowerFraction, -0.1);
      if (state.soc >= 93) targetPowerFraction = Math.max(targetPowerFraction, 0.1);

      const targetPower = targetPowerFraction * site.capacity_mw;
      // Smooth power transitions
      state.activePower += (targetPower - state.activePower) * 0.3 + gauss(0, site.capacity_mw * 0.005);
      state.activePower = clamp(state.activePower, -site.capacity_mw, site.capacity_mw);

      // Update SoC
      const energyDelta = -state.activePower * intervalHours; // negative power = charging = positive energy
      const efficiency = state.activePower > 0 ? 0.92 : 1.0; // discharge losses
      state.soc += (energyDelta * efficiency / site.capacity_mwh) * 100;
      state.soc = clamp(state.soc, 2, 98);

      // Slow SoH degradation
      state.soh -= Math.abs(state.activePower / site.capacity_mw) * 0.0000005;
      state.soh = clamp(state.soh, 95, 99.8);

      const ambient = this.getAmbientTemp(ts, site.latitude);
      const loadHeat = Math.abs(state.activePower / site.capacity_mw) * 15;
      const inverterTemp = clamp(ambient + loadHeat + gauss(3, 1.5), 20, 65);
      const rackTemp = clamp(ambient + loadHeat * 0.6 + gauss(1, 1), 18, 50);

      // Cell voltage (LFP: 3.2-3.65V)
      const cellVoltageAvg = 3.2 + (state.soc / 100) * 0.45 + gauss(0, 0.005);
      const spread = 0.01 + Math.random() * 0.04;

      const chargePower = state.activePower < 0 ? Math.abs(state.activePower) : 0;
      const dischargePower = state.activePower > 0 ? state.activePower : 0;

      const rte = clamp(88 + gauss(0, 1.5) - (inverterTemp - 35) * 0.1, 82, 95);
      const gridFreq = clamp(60 + gauss(0, 0.015), 59.9, 60.1);
      const gridVoltage = clamp(138 + gauss(0, 0.8), 135, 141);

      telemetry.push([
        ts.toISOString(), site.site_id, state.assets[0]?.asset_id || null,
        Math.round(state.activePower * 100) / 100,
        Math.round(chargePower * 100) / 100,
        Math.round(dischargePower * 100) / 100,
        Math.round(state.soc * 100) / 100,
        Math.round(state.soh * 100) / 100,
        Math.round(rte * 100) / 100,
        Math.round(inverterTemp * 100) / 100,
        Math.round(rackTemp * 100) / 100,
        Math.round(cellVoltageAvg * 1000) / 1000,
        Math.round((cellVoltageAvg - spread) * 1000) / 1000,
        Math.round((cellVoltageAvg + spread) * 1000) / 1000,
        Math.round(ambient * 100) / 100,
        Math.round(gridFreq * 1000) / 1000,
        Math.round(gridVoltage * 100) / 100,
      ]);

      // Alarms
      if (Math.random() < this.config.alarmProbability) {
        const alarm = ALARM_CODES[Math.floor(Math.random() * ALARM_CODES.length)];
        const resolveMin = alarm.severity === 'emergency' ? 30 + Math.random() * 60 :
                          alarm.severity === 'critical' ? 10 + Math.random() * 30 :
                          1 + Math.random() * 15;
        const resolvedAt = new Date(ts.getTime() + resolveMin * 60_000);
        alarms.push([
          ts.toISOString(), site.site_id, state.assets[Math.floor(Math.random() * state.assets.length)]?.asset_id || null,
          alarm.code, alarm.severity, alarm.msg, resolvedAt.toISOString(),
        ]);
      }

      // Resolve expired active alarms (tracked in state for live mode)
      for (const [key, info] of state.activeAlarms) {
        if (ts >= info.resolvesAt) {
          state.activeAlarms.delete(key);
        }
      }
    }

    // Market prices (generate once per tick for all markets)
    for (const { market, region } of MARKETS) {
      marketPrices.push([
        ts.toISOString(), market, region,
        Math.round(this.getMarketPrice(ts, market) * 100) / 100,
      ]);
    }

    return { telemetry, alarms, dispatches, marketPrices };
  }
}
