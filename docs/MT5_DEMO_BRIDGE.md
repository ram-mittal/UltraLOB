# UltraLOB MT5 Demo Bridge — Phase 1

This is the first vertical slice of UltraLOB's broker-execution foundation. It connects **one MT5 demo terminal** to the Execution API, accepts strategy signals, performs account-aware pre-trade checks, and returns a risk-sized demo order instruction.

**This build is demo-only. Live-account execution is not supported.** The EA refuses to initialize on a real or contest account, the API creates only DEMO connectors, and the health endpoint reports `live_execution_enabled: false`.

## Scope and current limitations

Included:

- MT5 Expert Advisor using HTTPS polling via MQL5 `WebRequest`.
- Account, balance, equity, margin, open-position and broker-symbol-specification heartbeats.
- One-time connector token generation; only a SHA-256 token hash is persisted.
- Admin-authenticated strategy signal ingress.
- Per-follower risk sizing from broker tick size, tick value, volume minimum/maximum/step, current bid/ask and stop distance.
- Daily-loss, peak-to-trough drawdown, stale-heartbeat, trade-mode, open-position, symbol, strategy and spread gates.
- Local MT5 `OrderCalcProfit`, `OrderCheck` and explicit acknowledgement handling.
- PostgreSQL persistence and idempotency per connector/signal.
- Command lease/retry and local terminal-global-variable duplicate protection.

Not included yet:

- Public user login, self-service broker connection UI or per-user authorization/entitlements.
- Exness API adapter.
- Multi-strategy runtime or direct conversion of Monte Carlo scenario outputs into buy/sell signals.
- Marketplace subscriptions, billing, provider onboarding or verified public performance pages.
- Live-account execution. Do not enable it by changing environment variables; the current build deliberately has no live mode.
- Production-grade terminal secret vaulting or broker credential custody. The connector token is a bearer credential; protect the MT5 terminal/VPS account.

The admin key is an operator-only bootstrap mechanism for this phase. Do not expose it to browser JavaScript or share it with strategy subscribers.

## 1. Configure persistent storage and admin access

The execution API requires PostgreSQL. It does **not** silently use in-memory storage or the Render instance filesystem. Without a database, `GET /api/execution/health` reports storage as not configured and protected execution routes return HTTP 503.

### Free demo database recommendation: Neon

