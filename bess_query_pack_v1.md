# BESS Query Pack v1 (Engineering Grade)

## Section 1 --- Real-Time Operations

### Q1 --- Latest Fleet State

**User:** BESS Operator\
**Question:** What is happening across my fleet right now?\
**Decision:** Do I need to intervene?\
**Business Value:** Real-time visibility, faster response

``` sql
SELECT DISTINCT ON (s.site_id)
  s.site_id,
  s.name AS site_name,
  t.bucket AS latest_time,
  t.avg_site_power_mw,
  t.avg_soc_pct AS soc_pct,
  t.avg_soh_pct AS soh_pct,
  t.avg_inverter_temp_c,
  t.avg_rack_temp_c
FROM public.sites s
JOIN public.telemetry_1min t ON t.site_id = s.site_id
ORDER BY s.site_id, t.bucket DESC;
```

### Q7 --- Dispatch Readiness

``` sql
SELECT
  s.name AS site_name,
  l.avg_soc_pct,
  l.avg_soh_pct,
  CASE
    WHEN l.avg_soc_pct >= 60 AND l.avg_soh_pct >= 95 THEN 'READY'
    ELSE 'NOT_READY'
  END AS status
FROM (
  SELECT DISTINCT ON (site_id)
    site_id,
    avg_soc_pct,
    avg_soh_pct
  FROM public.telemetry_1min
  ORDER BY site_id, bucket DESC
) l
JOIN public.sites s ON s.site_id = l.site_id;
```

### Q8 --- Revenue Opportunity

``` sql
SELECT
  s.name AS site_name,
  o.region,
  lp.market,
  lp.price_usd_mwh,
  ls.avg_soc_pct,
  s.capacity_mw
FROM (
  SELECT DISTINCT ON (site_id)
    site_id,
    avg_soc_pct
  FROM public.telemetry_1min
  ORDER BY site_id, bucket DESC
) ls
JOIN public.sites s ON s.site_id = ls.site_id
JOIN public.organizations o ON o.org_id = s.org_id
LEFT JOIN (
  SELECT DISTINCT ON (region)
    region,
    market,
    price_usd_mwh
  FROM public.market_price_signals
  ORDER BY region, ts DESC
) lp ON lp.region = o.region
ORDER BY lp.price_usd_mwh DESC;
```

## Section 5 --- Timescale Proof

### Q13 --- Raw Aggregation

``` sql
EXPLAIN ANALYZE
SELECT
  time_bucket('15 minutes', ts) AS bucket,
  avg(site_power_mw),
  avg(state_of_charge_pct)
FROM public.telemetry_raw
WHERE ts >= now() - INTERVAL '1 hour'
GROUP BY bucket;
```

### Q14 --- CAGG Aggregation

``` sql
EXPLAIN ANALYZE
SELECT
  bucket,
  avg_site_power_mw,
  avg_soc_pct
FROM public.telemetry_15min
WHERE bucket >= now() - INTERVAL '1 hour';
```

### Q15 --- Compression Stats

``` sql
SELECT *
FROM timescaledb_information.hypertable_compression_stats
WHERE hypertable_name = 'telemetry_raw';
```
