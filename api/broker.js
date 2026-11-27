import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMemoryStore, extractUserId } from "./store.js";
import { getDatabaseStatus } from "../db/client.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EA_SOURCE_PATH = path.join(PROJECT_ROOT, "mt5", "Experts", "UltraLOB_Bridge_EA.mq5");

function loadProductionEaSource(baseUrl, connectorId = "") {
  let raw = fs.readFileSync(EA_SOURCE_PATH, "utf8");
  if (baseUrl) {
    raw = raw.replace(
      /input string InpApiBaseUrl = "[^"]*";/,
      `input string InpApiBaseUrl = "${baseUrl}";`
    );
  }
  if (connectorId) {
    raw = raw.replace(
      /input string InpConnectorId = "[^"]*";/,
      `input string InpConnectorId = "${connectorId}";`
    );
  }
  return raw;
}

function maskSecret(value) {
  const s = String(value || "");
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "*".repeat(Math.min(8, s.length - 4)) + s.slice(-2);
}

export default async function brokerHandler(request, response, { executionStore = null } = {}) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/broker/, "").split("?")[0];
  const userId = extractUserId(request);
  const mem = getMemoryStore();

  // Public MT5 EA Signal Queue Polling endpoint (authenticated by bridgeToken)
  if (request.method === "GET" && subPath === "/mt5/signals") {
    const token = String(request.query?.token || request.headers["x-bridge-token"] || "").trim();
    if (!token) {
      return response.status(401).json({ error: "Bridge token is required." });
    }
    const matchingSignals = mem.mt5Signals.filter(
      (s) => s.bridgeToken === token && s.status === "pending"
    );
    const ack = String(request.query?.ack || "false") === "true";
    if (ack && matchingSignals.length > 0) {
      for (const sig of matchingSignals) sig.status = "dispatched";
    }
    return response.status(200).json({
      status: "ok",
      environment: "DEMO_ONLY",
      count: matchingSignals.length,
      signals: matchingSignals,
      timestamp: Date.now()
    });
  }

  // Download production MQL5 Expert Advisor (mt5/Experts/UltraLOB_Bridge_EA.mq5)
  if (request.method === "GET" && subPath === "/mt5/ea") {
    const existing = mem.brokers.get(userId);
    const origin = `${request.protocol || "https"}://${request.get?.("host") || "ultralob.onrender.com"}`;
    const source = loadProductionEaSource(origin, existing?.executionConnectorId || "");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="UltraLOB_Bridge_EA.mq5"');
    return response.status(200).send(source);
  }

  if (request.method === "GET" && subPath === "/status") {
    const conn = mem.brokers.get(userId) || null;
    const dbStatus = getDatabaseStatus();
    let executionConnectors = [];
    if (executionStore) {
      try {
        await executionStore.initialize();
        executionConnectors = await executionStore.listConnectors();
      } catch {}
    }

    if (!conn) {
      return response.status(200).json({
        connected: false,
        broker: null,
        execution_bridge: {
          postgres_configured: dbStatus.configured,
          endpoint: "/api/execution",
          environment: "DEMO_ONLY",
          connectors_count: executionConnectors.length
        }
      });
    }
    const pendingCount = mem.mt5Signals.filter(
      (s) => s.bridgeToken === conn.bridgeToken && s.status === "pending"
    ).length;
    return response.status(200).json({
      connected: true,
      broker: {
        ...conn,
        pendingSignals: pendingCount
      },
      execution_bridge: {
        postgres_configured: dbStatus.configured,
        endpoint: "/api/execution",
        environment: "DEMO_ONLY",
        connectors_count: executionConnectors.length
      }
    });
  }

  if (request.method === "POST" && subPath === "/connect") {
    const { type, server, login, password, account_id, api_key, api_secret, mode, environment = "DEMO", metaapi_token, metaapi_account_id } = request.body || {};
    const brokerType = String(type || "").toLowerCase();
    if (!["mt5", "exness"].includes(brokerType)) {
      return response.status(400).json({ error: "Broker type must be 'mt5' or 'exness'." });
    }
    if (String(environment).toUpperCase() === "LIVE") {
      return response.status(403).json({
        error: "Live real-money broker execution is locked. Only DEMO accounts are permitted.",
        code: "DEMO_ONLY_BUILD"
      });
    }

    let accountLabel = "";
    let serverLabel = "";
    let connectionMode = mode || "ea-bridge-demo";
    let upstreamVerified = false;
    let verificationNote = "";

    if (brokerType === "mt5") {
      if (!server || !login || !password) {
        return response.status(400).json({ error: "MT5 Server, Account Number, and Password are required." });
      }
      accountLabel = String(login).trim();
      serverLabel = String(server).trim();

      if (metaapi_token && metaapi_account_id) {
        try {
          const check = await fetch(
            `https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${encodeURIComponent(metaapi_account_id)}/account-information`,
            { headers: { "auth-token": metaapi_token }, signal: AbortSignal.timeout(8000) }
          );
          if (check.ok) {
            upstreamVerified = true;
            connectionMode = "metaapi-demo";
            verificationNote = "Verified via MetaApi Cloud.";
          }
        } catch {
          verificationNote = "MetaApi unreachable; paired in MT5 Demo EA Bridge queue mode.";
        }
      }
      if (!verificationNote) {
        verificationNote = "Paired in DEMO EA Bridge mode. Attach UltraLOB_Bridge_EA.mq5 to your MT5 demo terminal.";
      }
    } else {
      if (!account_id || !api_key || !api_secret) {
        return response.status(400).json({ error: "Exness Account ID, API Key, and API Secret are required." });
      }
      accountLabel = String(account_id).trim();
      serverLabel = String(server || "Exness-MT5Trial").trim();
      verificationNote = "Paired with Exness MT5 Demo Bridge queue (no live capital custody).";
    }

    const bridgeToken = "ulb-" + crypto.randomBytes(10).toString("hex");
    let executionConnectorId = null;
    let executionAccessToken = null;

    // Automatically register an execution bridge connector when PostgreSQL is active
    if (executionStore) {
      try {
        await executionStore.initialize();
        executionConnectorId = crypto.randomUUID();
        executionAccessToken = "ulb_demo_" + crypto.randomBytes(24).toString("base64url");
        const tokenHash = crypto.createHash("sha256").update(executionAccessToken, "utf8").digest("hex");
        await executionStore.createConnector({
          id: executionConnectorId,
          token_hash: tokenHash,
          label: `${brokerType.toUpperCase()} Demo (${accountLabel})`,
          strategy_ids: ["ul-01-gold-trend", "ul-02-liquidity-sweep", "ul-03-volume-profile"],
          allowed_symbols: ["XAUUSD", "BTCUSD"],
          max_trade_risk_pct: 0.5,
          max_daily_loss_pct: 2.0,
          max_drawdown_pct: 8.0,
          max_spread_points: 100,
          max_open_positions: 2,
          max_deviation_points: 20
        });
      } catch (err) {
        console.warn("[broker] execution store connector creation skipped:", err.message);
        executionConnectorId = null;
        executionAccessToken = null;
      }
    }

    const connection = {
      id: "brk-" + crypto.randomUUID().slice(0, 8),
      type: brokerType,
      name: brokerType === "mt5" ? "MetaTrader 5 (Demo)" : "Exness MT5 (Demo)",
      environment: "DEMO",
      data_origin: "DEMO_BROKER",
      account: accountLabel,
      server: serverLabel,
      credentialHint: maskSecret(brokerType === "mt5" ? password : api_key),
      mode: connectionMode,
      upstreamVerified,
      note: verificationNote,
      bridgeToken,
      executionConnectorId,
      connectedAt: new Date().toISOString(),
      status: "connected"
    };

    // Never persist raw password or api_secret
    mem.brokers.set(userId, connection);

    return response.status(200).json({
      connected: true,
      broker: connection,
      execution_connector: executionConnectorId
        ? { id: executionConnectorId, access_token: executionAccessToken, notice: "Save this token for UltraLOB_Bridge_EA.mq5" }
        : null
    });
  }

  if (request.method === "POST" && subPath === "/disconnect") {
    mem.brokers.delete(userId);
    return response.status(200).json({ connected: false, broker: null });
  }

  return response.status(404).json({ error: "Broker endpoint not found." });
}
