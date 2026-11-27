import crypto from "node:crypto";
import { getMemoryStore, extractUserId } from "./store.js";
import { getDatabaseStatus } from "../db/client.js";

function generateMt5EaSource(bridgeToken, baseUrl) {
  return `//+------------------------------------------------------------------+
//| UltraLOB_CopyBridge.mq5                                          |
//| Connects MetaTrader 5 / Exness Terminal to UltraLOB Web Engine   |
//| NOTE: Use UltraLOB_Bridge_EA.mq5 (/mt5/Experts) for full         |
//| PostgreSQL demo-risk enforcement & OrderCheck validation.        |
//+------------------------------------------------------------------+
#property copyright "UltraLOB"
#property version   "1.10"
#include <Trade\\Trade.mqh>

input string InpServerUrl   = "${baseUrl || "https://ultralob.onrender.com"}";
input string InpBridgeToken = "${bridgeToken}";
input double InpRiskPct     = 0.50;
input int    InpPollSeconds = 3;

CTrade trade;

int OnInit() {
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO) {
      Print("UltraLOB: Non-demo account blocked in Phase 1 build.");
      return(INIT_FAILED);
   }
   EventSetTimer(InpPollSeconds);
   Print("UltraLOB MT5/Exness Bridge initialized (DEMO ONLY). Polling: ", InpServerUrl);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) {
   EventKillTimer();
}

void OnTimer() {
   string url = InpServerUrl + "/api/broker/mt5/signals?token=" + InpBridgeToken;
   string headers = "Content-Type: application/json\\r\\n";
   char post[], result[];
   string resHeaders;
   int res = WebRequest("GET", url, headers, 3000, post, result, resHeaders);
   if(res == 200) {
      string body = CharArrayToString(result);
      Print("UltraLOB Signal Poll OK: ", body);
   }
}
`;
}

function maskSecret(value) {
  const s = String(value || "");
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "*".repeat(Math.min(8, s.length - 4)) + s.slice(-2);
}

export default async function brokerHandler(request, response) {
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

  // Download MQL5 Expert Advisor file for MT5 / Exness Desktop Terminal
  if (request.method === "GET" && subPath === "/mt5/ea") {
    const existing = mem.brokers.get(userId);
    const token = existing?.bridgeToken || ("ulb-" + crypto.randomBytes(8).toString("hex"));
    const origin = `${request.protocol || "https"}://${request.get?.("host") || "ultralob.onrender.com"}`;
    const source = generateMt5EaSource(token, origin);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="UltraLOB_CopyBridge.mq5"');
    return response.status(200).send(source);
  }

  if (request.method === "GET" && subPath === "/status") {
    const conn = mem.brokers.get(userId) || null;
    const dbStatus = getDatabaseStatus();
    if (!conn) {
      return response.status(200).json({
        connected: false,
        broker: null,
        execution_bridge: {
          postgres_configured: dbStatus.configured,
          endpoint: "/api/execution",
          environment: "DEMO_ONLY"
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
        environment: "DEMO_ONLY"
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
        error: "Live real-money broker execution is locked in Phase 1. Only DEMO accounts are permitted.",
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
        verificationNote = "Paired in DEMO EA Bridge mode. Confirm terminal heartbeat via UltraLOB_Bridge_EA.mq5.";
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
      connectedAt: new Date().toISOString(),
      status: "connected"
    };

    // Never persist raw password or api_secret
    mem.brokers.set(userId, connection);

    return response.status(200).json({ connected: true, broker: connection });
  }

  if (request.method === "POST" && subPath === "/disconnect") {
    mem.brokers.delete(userId);
    return response.status(200).json({ connected: false, broker: null });
  }

  return response.status(404).json({ error: "Broker endpoint not found." });
}
