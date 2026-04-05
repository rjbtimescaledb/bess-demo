-- ============================================================
-- BESS Demo: Continuous Aggregates
-- ============================================================

-- 1-minute rollup
CREATE MATERIALIZED VIEW telemetry_1min
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket('1 minute', ts) AS bucket,
    site_id,
    AVG(site_power_mw)         AS avg_site_power_mw,
    MIN(site_power_mw)         AS min_site_power_mw,
    MAX(site_power_mw)         AS max_site_power_mw,
    AVG(charge_power_mw)       AS avg_charge_power_mw,
    AVG(discharge_power_mw)    AS avg_discharge_power_mw,
    AVG(state_of_charge_pct)   AS avg_soc_pct,
    MIN(state_of_charge_pct)   AS min_soc_pct,
    MAX(state_of_charge_pct)   AS max_soc_pct,
    AVG(state_of_health_pct)   AS avg_soh_pct,
    AVG(round_trip_efficiency)  AS avg_rte,
    AVG(inverter_temp_c)       AS avg_inverter_temp_c,
    MAX(inverter_temp_c)       AS max_inverter_temp_c,
    AVG(rack_temp_c)           AS avg_rack_temp_c,
    MAX(rack_temp_c)           AS max_rack_temp_c,
    AVG(cell_voltage_avg)      AS avg_cell_voltage,
    MIN(cell_voltage_min)      AS min_cell_voltage,
    MAX(cell_voltage_max)      AS max_cell_voltage,
    AVG(ambient_temp_c)        AS avg_ambient_temp_c,
    AVG(grid_frequency_hz)     AS avg_grid_frequency_hz,
    COUNT(*)                   AS sample_count
FROM telemetry_raw
GROUP BY bucket, site_id;

SELECT add_continuous_aggregate_policy('telemetry_1min',
    start_offset  => INTERVAL '5 minutes',
    end_offset    => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

-- 15-minute rollup
CREATE MATERIALIZED VIEW telemetry_15min
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket('15 minutes', ts) AS bucket,
    site_id,
    AVG(site_power_mw)         AS avg_site_power_mw,
    MIN(site_power_mw)         AS min_site_power_mw,
    MAX(site_power_mw)         AS max_site_power_mw,
    AVG(charge_power_mw)       AS avg_charge_power_mw,
    AVG(discharge_power_mw)    AS avg_discharge_power_mw,
    AVG(state_of_charge_pct)   AS avg_soc_pct,
    MIN(state_of_charge_pct)   AS min_soc_pct,
    MAX(state_of_charge_pct)   AS max_soc_pct,
    AVG(state_of_health_pct)   AS avg_soh_pct,
    AVG(round_trip_efficiency)  AS avg_rte,
    AVG(inverter_temp_c)       AS avg_inverter_temp_c,
    MAX(inverter_temp_c)       AS max_inverter_temp_c,
    AVG(rack_temp_c)           AS avg_rack_temp_c,
    MAX(rack_temp_c)           AS max_rack_temp_c,
    AVG(cell_voltage_avg)      AS avg_cell_voltage,
    MIN(cell_voltage_min)      AS min_cell_voltage,
    MAX(cell_voltage_max)      AS max_cell_voltage,
    AVG(ambient_temp_c)        AS avg_ambient_temp_c,
    AVG(grid_frequency_hz)     AS avg_grid_frequency_hz,
    COUNT(*)                   AS sample_count
FROM telemetry_raw
GROUP BY bucket, site_id;

SELECT add_continuous_aggregate_policy('telemetry_15min',
    start_offset  => INTERVAL '1 hour',
    end_offset    => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes');

-- 1-hour rollup
CREATE MATERIALIZED VIEW telemetry_1hour
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    site_id,
    AVG(site_power_mw)         AS avg_site_power_mw,
    MIN(site_power_mw)         AS min_site_power_mw,
    MAX(site_power_mw)         AS max_site_power_mw,
    AVG(charge_power_mw)       AS avg_charge_power_mw,
    AVG(discharge_power_mw)    AS avg_discharge_power_mw,
    AVG(state_of_charge_pct)   AS avg_soc_pct,
    MIN(state_of_charge_pct)   AS min_soc_pct,
    MAX(state_of_charge_pct)   AS max_soc_pct,
    AVG(state_of_health_pct)   AS avg_soh_pct,
    AVG(round_trip_efficiency)  AS avg_rte,
    AVG(inverter_temp_c)       AS avg_inverter_temp_c,
    MAX(inverter_temp_c)       AS max_inverter_temp_c,
    AVG(rack_temp_c)           AS avg_rack_temp_c,
    MAX(rack_temp_c)           AS max_rack_temp_c,
    AVG(cell_voltage_avg)      AS avg_cell_voltage,
    MIN(cell_voltage_min)      AS min_cell_voltage,
    MAX(cell_voltage_max)      AS max_cell_voltage,
    AVG(ambient_temp_c)        AS avg_ambient_temp_c,
    AVG(grid_frequency_hz)     AS avg_grid_frequency_hz,
    COUNT(*)                   AS sample_count
FROM telemetry_raw
GROUP BY bucket, site_id;

SELECT add_continuous_aggregate_policy('telemetry_1hour',
    start_offset  => INTERVAL '4 hours',
    end_offset    => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');

-- Hourly alarm counts
CREATE MATERIALIZED VIEW alarms_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    site_id,
    severity,
    COUNT(*) AS alarm_count
FROM alarms_events
GROUP BY bucket, site_id, severity;

SELECT add_continuous_aggregate_policy('alarms_hourly',
    start_offset  => INTERVAL '4 hours',
    end_offset    => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');
