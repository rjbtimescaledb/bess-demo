
# BESS Core Query Pack v2 (10 Queries)

## Overview
Standardized BESS query pack demonstrating TimescaleDB's ability to handle the full spectrum of battery energy storage workloads — from sub-second operational monitoring to complex revenue analytics.

Each query maps:
**User** → **Question** → **Decision** → **Business Value** → **SQL**

### What changed from v1
- Q2B (Asset Health) now computes weekly degradation rate, not just current SoH
- Q3B (Fleet Rollup) now ranks sites by utilization efficiency over 24h
- Q4A (Dispatch Readiness) upgraded from bare query to scored readiness with alarm/load penalties
- Q4B (Revenue Opportunity) upgraded from bare join to full available capacity × market price calculation
- Added Q5A (Missed Revenue) — the highest-value BESS analytics query
- Added Q5B (Ingest + Query Proof) — proves concurrent read/write at scale

---

# Category 1 — Operational / Last-State

## Q1A — Latest Fleet State
**User:** BESS Operator
**Question:** What is happening across my fleet right now?
**Decision:** Do I need to intervene?
**Business Value:** Real-time visibility, faster incident response
**TimescaleDB Feature:** Continuous Aggregate (real-time), DISTINCT ON optimization

```sql
SELECT DISTINCT ON (s.site_id)
  s.site_id,
  s.name AS site_name,
  t.bucket AS latest_time,
  ROUND(t.avg_site_power_mw::numeric, 1) AS power_mw,
  ROUND(t.avg_soc_pct::numeric, 1) AS soc_pct,
  ROUND(t.avg_soh_pct::numeric, 1) AS soh_pct,
  ROUND(t.avg_inverter_temp_c::numeric, 1) AS inverter_temp_c,
  ROUND(t.avg_rack_temp_c::numeric, 1) AS rack_temp_c,
  s.capacity_mw,
  s.capacity_mwh
FROM public.sites s
JOIN public.telemetry_1min t ON t.site_id = s.site_id
WHERE t.bucket > NOW() - INTERVAL '10 minutes'
ORDER BY s.site_id, t.bucket DESC;
```

## Q1B — Active Alarms by Site
**User:** Reliability Engineer
**Question:** What is broken right now and where?
**Decision:** Which site needs immediate attention?
**Business Value:** Reduced MTTR, prioritized response
**TimescaleDB Feature:** Partial index on unresolved alarms

```sql
SELECT
  s.name AS site_name,
  a.severity,
  COUNT(*) AS alarm_count,
  MIN(a.ts) AS oldest_unresolved
FROM public.alarms_events a
JOIN public.sites s ON s.site_id = a.site_id
WHERE a.resolved_at IS NULL
GROUP BY s.name, a.severity
ORDER BY
  CASE a.severity
    WHEN 'emergency' THEN 1 WHEN 'critical' THEN 2
    WHEN 'warning' THEN 3 ELSE 4
  END,
  alarm_count DESC;
```

---

# Category 2 — Historical Analytics

## Q2A — Power Trend (per-site, 24h)
**User:** Operations Analyst
**Question:** How has this site's power output changed over the last 24 hours?
**Decision:** Is behavior normal or anomalous?
**Business Value:** Early anomaly detection, operational insight
**TimescaleDB Feature:** 15-min Continuous Aggregate (pre-computed, instant)

```sql
SELECT
  t.bucket AS time,
  s.name AS site_name,
  ROUND(t.avg_site_power_mw::numeric, 1) AS power_mw,
  ROUND(t.avg_soc_pct::numeric, 1) AS soc_pct,
  ROUND(t.avg_discharge_power_mw::numeric, 1) AS discharge_mw
FROM public.telemetry_15min t
JOIN public.sites s ON s.site_id = t.site_id
WHERE t.site_id = $1
  AND t.bucket >= NOW() - INTERVAL '24 hours'
ORDER BY t.bucket;
```

## Q2B — Asset Health Degradation (30-day trend)
**User:** Asset Manager
**Question:** Which sites are degrading fastest? Is maintenance needed?
**Decision:** Schedule preventive maintenance before failure
**Business Value:** Reduced replacement cost, extended asset life
**TimescaleDB Feature:** 1-hour Continuous Aggregate, time-windowed comparison

```sql
WITH weekly_soh AS (
  SELECT
    site_id,
    CASE
      WHEN bucket >= NOW() - INTERVAL '7 days' THEN 'this_week'
      WHEN bucket >= NOW() - INTERVAL '14 days' THEN 'last_week'
      WHEN bucket >= NOW() - INTERVAL '30 days' THEN 'month_ago'
    END AS period,
    AVG(avg_soh_pct) AS avg_soh
  FROM public.telemetry_1hour
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
JOIN public.sites s ON s.site_id = p.site_id
ORDER BY degradation_30d_pct ASC;
```

