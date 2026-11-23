# Deploy UltraLOB on Render Free

This repository includes a single-service Render deployment for the dashboard, Monte Carlo pricing API, and live market-data WebSocket gateway.

## Free deployment

1. Push or merge the `deploy/render-free` branch into `main`.
2. Sign in to [Render](https://render.com/) and choose **New → Blueprint**.
3. Connect `ram-mittal/UltraLOB` and select the branch containing `render.yaml`.
4. Review the Blueprint and create the service. Render builds the Node.js app and starts it with `npm start`.
5. Open the generated `*.onrender.com` URL. The dashboard is served at `/` and `/terminal`.

The Render service is configured on the Free instance plan. It sleeps after a period without inbound traffic; the dashboard sends a small WebSocket heartbeat every 60 seconds while the live feed is connected, so an active session can keep the connection alive. The first visit after idle may take about a minute while the service wakes.

## Market data

- **BTC/USDT:** connects automatically from the browser directly to Binance Spot's public WebSocket stream. This bypasses Render's outbound WebSocket gateway for BTC and requires no API key. If the primary hostname cannot be reached, the browser rotates through Binance's official market-data-only hostname and port 9443 fallback.
- **AAPL, MSFT, GOOGL:** add `TWELVE_DATA_API_KEY` under the Render service's Environment settings. Vercel environment variables are not shared with Render. Save with **Save, rebuild, and deploy** (or **Save and deploy**) to apply the key; never paste the secret into `index.html`.
- **Twelve Data plan limits:** Basic and Grow accounts are limited to trial symbols for WebSocket use; they do not unlock arbitrary AAPL/MSFT/GOOGL subscriptions. Check your account's permitted trial-symbol list or an eligible higher-tier plan before expecting those three equities to stream. See the [Twelve Data WebSocket documentation](https://twelvedata.com/docs/websocket/websocket-getting-started) and [trial details](https://support.twelvedata.com/en/articles/5335783-trial).

The landing view selects BTC by default, starts the live gateway automatically, and starts Auto Monte Carlo after the first BTC trade tick. The Auto Monte Carlo checkbox is enabled by default and can be paused by unchecking it.

## Market Monte Carlo scenario lab

The dashboard's separate Market Monte Carlo panel retrieves recent historical candles, calibrates close-to-close log returns, and resamples contiguous return blocks in the browser. BTCUSDT candles are public Binance Spot market data. AAPL, MSFT and GOOGL candles use the Twelve Data `time_series` API through the server; equity history requires `TWELVE_DATA_API_KEY` and consumes the plan's API credits. The endpoint caches BTC history for 15 seconds and equity history for 60 seconds per symbol/interval/lookback request.

The scenario chart displays a sample of simulated paths, the median path and empirical 5–95% / 25–75% percentile fans. It reports terminal price percentiles and close-only first-touch estimates for configured stop and target levels. This is conditional scenario analysis, not a forecast, trading signal, or execution system. It omits intrabar sequence, spread, fees, slippage, liquidity, funding and regime changes.

## Pricing and compute

The built-in JavaScript Monte Carlo CPU fallback runs on the Render service. The default fallback cap is 10 million paths and can be changed with `PRICING_FALLBACK_MAX_PATHS`.

CUDA is not included in this free deployment. Selecting CUDA returns an explicit unavailable response rather than silently running on CPU. A separate GPU host is required for the CUDA pricing container.

The FIX order ticket remains a simulation and is not connected to a broker or exchange. Live market quotes and Monte Carlo estimates do not constitute trade execution.

## Health checks

- `/healthz` — Render process health
- `/api/market-data` — available symbols and provider configuration
- `/api/pricing` — pricing backend health
