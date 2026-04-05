import { query } from './db';
import type { Site, BatteryAsset, Alarm, DispatchCommand, MarketPrice, FleetKPIs, PlatformStats, SiteOverview, MaintenanceLog } from './types';

export async function getSites(): Promise<{ data: Site[]; queryMs: number }> {
  const res = await query(`
    SELECT s.*, o.name AS org_name
    FROM sites s JOIN organizations o ON o.org_id = s.org_id
    ORDER BY s.name
  `);
  return { data: res.rows, queryMs: res.duration };
}

export async function getSiteDetail(siteId: string) {
  const res = await query(`
    SELECT s.*, o.name AS org_name,
      (SELECT COUNT(*) FROM battery_assets WHERE site_id = s.site_id) AS asset_count,
      (SELECT COUNT(*) FROM pcs_inverters WHERE site_id = s.site_id) AS inverter_count,
      (SELECT COUNT(*) FROM battery_racks r JOIN battery_assets a ON a.asset_id = r.asset_id WHERE a.site_id = s.site_id) AS rack_count
    FROM sites s JOIN organizations o ON o.org_id = s.org_id
    WHERE s.site_id = $1
  `, [siteId]);
  return { data: res.rows[0], queryMs: res.duration };
}

export async function getSiteAssets(siteId: string): Promise<{ data: BatteryAsset[]; queryMs: number }> {
  const res = await query(`
    SELECT a.*,
      (SELECT COUNT(*) FROM pcs_inverters WHERE asset_id = a.asset_id) AS inverter_count,
      (SELECT COUNT(*) FROM battery_racks WHERE asset_id = a.asset_id) AS rack_count
    FROM battery_assets a
    WHERE a.site_id = $1
    ORDER BY a.name
  `, [siteId]);
  return { data: res.rows, queryMs: res.duration };
}

export async function getLatestTelemetry(siteId: string) {
  const res = await query(`
    SELECT * FROM telemetry_raw
    WHERE site_id = $1
    ORDER BY ts DESC LIMIT 1
  `, [siteId]);
  return { data: res.rows[0] || null, queryMs: res.duration };
}

export async function getFleetOverview(): Promise<{ data: SiteOverview[]; queryMs: number }> {
  const res = await query(`
    SELECT
      s.*,
      o.name AS org_name,
      t.site_power_mw AS latest_power_mw,
      t.state_of_charge_pct AS latest_soc_pct,
      t.state_of_health_pct AS latest_soh_pct,
      t.round_trip_efficiency AS latest_rte,
      t.inverter_temp_c AS latest_temp_c,
      COALESCE(al.active_alarms, 0) AS active_alarms
    FROM sites s
    JOIN organizations o ON o.org_id = s.org_id
    LEFT JOIN LATERAL (
      SELECT site_power_mw, state_of_charge_pct, state_of_health_pct, round_trip_efficiency, inverter_temp_c
      FROM telemetry_raw WHERE site_id = s.site_id ORDER BY ts DESC LIMIT 1
    ) t ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS active_alarms
      FROM alarms_events WHERE site_id = s.site_id AND resolved_at IS NULL
    ) al ON TRUE
    ORDER BY s.name
  `);
  return { data: res.rows, queryMs: res.duration };
}