---

# Category 3 — Dashboard Queries

## Q3A — Multi-Resolution Telemetry
**User:** Dashboard End-User
**Question:** Can I zoom from 30-day overview to 1-minute detail seamlessly?
**Decision:** Which time resolution to serve based on requested range
**Business Value:** Fast UX regardless of time range (sub-200ms always)
**TimescaleDB Feature:** Hierarchical CAGGs (1min → 15min → 1hour)

```sql
-- The application selects the CAGG tier based on requested range:
--   <= 1 hour  → telemetry_raw (full resolution)
--   <= 26 hours → telemetry_1min
--   <= 72 hours → telemetry_15min
--   > 72 hours  → telemetry_1hour

-- Example: 7-day view using 15-min CAGG
SELECT
  bucket AS time,
  avg_site_power_mw AS power_mw,
  avg_soc_pct AS soc_pct,
  avg_discharge_power_mw AS discharge_mw,
  avg_inverter_temp_c AS temp_c
FROM public.telemetry_15min
WHERE site_id = $1
  AND bucket >= NOW() - INTERVAL '7 days'
ORDER BY bucket;
```

## Q3B — Fleet Utilization Ranking (24h)
**User:** Operations Lead
**Question:** Which sites are performing best? Where should I focus?
**Decision:** Allocate operations resources to underperforming sites
**Business Value:** Fleet-wide efficiency optimization
**TimescaleDB Feature:** 15-min CAGG, fleet-wide aggregation

```sql
SELECT
  s.name AS site_name,
  s.capacity_mw,
  ROUND(AVG(t.avg_site_power_mw)::numeric, 1) AS avg_power_mw,
  ROUND((AVG(t.avg_site_power_mw) / NULLIF(s.capacity_mw, 0) * 100)::numeric, 1) AS utilization_pct,
  ROUND(AVG(t.avg_soc_pct)::numeric, 1) AS avg_soc_pct,
  ROUND(AVG(t.avg_soh_pct)::numeric, 1) AS avg_soh_pct,
  ROUND(AVG(t.avg_rte)::numeric, 1) AS avg_rte_pct,
  COUNT(*) AS datapoints
FROM public.telemetry_15min t
JOIN public.sites s ON s.site_id = t.site_id
WHERE t.bucket >= NOW() - INTERVAL '24 hours'
GROUP BY s.name, s.capacity_mw
ORDER BY utilization_pct DESC;
```

---

# Category 4 — Decisioning

## Q4A — Dispatch Readiness (scored)
**User:** Energy Trader / Dispatch Operator
**Question:** Which sites can I dispatch right now? How confident am I?
**Decision:** Dispatch energy to the grid when prices are high
**Business Value:** Avoid dispatching degraded/alarmed sites, prevent grid penalties
**TimescaleDB Feature:** Real-time CAGG + cross-table join (telemetry + alarms + dispatch)

```sql
WITH latest_telemetry AS (
  SELECT DISTINCT ON (site_id)
    site_id,
    avg_soc_pct AS soc,
    avg_soh_pct AS soh,
    avg_site_power_mw AS current_power,
    bucket
  FROM public.telemetry_1min
  WHERE bucket > NOW() - INTERVAL '10 minutes'
  ORDER BY site_id, bucket DESC
),
active_critical AS (
  SELECT site_id, COUNT(*) AS critical_alarms
  FROM public.alarms_events
  WHERE resolved_at IS NULL AND severity IN ('critical', 'emergency')
  GROUP BY site_id
)
SELECT
  s.name AS site_name,
  s.capacity_mw,
  s.capacity_mwh,
  ROUND(lt.soc::numeric, 1) AS soc_pct,
  ROUND(lt.soh::numeric, 1) AS soh_pct,
  ROUND(lt.current_power::numeric, 1) AS current_power_mw,
  COALESCE(ac.critical_alarms, 0) AS critical_alarms,
  -- Discharge headroom (MWh available at 85% depth-of-discharge)
  ROUND((lt.soc / 100.0 * s.capacity_mwh * 0.85)::numeric, 1) AS available_energy_mwh,
  -- Readiness score: 0-100
  ROUND(GREATEST(0, LEAST(100,
    (lt.soc * 0.5)                                              -- SoC weight (0-50 pts)
    + (lt.soh - 90) * 5                                         -- SoH weight (0-50 pts at 100%)
    - COALESCE(ac.critical_alarms, 0) * 25                      -- Penalty per critical alarm
    - CASE WHEN lt.current_power > s.capacity_mw * 0.5
        THEN 20 ELSE 0 END                                      -- Penalty if already discharging
  ))::numeric, 0) AS readiness_score,
  CASE
    WHEN lt.soc >= 60 AND lt.soh >= 95 AND COALESCE(ac.critical_alarms, 0) = 0 THEN 'READY'
    WHEN lt.soc >= 40 AND lt.soh >= 90 THEN 'CAUTION'
    ELSE 'NOT_READY'
  END AS dispatch_status
FROM public.sites s
LEFT JOIN latest_telemetry lt ON lt.site_id = s.site_id
LEFT JOIN active_critical ac ON ac.site_id = s.site_id
ORDER BY readiness_score DESC;
```

