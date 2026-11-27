# UltraLOB — Institutional Architecture & Audit Specification

> **Positioning:** UltraLOB — Institutional Strategy Allocation & Risk Infrastructure  
> **Core Philosophy:** Verified strategies. Risk-governed allocation. Transparent execution. Intelligent portfolio decisions.

---

## 1. Codebase Audit Summary (Baseline)

### Preserved Working Infrastructure
- **MT5 Demo Execution Bridge (`execution/` & `mt5/`):**
  - `execution/postgres-store.js` — PostgreSQL schema (`ultralob_execution_connectors`, `ultralob_execution_commands`, `ultralob_execution_events`), SHA-256 connector token hashing, heartbeat tracking, `FOR UPDATE SKIP LOCKED` command lease queue.
  - `execution/risk-manager.js` — `evaluateDemoCommand()` performs account-currency risk sizing, daily loss limit, peak-to-trough drawdown limit, spread limit, open position limit, and stop-distance checks prior to dispatch.
  - `execution/router.js` — Express router mounted at `/api/execution` with strict `DEMO_ONLY` enforcement and admin key authentication.
  - `mt5/Experts/UltraLOB_Bridge_EA.mq5` — Production MQL5 Expert Advisor performing WebRequest HTTPS polling, `OrderCheck` preflight validation, and broker transaction acknowledgement.
- **Market Data & Quantitative Pricing (`api/market-data.js`, `api/market-history.js`, `api/pricing.js`):**
  - Express 5 + WebSocket server (`server.js`) streaming real Kraken Spot `BTC/USD` ticks/order book and Twelve Data US equities (`AAPL`, `MSFT`, `GOOGL`).
  - Historical candle fetcher (`/api/market-history`) with Kraken OHLC + Twelve Data support.
  - Antithetic Monte Carlo GBM option pricer (`/api/pricing`) with native CPU/CUDA bridge + serverless fallback.
  - Legacy FIX 4.4 / Market Monte Carlo terminal preserved at `/legacy`.

### Demo/Placeholder Items Identified & Remediated in Phase 1
1. **Fabricated Strategy Metrics (`api/store.js`):** Replaced 8 demo strategies carrying invented returns/Sharpe/equity curves with the 5 institutional XAUUSD strategies (`UL-01` through `UL-05`) initialized in `RESEARCH` lifecycle state with `null` performance fields until backed by real backtests or verified broker records.
2. **Hardcoded Fake Guest Portfolio (`api/store.js`):** Removed `$25,420.50` balance, synthetic monthly equity history, and invented closed trades. Portfolios initialize honestly at `$0.00` (with explicit `PAPER_SANDBOX` or `DEMO_BROKER` provenance).
3. **File-Based JSON Persistence (`data/runtime.json`):** Replaced primary persistence with PostgreSQL (`db/migrations/001_initial_schema.sql` + `db/client.js`), keeping an isolated in-memory fallback strictly for unconfigured local/test environments.
4. **Missing Role-Based Auth & Audit Trail (`api/auth.js`):** Added PostgreSQL-backed users, organizations, roles (`investor`, `strategy_provider`, `fund_manager`, `risk_manager`, `researcher`, `admin`), HMAC JWT access + rotating refresh tokens, and rate limiting.
5. **Unlabeled Frontend Metrics (`public/js/`):** Added explicit Data Source Provenance tags (`REAL_MARKET`, `BACKTEST`, `DEMO_BROKER`, `LIVE_BROKER`, `PAPER_SANDBOX`, `RESEARCH`) and upgraded navigation to the 12-section institutional workspace.

---

## 2. Data Provenance Classification (Strict Separation)

UltraLOB never mixes data sources without explicit UI and API labeling:

