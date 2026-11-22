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

- **BTC/USDT:** works without a provider API key through Binance Spot public WebSocket streams.
- **AAPL, MSFT, GOOGL:** add `TWELVE_DATA_API_KEY` under the Render service's Environment settings if your Twelve Data plan has access to those symbols. Keep the key server-side; do not put it in `index.html`.

## Pricing and compute

The built-in JavaScript Monte Carlo CPU fallback runs on the Render service. The default fallback cap is 10 million paths and can be changed with `PRICING_FALLBACK_MAX_PATHS`.

CUDA is not included in this free deployment. Selecting CUDA returns an explicit unavailable response rather than silently running on CPU. A separate GPU host is required for the CUDA pricing container.

The FIX order ticket remains a simulation and is not connected to a broker or exchange. Live market quotes and Monte Carlo estimates do not constitute trade execution.

## Health checks

- `/healthz` — Render process health
- `/api/market-data` — available symbols and provider configuration
- `/api/pricing` — pricing backend health
