-- ============================================================
-- BESS Demo: Compression & Retention Policies
-- ============================================================

-- Compression on telemetry_raw
ALTER TABLE telemetry_raw SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id',
    timescaledb.compress_orderby = 'ts DESC'
);
SELECT add_compression_policy('telemetry_raw', INTERVAL '2 days');

-- Compression on alarms_events
ALTER TABLE alarms_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id',
    timescaledb.compress_orderby = 'ts DESC'
);
SELECT add_compression_policy('alarms_events', INTERVAL '7 days');

-- Compression on dispatch_commands
ALTER TABLE dispatch_commands SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id',
    timescaledb.compress_orderby = 'ts DESC'
);
SELECT add_compression_policy('dispatch_commands', INTERVAL '7 days');

-- Compression on market_price_signals
ALTER TABLE market_price_signals SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'market',
    timescaledb.compress_orderby = 'ts DESC'
);
SELECT add_compression_policy('market_price_signals', INTERVAL '3 days');

-- Compression on maintenance_logs
ALTER TABLE maintenance_logs SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id',
    timescaledb.compress_orderby = 'ts DESC'
);
SELECT add_compression_policy('maintenance_logs', INTERVAL '30 days');

-- Retention policies
SELECT add_retention_policy('telemetry_raw', INTERVAL '90 days');
SELECT add_retention_policy('alarms_events', INTERVAL '365 days');
SELECT add_retention_policy('market_price_signals', INTERVAL '365 days');