| Tag | Meaning | Allowed Use |
|-----|---------|-------------|
| `REAL_MARKET` | Live Kraken Spot / Twelve Data / Broker feed | Market Intelligence, Terminal, Backtest inputs |
| `BACKTEST` | Historical simulation with transaction costs & slippage | Strategy evaluation, Research |
| `DEMO_BROKER` | Confirmed fills & snapshots from MT5 Demo account | Forward Testing, Live Pilot (Demo) |
| `LIVE_BROKER` | Broker-confirmed real-money fills | Verified Live accounts (locked until Phase 3+) |
| `PAPER_SANDBOX` | Internal paper execution ledger (zero real funds) | User testing when no MT5 terminal is linked |
| `SIMULATED_RESEARCH` | Monte Carlo block-bootstrap / synthetic stress paths | Stress testing, Fan charts |
| `RESEARCH` | Strategy logic defined; awaiting empirical backtest | Marketplace prior to validation |

---

## 3. Target System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Frontend SPA (12 Institutional Views)                │
│  Overview · Marketplace · Portfolio · UltraLOB AI · Market Intel · Risk  │
│  Copy Trading · Brokers · Execution Monitor · Research · Reports · Setup │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTPS / WSS (JWT + Role Guard)
┌───────────────────────────────▼─────────────────────────────────────────┐
│                   Node.js / Express 5 Core API Gateway                  │
│  Auth & RBAC · Strategy Registry · Copy Allocator · Risk Engine Gate    │
│  Execution Bridge (/api/execution) · Market Data WS · Pricing Proxy      │
├───────────────────────────────┬─────────────────────────────────────────┤
│   PostgreSQL Core Database    │   Python Quant Research Service (Ph 2)  │
│   db/migrations/001_*.sql     │   research/ (OHLCV Backtester, Walk-Fwd,│
│   Users, Orgs, Strategies,    │   Monte Carlo, UL-01..UL-05 Engine)      │
│   Backtests, Signals, Risk,   │                                         │
│   Executions, Audit Logs      │   External Feeds & Terminals            │
│                               │   Kraken WS · Twelve Data · MT5 EA (MQL5)│
└───────────────────────────────┴─────────────────────────────────────────┘
```

---

## 4. Implementation Status (Phases 1–6 Complete)

- **Phase 1 (Foundation):** Architecture audit, PostgreSQL schema + migrations (`db/migrations/`), RBAC auth + rotating refresh tokens (`api/auth.js`, `api/security.js`), honest XAUUSD Strategy Registry (`UL-01`..`UL-05` in `RESEARCH` status with zero fake metrics), 12-section institutional UI navigation, strict data provenance labeling.
- **Phase 2 (Quant Research Engine):** Pure-Python OHLCV backtesting engine (`research/engine.py`, `metrics.py`, `monte_carlo.py`, `data_feed.py`) modeling spread/commission/slippage/swap/delay, OOS split, walk-forward windows, and Monte Carlo trade-sequence stress tests; implemented `UL-01`, `UL-02`, and `UL-03` on XAUUSD with Twelve Data & MT5 CSV loaders (`api/research.js`).
- **Phase 3 (MT5 Execution Bridge):** Unified broker & copy-trading routing onto PostgreSQL `execution/` bridge (`UltraLOB_Bridge_EA.mq5` v0.2.0 with `OrderCalcMargin` & version telemetry), shared risk-normalized sizing (`computeRiskNormalizedVolume`), and real-time Execution Monitor UI (`/execution`).
- **Phase 4 (Portfolio & Risk Engine):** Multi-strategy allocation optimizer (`portfolio/allocator.js` supporting Fixed, Risk-Weighted, Volatility-Adjusted, ERC, and Fractional), net/gross exposure aggregation, empirical correlation checks, independent hard Risk Engine (`risk/engine.js`) with Global/Strategy/Instrument kill switches and immutable audit trails (`/portfolio`, `/risk`).
- **Phase 5 (UltraLOB AI):** 7-engine advisory-only pipeline (`ai/engines.js`, `ai/events.js`, `api/ai.js`) integrating Macro Event Intelligence blackouts and mandatory Risk Engine re-verification before human authorization (`/ai`).
- **Phase 6 (Institutional Features):** Investor mandate enforcement (`investor_profiles`), organization desk management, HWM fee accounting framework (explicitly non-billing), scoped enterprise API keys, and CSV/JSON institutional statements (`/reports`, `/settings`).