export async function getTelemetryHistory(siteId: string, from?: string, to?: string, resolution?: string) {
  const now = new Date();
  const fromDate = from || new Date(now.getTime() - 24 * 3600_000).toISOString();
  const toDate = to || now.toISOString();

  // Choose table based on resolution or time range
  const rangeMs = new Date(toDate).getTime() - new Date(fromDate).getTime();
  const rangeHours = rangeMs / 3_600_000;

  let table: string;
  let timeCol: string;
  let columns: string;

  if (resolution === 'raw' || (!resolution && rangeHours <= 1)) {
    table = 'telemetry_raw';
    timeCol = 'ts';
    columns = 'ts AS time, site_power_mw, charge_power_mw, discharge_power_mw, state_of_charge_pct, state_of_health_pct, round_trip_efficiency, inverter_temp_c, rack_temp_c, cell_voltage_avg, ambient_temp_c, grid_frequency_hz';
  } else if (resolution === '1min' || (!resolution && rangeHours <= 4)) {
    table = 'telemetry_1min';
    timeCol = 'bucket';
    columns = 'bucket AS time, avg_site_power_mw AS site_power_mw, avg_charge_power_mw AS charge_power_mw, avg_discharge_power_mw AS discharge_power_mw, avg_soc_pct AS state_of_charge_pct, avg_soh_pct AS state_of_health_pct, avg_rte AS round_trip_efficiency, avg_inverter_temp_c AS inverter_temp_c, avg_rack_temp_c AS rack_temp_c, avg_cell_voltage AS cell_voltage_avg, avg_ambient_temp_c AS ambient_temp_c, avg_grid_frequency_hz AS grid_frequency_hz';
  } else if (resolution === '15min' || (!resolution && rangeHours <= 48)) {
    table = 'telemetry_15min';
    timeCol = 'bucket';
    columns = 'bucket AS time, avg_site_power_mw AS site_power_mw, avg_charge_power_mw AS charge_power_mw, avg_discharge_power_mw AS discharge_power_mw, avg_soc_pct AS state_of_charge_pct, avg_soh_pct AS state_of_health_pct, avg_rte AS round_trip_efficiency, avg_inverter_temp_c AS inverter_temp_c, avg_rack_temp_c AS rack_temp_c, avg_cell_voltage AS cell_voltage_avg, avg_ambient_temp_c AS ambient_temp_c, avg_grid_frequency_hz AS grid_frequency_hz';
  } else {
    table = 'telemetry_1hour';
    timeCol = 'bucket';
    columns = 'bucket AS time, avg_site_power_mw AS site_power_mw, avg_charge_power_mw AS charge_power_mw, avg_discharge_power_mw AS discharge_power_mw, avg_soc_pct AS state_of_charge_pct, avg_soh_pct AS state_of_health_pct, avg_rte AS round_trip_efficiency, avg_inverter_temp_c AS inverter_temp_c, avg_rack_temp_c AS rack_temp_c, avg_cell_voltage AS cell_voltage_avg, avg_ambient_temp_c AS ambient_temp_c, avg_grid_frequency_hz AS grid_frequency_hz';
  }

  const res = await query(`
    SELECT ${columns}
    FROM ${table}
    WHERE site_id = $1 AND ${timeCol} >= $2 AND ${timeCol} <= $3
    ORDER BY ${timeCol}
  `, [siteId, fromDate, toDate]);

  return { data: res.rows, queryMs: res.duration, table };
}

export async function getActiveAlarms(siteId?: string): Promise<{ data: Alarm[]; queryMs: number }> {
  const conditions = ['resolved_at IS NULL'];
  const params: unknown[] = [];
  if (siteId) {
    params.push(siteId);
    conditions.push(`a.site_id = $${params.length}`);
  }

  const res = await query(`
    SELECT a.*, s.name AS site_name
    FROM alarms_events a JOIN sites s ON s.site_id = a.site_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.ts DESC LIMIT 100
  `, params);
  return { data: res.rows, queryMs: res.duration };
}