## Q4B — Revenue Opportunity (real-time)
**User:** Energy Trader
**Question:** Where is the money right now? Which sites should dispatch?
**Decision:** Maximize revenue by dispatching high-SoC sites into high-price markets
**Business Value:** Direct revenue optimization ($000s per decision)
**TimescaleDB Feature:** Cross-table join (telemetry CAGG + market prices + site metadata)

```sql
WITH latest_telemetry AS (
  SELECT DISTINCT ON (site_id)
    site_id, avg_soc_pct AS soc, avg_site_power_mw AS current_power
  FROM public.telemetry_1min
  WHERE bucket > NOW() - INTERVAL '10 minutes'
  ORDER BY site_id, bucket DESC
),
latest_prices AS (
  SELECT DISTINCT ON (market)
    market, region, price_usd_mwh, ts
  FROM public.market_price_signals
  WHERE ts > NOW() - INTERVAL '30 minutes'
  ORDER BY market, ts DESC
)
SELECT
  s.name AS site_name,
  s.capacity_mw,
  lp.market,
  ROUND(lp.price_usd_mwh::numeric, 2) AS price_usd_mwh,
  ROUND(lt.soc::numeric, 1) AS soc_pct,
  -- Available discharge capacity (MW)
  ROUND(GREATEST(0, s.capacity_mw - GREATEST(lt.current_power, 0))::numeric, 1) AS available_mw,
  -- Available energy if discharged to 10% SoC (MWh)
  ROUND(GREATEST(0, (lt.soc - 10) / 100.0 * s.capacity_mwh)::numeric, 1) AS available_mwh,
  -- Revenue per hour at full available capacity ($/hr)
  ROUND((GREATEST(0, s.capacity_mw - GREATEST(lt.current_power, 0)) * lp.price_usd_mwh)::numeric, 0) AS revenue_per_hour_usd,
  -- Total revenue if fully discharged ($)
  ROUND((GREATEST(0, (lt.soc - 10) / 100.0 * s.capacity_mwh) * lp.price_usd_mwh)::numeric, 0) AS total_opportunity_usd
FROM public.sites s
LEFT JOIN latest_telemetry lt ON lt.site_id = s.site_id
CROSS JOIN latest_prices lp
WHERE lp.market = CASE
  WHEN s.timezone = 'America/Los_Angeles' THEN 'CAISO'
  WHEN s.timezone = 'America/Chicago' THEN 'ERCOT'
  WHEN s.timezone = 'America/Phoenix' THEN 'CAISO'
  ELSE 'PJM'
END
ORDER BY revenue_per_hour_usd DESC;
```

---

# Category 5 — Revenue Analytics & Platform Proof

## Q5A — Missed Revenue Analysis (7-day lookback)
**User:** Head of Trading / CFO
**Question:** How much money did we leave on the table this week?
**Decision:** Improve dispatch strategy, justify automation investment
**Business Value:** Quantifies opportunity cost — often the single most actionable BESS metric
**TimescaleDB Feature:** 1-hour CAGG + time_bucket + FILTER aggregation across telemetry + market data

