import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

export interface SiteRow {
  site_id: string;
  name: string;
  capacity_mw: number;
  capacity_mwh: number;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface AssetRow {
  asset_id: string;
  site_id: string;
  name: string;
  capacity_mwh: number;
  max_power_mw: number;
}

export async function getSites(): Promise<SiteRow[]> {
  const res = await query('SELECT site_id, name, capacity_mw, capacity_mwh, latitude, longitude, timezone FROM sites ORDER BY name');
  return res.rows;
}

export async function getAssets(): Promise<AssetRow[]> {
  const res = await query('SELECT asset_id, site_id, name, capacity_mwh, max_power_mw FROM battery_assets ORDER BY site_id, name');
  return res.rows;
}

export async function batchInsertTelemetry(rows: unknown[][]) {
  if (rows.length === 0) return;
  const cols = 17;
  const placeholders = rows.map((_, i) => {
    const offset = i * cols;
    return `(${Array.from({ length: cols }, (_, j) => `$${offset + j + 1}`).join(',')})`;
  }).join(',');

  const sql = `INSERT INTO telemetry_raw (
    ts, site_id, asset_id, site_power_mw, charge_power_mw, discharge_power_mw,
    state_of_charge_pct, state_of_health_pct, round_trip_efficiency,
    inverter_temp_c, rack_temp_c, cell_voltage_avg, cell_voltage_min, cell_voltage_max,
    ambient_temp_c, grid_frequency_hz, grid_voltage_kv
  ) VALUES ${placeholders}`;

  await query(sql, rows.flat());
}

export async function batchInsertAlarms(rows: unknown[][]) {
  if (rows.length === 0) return;
  const cols = 7;
  const placeholders = rows.map((_, i) => {
    const offset = i * cols;
    return `(${Array.from({ length: cols }, (_, j) => `$${offset + j + 1}`).join(',')})`;
  }).join(',');

  const sql = `INSERT INTO alarms_events (ts, site_id, asset_id, alarm_code, severity, message, resolved_at)
    VALUES ${placeholders}`;

  await query(sql, rows.flat());
}

export async function insertDispatch(row: unknown[]) {
  await query(
    `INSERT INTO dispatch_commands (ts, site_id, command_type, target_power_mw, duration_min, source, status, executed_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    row
  );
}

export async function insertMarketPrices(rows: unknown[][]) {
  if (rows.length === 0) return;
  const cols = 4;
  const placeholders = rows.map((_, i) => {
    const offset = i * cols;
    return `(${Array.from({ length: cols }, (_, j) => `$${offset + j + 1}`).join(',')})`;
  }).join(',');

  const sql = `INSERT INTO market_price_signals (ts, market, region, price_usd_mwh)
    VALUES ${placeholders}`;
  await query(sql, rows.flat());
}

export async function batchInsertMaintenance(rows: unknown[][]) {
  if (rows.length === 0) return;
  const cols = 7;
  const placeholders = rows.map((_, i) => {
    const offset = i * cols;
    return `(${Array.from({ length: cols }, (_, j) => `$${offset + j + 1}`).join(',')})`;
  }).join(',');

  const sql = `INSERT INTO maintenance_logs (ts, site_id, asset_id, log_type, description, technician, duration_hours)
    VALUES ${placeholders}`;
  await query(sql, rows.flat());
}

export async function close() {
  await pool.end();
}