export async function getAlarmHistory(siteId?: string, from?: string, to?: string): Promise<{ data: Alarm[]; queryMs: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (siteId) { params.push(siteId); conditions.push(`a.site_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`a.ts >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`a.ts <= $${params.length}`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query(`
    SELECT a.*, s.name AS site_name
    FROM alarms_events a JOIN sites s ON s.site_id = a.site_id
    ${where}
    ORDER BY a.ts DESC LIMIT 500
  `, params);
  return { data: res.rows, queryMs: res.duration };
}

export async function getAlarmStats() {
  const res = await query(`
    SELECT severity, COUNT(*) AS count
    FROM alarms_events
    WHERE resolved_at IS NULL
    GROUP BY severity
    ORDER BY CASE severity WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END
  `);
  return { data: res.rows, queryMs: res.duration };
}

export async function getDispatchHistory(siteId?: string, from?: string, to?: string): Promise<{ data: DispatchCommand[]; queryMs: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (siteId) { params.push(siteId); conditions.push(`d.site_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`d.ts >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`d.ts <= $${params.length}`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query(`
    SELECT d.*, s.name AS site_name
    FROM dispatch_commands d JOIN sites s ON s.site_id = d.site_id
    ${where}
    ORDER BY d.ts DESC LIMIT 200
  `, params);
  return { data: res.rows, queryMs: res.duration };
}

export async function getMarketPrices(market?: string, from?: string, to?: string): Promise<{ data: MarketPrice[]; queryMs: number }> {
  const now = new Date();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (market) { params.push(market); conditions.push(`market = $${params.length}`); }
  params.push(from || new Date(now.getTime() - 24 * 3600_000).toISOString());
  conditions.push(`ts >= $${params.length}`);
  params.push(to || now.toISOString());
  conditions.push(`ts <= $${params.length}`);

  const res = await query(`
    SELECT * FROM market_price_signals
    WHERE ${conditions.join(' AND ')}
    ORDER BY ts DESC LIMIT 1000
  `, params);
  return { data: res.rows, queryMs: res.duration };
}

export async function getFleetKPIs(): Promise<{ data: FleetKPIs; queryMs: number }> {
  const res = await query(`
    WITH latest AS (
      SELECT DISTINCT ON (site_id) site_id, site_power_mw, state_of_charge_pct, state_of_health_pct, round_trip_efficiency
      FROM telemetry_raw ORDER BY site_id, ts DESC
    )
    SELECT
      (SELECT COALESCE(SUM(capacity_mw), 0) FROM sites) AS total_capacity_mw,
      (SELECT COALESCE(SUM(capacity_mwh), 0) FROM sites) AS total_capacity_mwh,
      COALESCE(SUM(l.site_power_mw), 0) AS total_current_power_mw,
      COALESCE(AVG(l.state_of_charge_pct), 0) AS avg_soc_pct,
      COALESCE(AVG(l.state_of_health_pct), 0) AS avg_soh_pct,
      COALESCE(AVG(l.round_trip_efficiency), 0) AS avg_rte,
      (SELECT COUNT(*) FROM alarms_events WHERE resolved_at IS NULL) AS active_alarm_count,
      (SELECT COUNT(*) FROM sites) AS site_count
    FROM latest l
  `);
  return { data: res.rows[0], queryMs: res.duration };
}

export async function getPlatformStats(): Promise<{ data: PlatformStats; queryMs: number }> {
  const res = await query(`
    SELECT
      (SELECT COALESCE(SUM(c.reltuples)::BIGINT, 0)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = 'telemetry_raw' AND n.nspname = 'public') AS telemetry_row_count,
      (SELECT COUNT(*) FROM timescaledb_information.chunks) AS chunk_count,
      (SELECT COUNT(*) FROM timescaledb_information.chunks WHERE is_compressed) AS compressed_chunk_count,
      (SELECT COUNT(*) FROM timescaledb_information.continuous_aggregates) AS continuous_aggregates,
      (SELECT COUNT(*) FROM timescaledb_information.hypertables) AS hypertable_count
  `);

  // Get compression stats
  let compressionData = { before: 0, after: 0 };
  try {
    const compRes = await query(`
      SELECT
        COALESCE(SUM(before_compression_total_bytes), 0) AS before_bytes,
        COALESCE(SUM(after_compression_total_bytes), 0) AS after_bytes
      FROM hypertable_compression_stats('telemetry_raw')
    `);
    if (compRes.rows[0]) {
      compressionData = {
        before: parseInt(compRes.rows[0].before_bytes) || 0,
        after: parseInt(compRes.rows[0].after_bytes) || 0,
      };
    }
  } catch {
    // Compression stats may not be available yet
  }

  const row = res.rows[0];
  const ratio = compressionData.after > 0 ? compressionData.before / compressionData.after : 0;

  return {
    data: {
      telemetry_row_count: parseInt(row.telemetry_row_count) || 0,
      compression_ratio: Math.round(ratio * 10) / 10,
      before_compression_bytes: compressionData.before,
      after_compression_bytes: compressionData.after,
      chunk_count: parseInt(row.chunk_count) || 0,
      compressed_chunk_count: parseInt(row.compressed_chunk_count) || 0,
      continuous_aggregates: parseInt(row.continuous_aggregates) || 0,
      hypertable_count: parseInt(row.hypertable_count) || 0,
    },
    queryMs: res.duration,
  };
}

export async function getSiteKPIs(siteId: string) {
  const res = await query(`
    SELECT
      t.site_power_mw, t.state_of_charge_pct, t.state_of_health_pct,
      t.round_trip_efficiency, t.inverter_temp_c, t.rack_temp_c, t.ambient_temp_c,
      t.grid_frequency_hz, t.availability_status, t.ts,
      (SELECT COUNT(*) FROM alarms_events WHERE site_id = $1 AND resolved_at IS NULL) AS active_alarms,
      (SELECT COUNT(*) FROM battery_assets WHERE site_id = $1) AS asset_count
    FROM telemetry_raw t
    WHERE t.site_id = $1
    ORDER BY t.ts DESC LIMIT 1
  `, [siteId]);
  return { data: res.rows[0] || null, queryMs: res.duration };
}

export async function getMaintenanceLogs(siteId?: string, limit = 50): Promise<{ data: MaintenanceLog[]; queryMs: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (siteId) { params.push(siteId); conditions.push(`m.site_id = $${params.length}`); }
  params.push(limit);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query(`
    SELECT m.*, s.name AS site_name
    FROM maintenance_logs m JOIN sites s ON s.site_id = m.site_id
    ${where}
    ORDER BY m.ts DESC LIMIT $${params.length}
  `, params);
  return { data: res.rows, queryMs: res.duration };
}
