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

function round1(v: number): number { return Math.round(v * 10) / 10; }
function round2(v: number): number { return Math.round(v * 100) / 100; }
function round3(v: number): number { return Math.round(v * 1000) / 1000; }

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
  { code: 'DC_BUS_FAULT', severity: 'critical', msg: 'DC bus voltage out of range' },
  { code: 'CONTACTOR_FAIL', severity: 'critical', msg: 'Main contactor failed to engage' },
  { code: 'FAN_FAILURE', severity: 'warning', msg: 'Cooling fan failure detected in rack' },
  { code: 'INSULATION_LOW', severity: 'warning', msg: 'Insulation resistance below threshold' },
];

const DISPATCH_TYPES = [
  'frequency_response', 'peak_shaving', 'energy_arbitrage',
  'demand_response', 'capacity_reserve', 'renewable_firming',
];

const MARKETS = [
  { market: 'CAISO', region: 'US-WEST', tz: 'America/Los_Angeles' },
  { market: 'ERCOT', region: 'US-SOUTH', tz: 'America/Chicago' },
  { market: 'PJM', region: 'US-EAST', tz: 'America/New_York' },
];

interface AssetState {
  asset: AssetRow;
  soc: number;
  soh: number;
  tempOffset: number;      // per-asset thermal personality (+/- 2C)
  voltageSpread: number;   // per-asset cell imbalance
  inMaintenance: boolean;
  maintenanceEndsAt: number | null;
  // Smoothed per-asset values for realistic sensor behavior
  inverterTemp: number;
  rackTemp: number;
  rte: number;
}

interface SiteState {
  site: SiteRow;
  assets: AssetState[];
  mode: 'charging' | 'discharging' | 'idle' | 'standby';
  activePower: number;
  drActive: boolean;
  drEndsAt: number | null;
  drDispatchEmitted: boolean;
  unresolvedAlarmCount: number;
  // Smoothed values for realistic sensor behavior (better compression)
  gridFreq: number;
  gridVoltage: number;
  ambient: number;
}

export class BESSSimulator {
  private states: Map<string, SiteState> = new Map();
  private config: SimConfig;
  // Cache for Intl formatters (expensive to create)
  private hourFormatters: Map<string, Intl.DateTimeFormat> = new Map();

  constructor(sites: SiteRow[], assets: AssetRow[], config: SimConfig) {
    this.config = config;

    for (const site of sites) {
      const siteAssets = assets.filter(a => a.site_id === site.site_id);
      this.states.set(site.site_id, {
        site,
        assets: siteAssets.map(a => ({
          asset: a,
          soc: 40 + Math.random() * 40,
          soh: 98.0 + Math.random() * 1.5,
          tempOffset: gauss(0, 1.5),
          voltageSpread: 0.01 + Math.random() * 0.03,
          inMaintenance: false,
          maintenanceEndsAt: null,
          inverterTemp: 35,
          rackTemp: 28,
          rte: 90,
        })),
        mode: 'idle',
        activePower: 0,
        drActive: false,
        drEndsAt: null,
        drDispatchEmitted: false,
        unresolvedAlarmCount: 0,
        gridFreq: 60.0,
        gridVoltage: 138.0,
        ambient: 22.0,
      });
    }
  }

