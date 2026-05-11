
# BESS Core Query Pack v1 (8 Queries)

## Overview
This is the standardized BESS query pack designed to demonstrate TimescaleDB’s ability to handle:
- Operational (OLTP-like) workloads
- Analytical (OLAP-like) workloads
- User-facing dashboards
- Real-time decisioning

Each query maps:
User → Question → Decision → Business Value → SQL

---

# Category 1 — Operational / Last-State

## Q1A — Latest Fleet State
User: BESS Operator  
Question: What is happening right now?  
Decision: Do I need to act?  
Business Value: Real-time visibility

```sql
SELECT DISTINCT ON (s.site_id)
  s.site_id,
  s.name,
  t.bucket,
  t.avg_site_power_mw,
  t.avg_soc_pct,
  t.avg_soh_pct
FROM public.sites s
JOIN public.telemetry_1min t ON t.site_id = s.site_id
ORDER BY s.site_id, t.bucket DESC;
```

## Q1B — Active Alarms
User: Reliability Engineer  
Question: What is broken right now?  
Decision: Where to intervene  
Business Value: Reduced downtime

```sql
SELECT s.name, a.severity, count(*)
FROM public.alarms_events a
JOIN public.sites s ON s.site_id = a.site_id
WHERE a.resolved_at IS NULL
GROUP BY s.name, a.severity
ORDER BY count(*) DESC;
```

---

# Category 2 — Historical Analytics

## Q2A — Power Trend
User: Analyst  
Question: How has power changed?  
Decision: Is behavior normal?  
Business Value: Insight into operations

```sql
SELECT bucket, avg_site_power_mw
FROM public.telemetry_15min
WHERE bucket >= now() - INTERVAL '24 hours'
GROUP BY bucket
ORDER BY bucket;
```

## Q2B — Asset Health
User: Asset Manager  
Question: Which assets are degrading?  
Decision: Maintenance planning  
Business Value: Reduced cost

```sql
SELECT s.name, avg(t.avg_soh_pct)
FROM public.telemetry_1hour t
JOIN public.sites s ON s.site_id = t.site_id
WHERE t.bucket >= now() - INTERVAL '30 days'
GROUP BY s.name
ORDER BY avg(t.avg_soh_pct);
```

---

# Category 3 — Dashboard Queries

## Q3A — Multi Resolution
User: End User  
Question: Can dashboards scale?  
Decision: Query resolution  
Business Value: Fast UX

```sql
SELECT bucket, avg_site_power_mw
FROM public.telemetry_1min
WHERE bucket >= now() - INTERVAL '1 hour'
ORDER BY bucket;
```

## Q3B — Fleet Rollup
User: Ops Lead  
Question: Which sites perform best?  
Decision: Focus effort  
Business Value: Efficiency

```sql
SELECT s.name, avg(t.avg_site_power_mw)
FROM public.telemetry_15min t
JOIN public.sites s ON s.site_id = t.site_id
WHERE t.bucket >= now() - INTERVAL '24 hours'
GROUP BY s.name
ORDER BY avg DESC;
```

---

# Category 4 — Decisioning

## Q4A — Dispatch Readiness
User: Trader  
Question: Can I dispatch?  
Decision: Where to act  
Business Value: Avoid failure

```sql
SELECT s.name, l.avg_soc_pct
FROM public.telemetry_1min l
JOIN public.sites s ON s.site_id = l.site_id
ORDER BY l.bucket DESC;
```

## Q4B — Revenue Opportunity
User: Trader  
Question: Where is the money?  
Decision: Where to dispatch  
Business Value: Max revenue

```sql
SELECT s.name, lp.price_usd_mwh
FROM public.sites s
JOIN public.market_price_signals lp ON TRUE
LIMIT 10;
```

---

# Notes
- This is the CORE benchmark pack (8 queries)
- Extended queries (investigation, ML, etc.) live separately
- Designed for:
  - Claude Code analysis
  - benchmarking across DBs
  - demo narratives
