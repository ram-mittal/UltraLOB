import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pricingHandler from "./pricing.js";
import marketHistoryHandler from "./market-history.js";
import { createExecutionRouter } from "../execution/router.js";
import { PostgresExecutionStore } from "../execution/postgres-store.js";
import strategiesHandler from "./strategies.js";
import authHandler from "./auth.js";
import brokerHandler from "./broker.js";
import copyTradingHandler from "./copy-trading.js";
import portfolioHandler from "./portfolio.js";
import researchHandler from "./research.js";
import aiHandler from "./ai.js";
import institutionalHandler from "./institutional.js";
import WebSocket, { WebSocketServer } from "ws";
import { getDatabaseStatus } from "../db/client.js";
import { assertJwtSecretConfigured, ensureDbReady, resolveAuthContext, query } from "./store.js";
import { authorizeRequest } from "./security.js";
import {
  LIVE_SYMBOLS,
  EQUITY_SYMBOLS,
  CRYPTO_SYMBOLS,
  normalizeSymbols,
  normalizeTwelveDataMessage
} from "../lib/market-data.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 1024 });
const activeClients = new Set();
const executionStore = process.env.DATABASE_URL
  ? new PostgresExecutionStore({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true"
    })
  : null;
const MAX_LOCAL_CONNECTIONS = Math.max(
  1,
  Math.min(3, Number.parseInt(process.env.MARKET_DATA_MAX_CONNECTIONS || "1", 10) || 1)
);

function send(client, payload) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

function normalizeHost(value) {
  if (!value) return "";
  const candidate = String(value).split(",")[0].trim();
  try {
    return new URL(candidate.includes("://") ? candidate : "https://" + candidate).host.toLowerCase();
  } catch {
    return "";
  }
}

function requestOriginAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    if (!["https:", "http:"].includes(parsedOrigin.protocol)) return false;
    const allowedHosts = new Set([
      normalizeHost(request.headers["x-forwarded-host"]),
      normalizeHost(request.headers.host),
      normalizeHost(process.env.RENDER_EXTERNAL_HOSTNAME)
    ].filter(Boolean));
    const explicitOrigins = String(process.env.ALLOWED_WS_ORIGINS || "")
      .split(",").map((item) => item.trim()).filter(Boolean);
    if (explicitOrigins.includes(parsedOrigin.origin)) return true;
    return allowedHosts.has(parsedOrigin.host.toLowerCase());
  } catch {
    return false;
  }
}

function sendMarketDataHealth(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  return response.status(200).json({
    status: "ok",
    configured: true,
    symbols: LIVE_SYMBOLS,
    maxSymbols: LIVE_SYMBOLS.length,
    transport: "websocket",
    providers: {
      equities: {
        provider: "Twelve Data",
        configured: Boolean(process.env.TWELVE_DATA_API_KEY),
        symbols: EQUITY_SYMBOLS
      },
      crypto: {
        provider: "Kraken Spot",
        market_symbol: "BTC/USD",
        configured: true,
        symbols: CRYPTO_SYMBOLS,
        authentication_required: false
      }
    },
    note: "BTCUSDT is mapped to Kraken Spot BTC/USD public market data. US equities use Twelve Data when configured."
  });
}

