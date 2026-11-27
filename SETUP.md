# UltraLOB — Setup & Environment Guide

## 1. Prerequisites
- **Node.js >= 22**
- **PostgreSQL 15+** (Neon free tier or local Postgres; optional TimescaleDB extension for tick/candle time-series in Phase 2)
- **MetaTrader 5 Desktop** (for Demo Connector EA in `mt5/Experts/UltraLOB_Bridge_EA.mq5`)

## 2. Environment Variables

Create a `.env` file locally or set these variables in Render Dashboard → Environment:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No (default `10000`) | HTTP/WS port for `server.js` |
| `DATABASE_URL` | **Yes (Prod)** | PostgreSQL connection string (`postgresql://user:pass@host/db?sslmode=require`) |
| `DATABASE_SSL` | Conditional | Set `"true"` if Postgres requires TLS with verified cert (e.g. Neon) |
| `ULTRALOB_JWT_SECRET` | **Yes (Prod)** | 64-char random hex secret for signing JWT access & refresh tokens |
| `ULTRALOB_EXECUTION_ADMIN_KEY` | **Yes (Execution)** | Admin key sent in `x-ultralob-admin-key` for `/api/execution` management |
| `TWELVE_DATA_API_KEY` | Optional | Twelve Data API key for US equity ticks & history |
| `ALLOWED_WS_ORIGINS` | Optional | Comma-separated allowed WebSocket origins |
| `RENDER_EXTERNAL_HOSTNAME` | Auto on Render | Hostname used for origin validation |
| `PRICING_SERVICE_URL` | Optional | Native C++/CUDA Monte Carlo pricing sidecar URL |

Generate secure secrets with Node:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Database Initialization

When `DATABASE_URL` is configured, `db/client.js` automatically applies SQL migrations from `db/migrations/` on startup and seeds the 5 core XAUUSD research strategies (`UL-01` through `UL-05`).

To run migrations manually:
```bash
psql "$DATABASE_URL" -f db/migrations/001_initial_schema.sql
```

## 4. Running Locally & Testing

```bash
npm install
npm test
npm start
```

> **Note on Sandbox / Unconfigured Environments:** When `DATABASE_URL` is omitted (such as isolated CI test runs), UltraLOB operates in ephemeral in-memory mode for user sessions and marks execution storage (`EXECUTION_STORAGE_NOT_CONFIGURED`) as awaiting configuration. No fake performance statistics are fabricated in either mode.
