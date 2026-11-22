import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pricingHandler from "./pricing.js";
import WebSocket, { WebSocketServer } from "ws";
import {
  LIVE_SYMBOLS,
  EQUITY_SYMBOLS,
  CRYPTO_SYMBOLS,
  normalizeSymbols,
  normalizeTwelveDataMessage,
  normalizeBinanceTradeMessage,
  normalizeBinanceBookTickerMessage
} from "../lib/market-data.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 1024 });
const activeClients = new Set();
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
        provider: "Binance Spot",
        configured: true,
        symbols: CRYPTO_SYMBOLS,
        authentication_required: false
      }
    },
    note: "BTCUSDT uses Binance Spot public streams. US equities use Twelve Data when configured."
  });
}

if (process.env.ULTRALOB_RENDER_MODE === "true") {
  // This single persistent Node process serves the dashboard and both APIs.
  app.use(express.json({ limit: "64kb" }));
  app.all("/api/pricing", (request, response) => pricingHandler(request, response));

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dashboardFile = path.join(projectRoot, "index.html");
  app.get(["/", "/terminal", "/fix_trading_terminal.html"], (_request, response) => {
    response.sendFile(dashboardFile);
  });
  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok", service: "ultralob" });
  });
  app.get("/api/market-data", (_request, response) => sendMarketDataHealth(response));
  app.use((_request, response) => response.status(404).json({ error: "Not found" }));
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

  // Public Binance Spot streams make BTCUSDT available without an API key.
  if (cryptoSymbols.includes("BTCUSDT") && process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS !== "true") {
    const streams = ["btcusdt@trade", "btcusdt@bookTicker"];
    // Port 443 is friendlier to hosted environments and is an official Binance
    // Spot market-stream endpoint. It carries the same public combined streams.
    const binanceUrl = "wss://stream.binance.com:443/stream?streams=" + streams.join("/");
    console.info("[market-data] opening Binance Spot public stream");
    const binance = new WebSocket(binanceUrl, { handshakeTimeout: 15000 });
    upstreams.add(binance);

    binance.on("open", () => {
      console.info("[market-data] Binance Spot stream connected");
      send(client, {
        event: "gateway",
        status: "connected",
        provider: "Binance Spot",
        symbols: ["BTCUSDT"],
        message: "Binance Spot connected · waiting for BTCUSDT trades and best-bid/ask updates."
      });
    });

    binance.on("message", (raw) => {
      let decoded;
      try {
        decoded = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Binance combined-stream responses wrap the original event in the data property.
      const message = decoded && typeof decoded === "object" && decoded.data
        ? decoded.data
        : decoded;
      const trade = normalizeBinanceTradeMessage(message);
      if (trade) {
        send(client, trade);
        return;
      }
      const book = normalizeBinanceBookTickerMessage(message);
      if (book) {
        send(client, book);
      }
    });

    binance.on("error", (error) => {
      console.error("[market-data] Binance Spot upstream error:", error.message || error);
      send(client, {
        event: "error",
        code: "CRYPTO_UPSTREAM_ERROR",
        provider: "Binance Spot",
        message: error.message || "Could not connect to Binance Spot."
      });
      closeClientForReconnect("Binance Spot connection failed; retrying the live market feed.");
    });

    binance.on("close", (code, reason) => {
      if (client.readyState === WebSocket.OPEN) {
        closeClientForReconnect(
          reason.toString() || "Binance Spot closed the stream; reconnecting."
        );
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
        message: "BTCUSDT is available through Binance Spot. Add TWELVE_DATA_API_KEY to enable US equity ticks."
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
