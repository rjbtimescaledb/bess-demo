import { query } from './db';
import type { Site, BatteryAsset, Alarm, DispatchCommand, MarketPrice, FleetKPIs, PlatformStats, SiteOverview, MaintenanceLog, AssetHealthRow, FleetUtilizationRow } from './types';

// Convert Date objects to ISO strings so RSC serialization doesn't break
function serializeRows<T>(rows: T[]): T[] {
  return rows.map(row => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      out[k] = v instanceof Date ? v.toISOString() : v;
    }
    return out as T;
  });
}

export async function getSites(): Promise<{ data: Site[]; queryMs: number }> {
  const res = await query(`
    SELECT s.*, o.name AS org_name
    FROM sites s JOIN organizations o ON o.org_id = s.org_id
    ORDER BY s.name
  `);
  return { data: serializeRows(res.rows), queryMs: res.duration };
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
  return { data: res.rows[0] ? serializeRows([res.rows[0]])[0] : null, queryMs: res.duration };
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
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

export async function getLatestTelemetry(siteId: string) {
  const res = await query(`
    SELECT bucket AS ts, avg_site_power_mw AS site_power_mw,
           avg_charge_power_mw AS charge_power_mw, avg_discharge_power_mw AS discharge_power_mw,
           avg_soc_pct AS state_of_charge_pct, avg_soh_pct AS state_of_health_pct,
           avg_rte AS round_trip_efficiency, avg_inverter_temp_c AS inverter_temp_c,
           avg_rack_temp_c AS rack_temp_c, avg_cell_voltage AS cell_voltage_avg,
           avg_ambient_temp_c AS ambient_temp_c, avg_grid_frequency_hz AS grid_frequency_hz
    FROM telemetry_1min
    WHERE site_id = $1 AND bucket > NOW() - INTERVAL '10 minutes'
    ORDER BY bucket DESC LIMIT 1
  `, [siteId]);
  return { data: res.rows[0] ? serializeRows([res.rows[0]])[0] : null, queryMs: res.duration };
}

export async function getFleetOverview(): Promise<{ data: SiteOverview[]; queryMs: number }> {
  const res = await query(`
    WITH latest AS (
      SELECT DISTINCT ON (site_id)
        site_id, avg_site_power_mw, avg_soc_pct, avg_soh_pct, avg_rte, avg_inverter_temp_c
      FROM telemetry_1min
      WHERE bucket > NOW() - INTERVAL '10 minutes'
      ORDER BY site_id, bucket DESC
    ),
    alarm_counts AS (
      SELECT site_id, COUNT(*) AS active_alarms
      FROM alarms_events WHERE resolved_at IS NULL
      GROUP BY site_id
    )
    SELECT
      s.site_id, s.org_id, s.name, s.slug, s.latitude, s.longitude,
      s.capacity_mw, s.capacity_mwh, s.status, s.timezone,
      o.name AS org_name,
      t.avg_site_power_mw AS latest_power_mw,
      t.avg_soc_pct AS latest_soc_pct,
      t.avg_soh_pct AS latest_soh_pct,
      t.avg_rte AS latest_rte,
      t.avg_inverter_temp_c AS latest_temp_c,
      COALESCE(al.active_alarms, 0) AS active_alarms
    FROM sites s
    JOIN organizations o ON o.org_id = s.org_id
    LEFT JOIN latest t ON t.site_id = s.site_id
    LEFT JOIN alarm_counts al ON al.site_id = s.site_id
    ORDER BY s.name
  `);
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

export async function getTelemetryHistory(siteId: string, from?: string, to?: string, resolution?: string) {
  const now = new Date();
  const fromDate = from || new Date(now.getTime() - 24 * 3600_000).toISOString();
  const toDate = to || now.toISOString();

  const rangeMs = new Date(toDate).getTime() - new Date(fromDate).getTime();
  const rangeHours = rangeMs / 3_600_000;

  let table: string;
  let timeCol: string;
  let columns: string;

  if (resolution === 'raw' || (!resolution && rangeHours <= 0.25)) {
    table = 'telemetry_raw';
    timeCol = 'ts';
    columns = 'ts AS time, site_power_mw, charge_power_mw, discharge_power_mw, state_of_charge_pct, state_of_health_pct, round_trip_efficiency, inverter_temp_c, rack_temp_c, cell_voltage_avg, ambient_temp_c, grid_frequency_hz';
  } else if (resolution === '1min' || (!resolution && rangeHours <= 26)) {
    table = 'telemetry_1min';
    timeCol = 'bucket';
    columns = 'bucket AS time, avg_site_power_mw AS site_power_mw, avg_charge_power_mw AS charge_power_mw, avg_discharge_power_mw AS discharge_power_mw, avg_soc_pct AS state_of_charge_pct, avg_soh_pct AS state_of_health_pct, avg_rte AS round_trip_efficiency, avg_inverter_temp_c AS inverter_temp_c, avg_rack_temp_c AS rack_temp_c, avg_cell_voltage AS cell_voltage_avg, avg_ambient_temp_c AS ambient_temp_c, avg_grid_frequency_hz AS grid_frequency_hz';
  } else if (resolution === '15min' || (!resolution && rangeHours <= 72)) {
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
  return { data: serializeRows(res.rows), queryMs: res.duration };
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
  return { data: serializeRows(res.rows), queryMs: res.duration };
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
  return { data: serializeRows(res.rows), queryMs: res.duration };
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
      SELECT DISTINCT ON (site_id) site_id, avg_site_power_mw AS site_power_mw,
             avg_soc_pct AS state_of_charge_pct, avg_soh_pct AS state_of_health_pct,
             avg_rte AS round_trip_efficiency
      FROM telemetry_1min WHERE bucket > NOW() - INTERVAL '10 minutes'
      ORDER BY site_id, bucket DESC
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
  // Use 1-min CAGG instead of raw table scan
  const res = await query(`
    SELECT
      t.avg_site_power_mw AS site_power_mw,
      t.avg_soc_pct AS state_of_charge_pct,
      t.avg_soh_pct AS state_of_health_pct,
      t.avg_rte AS round_trip_efficiency,
      t.avg_inverter_temp_c AS inverter_temp_c,
      t.avg_rack_temp_c AS rack_temp_c,
      t.avg_ambient_temp_c AS ambient_temp_c,
      t.avg_grid_frequency_hz AS grid_frequency_hz,
      t.bucket AS ts,
      (SELECT COUNT(*) FROM alarms_events WHERE site_id = $1 AND resolved_at IS NULL) AS active_alarms,
      (SELECT COUNT(*) FROM battery_assets WHERE site_id = $1) AS asset_count
    FROM telemetry_1min t
    WHERE t.site_id = $1 AND t.bucket > NOW() - INTERVAL '10 minutes'
    ORDER BY t.bucket DESC LIMIT 1
  `, [siteId]);
  return { data: res.rows[0] ? serializeRows([res.rows[0]])[0] : null, queryMs: res.duration };
}

// ============================================================
// V2: Decision-Support Queries
// ============================================================

export async function getDispatchReadiness() {
  const res = await query(`
    WITH latest_telemetry AS (
      SELECT DISTINCT ON (site_id)
        site_id, avg_soc_pct AS soc, avg_soh_pct AS soh,
        avg_site_power_mw AS current_power, bucket
      FROM telemetry_1min WHERE bucket > NOW() - INTERVAL '10 minutes' ORDER BY site_id, bucket DESC
    ),
    active_critical AS (
      SELECT site_id, COUNT(*) AS critical_alarms
      FROM alarms_events
      WHERE resolved_at IS NULL AND severity IN ('critical', 'emergency')
      GROUP BY site_id
    ),
    recent_dispatch AS (
      SELECT DISTINCT ON (site_id) site_id, ts AS last_dispatch_ts, status AS last_dispatch_status
      FROM dispatch_commands ORDER BY site_id, ts DESC
    )
    SELECT
      s.site_id, s.name, s.capacity_mw, s.capacity_mwh,
      ROUND(lt.soc::numeric, 1) AS soc_pct,
      ROUND(lt.soh::numeric, 1) AS soh_pct,
      ROUND(lt.current_power::numeric, 1) AS current_power_mw,
      COALESCE(ac.critical_alarms, 0) AS critical_alarms,
      rd.last_dispatch_ts,
      -- Discharge headroom: how much energy can be discharged (MWh)
      ROUND((lt.soc / 100.0 * s.capacity_mwh * 0.85)::numeric, 1) AS available_energy_mwh,
      -- Readiness score: 0-100 (higher = more ready to dispatch)
      ROUND(GREATEST(0, LEAST(100,
        (lt.soc * 0.5)                                          -- SoC weight (0-50 pts)
        + (lt.soh - 90) * 5                                     -- SoH weight (0-50 pts if 100%)
        - COALESCE(ac.critical_alarms, 0) * 25                  -- Penalty for critical alarms
        - CASE WHEN lt.current_power > s.capacity_mw * 0.5 THEN 20 ELSE 0 END  -- Penalty if already discharging hard
      ))::numeric, 0) AS readiness_score
    FROM sites s
    LEFT JOIN latest_telemetry lt ON lt.site_id = s.site_id
    LEFT JOIN active_critical ac ON ac.site_id = s.site_id
    LEFT JOIN recent_dispatch rd ON rd.site_id = s.site_id
    ORDER BY readiness_score DESC
  `);
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

export async function getRevenueOpportunityNow() {
  const res = await query(`
    WITH latest_telemetry AS (
      SELECT DISTINCT ON (site_id)
        site_id, avg_soc_pct AS soc, avg_site_power_mw AS current_power, bucket
      FROM telemetry_1min WHERE bucket > NOW() - INTERVAL '10 minutes'
      ORDER BY site_id, bucket DESC
    ),
    latest_prices AS (
      SELECT DISTINCT ON (market)
        market, region, price_usd_mwh, ts
      FROM market_price_signals WHERE ts > NOW() - INTERVAL '30 minutes'
      ORDER BY market, ts DESC
    )
    SELECT
      s.site_id, s.name, s.capacity_mw, s.capacity_mwh, s.timezone,
      ROUND(lt.soc::numeric, 1) AS soc_pct,
      ROUND(lt.current_power::numeric, 1) AS current_power_mw,
      lp.market,
      ROUND(lp.price_usd_mwh::numeric, 2) AS price_usd_mwh,
      -- Available discharge capacity (MW)
      ROUND(GREATEST(0, s.capacity_mw - GREATEST(lt.current_power, 0))::numeric, 1) AS available_mw,
      -- Available energy if fully discharged to 10% SoC (MWh)
      ROUND(GREATEST(0, (lt.soc - 10) / 100.0 * s.capacity_mwh)::numeric, 1) AS available_mwh,
      -- Revenue per hour if dispatched at full available capacity ($/hr)
      ROUND((GREATEST(0, s.capacity_mw - GREATEST(lt.current_power, 0)) * lp.price_usd_mwh)::numeric, 0) AS revenue_per_hour_usd,
      -- Total energy revenue if discharged to 10% SoC ($)
      ROUND((GREATEST(0, (lt.soc - 10) / 100.0 * s.capacity_mwh) * lp.price_usd_mwh)::numeric, 0) AS total_opportunity_usd
    FROM sites s
    LEFT JOIN latest_telemetry lt ON lt.site_id = s.site_id
    CROSS JOIN latest_prices lp
    WHERE lp.market = CASE
      WHEN s.timezone = 'America/Los_Angeles' THEN 'CAISO'
      WHEN s.timezone = 'America/Chicago' THEN 'ERCOT'
      ELSE 'PJM'
    END
    ORDER BY revenue_per_hour_usd DESC
  `);
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

export async function getMissedRevenue(from?: string, to?: string) {
  const now = new Date();
  const fromDate = from || new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const toDate = to || now.toISOString();

  const res = await query(`
    WITH hourly_state AS (
      SELECT
        t.bucket, t.site_id,
        t.avg_soc_pct AS soc,
        t.avg_site_power_mw AS power_mw,
        t.avg_discharge_power_mw AS discharge_mw,
        s.capacity_mw, s.capacity_mwh, s.name,
        s.timezone
      FROM telemetry_1hour t
      JOIN sites s ON s.site_id = t.site_id
      WHERE t.bucket >= $1 AND t.bucket <= $2
    ),
    hourly_prices AS (
      SELECT
        time_bucket('1 hour', ts) AS bucket,
        market, AVG(price_usd_mwh) AS price
      FROM market_price_signals
      WHERE ts >= $1 AND ts <= $2
      GROUP BY bucket, market
    ),
    combined AS (
      SELECT
        hs.bucket, hs.site_id, hs.name, hs.capacity_mw, hs.capacity_mwh,
        hs.soc, hs.power_mw, hs.discharge_mw,
        hp.market, hp.price,
        -- Was price above $60/MWh? (high-value window)
        CASE WHEN hp.price > 60 THEN true ELSE false END AS high_price_window,
        -- Was site discharging significantly?
        CASE WHEN hs.discharge_mw > hs.capacity_mw * 0.3 THEN true ELSE false END AS was_dispatched,
        -- Could it have discharged? (SoC > 20%)
        CASE WHEN hs.soc > 20 THEN true ELSE false END AS could_dispatch,
        -- Missed revenue = (available_capacity × price) when price was high but not dispatching
        CASE
          WHEN hp.price > 60 AND hs.discharge_mw < hs.capacity_mw * 0.3 AND hs.soc > 20
          THEN ROUND(((hs.capacity_mw * 0.8 - GREATEST(hs.discharge_mw, 0)) * hp.price)::numeric, 0)
          ELSE 0
        END AS missed_revenue_usd
      FROM hourly_state hs
      LEFT JOIN hourly_prices hp ON hp.bucket = hs.bucket
        AND hp.market = CASE
          WHEN hs.timezone = 'America/Los_Angeles' THEN 'CAISO'
          WHEN hs.timezone = 'America/Chicago' THEN 'ERCOT'
          ELSE 'PJM'
        END
    )
    SELECT
      name, site_id,
      COUNT(*) FILTER (WHERE high_price_window) AS high_price_hours,
      COUNT(*) FILTER (WHERE high_price_window AND was_dispatched) AS dispatched_high_price_hours,
      COUNT(*) FILTER (WHERE high_price_window AND NOT was_dispatched AND could_dispatch) AS missed_hours,
      COALESCE(SUM(missed_revenue_usd), 0) AS total_missed_revenue_usd,
      ROUND(AVG(CASE WHEN high_price_window THEN price END)::numeric, 2) AS avg_high_price
    FROM combined
    GROUP BY name, site_id
    ORDER BY total_missed_revenue_usd DESC
  `, [fromDate, toDate]);
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

export async function getDispatchMarketCorrelation(siteId?: string, from?: string, to?: string) {
  const now = new Date();
  const fromDate = from || new Date(now.getTime() - 48 * 3600_000).toISOString();
  const toDate = to || now.toISOString();

  const conditions: string[] = ['t.bucket >= $1', 't.bucket <= $2'];
  const params: unknown[] = [fromDate, toDate];
  if (siteId) { params.push(siteId); conditions.push(`t.site_id = $${params.length}`); }

  const res = await query(`
    SELECT
      t.bucket AS time,
      t.site_id,
      s.name,
      ROUND(t.avg_site_power_mw::numeric, 1) AS power_mw,
      ROUND(t.avg_soc_pct::numeric, 1) AS soc_pct,
      ROUND(t.avg_discharge_power_mw::numeric, 1) AS discharge_mw,
      ROUND(hp.price::numeric, 2) AS price_usd_mwh,
      hp.market,
      d.command_type AS dispatch_type,
      d.target_power_mw AS dispatch_target_mw
    FROM telemetry_15min t
    JOIN sites s ON s.site_id = t.site_id
    LEFT JOIN LATERAL (
      SELECT AVG(price_usd_mwh) AS price, market
      FROM market_price_signals
      WHERE ts >= t.bucket AND ts < t.bucket + INTERVAL '15 minutes'
        AND market = CASE
          WHEN s.timezone = 'America/Los_Angeles' THEN 'CAISO'
          WHEN s.timezone = 'America/Chicago' THEN 'ERCOT'
          ELSE 'PJM'
        END
      GROUP BY market
    ) hp ON TRUE
    LEFT JOIN LATERAL (
      SELECT command_type, target_power_mw
      FROM dispatch_commands
      WHERE site_id = t.site_id AND ts >= t.bucket AND ts < t.bucket + INTERVAL '15 minutes'
      ORDER BY ts DESC LIMIT 1
    ) d ON TRUE
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.bucket DESC
    LIMIT 500
  `, params);
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

export async function getAssetHealthTimeline(siteId: string) {
  const res = await query(`
    WITH recent_alarms AS (
      SELECT ts, site_id, asset_id, alarm_code, severity, message, resolved_at,
             'alarm' AS event_type
      FROM alarms_events
      WHERE site_id = $1 AND ts > NOW() - INTERVAL '7 days'
      ORDER BY ts DESC LIMIT 50
    ),
    recent_maintenance AS (
      SELECT ts, site_id, asset_id, log_type AS alarm_code, 'maintenance' AS severity,
             description AS message, NULL::timestamptz AS resolved_at,
             'maintenance' AS event_type
      FROM maintenance_logs
      WHERE site_id = $1 AND ts > NOW() - INTERVAL '30 days'
      ORDER BY ts DESC LIMIT 30
    ),
    combined AS (
      SELECT * FROM recent_alarms
      UNION ALL
      SELECT * FROM recent_maintenance
    )
    SELECT c.*, ba.name AS asset_name, s.name AS site_name
    FROM combined c
    LEFT JOIN battery_assets ba ON ba.asset_id = c.asset_id
    JOIN sites s ON s.site_id = c.site_id
    ORDER BY c.ts DESC
  `, [siteId]);
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

export async function getExecutiveSummary() {
  // Split into fast parallel queries instead of one heavy query
  const [fleetRes, priceRes, dispatchRes, alarmRes] = await Promise.all([
    query(`
      WITH latest AS (
        SELECT DISTINCT ON (site_id) site_id, avg_soc_pct AS soc, avg_soh_pct AS soh,
               avg_site_power_mw AS power, avg_rte AS rte
        FROM telemetry_1min WHERE bucket > NOW() - INTERVAL '10 minutes'
        ORDER BY site_id, bucket DESC
      )
      SELECT
        (SELECT COUNT(*) FROM sites) AS site_count,
        (SELECT SUM(capacity_mw) FROM sites) AS total_capacity_mw,
        (SELECT SUM(capacity_mwh) FROM sites) AS total_capacity_mwh,
        ROUND(AVG(soc)::numeric, 1) AS fleet_avg_soc,
        ROUND(AVG(soh)::numeric, 1) AS fleet_avg_soh,
        ROUND(AVG(rte)::numeric, 1) AS fleet_avg_rte,
        ROUND(SUM(power)::numeric, 1) AS fleet_current_power_mw
      FROM latest
    `),
    query(`
      SELECT ROUND(AVG(price_usd_mwh)::numeric, 2) AS avg_market_price
      FROM market_price_signals WHERE ts > NOW() - INTERVAL '15 minutes'
    `),
    query(`
      SELECT COUNT(*) AS dispatch_count,
             COALESCE(SUM(target_power_mw * duration_min / 60.0), 0) AS energy_mwh
      FROM dispatch_commands WHERE ts > NOW() - INTERVAL '7 days' AND status = 'completed'
    `),
    query(`
      SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL) AS active_alarms,
             COUNT(*) AS week_total_alarms,
             COUNT(*) FILTER (WHERE severity IN ('critical','emergency')) AS week_critical_alarms
      FROM alarms_events WHERE ts > NOW() - INTERVAL '7 days'
    `),
  ]);

  const f = fleetRes.rows[0] || {};
  const p = priceRes.rows[0] || {};
  const d = dispatchRes.rows[0] || {};
  const a = alarmRes.rows[0] || {};
  const avgPrice = parseFloat(p.avg_market_price) || 0;
  const availableMw = Math.max(0, parseFloat(f.total_capacity_mw || 0) - Math.max(parseFloat(f.fleet_current_power_mw || 0), 0));

  return {
    data: {
      ...f,
      avg_market_price: p.avg_market_price || 0,
      fleet_revenue_potential_per_hour: Math.round(availableMw * avgPrice),
      week_dispatches: d.dispatch_count || 0,
      week_energy_mwh: Math.round(parseFloat(d.energy_mwh) || 0),
      week_estimated_revenue: Math.round((parseFloat(d.energy_mwh) || 0) * avgPrice),
      active_alarms: a.active_alarms || 0,
      week_total_alarms: a.week_total_alarms || 0,
      week_critical_alarms: a.week_critical_alarms || 0,
    },
    queryMs: fleetRes.duration + priceRes.duration + dispatchRes.duration + alarmRes.duration,
  };
}

// Q2B — Asset Health Degradation (30-day trend with weekly comparison)
export async function getAssetHealthDegradation(): Promise<{ data: AssetHealthRow[]; queryMs: number }> {
  const res = await query(`
    WITH weekly_soh AS (
      SELECT
        site_id,
        CASE
          WHEN bucket >= NOW() - INTERVAL '7 days' THEN 'this_week'
          WHEN bucket >= NOW() - INTERVAL '14 days' THEN 'last_week'
          WHEN bucket >= NOW() - INTERVAL '30 days' THEN 'month_ago'
        END AS period,
        AVG(avg_soh_pct) AS avg_soh
      FROM telemetry_1hour
      WHERE bucket >= NOW() - INTERVAL '30 days'
      GROUP BY site_id, period
    ),
    pivoted AS (
      SELECT
        site_id,
        MAX(CASE WHEN period = 'this_week' THEN avg_soh END) AS soh_now,
        MAX(CASE WHEN period = 'last_week' THEN avg_soh END) AS soh_last_week,
        MAX(CASE WHEN period = 'month_ago' THEN avg_soh END) AS soh_month_ago
      FROM weekly_soh
      WHERE period IS NOT NULL
      GROUP BY site_id
    )
    SELECT
      s.name AS site_name,
      ROUND(p.soh_now::numeric, 2) AS soh_current_pct,
      ROUND(p.soh_last_week::numeric, 2) AS soh_last_week_pct,
      ROUND(p.soh_month_ago::numeric, 2) AS soh_month_ago_pct,
      ROUND((p.soh_now - p.soh_month_ago)::numeric, 3) AS degradation_30d_pct,
      ROUND(((p.soh_now - p.soh_month_ago) * 12)::numeric, 2) AS projected_annual_degradation_pct,
      CASE
        WHEN (p.soh_now - p.soh_month_ago) * 12 < -2.0 THEN 'CRITICAL'
        WHEN (p.soh_now - p.soh_month_ago) * 12 < -1.0 THEN 'WATCH'
        ELSE 'NORMAL'
      END AS health_status
    FROM pivoted p
    JOIN sites s ON s.site_id = p.site_id
    ORDER BY degradation_30d_pct ASC
  `);
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

// Q3B — Fleet Utilization Ranking (24h)
export async function getFleetUtilization(): Promise<{ data: FleetUtilizationRow[]; queryMs: number }> {
  const res = await query(`
    SELECT
      s.name AS site_name,
      s.capacity_mw,
      ROUND(AVG(t.avg_site_power_mw)::numeric, 1) AS avg_power_mw,
      ROUND((AVG(t.avg_site_power_mw) / NULLIF(s.capacity_mw, 0) * 100)::numeric, 1) AS utilization_pct,
      ROUND(AVG(t.avg_soc_pct)::numeric, 1) AS avg_soc_pct,
      ROUND(AVG(t.avg_soh_pct)::numeric, 1) AS avg_soh_pct,
      ROUND(AVG(t.avg_rte)::numeric, 1) AS avg_rte_pct,
      COUNT(*) AS datapoints
    FROM telemetry_15min t
    JOIN sites s ON s.site_id = t.site_id
    WHERE t.bucket >= NOW() - INTERVAL '24 hours'
    GROUP BY s.name, s.capacity_mw
    ORDER BY utilization_pct DESC
  `);
  return { data: serializeRows(res.rows), queryMs: res.duration };
}

// SoH Degradation Trend — per-site, variable time range
export async function getSohTrend(siteId: string, days: number): Promise<{ data: { day: string; avg_soh: number }[]; queryMs: number }> {
  // Use daily buckets from the 1-hour CAGG
  const res = await query(`
    SELECT date_trunc('day', bucket) AS day,
      ROUND(AVG(avg_soh_pct)::numeric, 3) AS avg_soh
    FROM telemetry_1hour
    WHERE site_id = $1 AND bucket >= NOW() - make_interval(days => $2)
    GROUP BY 1 ORDER BY 1
  `, [siteId, days]);
  return { data: serializeRows(res.rows), queryMs: res.duration };
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
  return { data: serializeRows(res.rows), queryMs: res.duration };
}