```sql
WITH hourly_state AS (
  SELECT
    t.bucket,
    t.site_id,
    t.avg_soc_pct AS soc,
    t.avg_site_power_mw AS power_mw,
    t.avg_discharge_power_mw AS discharge_mw,
    s.capacity_mw,
    s.name,
    s.timezone
  FROM public.telemetry_1hour t
  JOIN public.sites s ON s.site_id = t.site_id
  WHERE t.bucket >= NOW() - INTERVAL '7 days'
),
hourly_prices AS (
  SELECT
    time_bucket('1 hour', ts) AS bucket,
    market,
    AVG(price_usd_mwh) AS price
  FROM public.market_price_signals
  WHERE ts >= NOW() - INTERVAL '7 days'
  GROUP BY 1, market
),
combined AS (
  SELECT
    hs.*,
    hp.market,
    hp.price,
    CASE WHEN hp.price > 60 THEN true ELSE false END AS high_price_window,
    CASE WHEN hs.discharge_mw > hs.capacity_mw * 0.3 THEN true ELSE false END AS was_dispatched,
    CASE WHEN hs.soc > 20 THEN true ELSE false END AS could_dispatch,
    CASE
      WHEN hp.price > 60
        AND hs.discharge_mw < hs.capacity_mw * 0.3
        AND hs.soc > 20
      THEN ROUND(((hs.capacity_mw * 0.8 - GREATEST(hs.discharge_mw, 0)) * hp.price)::numeric, 0)
      ELSE 0
    END AS missed_revenue_usd
  FROM hourly_state hs
  LEFT JOIN hourly_prices hp ON hp.bucket = hs.bucket
    AND hp.market = CASE
      WHEN hs.timezone = 'America/Los_Angeles' THEN 'CAISO'
      WHEN hs.timezone = 'America/Chicago' THEN 'ERCOT'
      WHEN hs.timezone = 'America/Phoenix' THEN 'CAISO'
      ELSE 'PJM'
    END
)
SELECT
  name AS site_name,
  COUNT(*) FILTER (WHERE high_price_window) AS high_price_hours,
  COUNT(*) FILTER (WHERE high_price_window AND was_dispatched) AS dispatched_hours,
  COUNT(*) FILTER (WHERE high_price_window AND NOT was_dispatched AND could_dispatch) AS missed_hours,
  COALESCE(SUM(missed_revenue_usd), 0) AS total_missed_revenue_usd,
  ROUND(AVG(CASE WHEN high_price_window THEN price END)::numeric, 2) AS avg_high_price_usd
FROM combined
GROUP BY name, site_id
ORDER BY total_missed_revenue_usd DESC;
```

## Q5B — Platform Proof (concurrent ingest + query)
**User:** Solutions Engineer / DBA
**Question:** Can the platform handle real-time writes AND analytical queries simultaneously?
**Decision:** Is TimescaleDB production-ready for this workload?
**Business Value:** Platform confidence, reduced evaluation risk
**TimescaleDB Feature:** Hypertable stats, compression stats, chunk management

```sql
SELECT
  -- Ingest stats
  (SELECT COUNT(*) FROM public.telemetry_raw
   WHERE ts > NOW() - INTERVAL '1 minute') AS rows_last_minute,
  -- Table stats
  (SELECT reltuples::bigint FROM pg_class
   WHERE relname = 'telemetry_raw') AS est_total_rows,
  -- Chunk stats
  (SELECT COUNT(*) FROM timescaledb_information.chunks
   WHERE hypertable_name = 'telemetry_raw') AS total_chunks,
  (SELECT COUNT(*) FROM timescaledb_information.chunks
   WHERE hypertable_name = 'telemetry_raw' AND is_compressed) AS compressed_chunks,
  -- Compression stats
  (SELECT pg_size_pretty(SUM(before_compression_total_bytes))
   FROM hypertable_compression_stats('telemetry_raw')) AS uncompressed_size,
  (SELECT pg_size_pretty(SUM(after_compression_total_bytes))
   FROM hypertable_compression_stats('telemetry_raw')) AS compressed_size,
  (SELECT ROUND(SUM(before_compression_total_bytes)::numeric /
     NULLIF(SUM(after_compression_total_bytes), 0), 1)
   FROM hypertable_compression_stats('telemetry_raw')) AS compression_ratio,
  -- CAGG count
  (SELECT COUNT(*) FROM timescaledb_information.continuous_aggregates) AS cagg_count,
  -- Database size
  pg_size_pretty(pg_database_size(current_database())) AS database_size;
```

---

# Query Performance Expectations

| Query | CAGG Used | Expected Latency | Data Scanned |
|-------|-----------|-----------------|--------------|
| Q1A Latest Fleet State | telemetry_1min | < 50ms | Last 10 min, 10 rows |
| Q1B Active Alarms | (direct) | < 50ms | Partial index scan |
| Q2A Power Trend 24h | telemetry_15min | < 100ms | ~96 rows per site |
| Q2B Asset Health 30d | telemetry_1hour | < 150ms | ~720 rows per site |
| Q3A Multi-Resolution | tier-dependent | < 200ms | Varies by range |
| Q3B Fleet Utilization | telemetry_15min | < 150ms | ~960 rows (10 sites) |
| Q4A Dispatch Readiness | telemetry_1min | < 100ms | 10 latest + alarm scan |
| Q4B Revenue Opportunity | telemetry_1min + market | < 100ms | 10 latest + 3 prices |
| Q5A Missed Revenue 7d | telemetry_1hour + market | < 400ms | ~1,680 hourly rows |
| Q5B Platform Proof | metadata | < 100ms | System catalogs |

---

# Notes
- **v2 changes from v1:** Q2B, Q3B, Q4A, Q4B significantly upgraded; Q5A, Q5B added
- Designed for: demo narratives, benchmarking, Claude Code analysis
- All queries use CAGGs — no raw table scans for operational queries
- Q5A (Missed Revenue) is the "money slide" for executive audiences
- Extended queries (investigation, ML features, etc.) live in the engineering pack