if (process.env.ULTRALOB_RENDER_MODE === "true") {
  if (!process.env.NODE_TEST_CONTEXT && process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS !== "true") {
    assertJwtSecretConfigured();
  }
  // This single persistent Node process serves the SPA, APIs, and WebSocket feeds.
  app.use(express.json({ limit: "2mb" }));

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  // --- Static Assets ---
  app.use("/public", express.static(path.join(projectRoot, "public"), {
    maxAge: "1h",
    immutable: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".js")) res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    }
  }));

  // --- API Routes ---
  app.all("/api/pricing", (request, response) => pricingHandler(request, response));
  app.get("/api/market-data", (_request, response) => sendMarketDataHealth(response));
  app.get("/api/market-history", (request, response) => marketHistoryHandler(request, response));
  app.get("/api/strategies/:id", (request, response) => strategiesHandler(request, response));
  app.all("/api/strategies", (request, response) => strategiesHandler(request, response));
  app.use("/api/auth", (request, response) => authHandler(request, response));
  app.use("/api/broker", (request, response) => brokerHandler(request, response, { executionStore }));
  app.use("/api/copy-trading", (request, response) => copyTradingHandler(request, response, { executionStore }));
  app.use("/api/portfolio", (request, response) => portfolioHandler(request, response));
  app.use("/api/research", (request, response) => researchHandler(request, response));
  app.use("/api/ai", (request, response) => aiHandler(request, response, { executionStore }));
  app.use("/api/institutional", (request, response) => institutionalHandler(request, response, { executionStore }));

  // --- Health Check & Institutional System Telemetry ---
  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok", service: "ultralob" });
  });

  app.get("/api/system/status", async (_request, response) => {
    await ensureDbReady().catch(() => false);
    const db = getDatabaseStatus();
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      platform: "UltraLOB — Institutional Strategy Allocation & Risk Infrastructure",
      phase: "Phases 1–6 Complete (Quant Registry, Research Backtester, MT5 Demo Bridge, Portfolio/Risk Engine, 7-Engine AI, Institutional Governance)",
      database: db,
      execution: {
        environment: "DEMO_ONLY",
        live_execution_enabled: false,
        postgres_configured: Boolean(executionStore)
      },
      market_feeds: {
        btc_usd: { provider: "Kraken Spot", status: "LIVE", origin: "REAL_MARKET" },
        us_equities: { provider: "Twelve Data", configured: Boolean(process.env.TWELVE_DATA_API_KEY), origin: "REAL_MARKET" },
        xauusd: {
          provider: Boolean(process.env.TWELVE_DATA_API_KEY) ? "Twelve Data (XAU/USD) + MT5 CSV" : "MT5 Broker CSV / Twelve Data",
          status: Boolean(process.env.TWELVE_DATA_API_KEY) ? "CONFIGURED" : "AWAITING_API_KEY_OR_CSV",
          origin: Boolean(process.env.TWELVE_DATA_API_KEY) ? "REAL_MARKET" : "AWAITING_DATA"
        }
      },
      ai_engine: {
        mode: "ADVISORY_7_ENGINES",
        autonomous_override_permitted: false
      }
    });
  });

  // --- MT5 Execution Bridge & Risk Manager Router ---
  app.use("/api/execution", createExecutionRouter({
    store: executionStore,
    adminKey: process.env.ULTRALOB_EXECUTION_ADMIN_KEY || "",
    liveExecutionEnabled: false,
    resolveMonitorAccess: async (req) => {
      const dbAvail = await ensureDbReady().catch(() => false);
      const auth = await resolveAuthContext(req, dbAvail);
      if (!auth.authenticated) {
        return { authenticated: false, status: 401, code: "AUTH_REQUIRED", error: "Authentication required to access execution monitor." };
      }
      const gate = authorizeRequest(auth, ["execution:read", "portfolio:read"], {
        isMutation: false,
        apiKeyScope: "execution:read"
      });
      if (!gate.ok) {
        return { authenticated: true, forbidden: true, code: gate.code, error: gate.error };
      }
      const ownedConnectorIds = new Set();
      if (dbAvail && /^[0-9a-f-]{36}$/i.test(auth.userId)) {
        const res = await query(
          `SELECT execution_connector_id FROM broker_integrations WHERE user_id = $1 AND execution_connector_id IS NOT NULL`,
          [auth.userId]
        ).catch(() => ({ rows: [] }));
        for (const r of res.rows) ownedConnectorIds.add(r.execution_connector_id);
      }
      return {
        authenticated: true,
        userId: auth.userId,
        role: auth.role,
        ownedConnectorIds
      };
    }
  }));

  // --- Legacy Classic Terminal ---
  app.get(["/legacy", "/fix_trading_terminal.html"], (_request, response) => {
    response.sendFile(path.join(projectRoot, "terminal-legacy.html"));
  });

  // --- SPA Routes: serve index.html ---
  const spaFile = path.join(projectRoot, "index.html");
  app.get([
    "/", "/overview", "/marketplace", "/portfolio", "/ai", "/markets",
    "/risk", "/copy-trading", "/broker", "/execution", "/research",
    "/reports", "/settings", "/admin", "/dashboard", "/terminal", "/auth", "/strategy/:id"
  ], (_request, response) => {
    response.sendFile(spaFile);
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });
} else {
  // Vercel routes this module as the /api/market-data function.
  app.use((_request, response) => sendMarketDataHealth(response));
}

