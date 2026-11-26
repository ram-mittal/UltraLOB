# Deploy UltraLOB on Render Free

This repository includes a single-service Render deployment for the dashboard, Monte Carlo pricing API, live market-data WebSocket gateway, and a demo-only MT5 Execution API. The execution API remains disabled until PostgreSQL and an operator admin key are configured.

## Free deployment

1. Push or merge the `deploy/render-free` branch into `main`.
2. Sign in to [Render](https://render.com/) and choose **New → Blueprint**.
3. Connect `ram-mittal/UltraLOB` and select the branch containing `render.yaml`.
4. Review the Blueprint and create the service. Render builds the Node.js app and starts it with `npm start`.
5. Open the generated `*.onrender.com` URL. The dashboard is served at `/` and `/terminal`.

The Render service is configured on the Free instance plan. It sleeps after a period without inbound traffic; the dashboard sends a small WebSocket heartbeat every 60 seconds while the live feed is connected, so an active session can keep the connection alive. The first visit after idle may take about a minute while the service wakes.

## Market data

- **BTC/USD (internal UI key: BTCUSDT):** connects automatically from the browser directly to Kraken Spot WebSocket v2 ticker and trade channels. The public feed requires no API key. The Render historical-candle endpoint uses Kraken's public OHLC REST API. Kraken's REST OHLC endpoint returns at most 720 recent entries and includes the currently forming candle; the scenario model filters incomplete candles before calibration. [Kraken WebSocket FAQ](https://support.kraken.com/en-us/articles/360022326871-kraken-websocket-api-frequently-asked-questions) · [Kraken OHLC endpoint](https://docs.kraken.com/api/docs/rest-api/get-ohlc-data).
- **AAPL, MSFT, GOOGL:** add `TWELVE_DATA_API_KEY` under the Render service's Environment settings. Vercel environment variables are not shared with Render. Save with **Save, rebuild, and deploy** (or **Save and deploy**) to apply the key; never paste the secret into `index.html`.
- **Twelve Data plan limits:** Basic and Grow accounts are limited to trial symbols for WebSocket use; they do not unlock arbitrary AAPL/MSFT/GOOGL subscriptions. Check your account's permitted trial-symbol list or an eligible higher-tier plan before expecting those three equities to stream. See the [Twelve Data WebSocket documentation](https://twelvedata.com/docs/websocket/websocket-getting-started) and [trial details](https://support.twelvedata.com/en/articles/5335783-trial).

The landing view selects BTC by default, starts the live gateway automatically, and starts Auto Monte Carlo after the first BTC trade tick. The Auto Monte Carlo checkbox is enabled by default and can be paused by unchecking it.

## Market Monte Carlo scenario lab

The dashboard's separate Market Monte Carlo panel retrieves recent historical candles, calibrates close-to-close log returns, and resamples contiguous return blocks in the browser. BTCUSDT is an internal UI key for Kraken Spot BTC/USD candles; the quote currency is USD. AAPL, MSFT and GOOGL candles use the Twelve Data `time_series` API through the server; equity history requires `TWELVE_DATA_API_KEY` and consumes the plan's API credits. The endpoint caches BTC history for 15 seconds and equity history for 60 seconds per symbol/interval/lookback request.

The scenario chart displays a sample of simulated paths, the median path and empirical 5–95% / 25–75% percentile fans. It reports terminal price percentiles and close-only first-touch estimates for configured stop and target levels. This is conditional scenario analysis, not a forecast, trading signal, or execution system. It omits intrabar sequence, spread, fees, slippage, liquidity, funding and regime changes.

## MT5 demo execution bridge (phase 1)

The MT5 demo Execution API requires a persistent PostgreSQL database. Add these variables under Render → UltraLOB → Environment:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL connection string |
| `DATABASE_SSL` | Optional `true` when the database provider requires TLS |
| `ULTRALOB_EXECUTION_ADMIN_KEY` | Long random operator-only secret to create connector tokens and publish strategy signals |

The service initializes the execution tables on first use. Without `DATABASE_URL`, `/api/execution/health` reports `storage: not-configured` and protected execution routes return 503. Do not use Render's ephemeral filesystem as the execution journal.

The MT5 source is [`mt5/Experts/UltraLOB_Bridge_EA.mq5`](../mt5/Experts/UltraLOB_Bridge_EA.mq5). It must be compiled in MetaEditor, and the user must allow `https://ultralob.onrender.com` in MT5 WebRequest settings. The EA defaults to no execution and rejects any account that is not a demo account. Read the complete [MT5 Demo Bridge guide](MT5_DEMO_BRIDGE.md) before pairing.

This is an operator-managed phase-1 integration. There is not yet a user login or self-service broker page, no Exness adapter, and no live trading mode. The REST polling bridge is not intended for high-frequency execution.

## Pricing and compute

The built-in JavaScript Monte Carlo CPU fallback runs on the Render service. The default fallback cap is 10 million paths and can be changed with `PRICING_FALLBACK_MAX_PATHS`.

CUDA is not included in this free deployment. Selecting CUDA returns an explicit unavailable response rather than silently running on CPU. A separate GPU host is required for the CUDA pricing container.

The FIX order ticket remains a simulation and is not connected to a broker or exchange. Live market quotes and Monte Carlo estimates do not constitute trade execution.

## Health checks

- `/healthz` — Render process health
- `/api/market-data` — available symbols and provider configuration
- `/api/market-history?symbol=BTCUSDT&interval=5m&limit=250` — historical candles for scenario calibration
- `/api/pricing` — pricing backend health