For this development/demo phase, use a [Neon Free PostgreSQL project](https://neon.com/). Its currently documented free allowance includes 1 GB storage, 100 compute-hours per project per month and 5 GB public network transfer; the compute scales to zero after five minutes of inactivity. It is suitable for development and a low-volume demo connector, **not** for always-on or live-money execution. <https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md>

1. Create a Neon project and choose a region close to the Render web service.
2. In the Neon Console, open **Connect** and enable **Connection pooling**.
3. Copy the pooled PostgreSQL connection string. It should use a hostname containing `-pooler` and include `sslmode=require`. Keep any generated `channel_binding=require` parameter.
4. Add the full string as Render's `DATABASE_URL` secret. Do not paste it into GitHub, this chat, browser JavaScript or the EA.
5. Leave `DATABASE_SSL` unset for the Neon URL because the connection string already specifies TLS. Set `DATABASE_SSL=true` only for another provider where the URL itself does not carry TLS configuration and the provider requires driver-level SSL.

Neon documents the pooled connection string for long-running web applications and the `-pooler` host suffix here: <https://neon.com/docs/connect/connection-pooling>.

Add these environment variables to the Render UltraLOB service:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Use a managed PostgreSQL database with persistent storage. |
| `DATABASE_SSL` | Optional; set to `true` only when the database provider requires TLS. |
| `ULTRALOB_EXECUTION_ADMIN_KEY` | Long random operator secret used to create connector tokens and publish strategy signals. Generate at least 32 random bytes. |

The service creates the execution tables and indexes on first use. The schema is stored in `execution/postgres-store.js`. Back up the database and restrict network access to the application.

After setting variables, redeploy the Render service. Then check:

```bash
curl https://ultralob.onrender.com/api/execution/health
```

Expected configured response:

```json
{
  "status": "configured",
  "storage": "postgresql",
  "broker": "MT5",
  "environment": "DEMO_ONLY",
  "live_execution_enabled": false
}
```

If the response says `storage: not-configured`, do not try to pair an EA yet.

## 2. Create a demo connector

Keep the admin key in a local shell or password manager. Never put it in `index.html`, browser storage or a public repository.

Example request (replace the symbol with the exact name used by your broker, including suffixes such as `XAUUSDm`):

```bash
curl -X POST "https://ultralob.onrender.com/api/execution/connectors" \
  -H "Content-Type: application/json" \
  -H "x-ultralob-admin-key: $ULTRALOB_EXECUTION_ADMIN_KEY" \
  -d '{
    "label": "MT5 Demo - XAUUSD",
    "broker": "MT5",
    "environment": "DEMO",
    "strategy_ids": ["valor-xau-demo"],
    "allowed_symbols": ["XAUUSD"],
    "risk": {
      "max_trade_risk_pct": 0.5,
      "max_daily_loss_pct": 2.0,
      "max_drawdown_pct": 8.0,
      "max_spread_points": 100,
      "max_open_positions": 2,
      "max_deviation_points": 20
    }
  }'
```

The response includes:

- `connector.id`: paste into the EA's Connector ID input.
- `access_token`: paste into the EA's Access Token input.

**Copy the access token once.** The database stores only its SHA-256 hash and the API cannot retrieve the plaintext token later. If it is lost or exposed, revoke/delete the connector record through an operator-controlled database procedure and create a new connector. A dedicated revoke endpoint and user-facing account management UI are later tasks.

## 3. Install the MT5 Expert Advisor

Source file: `mt5/Experts/UltraLOB_Bridge_EA.mq5`

1. Open MetaTrader 5 and launch MetaEditor.
2. Copy the EA source into the terminal's `MQL5/Experts` folder.
3. Open `UltraLOB_Bridge_EA.mq5` in MetaEditor and compile it. This repository stores source code; the compiled `.ex5` binary is generated by MetaEditor in your terminal.
4. In MT5, open **Tools → Options → Expert Advisors**.
5. Enable **Allow WebRequest for listed URL** and add exactly:

   `https://ultralob.onrender.com`

6. Open a **demo account only**, attach the EA to a chart, and set its inputs.

Recommended initial inputs:

| Input | Value |
|---|---|
| API Base URL | `https://ultralob.onrender.com` |
| Connector ID | ID returned by the connector creation request |
| Access Token | One-time token returned by the connector creation request |
| Symbols | Exact broker symbol names, e.g. `XAUUSD` |
| Enable Demo Execution | `false` for the first connection check |
| Max Trade Risk % | `0.50` |
| Max Spread Points | Match or be stricter than the server profile |
| Max Open Positions | Match or be stricter than the server profile |
| Timer Seconds | `5` |

The EA sends heartbeats while execution is off. Confirm that the connector appears in the operator list and that its account mode is `DEMO`, terminal connection is fresh, and symbol specifications are populated. Only after that should you deliberately set `Enable Demo Execution = true` for a demo-account test.

MQL5 WebRequest is synchronous, is available to Expert Advisors/scripts (not indicators), and the destination URL must be added to the MT5 allowed list. It is polling-based, not a tick-level or HFT transport. See the [MQL5 WebRequest reference](https://www.mql5.com/en/docs/network/webrequest) and [MetaTrader Expert Advisor settings](https://www.metatrader5.com/en/terminal/help/algotrading/trade_robots_indicators).

## 4. Publish a test strategy signal

The strategy identifier must be included in the connector's `strategy_ids`, and the symbol must exactly match one in `allowed_symbols`.

Illustrative request only — the stop and target prices must be valid for the live demo quote and the symbol's broker stop-distance rules:

```bash
curl -X POST "https://ultralob.onrender.com/api/execution/signals" \
  -H "Content-Type: application/json" \
  -H "x-ultralob-admin-key: $ULTRALOB_EXECUTION_ADMIN_KEY" \
  -d '{
    "signal_id": "valor-xau-demo-000001",
    "strategy_id": "valor-xau-demo",
    "strategy_version": "0.1.0",
    "symbol": "XAUUSD",
    "side": "BUY",
    "risk_pct": 0.25,
    "stop_loss": 3990.00,
    "take_profit": 4020.00,
    "ttl_seconds": 60
  }'
```

The signal endpoint creates queued **instructions**, not broker orders. The connector only receives a command when:

- Its account snapshot is no more than 15 seconds old.
- The account is a demo account.
- MT5 is connected and terminal/EA trade permissions are enabled.
- The strategy and symbol are allowed for the connector.
- Daily loss and peak-to-trough drawdown limits have not been breached.
- Current spread is under the limit.
- Broker tick/volume rules allow a position that stays within the risk budget.
- The signal has not expired.

The server rounds volume **down** to the broker's volume step. If the resulting volume is below the broker minimum, the trade is rejected; the risk manager never rounds up to force a minimum lot.

Before sending, the EA independently verifies current prices, volume step, stop distance, spread and account-currency loss with `OrderCalcProfit`, then runs `OrderCheck`. It submits via `OrderSend` only when the EA's demo-execution input is enabled.

## 5. API routes

| Method | Route | Authorization | Purpose |
|---|---|---|---|
| GET | `/api/execution/health` | Public | Reports storage and demo-only mode |
| POST | `/api/execution/connectors` | Admin key | Create a demo connector and return its token once |
| GET | `/api/execution/connectors` | Admin key | List sanitized connector and heartbeat status |
| PATCH | `/api/execution/connectors/:id/status` | Admin key | Activate, pause or revoke a connector |
| GET | `/api/execution/commands` | Admin key | Inspect the latest command states |
| GET | `/api/execution/events` | Admin key | Read the append-only command and connector event trail |
| POST | `/api/execution/signals` | Admin key | Fan out an idempotent strategy signal |
| POST | `/api/execution/connectors/:id/heartbeat` | Connector bearer | Submit account, position and symbol snapshots |
| GET | `/api/execution/connectors/:id/next` | Connector bearer | Long-poll/poll the next risk-approved instruction |
| POST | `/api/execution/connectors/:id/commands/:commandId/ack` | Connector bearer | Record accepted, rejected, partial or filled status |

Connector credentials are per connector. The API never asks for or stores an MT5 trading password. Connector creation, signal queueing, command dispatch, risk rejections, broker acknowledgements and operator status changes are recorded in `ultralob_execution_events`. Use the connector status endpoint to pause a follower before maintenance or revoke its token if a terminal is compromised. A revoked token can no longer heartbeat or poll.

## 6. Risk and execution semantics

- The current maximum configurable per-trade risk is 1% of equity; the suggested initial profile is 0.5%.
- Daily loss and drawdown gates are measured from the connector's first heartbeat equity baseline for the current UTC day and the stored equity high-water mark. They are not a substitute for broker statement reconciliation.
- The server estimates risk from the terminal-supplied `SYMBOL_TRADE_TICK_SIZE` and `SYMBOL_TRADE_TICK_VALUE`; the EA recalculates account-currency loss using `OrderCalcProfit` immediately before sending.
- `OrderCheck` is a preflight check, not a fill guarantee. `OrderSend` acceptance is recorded as `ACCEPTED`; deal transactions later update the command to `PARTIAL` or `FILLED`. See [MQL5 OrderCheck](https://www.mql5.com/en/docs/trading/ordercheck) and [MQL5 OrderSend](https://www.mql5.com/en/docs/trading/ordersend).
- A queued command expires after its TTL. Dispatched commands are leased and can be redelivered after a timeout; the EA uses a terminal global variable keyed by command ID to avoid resubmitting a command already accepted locally.
- This initial version sends market orders with attached stop-loss and take-profit. It does not yet implement pending orders, modify/close commands, portfolio netting/hedging reconciliation, or failover terminal agents.

## 7. Next integration phases

1. Add user authentication, ownership, per-user connector authorization and a web account-management console.
2. Add full open-order/position reconciliation, command cancellation and recovery workflows.
3. Connect the existing strategy runtime and validated Monte Carlo risk outputs to the signal API; Monte Carlo paths alone must not automatically trigger a direction.
4. Implement the Exness API adapter for eligible Exness API accounts. Exness states that standard MT accounts cannot connect to its API and its current API does not support stock/index instruments; see the [Exness API documentation](https://get.exness.help/hc/en-us/articles/27866287512476-Exness-API).
5. Add follower allocation, multi-account copy coordination, verified performance records and the strategy marketplace.
6. Complete jurisdiction-specific legal and compliance reviews before offering automated third-party copy execution.

**Do not use a live account with this phase-1 EA.** This code path is intentionally limited to MT5 demo accounts.