wss.on("connection", (client, request) => {
  if (!requestOriginAllowed(request)) {
    console.warn("[market-data] rejected WebSocket origin", {
      origin: request.headers.origin || null,
      host: request.headers.host || null,
      forwardedHost: request.headers["x-forwarded-host"] || null,
      renderExternalHostname: process.env.RENDER_EXTERNAL_HOSTNAME || null
    });
    send(client, { event: "error", code: "ORIGIN_NOT_ALLOWED", message: "Connect from the UltraLOB website origin. Check Render hostname/origin configuration." });
    client.close(1008, "Origin not allowed");
    return;
  }

  if (activeClients.size >= MAX_LOCAL_CONNECTIONS) {
    send(client, {
      event: "error",
      code: "CONNECTION_LIMIT",
      message: "The market feed connection limit is reached. Close other UltraLOB tabs and reconnect."
    });
    client.close(1013, "Connection limit reached");
    return;
  }

  let symbols;
  try {
    const requestUrl = new URL(request.url, "https://ultralob.local");
    symbols = normalizeSymbols(requestUrl.searchParams.get("symbols"));
  } catch (error) {
    send(client, { event: "error", code: "INVALID_SYMBOLS", message: error.message });
    client.close(1008, "Invalid symbols");
    return;
  }

  const equitySymbols = symbols.filter((symbol) => EQUITY_SYMBOLS.includes(symbol));
  const cryptoSymbols = symbols.filter((symbol) => CRYPTO_SYMBOLS.includes(symbol));
  const upstreams = new Set();
  const timers = new Set();
  let cleanedUp = false;
  let providerFailureClosing = false;

  activeClients.add(client);
  console.info("[market-data] browser client connected:", symbols.join(","));
  send(client, {
    event: "gateway",
    status: "connecting",
    provider: "UltraLOB Market Gateway",
    symbols,
    providers: {
      equities: equitySymbols.length > 0,
      crypto: cryptoSymbols.length > 0
    }
  });

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    activeClients.delete(client);
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    for (const upstream of upstreams) {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        try { upstream.close(); } catch { /* already closed */ }
      }
    }
    upstreams.clear();
  };

  const closeClientForReconnect = (reason) => {
    if (providerFailureClosing || client.readyState !== WebSocket.OPEN) return;
    providerFailureClosing = true;
    send(client, {
      event: "gateway",
      status: "disconnected",
      message: reason || "Market provider connection closed; reconnecting."
    });
    client.close(1012, "Market provider disconnected");
  };

  // Kraken's public Spot WebSocket v2 provides live BTC/USD ticker and trades.
  if (cryptoSymbols.includes("BTCUSDT") && process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS !== "true") {
    const kraken = new WebSocket("wss://ws.kraken.com/v2", { handshakeTimeout: 15000 });
    upstreams.add(kraken);

    kraken.on("open", () => {
      console.info("[market-data] Kraken Spot WebSocket connected");
      send(client, {
        event: "gateway",
        status: "connected",
        provider: "Kraken Spot",
        symbols: ["BTCUSDT"],
        market_symbol: "BTC/USD",
        message: "Kraken Spot connected · waiting for BTC/USD trades and best-bid/ask updates."
      });
      kraken.send(JSON.stringify({
        method: "subscribe",
        params: { channel: "ticker", symbol: ["BTC/USD"], event_trigger: "bbo", snapshot: true }
      }));
      kraken.send(JSON.stringify({
        method: "subscribe",
        params: { channel: "trade", symbol: ["BTC/USD"], snapshot: false }
      }));
    });

    kraken.on("message", (raw) => {
      let decoded;
      try { decoded = JSON.parse(raw.toString()); } catch { return; }
      if (decoded?.success === false) {
        send(client, {
          event: "error",
          code: "CRYPTO_SUBSCRIPTION_ERROR",
          provider: "Kraken Spot",
          message: decoded.error || "Kraken rejected the BTC/USD subscription."
        });
        return;
      }
      if (!Array.isArray(decoded?.data)) return;
      const toTimestamp = (value) => {
        const parsed = Date.parse(value || "");
        return Number.isFinite(parsed) ? parsed : Date.now();
      };

      if (decoded.channel === "ticker") {
        for (const quote of decoded.data) {
          if (quote.symbol !== "BTC/USD") continue;
          const last = Number(quote.last);
          if (last > 0) {
            send(client, {
              event: "price",
              provider: "Kraken Spot",
              symbol: "BTCUSDT",
              price: last,
              currency: "USD",
              exchange: "KRAKEN",
              timestamp: toTimestamp(quote.timestamp)
            });
          }
          const bid = Number(quote.bid);
          const ask = Number(quote.ask);
          if (bid > 0 && ask >= bid) {
            send(client, {
              event: "book",
              provider: "Kraken Spot",
              symbol: "BTCUSDT",
              bid,
              bid_quantity: Number(quote.bid_qty) || 0,
              ask,
              ask_quantity: Number(quote.ask_qty) || 0,
              timestamp: toTimestamp(quote.timestamp)
            });
          }
        }
      } else if (decoded.channel === "trade") {
        for (const trade of decoded.data) {
          if (trade.symbol !== "BTC/USD") continue;
          send(client, {
            event: "price",
            provider: "Kraken Spot",
            symbol: "BTCUSDT",
            price: Number(trade.price),
            currency: "USD",
            exchange: "KRAKEN",
            timestamp: toTimestamp(trade.timestamp),
            trade_id: trade.trade_id ?? null,
            trade_quantity: Number(trade.qty) || 0,
            buyer_is_maker: trade.side === "sell"
          });
        }
      }
    });

    kraken.on("error", (error) => {
      console.error("[market-data] Kraken Spot upstream error:", error.message || error);
      send(client, {
        event: "error",
        code: "CRYPTO_UPSTREAM_ERROR",
        provider: "Kraken Spot",
        message: error.message || "Could not connect to Kraken Spot."
      });
      closeClientForReconnect("Kraken Spot connection failed; retrying the live market feed.");
    });

    kraken.on("close", (code, reason) => {
      if (client.readyState === WebSocket.OPEN) {
        closeClientForReconnect(reason.toString() || "Kraken Spot closed the stream; reconnecting.");
      }
      cleanup();
    });
  }

  // US equities remain on Twelve Data. Missing/denied equity access does not
  // stop the independent BTCUSDT public stream.
  if (equitySymbols.length > 0 && process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS !== "true") {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      console.warn("[market-data] TWELVE_DATA_API_KEY is not set; equity streaming is disabled");
      send(client, {
        event: "notice",
        code: "EQUITIES_KEY_MISSING",
        provider: "Twelve Data",
        message: "BTCUSDT maps to Kraken Spot BTC/USD public data. Add TWELVE_DATA_API_KEY to enable US equity ticks."
      });
    } else {
      const upstreamUrl = "wss://ws.twelvedata.com/v1/quotes/price?apikey=" + encodeURIComponent(apiKey);
      const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 12000 });
      upstreams.add(upstream);

      upstream.on("open", () => {
        console.info("[market-data] Twelve Data WebSocket connected; subscribing to", equitySymbols.join(","));
        send(client, {
          event: "gateway",
          status: "connected",
          provider: "Twelve Data",
          symbols: equitySymbols,
          message: "Twelve Data connected. Waiting for equity subscription confirmation and market ticks."
        });
        upstream.send(JSON.stringify({
          action: "subscribe",
          params: { symbols: equitySymbols.join(",") }
        }));

        const heartbeat = setInterval(() => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(JSON.stringify({ action: "heartbeat" }));
          }
        }, 10000);
        heartbeat.unref?.();
        timers.add(heartbeat);
      });

      upstream.on("message", (raw) => {
        let decoded;
        try {
          decoded = JSON.parse(raw.toString());
        } catch {
          return;
        }

        const messages = Array.isArray(decoded) ? decoded : [decoded];
        for (const message of messages) {
          const tick = normalizeTwelveDataMessage(message);
          if (tick) {
            send(client, tick);
          } else if (message && typeof message === "object") {
            if (message.event === "error") {
              console.error("[market-data] Twelve Data provider error:", message.message || message.detail || message.code || "unknown provider error");
              send(client, {
                event: "error",
                code: "EQUITY_PROVIDER_ERROR",
                provider: "Twelve Data",
                message: message.message || message.detail || "Twelve Data returned a provider error.",
                providerCode: message.code || null
              });
            } else if (message.event === "subscribe-status") {
              send(client, {
                event: "subscription",
                provider: "Twelve Data",
                status: message.status || "unknown",
                success: message.success || [],
                fails: message.fails || [],
                symbols: equitySymbols
              });
            } else if (message.event === "status") {
              send(client, { event: "provider-status", provider: "Twelve Data", status: message.status || "ok" });
            }
          }
        }
      });

      upstream.on("error", (error) => {
        console.error("[market-data] Twelve Data upstream error:", error.message || error);
        send(client, {
          event: "error",
          code: "EQUITY_UPSTREAM_ERROR",
          provider: "Twelve Data",
          message: error.message || "Could not connect to Twelve Data."
        });
      });

      upstream.on("close", (code, reason) => {
        if (client.readyState === WebSocket.OPEN) {
          send(client, {
            event: "provider-status",
            provider: "Twelve Data",
            status: "disconnected",
            code,
            message: reason.toString() || "Twelve Data closed its equity stream."
          });
        }
        upstreams.delete(upstream);
        if (cryptoSymbols.length === 0) closeClientForReconnect("Equity market feed disconnected; reconnecting.");
      });
    }
  }

  // Render Free keeps an active WebSocket awake when it receives client messages.
  // The browser sends a lightweight ping every 60 seconds while the feed is connected.
  client.on("message", (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message && message.event === "ping") {
      send(client, { event: "heartbeat", timestamp: Date.now() });
    }
  });

  client.on("close", cleanup);
  client.on("error", cleanup);
});

export default server;
