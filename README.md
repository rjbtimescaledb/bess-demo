# BESS Operations Center

A production-quality Battery Energy Storage System (BESS) monitoring and operations demo, powered by [Tiger Cloud](https://www.timescale.com/cloud) (TimescaleDB).

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│   Next.js Frontend  │────>│    Tiger Cloud        │
│   (Vercel)          │     │    (TimescaleDB)      │
└─────────────────────┘     └──────────────────────┘
                                     ^
                                     │
                            ┌────────┴─────────┐
                            │   Simulator       │
                            │   (Always-on      │
                            │    Worker)        │
                            └──────────────────┘
```

- **Frontend**: Next.js 15 on Vercel — dashboard, site views, alarms, dispatch, platform metrics
- **Database**: Tiger Cloud with hypertables, continuous aggregates, columnstore compression, retention policies
- **Simulator**: Standalone Node.js worker generating realistic BESS telemetry 24/7

## Tiger Cloud Features Demonstrated

| Feature | Usage |
|---------|-------|
| **Hypertables** | `telemetry_raw`, `alarms_events`, `dispatch_commands`, `market_price_signals`, `maintenance_logs` |
| **Continuous Aggregates** | 1-min, 15-min, 1-hour rollups + hourly alarm counts |
| **Columnstore Compression** | Auto-compress chunks older than 2 days (telemetry), 7 days (alarms/dispatch) |
| **Retention Policies** | Auto-drop raw telemetry >90 days, alarms >365 days |
| **Efficient Indexing** | Composite indexes on (site_id, ts DESC) for fast operational queries |

## Quick Start

### Prerequisites

- Node.js 20+
- A Tiger Cloud service (or any TimescaleDB instance)
- Tiger CLI (`brew install --cask timescale/tap/tiger-cli`)

### 1. Get your connection string

```bash
tiger service connection-info <service-id>
```

### 2. Set up the database

```bash
cd bess-demo

# Copy and edit env file
cp .env.example .env
# Edit .env with your DATABASE_URL

# Run schema + policies
export DATABASE_URL="postgres://tsdbadmin:PASSWORD@HOST:PORT/tsdb?sslmode=require"
psql $DATABASE_URL < sql/001_schema.sql
psql $DATABASE_URL < sql/002_continuous_aggregates.sql
psql $DATABASE_URL < sql/003_compression_retention.sql
psql $DATABASE_URL < sql/004_seed.sql
```

### 3. Start the simulator

```bash
cd simulator
cp .env.example .env
# Edit .env with your DATABASE_URL

npm install
npm run backfill          # Generate 30 days of historical data
npm start                 # Start continuous telemetry generation
```

### 4. Start the frontend

```bash
# In the project root
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Simulator

The simulator runs as a separate always-on worker and generates:

- **Telemetry**: Power output, SoC, temperatures, voltages, grid metrics
- **Alarms**: Random fault events with severity levels
- **Dispatch Commands**: Charge/discharge commands driven by market prices
- **Market Prices**: LMP signals for CAISO, ERCOT, PJM

### Simulation Modes

| Mode | Interval | Batch Size | Use Case |
|------|----------|------------|----------|
| `small` | 10s | 50 | Local demos |
| `large` | 2s | 200 | Production demos |
| `terabyte` | 1s | 500 | Scale testing |

Set via `SIMULATION_MODE` env var.

### Backfill Historical Data

```bash
cd simulator
npm run backfill              # Default: 30 days
npm run backfill -- --days 90 # Custom range
```

## Deployment

### Frontend (Vercel)

1. Push to GitHub
2. Import in Vercel
3. Set environment variable: `DATABASE_URL` = your Tiger Cloud connection string
4. Deploy

### Simulator (Always-on Worker)

The simulator needs to run continuously. Options:

- **Railway/Render**: Deploy as a background worker
- **Fly.io**: Deploy as a machine with `fly launch`
- **Docker**: `cd simulator && docker build -t bess-sim . && docker run bess-sim`
- **PM2**: `pm2 start npm --name bess-sim -- start`
- **Screen/tmux**: `screen -S sim npm start` (for quick demos)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Tiger Cloud connection string | Yes |
| `SIMULATION_MODE` | `small` / `large` / `terabyte` | No (default: `small`) |

## Project Structure

```
bess-demo/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── api/              # API routes
│   │   ├── sites/            # Site pages
│   │   ├── alarms/           # Alarm views
│   │   ├── dispatch/         # Dispatch timeline
│   │   ├── assets/           # Asset management
│   │   └── platform/         # Tiger Cloud showcase
│   ├── components/           # React components
│   │   ├── cards/            # KPI and site cards
│   │   ├── charts/           # Recharts wrappers
│   │   ├── tables/           # Data tables
│   │   └── layout/           # Layout components
│   └── lib/                  # Database, queries, utilities
├── sql/                      # Database migrations
│   ├── 001_schema.sql
│   ├── 002_continuous_aggregates.sql
│   ├── 003_compression_retention.sql
│   └── 004_seed.sql
├── simulator/                # Standalone telemetry generator
│   └── src/
├── grafana/                  # Grafana dashboard queries
└── README.md
```

## Grafana Integration

SQL queries for Grafana dashboards are in `grafana/dashboards.sql`. To use:

1. Add your Tiger Cloud instance as a PostgreSQL data source in Grafana
2. Create dashboards using the provided queries
3. Recommended panels: compression savings, ingest throughput, telemetry volume, active alarms

## Scaling Notes

- **1M+ rows/day**: The `small` simulator mode generates ~43K rows/day per site (~215K total)
- **10M+ rows/day**: Use `large` mode for ~216K rows/day per site (~1M total)
- **Terabyte scale**: Use `terabyte` mode and run backfill for 90+ days
- Continuous aggregates ensure dashboard queries stay fast regardless of raw data volume
- Compression typically achieves 10-20x reduction on BESS telemetry data
