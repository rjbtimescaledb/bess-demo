-- ============================================================
-- BESS Demo: Core Schema for Tiger Cloud
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================
-- 1. Reference / Dimensional Tables
-- ============================================================

CREATE TABLE organizations (
    org_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    region          TEXT NOT NULL DEFAULT 'US-WEST',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sites (
    site_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(org_id),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    capacity_mw     DOUBLE PRECISION NOT NULL,
    capacity_mwh    DOUBLE PRECISION NOT NULL,
    commissioned    DATE,
    status          TEXT NOT NULL DEFAULT 'operational',
    timezone        TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE battery_assets (
    asset_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         UUID NOT NULL REFERENCES sites(site_id),
    name            TEXT NOT NULL,
    manufacturer    TEXT,
    model           TEXT,
    serial_number   TEXT,
    capacity_mwh    DOUBLE PRECISION NOT NULL,
    max_power_mw    DOUBLE PRECISION NOT NULL,
    chemistry       TEXT NOT NULL DEFAULT 'LFP',
    install_date    DATE,
    status          TEXT NOT NULL DEFAULT 'online',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pcs_inverters (
    inverter_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES battery_assets(asset_id),
    site_id         UUID NOT NULL REFERENCES sites(site_id),
    name            TEXT NOT NULL,
    manufacturer    TEXT,
    rated_power_mw  DOUBLE PRECISION NOT NULL,
    status          TEXT NOT NULL DEFAULT 'online',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE battery_racks (
    rack_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES battery_assets(asset_id),
    name            TEXT NOT NULL,
    module_count    INTEGER NOT NULL DEFAULT 16,
    cell_count      INTEGER NOT NULL DEFAULT 256,
    status          TEXT NOT NULL DEFAULT 'online',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Time-Series Tables (Hypertables)
-- ============================================================

CREATE TABLE telemetry_raw (
    ts                      TIMESTAMPTZ NOT NULL,
    site_id                 UUID NOT NULL,
    asset_id                UUID,
    site_power_mw           DOUBLE PRECISION,
    charge_power_mw         DOUBLE PRECISION,
    discharge_power_mw      DOUBLE PRECISION,
    state_of_charge_pct     DOUBLE PRECISION,
    state_of_health_pct     DOUBLE PRECISION,
    round_trip_efficiency   DOUBLE PRECISION,
    inverter_temp_c         DOUBLE PRECISION,
    rack_temp_c             DOUBLE PRECISION,
    cell_voltage_avg        DOUBLE PRECISION,
    cell_voltage_min        DOUBLE PRECISION,
    cell_voltage_max        DOUBLE PRECISION,
    ambient_temp_c          DOUBLE PRECISION,
    humidity_pct            DOUBLE PRECISION,
    grid_frequency_hz       DOUBLE PRECISION,
    grid_voltage_kv         DOUBLE PRECISION,
    availability_status     TEXT DEFAULT 'available'
);

SELECT create_hypertable('telemetry_raw', by_range('ts', INTERVAL '1 day'));

CREATE TABLE alarms_events (
    ts              TIMESTAMPTZ NOT NULL,
    site_id         UUID NOT NULL,
    asset_id        UUID,
    alarm_code      TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical','emergency')),
    message         TEXT,
    acknowledged    BOOLEAN DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ
);

SELECT create_hypertable('alarms_events', by_range('ts', INTERVAL '7 days'));

CREATE TABLE dispatch_commands (
    ts              TIMESTAMPTZ NOT NULL,
    site_id         UUID NOT NULL,
    command_type    TEXT NOT NULL,
    target_power_mw DOUBLE PRECISION,
    duration_min    INTEGER,
    source          TEXT NOT NULL DEFAULT 'scheduler',
    status          TEXT NOT NULL DEFAULT 'pending',
    executed_at     TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

SELECT create_hypertable('dispatch_commands', by_range('ts', INTERVAL '7 days'));

CREATE TABLE market_price_signals (
    ts              TIMESTAMPTZ NOT NULL,
    market          TEXT NOT NULL,
    region          TEXT NOT NULL,
    price_usd_mwh  DOUBLE PRECISION NOT NULL,
    signal_type     TEXT NOT NULL DEFAULT 'lmp'
);

SELECT create_hypertable('market_price_signals', by_range('ts', INTERVAL '1 day'));

CREATE TABLE maintenance_logs (
    ts              TIMESTAMPTZ NOT NULL,
    site_id         UUID NOT NULL,
    asset_id        UUID,
    log_type        TEXT NOT NULL,
    description     TEXT,
    technician      TEXT,
    duration_hours  DOUBLE PRECISION,
    parts_replaced  TEXT[]
);

SELECT create_hypertable('maintenance_logs', by_range('ts', INTERVAL '30 days'));

-- ============================================================
-- 3. Indexes for Operational Queries
-- ============================================================

CREATE INDEX idx_telemetry_site_ts ON telemetry_raw (site_id, ts DESC);
CREATE INDEX idx_telemetry_asset_ts ON telemetry_raw (asset_id, ts DESC) WHERE asset_id IS NOT NULL;
CREATE INDEX idx_alarms_site_ts ON alarms_events (site_id, ts DESC);
CREATE INDEX idx_alarms_severity ON alarms_events (severity, ts DESC);
CREATE INDEX idx_alarms_unresolved ON alarms_events (site_id, ts DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_dispatch_site_ts ON dispatch_commands (site_id, ts DESC);
CREATE INDEX idx_market_ts ON market_price_signals (market, ts DESC);
