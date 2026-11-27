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
| `DATABASE_URL` | **Yes (Prod / MT5)** | PostgreSQL connection string via private env var (`postgresql://user:pass@host/db?sslmode=require`). Without it, MT5 Bridge returns `503` and non-MT5 state uses ephemeral in-memory storage. |
| `DATABASE_SSL` | Conditional | Set `"true"` if Postgres requires TLS with verified cert (`rejectUnauthorized: true`) |
| `ULTRALOB_REQUIRE_DATABASE` | Optional | Set `"true"` to abort startup if `DATABASE_URL` is absent or unreachable |
| `ULTRALOB_JWT_SECRET` | **Yes (Prod)** | Required >=32-char cryptographically random secret for signing JWT access & HMAC-binding refresh tokens. Production startup fails cleanly if missing or set to a placeholder; rotating this secret invalidates all active sessions. |
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

> **Note on Fallback Storage & Separate C++ Runtime:** When `DATABASE_URL` is omitted, auth sessions, custom strategies, Paper Sandbox portfolios/allocations, risk limits/kill switches, research backtests, AI decisions, and mandates operate in ephemeral in-memory fallback storage, while the **MT5 Execution Bridge strictly requires PostgreSQL** and returns HTTP `503 EXECUTION_STORAGE_NOT_CONFIGURED`. Separately, the standalone C++20 FIX 4.4 / binary matching engine (`server/main.cpp`) is a native process not connected to the hosted web terminal, and the hosted `/legacy` FIX order ticket is explicitly simulated in-browser.
