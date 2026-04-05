export interface Organization {
  org_id: string;
  name: string;
  slug: string;
  region: string;
}

export interface Site {
  site_id: string;
  org_id: string;
  org_name?: string;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  capacity_mw: number;
  capacity_mwh: number;
  commissioned: string;
  status: string;
  timezone: string;
}

export interface BatteryAsset {
  asset_id: string;
  site_id: string;
  name: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  capacity_mwh: number;
  max_power_mw: number;
  chemistry: string;
  install_date: string;
  status: string;
  inverter_count?: number;
  rack_count?: number;
}

export interface PCSInverter {
  inverter_id: string;
  asset_id: string;
  site_id: string;
  name: string;
  manufacturer: string;
  rated_power_mw: number;
  status: string;
}

export interface BatteryRack {
  rack_id: string;
  asset_id: string;
  name: string;
  module_count: number;
  cell_count: number;
  status: string;
}

export interface TelemetryPoint {
  ts: string;
  site_id: string;
  asset_id?: string;
  site_power_mw: number;
  charge_power_mw: number;
  discharge_power_mw: number;
  state_of_charge_pct: number;
  state_of_health_pct: number;
  round_trip_efficiency: number;
  inverter_temp_c: number;
  rack_temp_c: number;
  cell_voltage_avg: number;
  cell_voltage_min: number;
  cell_voltage_max: number;
  ambient_temp_c: number;
  humidity_pct: number;
  grid_frequency_hz: number;
  grid_voltage_kv: number;
  availability_status: string;
}

export interface TelemetryAggregated {
  bucket: string;
  site_id: string;
  avg_site_power_mw: number;
  min_site_power_mw: number;
  max_site_power_mw: number;
  avg_charge_power_mw: number;
  avg_discharge_power_mw: number;
  avg_soc_pct: number;
  min_soc_pct: number;
  max_soc_pct: number;
  avg_soh_pct: number;
  avg_rte: number;
  avg_inverter_temp_c: number;
  max_inverter_temp_c: number;
  avg_rack_temp_c: number;
  max_rack_temp_c: number;
  avg_cell_voltage: number;
  avg_ambient_temp_c: number;
  avg_grid_frequency_hz: number;
  sample_count: number;
}

export interface Alarm {
  ts: string;
  site_id: string;
  site_name?: string;
  asset_id?: string;
  alarm_code: string;
  severity: string;
  message: string;
  acknowledged: boolean;
  resolved_at: string | null;
}

export interface DispatchCommand {
  ts: string;
  site_id: string;
  site_name?: string;
  command_type: string;
  target_power_mw: number;
  duration_min: number;
  source: string;
  status: string;
  executed_at: string | null;
  completed_at: string | null;
}

export interface MarketPrice {
  ts: string;
  market: string;
  region: string;
  price_usd_mwh: number;
}

export interface MaintenanceLog {
  ts: string;
  site_id: string;
  site_name?: string;
  asset_id?: string;
  log_type: string;
  description: string;
  technician: string;
  duration_hours: number;
  parts_replaced: string[];
}

export interface SiteOverview extends Site {
  latest_power_mw: number | null;
  latest_soc_pct: number | null;
  latest_soh_pct: number | null;
  latest_rte: number | null;
  latest_temp_c: number | null;
  active_alarms: number;
}

export interface FleetKPIs {
  total_capacity_mw: number;
  total_capacity_mwh: number;
  total_current_power_mw: number;
  avg_soc_pct: number;
  avg_soh_pct: number;
  avg_rte: number;
  active_alarm_count: number;
  site_count: number;
}

export interface PlatformStats {
  telemetry_row_count: number;
  compression_ratio: number;
  before_compression_bytes: number;
  after_compression_bytes: number;
  chunk_count: number;
  compressed_chunk_count: number;
  continuous_aggregates: number;
  hypertable_count: number;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
  meta?: {
    queryMs: number;
  };
}
