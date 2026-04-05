-- ============================================================
-- BESS Demo: Grafana Dashboard Queries
-- ============================================================
-- Add Tiger Cloud as a PostgreSQL data source in Grafana,
-- then use these queries in dashboard panels.

-- ============================================================
-- 1. Compression Savings
-- ============================================================
-- Shows before/after sizes and compression ratio per hypertable
SELECT
    hypertable_name,
    pg_size_pretty(before_compression_total_bytes) AS before_size,
    pg_size_pretty(after_compression_total_bytes)  AS after_size,
    ROUND(
        (1 - after_compression_total_bytes::NUMERIC / NULLIF(before_compression_total_bytes, 0)) * 100, 1
    ) AS savings_pct,
    ROUND(
        before_compression_total_bytes::NUMERIC / NULLIF(after_compression_total_bytes, 1), 1
    ) AS compression_ratio
FROM hypertable_compression_stats('telemetry_raw')
UNION ALL
SELECT * FROM (
    SELECT
        hypertable_name,
        pg_size_pretty(before_compression_total_bytes),
        pg_size_pretty(after_compression_total_bytes),
        ROUND((1 - after_compression_total_bytes::NUMERIC / NULLIF(before_compression_total_bytes, 0)) * 100, 1),
        ROUND(before_compression_total_bytes::NUMERIC / NULLIF(after_compression_total_bytes, 1), 1)
    FROM hypertable_compression_stats('alarms_events')
) a
ORDER BY hypertable_name;

-- ============================================================
-- 2. Ingest Throughput (rows per minute)
-- ============================================================
-- Use with Grafana time range variables $__timeFrom() and $__timeTo()
SELECT
    time_bucket('1 minute', ts) AS time,
    COUNT(*) AS rows_per_minute
FROM telemetry_raw
WHERE ts BETWEEN $__timeFrom() AND $__timeTo()
GROUP BY time
ORDER BY time;

-- ============================================================
-- 3. Raw vs Compressed Footprint (chunk-level)
-- ============================================================
SELECT
    chunk_name,
    is_compressed,
    pg_size_pretty(
        COALESCE(before_compression_total_bytes, total_bytes)
    ) AS uncompressed_size,
    pg_size_pretty(
        CASE WHEN is_compressed THEN after_compression_total_bytes ELSE total_bytes END
    ) AS current_size,
    range_start,
    range_end
FROM timescaledb_information.chunks c
LEFT JOIN LATERAL (
    SELECT * FROM hypertable_compression_stats('telemetry_raw')
) cs ON TRUE
WHERE c.hypertable_name = 'telemetry_raw'
ORDER BY range_start DESC
LIMIT 30;

-- ============================================================
-- 4. Continuous Aggregate Freshness
-- ============================================================
SELECT
    view_name,
    materialization_hypertable_name,
    (SELECT MAX(bucket) FROM telemetry_1min) AS last_1min_bucket,
    (SELECT MAX(bucket) FROM telemetry_15min) AS last_15min_bucket,
    (SELECT MAX(bucket) FROM telemetry_1hour) AS last_1hour_bucket,
    (SELECT MAX(bucket) FROM alarms_hourly) AS last_alarms_bucket
FROM timescaledb_information.continuous_aggregates
LIMIT 4;

-- ============================================================
-- 5. Active Alarms by Site
-- ============================================================
SELECT
    s.name AS site_name,
    a.severity,
    COUNT(*) AS alarm_count
FROM alarms_events a
JOIN sites s ON s.site_id = a.site_id
WHERE a.resolved_at IS NULL
GROUP BY s.name, a.severity
ORDER BY
    CASE a.severity
        WHEN 'emergency' THEN 1
        WHEN 'critical' THEN 2
        WHEN 'warning' THEN 3
        WHEN 'info' THEN 4
    END;

-- ============================================================
-- 6. Telemetry Volume Over Time
-- ============================================================
SELECT
    time_bucket('1 hour', ts) AS time,
    COUNT(*) AS row_count
FROM telemetry_raw
WHERE ts BETWEEN $__timeFrom() AND $__timeTo()
GROUP BY time
ORDER BY time;

-- ============================================================
-- 7. Site Power Overview (current)
-- ============================================================
SELECT DISTINCT ON (t.site_id)
    s.name AS site_name,
    t.site_power_mw,
    t.state_of_charge_pct,
    t.state_of_health_pct,
    t.availability_status,
    t.ts
FROM telemetry_raw t
JOIN sites s ON s.site_id = t.site_id
ORDER BY t.site_id, t.ts DESC;

-- ============================================================
-- 8. State of Charge History
-- ============================================================
SELECT
    bucket AS time,
    s.name AS site_name,
    avg_soc_pct
FROM telemetry_15min t
JOIN sites s ON s.site_id = t.site_id
WHERE bucket BETWEEN $__timeFrom() AND $__timeTo()
ORDER BY bucket, s.name;
