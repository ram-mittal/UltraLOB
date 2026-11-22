import { createServer } from "node:http";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import { LIVE_SYMBOLS, normalizeSymbols, normalizeTwelveDataMessage } from "../lib/market-data.js";

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

function requestOriginAllowed(request) {
  const origin = request.headers.origin;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

app.use((request, response) => {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.status(200).json({
    provider: "Twelve Data",
    configured: Boolean(process.env.TWELVE_DATA_API_KEY),
    symbols: LIVE_SYMBOLS,
    maxSymbols: LIVE_SYMBOLS.length,
    transport: "websocket",
    note: "Market prices are delivered only when the provider emits a tick."
  });
});

wss.on("connection", (client, request) => {
  if (!requestOriginAllowed(request)) {
    send(client, { event: "error", code: "ORIGIN_NOT_ALLOWED", message: "Connect from the UltraLOB website origin." });
    client.close(1008, "Origin not allowed");
    return;
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    send(client, {
      event: "error",
      code: "CONFIG_MISSING",
      message: "Add TWELVE_DATA_API_KEY to Vercel Environment Variables, then redeploy."
    });
    client.close(1011, "Market-data provider is not configured");
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

  activeClients.add(client);
  send(client, {
    event: "gateway",
    status: "connecting",
    provider: "Twelve Data",
    symbols
  });

  const upstreamUrl = "wss://ws.twelvedata.com/v1/quotes/price?apikey=" + encodeURIComponent(apiKey);
  const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 12000 });
  let heartbeat = null;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    activeClients.delete(client);
    if (heartbeat) clearInterval(heartbeat);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      try { upstream.close(); } catch { /* already closed */ }
    }
  };

  upstream.on("open", () => {
    send(client, {
      event: "gateway",
      status: "connected",
      provider: "Twelve Data",
      symbols,
      message: "Provider connected. Waiting for subscription confirmation and market ticks."
    });
    upstream.send(JSON.stringify({
      action: "subscribe",
      params: { symbols: symbols.join(",") }
    }));

    heartbeat = setInterval(() => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ action: "heartbeat" }));
      }
    }, 10000);
    heartbeat.unref?.();
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
          send(client, {
            event: "error",
            code: "PROVIDER_ERROR",
            message: message.message || message.detail || "Twelve Data returned a provider error.",
            providerCode: message.code || null
          });
        } else if (message.event === "subscribe-status") {
          send(client, {
            event: "subscription",
            status: message.status || "unknown",
            success: message.success || [],
            fails: message.fails || [],
            symbols
          });
        } else if (message.event === "status") {
          send(client, { event: "provider-status", status: message.status || "ok" });
        }
      }
    }
  });

  upstream.on("error", (error) => {
    send(client, {
      event: "error",
      code: "UPSTREAM_CONNECTION_ERROR",
      message: error.message || "Could not connect to Twelve Data."
    });
  });

  upstream.on("close", (code, reason) => {
    if (client.readyState === WebSocket.OPEN) {
      send(client, {
        event: "gateway",
        status: "disconnected",
        code,
        message: reason.toString() || "The market-data provider closed the connection."
      });
      client.close(1012, "Provider connection closed");
    }
    cleanup();
  });

  client.on("close", cleanup);
  client.on("error", cleanup);
});

export default server;
