-- ============================================================
-- BESS Demo: Schema for vanilla RDS Postgres (no Timescale)
-- Equivalent to 001_schema.sql but without hypertables
-- ============================================================

-- No timescaledb extension on RDS
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================
-- 1. Reference / Dimensional Tables (identical)
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
    org_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    region          TEXT NOT NULL DEFAULT 'US-WEST',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
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

CREATE TABLE IF NOT EXISTS battery_assets (
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

CREATE TABLE IF NOT EXISTS pcs_inverters (
    inverter_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES battery_assets(asset_id),
    site_id         UUID NOT NULL REFERENCES sites(site_id),
    name            TEXT NOT NULL,
    manufacturer    TEXT,
    rated_power_mw  DOUBLE PRECISION NOT NULL,
    status          TEXT NOT NULL DEFAULT 'online',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS battery_racks (
    rack_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        UUID NOT NULL REFERENCES battery_assets(asset_id),
    name            TEXT NOT NULL,
    module_count    INTEGER NOT NULL DEFAULT 16,
    cell_count      INTEGER NOT NULL DEFAULT 256,
    status          TEXT NOT NULL DEFAULT 'online',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Time-Series Tables (plain Postgres — NO hypertables)
-- ============================================================

CREATE TABLE IF NOT EXISTS telemetry_raw (
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

-- NOTE: On vanilla Postgres, you'd need pg_partman or manual partitioning
-- for this table to perform at scale. Without it, queries will degrade
-- as the table grows beyond a few hundred million rows.

CREATE TABLE IF NOT EXISTS alarms_events (
    ts              TIMESTAMPTZ NOT NULL,
    site_id         UUID NOT NULL,
    asset_id        UUID,
    alarm_code      TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical','emergency')),
    message         TEXT,
    acknowledged    BOOLEAN DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dispatch_commands (
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

CREATE TABLE IF NOT EXISTS market_price_signals (
    ts              TIMESTAMPTZ NOT NULL,
    market          TEXT NOT NULL,
    region          TEXT NOT NULL,
    price_usd_mwh  DOUBLE PRECISION NOT NULL,
    signal_type     TEXT NOT NULL DEFAULT 'lmp'
);

CREATE TABLE IF NOT EXISTS maintenance_logs (
    ts              TIMESTAMPTZ NOT NULL,
    site_id         UUID NOT NULL,
    asset_id        UUID,
    log_type        TEXT NOT NULL,
    description     TEXT,
    technician      TEXT,
    duration_hours  DOUBLE PRECISION,
    parts_replaced  TEXT[]
);

-- ============================================================
-- 3. Indexes (same as Tiger Cloud version)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_telemetry_site_ts ON telemetry_raw (site_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_asset_ts ON telemetry_raw (asset_id, ts DESC) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alarms_site_ts ON alarms_events (site_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alarms_severity ON alarms_events (severity, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alarms_unresolved ON alarms_events (site_id, ts DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_site_ts ON dispatch_commands (site_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_market_ts ON market_price_signals (market, ts DESC);

-- ============================================================
-- NOTE: What's missing vs Tiger Cloud
-- ============================================================
-- No hypertables (no automatic partitioning)
-- No continuous aggregates (would need materialized views + cron)
-- No columnstore compression (no equivalent in vanilla Postgres)
-- No retention policies (would need pg_cron + custom scripts)
-- No S3 tiering (would need custom ETL to move data)
-- No time_bucket() function (use date_trunc() instead)
