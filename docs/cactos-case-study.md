# Cactos Customer Story — EKD Slide Format

## Slide Title
**Cactos migrates 15TB BESS fleet telemetry from Amazon RDS and cuts costs by 55% with TimescaleDB**

---

## Application Description:
Cactos' **Battery Energy Storage Platform** ingests continuous telemetry from every BESS unit in its fleet — including power output, state of charge, cell voltages, temperature, and grid measurements — and feeds it into a **central optimizer** that calculates optimal charge/discharge actions on 15-minute market intervals. TimescaleDB serves as the single source of truth powering customer-facing dashboards, real-time fleet optimization, and TSO/DSO regulatory reporting. Data flows from field units via HTTPS through Cloudflare and AWS SQS into backend services on EKS, which process and write directly to Tiger Cloud. There is **no caching layer** — all reads, from real-time optimizer queries to historical analysis, go directly against TimescaleDB.

## Challenges:
Cactos previously relied on **Amazon RDS for PostgreSQL** to store 15TB of fleet telemetry across 35 partitioned tables. As the fleet grew, RDS costs escalated to **$9,000/month** with all data kept in expensive hot storage and **no compression, no tiering, and no continuous aggregates**. Data access for historical queries was becoming progressively slower, and the cost trajectory was unsustainable as Cactos targets **doubling fleet size annually**. The team evaluated InfluxDB, Prometheus, and ClickHouse, but rejected them — InfluxDB and Prometheus lacked the transactional rigor needed for energy market operations, while ClickHouse would have required a split architecture and significant codebase rework. Cactos needed a solution that could house **both relational configuration data and time-series telemetry in a single PostgreSQL-compatible database**.

## Outcomes:
By migrating to Tiger Cloud, Cactos achieved **92% storage compression** (15TB → 1TB), reducing monthly costs from $9,000 to **$4,000/month — a 55% reduction** — while gaining HA replication, continuous aggregates, tiered S3 storage, and a dedicated dev/test environment that RDS never provided. Historical data retrieval from S3 tiered storage is now **faster than it was from hot storage on RDS**, thanks to columnar compression and chunk exclusion optimization. The migration covered 15TB across 35 tables with minimal downtime using per-table live-sync, completing in approximately one month with no significant architectural changes required.

## Company Description:
**Cactos** is a European manufacturer and operator of battery energy storage systems (BESS) that provide intelligent energy buffers for agriculture, EV charging, and grid-scale applications. Their systems charge during low-cost off-peak periods and discharge during demand spikes — a single peak event can raise DSO charges **4x for an entire quarter**. Cactos also enables energy trading through a central optimizer operating on 15-minute market intervals. The company is **doubling its fleet annually** and expanding into new product lines including EV charging stations and grid-scale solar/wind storage.

---

## Key Stats (for slide callouts)

| Metric | Value |
|--------|-------|
| Previous DB | Amazon RDS for PostgreSQL |
| Data migrated | 15 TB across 35 tables |
| Compression | 15 TB → 1 TB (92%) |
| Cost reduction | $9,000 → $4,000/month (55%) |
| Hot retention | 2 months |
| Cold tier | ~13 TB on S3, fully queryable |
| Migration time | ~1 month, minimal downtime |
| Tiered query speed | Faster than previous RDS hot storage |

## Quotes (from Juuso Mayränen, Co-Founder & Software Engineer)

> "It makes things much simpler to manage everything from a single database."

> "Currently it's faster to get data from Tiger Data tiered storage than it was from hot storage on RDS."

> "It's been smooth sailing, and everything's been working really well after the migration completed."

## Tiger Cloud Features Used
- Hypertables with native compression (92% reduction)
- Continuous aggregates
- Automatic S3 tiering (age-based, 2-month hot window)
- Per-table live-sync migration from RDS
- Columnar compression + chunk exclusion optimization
- HA replication
- VPC peering for secure connectivity