  private getLocalHour(ts: Date, timezone: string): number {
    try {
      let fmt = this.hourFormatters.get(timezone);
      if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
        this.hourFormatters.set(timezone, fmt);
      }
      const parts = fmt.formatToParts(ts);
      const hourPart = parts.find(p => p.type === 'hour');
      const h = hourPart ? parseInt(hourPart.value) : ts.getUTCHours();
      // Add fractional hour from minutes
      return h + ts.getMinutes() / 60;
    } catch {
      return ts.getUTCHours() + ts.getMinutes() / 60;
    }
  }

  private getAmbientTemp(ts: Date, site: SiteRow): number {
    const hour = this.getLocalHour(ts, site.timezone);
    const dayOfYear = Math.floor((ts.getTime() - new Date(ts.getFullYear(), 0, 0).getTime()) / 86400000);
    const dailyCycle = Math.sin((hour - 5) / 24 * 2 * Math.PI) * 8;
    const seasonal = Math.sin((dayOfYear - 80) / 365 * 2 * Math.PI) * 6;
    const latEffect = (40 - Math.abs(site.latitude)) * 0.4;
    return 22 + latEffect + seasonal + dailyCycle + gauss(0, 1.2);
  }

  private getMarketPrice(ts: Date, market: string, tz: string): number {
    const hour = this.getLocalHour(ts, tz);
    let base = 35;
    if (hour >= 6 && hour < 10) base = 45 + (hour - 6) * 10;
    else if (hour >= 10 && hour < 15) base = 25 - Math.random() * 12;
    else if (hour >= 15 && hour < 21) base = 55 + (hour - 15) * 12;
    else base = 28;

    if (market === 'ERCOT') base *= 1.15;
    if (market === 'CAISO') base *= (hour >= 10 && hour < 15 ? 0.55 : 1.1);

    if (Math.random() < 0.015) base = 200 + Math.random() * 400;
    if (market === 'CAISO' && hour >= 11 && hour < 14 && Math.random() < 0.12) {
      base = -5 - Math.random() * 20;
    }
    return base + gauss(0, 4);
  }

  generateTick(ts: Date): {
    telemetry: unknown[][];
    alarms: unknown[][];
    dispatches: unknown[][];
    marketPrices: unknown[][];
    maintenanceLogs: unknown[][];
  } {
    const telemetry: unknown[][] = [];
    const alarms: unknown[][] = [];
    const dispatches: unknown[][] = [];
    const marketPrices: unknown[][] = [];
    const maintenanceLogs: unknown[][] = [];

    const intervalHours = this.config.telemetryIntervalMs / 3_600_000;
    const intervalDays = intervalHours / 24;

    for (const state of this.states.values()) {
      const { site } = state;
      const localHour = this.getLocalHour(ts, site.timezone);

      // --- Site-level operating mode ---
      let targetPowerFraction = 0;
      if (localHour >= 10 && localHour < 15) {
        const ramp = localHour < 11 ? (localHour - 10) : localHour > 14 ? (15 - localHour) : 1;
        targetPowerFraction = -(0.6 + Math.random() * 0.25) * ramp;
        state.mode = 'charging';
      } else if (localHour >= 16 && localHour < 21) {
        const ramp = localHour < 17 ? (localHour - 16) : localHour > 20 ? (21 - localHour) : 1;
        targetPowerFraction = (0.5 + Math.random() * 0.3) * ramp;
        state.mode = 'discharging';
      } else if (localHour >= 6 && localHour < 10) {
        targetPowerFraction = -(0.08 + Math.random() * 0.12);
        state.mode = 'charging';
      } else {
        targetPowerFraction = -(0.02 + Math.random() * 0.03);
        state.mode = 'idle';
      }

      // --- Demand response ---
      if (state.drActive && state.drEndsAt !== null) {
        if (ts.getTime() >= state.drEndsAt) {
          // DR event just ended — emit completed dispatch
          if (!state.drDispatchEmitted) {
            const cmdType = DISPATCH_TYPES[Math.floor(Math.random() * DISPATCH_TYPES.length)];
            const durationMin = Math.round((state.drEndsAt - (state.drEndsAt - 15 * 60_000)) / 60_000);
            const startTs = new Date(state.drEndsAt - durationMin * 60_000);
            dispatches.push([
              startTs.toISOString(), site.site_id, cmdType,
              round2(site.capacity_mw * 0.85), durationMin,
              'auto_dispatch', 'completed', startTs.toISOString(), ts.toISOString(),
            ]);
            state.drDispatchEmitted = true;
          }
          state.drActive = false;
          state.drEndsAt = null;
        } else {
          targetPowerFraction = 0.85 + Math.random() * 0.1;
          state.mode = 'discharging';
        }
      }

      // Trigger DR randomly
      const drProbPerTick = (this.config.dispatchIntervalMin / 60 / 24) * intervalDays;
      if (!state.drActive && Math.random() < drProbPerTick) {
        const durationMin = 5 + Math.floor(Math.random() * 25);
        state.drActive = true;
        state.drEndsAt = ts.getTime() + durationMin * 60_000;
        state.drDispatchEmitted = false;
        targetPowerFraction = 0.9;
        state.mode = 'discharging';
      }

      // --- Site-level power smoothing ---
      const avgSoc = state.assets.reduce((s, a) => s + a.soc, 0) / state.assets.length;
      if (avgSoc <= 8) targetPowerFraction = Math.min(targetPowerFraction, -0.1);
      if (avgSoc >= 93) targetPowerFraction = Math.max(targetPowerFraction, 0.05);

      const targetPower = targetPowerFraction * site.capacity_mw;
      // Smooth power: 1% move per tick (real inverters ramp slowly via PID controllers)
      state.activePower += (targetPower - state.activePower) * 0.01 + gauss(0, site.capacity_mw * 0.00005);
      state.activePower = clamp(state.activePower, -site.capacity_mw, site.capacity_mw);

      // Smooth ambient, grid freq, grid voltage (real sensors change very slowly)
      const targetAmbient = this.getAmbientTemp(ts, site);
      state.ambient += (targetAmbient - state.ambient) * 0.005 + gauss(0, 0.005);
      state.gridFreq += (60.0 - state.gridFreq) * 0.02 + gauss(0, 0.0002);
      state.gridFreq = clamp(state.gridFreq, 59.92, 60.08);
      state.gridVoltage += (138.0 - state.gridVoltage) * 0.01 + gauss(0, 0.002);
      state.gridVoltage = clamp(state.gridVoltage, 135, 141);
      const ambient = state.ambient;
      const gridFreq = state.gridFreq;
      const gridVoltage = state.gridVoltage;

      // --- Per-asset telemetry ---
      const totalCapacityMw = state.assets.reduce((s, a) => s + a.asset.max_power_mw, 0);

      for (const assetState of state.assets) {
        const { asset } = assetState;
        const powerShare = asset.max_power_mw / totalCapacityMw;

        // Maintenance check
        if (assetState.inMaintenance) {
          if (assetState.maintenanceEndsAt !== null && ts.getTime() >= assetState.maintenanceEndsAt) {
            assetState.inMaintenance = false;
            assetState.maintenanceEndsAt = null;
          }
        } else {
          const maintProb = this.config.maintenanceProbability * intervalDays;
          if (Math.random() < maintProb) {
            assetState.inMaintenance = true;
            const hours = 2 + Math.random() * 6;
            assetState.maintenanceEndsAt = ts.getTime() + hours * 3_600_000;
            // Write maintenance log
            const MAINT_TYPES = ['scheduled_inspection', 'bms_firmware_update', 'hvac_service', 'cell_balancing', 'contactor_replacement', 'inverter_calibration'];
            const TECHNICIANS = ['J. Martinez', 'A. Chen', 'R. Patel', 'S. Okonkwo', 'M. Schmidt'];
            const logType = MAINT_TYPES[Math.floor(Math.random() * MAINT_TYPES.length)];
            maintenanceLogs.push([
              ts.toISOString(), site.site_id, asset.asset_id,
              logType, `${logType.replace(/_/g, ' ')} on ${asset.name}`,
              TECHNICIANS[Math.floor(Math.random() * TECHNICIANS.length)],
              round2(hours),
            ]);
          }
        }

        let assetPower: number;
        let chargePower: number;
        let dischargePower: number;

        if (assetState.inMaintenance) {
          assetPower = 0;
          chargePower = 0;
          dischargePower = 0;
        } else {
          assetPower = state.activePower * powerShare + gauss(0, asset.max_power_mw * 0.00005);
          assetPower = clamp(assetPower, -asset.max_power_mw, asset.max_power_mw);
          chargePower = assetPower < 0 ? Math.abs(assetPower) : 0;
          dischargePower = assetPower > 0 ? assetPower : 0;
        }

        // SoC integration (per-asset)
        const energyDeltaMwh = -assetPower * intervalHours;
        const efficiency = assetPower > 0 ? 0.92 : 1.0;
        assetState.soc += (energyDeltaMwh * efficiency / asset.capacity_mwh) * 100;
        assetState.soc = clamp(assetState.soc, 2, 98);

        // SoH — TIME-BASED degradation
        const cycleDepth = Math.abs(assetPower / asset.max_power_mw);
        const degradationPerHour = cycleDepth * 0.0002; // ~1.75%/yr at 100% continuous cycling
        assetState.soh -= degradationPerHour * intervalHours;
        assetState.soh = clamp(assetState.soh, 92, 99.9);

        // Thermal model — smoothed (real temps have thermal inertia, change slowly)
        const loadHeat = assetState.inMaintenance ? 0 : (Math.abs(assetPower) / asset.max_power_mw) * 14;
        const targetInvTemp = ambient + loadHeat + assetState.tempOffset + 2;
        const targetRackTemp = ambient + loadHeat * 0.5 + assetState.tempOffset * 0.7 + 0.5;
        assetState.inverterTemp += (targetInvTemp - assetState.inverterTemp) * 0.005 + gauss(0, 0.005);
        assetState.rackTemp += (targetRackTemp - assetState.rackTemp) * 0.005 + gauss(0, 0.003);
        assetState.inverterTemp = clamp(assetState.inverterTemp, 18, 68);
        assetState.rackTemp = clamp(assetState.rackTemp, 16, 52);
        const inverterTemp = assetState.inverterTemp;
        const rackTemp = assetState.rackTemp;

        // Cell voltage (LFP: 3.2V empty → 3.65V full) — smooth, tiny noise
        const cellVoltageAvg = 3.2 + (assetState.soc / 100) * 0.45 + gauss(0, 0.00005);
        const spread = assetState.voltageSpread;

        // RTE — smoothed (efficiency doesn't jump randomly)
        const targetRte = clamp(88 - (inverterTemp - 35) * 0.08, 82, 95);
        assetState.rte += (targetRte - assetState.rte) * 0.005 + gauss(0, 0.002);
        assetState.rte = clamp(assetState.rte, 82, 95);
        const rte = assetState.rte;

        if (this.config.perAssetTelemetry) {
          telemetry.push([
            ts.toISOString(), site.site_id, asset.asset_id,
            round1(state.activePower),  // site total — 0.1 MW precision
            round1(chargePower), round1(dischargePower),
            round1(assetState.soc), round2(assetState.soh), round1(rte),
            round1(inverterTemp), round1(rackTemp),
            round3(cellVoltageAvg), round3(cellVoltageAvg - spread), round3(cellVoltageAvg + spread),
            round1(ambient), round3(gridFreq), round1(gridVoltage),
          ]);
        }
      }

      // Site-level row (if not per-asset, emit one row per site)
      if (!this.config.perAssetTelemetry) {
        const a0 = state.assets[0];
        const chargePower = state.activePower < 0 ? Math.abs(state.activePower) : 0;
        const dischargePower = state.activePower > 0 ? state.activePower : 0;
        const cellV = 3.2 + (a0.soc / 100) * 0.45;
        const loadHeat = Math.abs(state.activePower / site.capacity_mw) * 14;
        const invT = clamp(ambient + loadHeat + gauss(2, 1.5), 18, 65);
        const rackT = clamp(ambient + loadHeat * 0.5 + gauss(0.5, 1), 16, 50);
        telemetry.push([
          ts.toISOString(), site.site_id, a0.asset.asset_id,
          round2(state.activePower), round2(chargePower), round2(dischargePower),
          round2(a0.soc), round2(a0.soh),
          round2(clamp(88 + gauss(0, 1.5) - (invT - 35) * 0.1, 82, 95)),
          round2(invT), round2(rackT),
          round3(cellV), round3(cellV - 0.02), round3(cellV + 0.02),
          round2(ambient), round3(gridFreq), round2(gridVoltage),
        ]);
      }

      // --- Alarms ---
      const alarmProb = this.config.alarmProbability;
      if (Math.random() < alarmProb) {
        const alarm = ALARM_CODES[Math.floor(Math.random() * ALARM_CODES.length)];
        const targetAsset = state.assets[Math.floor(Math.random() * state.assets.length)];

        // 30% of alarms stay unresolved (truly active)
        // But cap unresolved per site at ~8
        const leaveUnresolved = Math.random() < 0.15 && state.unresolvedAlarmCount < 3;
        let resolvedAt: string | null;

        if (leaveUnresolved) {
          resolvedAt = null;
          state.unresolvedAlarmCount++;
        } else {
          const resolveMin = alarm.severity === 'emergency' ? 30 + Math.random() * 60 :
                            alarm.severity === 'critical' ? 10 + Math.random() * 30 :
                            1 + Math.random() * 20;
          resolvedAt = new Date(ts.getTime() + resolveMin * 60_000).toISOString();
        }

        alarms.push([
          ts.toISOString(), site.site_id,
          targetAsset.asset.asset_id,
          alarm.code, alarm.severity, alarm.msg, resolvedAt,
        ]);
      }

      // Periodically resolve some old unresolved alarms (decay)
      if (state.unresolvedAlarmCount > 3 && Math.random() < 0.1) {
        state.unresolvedAlarmCount = Math.max(0, state.unresolvedAlarmCount - 1);
      }
    }

    // --- Market prices ---
    for (const { market, region, tz } of MARKETS) {
      marketPrices.push([
        ts.toISOString(), market, region,
        round2(this.getMarketPrice(ts, market, tz)),
      ]);
    }

    return { telemetry, alarms, dispatches, marketPrices, maintenanceLogs };
  }
}
