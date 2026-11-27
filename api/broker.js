import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureDbReady,
  getMemoryStore,
  resolveAuthContext,
  sha256Hex,
  query
} from "./store.js";
import { getDatabaseStatus, recordAuditLog } from "../db/client.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EA_SOURCE_PATH = path.join(PROJECT_ROOT, "mt5", "Experts", "UltraLOB_Bridge_EA.mq5");
const EA_HEARTBEAT_TTL_MS = 90_000;

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
  if (!s) return "—";
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "*".repeat(Math.min(8, s.length - 4)) + s.slice(-2);
}

/**
 * Single source of truth for user broker verification & connection status.
 * `connected` is strictly true ONLY when upstream verification (live EA heartbeat
 * or verified MetaApi cloud response) has actually succeeded.
 */
export async function resolveUserBrokerStatus(userId, { executionStore = null, dbAvailable = false } = {}) {
  const mem = getMemoryStore();
  let record = null;

  if (dbAvailable && /^[0-9a-f-]{36}$/i.test(userId || "")) {
    try {
      const res = await query(
        `SELECT bi.*, ba.account_login, ba.balance, ba.equity, ba.currency
         FROM broker_integrations bi
         LEFT JOIN broker_accounts ba ON ba.integration_id = bi.id
         WHERE bi.user_id = $1 AND bi.status NOT IN ('DISCONNECTED','REVOKED')
         ORDER BY bi.updated_at DESC LIMIT 1`,
        [userId]
      );
      if (res.rows[0]) {
        const r = res.rows[0];
        const meta = r.metadata || {};
        record = {
          id: r.id,
          type: r.broker_type === "EXNESS_MT5" ? "exness" : "mt5",
          name: r.broker_type === "EXNESS_MT5" ? "Exness MT5 (Demo)" : "MetaTrader 5 (Demo)",
          environment: r.environment || "DEMO",
          account: r.account_login || r.account_label,
          server: r.server_name,
          mode: meta.mode || "ea_bridge",
          credentialHint: meta.credentialHint || null,
          upstreamVerified: Boolean(r.upstream_verified),
          verification_status: r.verification_status || "UNVERIFIED",
          note: meta.note || "",
          bridgeToken: meta.bridgeToken || null,
          executionConnectorId: r.execution_connector_id || null,
          connectedAt: r.created_at,
          account_snapshot: r.account_login
            ? { login: r.account_login, balance: r.balance, equity: r.equity, currency: r.currency }
            : null
        };
      }
    } catch (err) {
      console.warn("[broker] PostgreSQL integration read warning:", err.message);
    }
  }

  if (!record) {
    record = mem.brokers.get(userId) || null;
  }

  if (!record) {
    return {
      connected: false,
      paired: false,
      upstreamVerified: false,
      verification_status: "DISCONNECTED",
      broker: null
    };
  }

  // Recompute real upstream verification dynamically for EA bridges via live heartbeat telemetry
  let upstreamVerified = Boolean(record.upstreamVerified);
  let verificationStatus = record.verification_status || (upstreamVerified ? "VERIFIED" : "PENDING_EA_HEARTBEAT");
  let connector = null;

  if (record.mode === "ea_bridge" && executionStore && record.executionConnectorId) {
    try {
      await executionStore.initialize();
      connector = await executionStore.getConnector(record.executionConnectorId);
      const hbMs = connector?.last_heartbeat_at ? Date.parse(connector.last_heartbeat_at) : 0;
      const hbFresh = hbMs > 0 && (Date.now() - hbMs) <= EA_HEARTBEAT_TTL_MS;
      const isDemoEa = String(connector?.trade_mode || "").toUpperCase() === "DEMO";
      if (connector?.status === "ACTIVE" && connector?.terminal_connected && isDemoEa && hbFresh) {
        upstreamVerified = true;
        verificationStatus = "VERIFIED_EA_HEARTBEAT";
        record.account = connector.account_login || record.account;
        record.server = connector.account_server || record.server;
        record.account_snapshot = {
          login: connector.account_login,
          balance: connector.balance,
          equity: connector.equity,
          margin_free: connector.margin_free,
          currency: connector.account_currency || "USD"
        };
      } else {
        upstreamVerified = false;
        verificationStatus = connector?.last_heartbeat_at ? "STALE_EA_HEARTBEAT" : "PENDING_EA_HEARTBEAT";
      }
    } catch {
      upstreamVerified = false;
    }
  }

  const pendingCount = record.bridgeToken
    ? mem.mt5Signals.filter((s) => s.bridgeToken === record.bridgeToken && s.status === "pending").length
    : 0;

  return {
    connected: upstreamVerified,
    paired: true,
    upstreamVerified,
    verification_status: verificationStatus,
    broker: {
      ...record,
      upstreamVerified,
      verification_status: verificationStatus,
      connected: upstreamVerified,
      data_origin: upstreamVerified ? "DEMO_BROKER" : "AWAITING_VERIFICATION",
      status: upstreamVerified ? "connected" : "pending_ea_heartbeat",
      pendingSignals: pendingCount
    }
  };
}

export default async function brokerHandler(request, response, { executionStore = null } = {}) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/broker/, "").split("?")[0];
  const dbAvailable = await ensureDbReady().catch(() => false);
  const auth = await resolveAuthContext(request, dbAvailable);
  const userId = auth.userId;
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
    const current = await resolveUserBrokerStatus(userId, { executionStore, dbAvailable });
    const origin = `${request.protocol || "https"}://${request.get?.("host") || "ultralob.onrender.com"}`;
    const source = loadProductionEaSource(origin, current.broker?.executionConnectorId || "");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="UltraLOB_Bridge_EA.mq5"');
    return response.status(200).send(source);
  }

  if (request.method === "GET" && subPath === "/status") {
    const dbStatus = getDatabaseStatus();
    let executionConnectors = [];
    if (executionStore) {
      try {
        await executionStore.initialize();
        executionConnectors = await executionStore.listConnectors();
      } catch {}
    }

    const status = await resolveUserBrokerStatus(userId, { executionStore, dbAvailable });
    return response.status(200).json({
      connected: status.connected,
      paired: status.paired,
      upstreamVerified: status.upstreamVerified,
      verification_status: status.verification_status,
      broker: status.broker,
      execution_bridge: {
        postgres_configured: dbStatus.configured,
        endpoint: "/api/execution",
        environment: "DEMO_ONLY",
        connectors_count: executionConnectors.length
      }
    });
  }

  if (request.method === "POST" && subPath === "/connect") {
    if (!auth.authenticated) {
      return response.status(401).json({
        connected: false,
        upstreamVerified: false,
        error: "Authentication required to pair a broker bridge or verify an account.",
        code: "AUTH_REQUIRED"
      });
    }

    const {
      type,
      mode,
      server,
      login,
      account_id,
      password,
      api_key,
      api_secret,
      environment = "DEMO",
      metaapi_token,
      metaapi_account_id
    } = request.body || {};

    const brokerType = String(type || "mt5").toLowerCase();
    if (!["mt5", "exness"].includes(brokerType)) {
      return response.status(400).json({ error: "Broker type must be 'mt5' or 'exness'." });
    }
    if (String(environment).toUpperCase() === "LIVE") {
      return response.status(403).json({
        connected: false,
        upstreamVerified: false,
        error: "Live real-money broker execution is locked. Only DEMO accounts are permitted.",
        code: "DEMO_ONLY_BUILD"
      });
    }

    const reqMode = String(mode || (metaapi_token || metaapi_account_id ? "metaapi_demo" : "ea_bridge")).toLowerCase();

    // Explicitly refuse unimplemented direct broker credential modes (never accept unverified passwords/API keys)
    if (
      password ||
      api_key ||
      api_secret ||
      ["exness_api", "exness-api", "mt5_password", "direct_password"].includes(reqMode)
    ) {
      return response.status(501).json({
        connected: false,
        upstreamVerified: false,
        verification_status: "ADAPTER_NOT_IMPLEMENTED",
        code: "ADAPTER_NOT_IMPLEMENTED",
        error:
          "Direct MT5 password authentication and Exness REST API credential validation are not implemented in this build. Never submit broker passwords here; pair using mode='ea_bridge' (UltraLOB_Bridge_EA.mq5, zero password required) or verify via mode='metaapi_demo'."
      });
    }

    let accountLabel = String(account_id || login || "").trim();
    let serverLabel = String(server || (brokerType === "exness" ? "Exness-MT5Trial" : "MT5-Demo")).trim();
    let upstreamVerified = false;
    let verificationStatus = "PENDING_EA_HEARTBEAT";
    let connectionMode = "ea_bridge";
    let verificationNote = "";
    let metaApiSnapshot = null;

    if (reqMode === "metaapi_demo") {
      if (!metaapi_token || !metaapi_account_id) {
        return response.status(400).json({
          connected: false,
          upstreamVerified: false,
          error: "metaapi_token and metaapi_account_id are required for MetaApi Cloud verification."
        });
      }
      try {
        const check = await fetch(
          `https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${encodeURIComponent(metaapi_account_id)}/account-information`,
          { headers: { "auth-token": String(metaapi_token) }, signal: AbortSignal.timeout(8000) }
        );
        if (!check.ok) {
          return response.status(502).json({
            connected: false,
            upstreamVerified: false,
            verification_status: "METAAPI_VERIFICATION_FAILED",
            code: "UPSTREAM_VERIFICATION_FAILED",
            error: `MetaApi upstream verification returned HTTP ${check.status}. Broker connection was NOT established.`
          });
        }
        const acctInfo = await check.json();
        const acctType = String(acctInfo?.type || "").toUpperCase();
        if (acctType.includes("REAL") || acctType.includes("LIVE")) {
          return response.status(403).json({
            connected: false,
            upstreamVerified: false,
            code: "DEMO_ONLY_BUILD",
            error: "MetaApi reported a non-demo/real account. Only DEMO accounts are permitted."
          });
        }
        upstreamVerified = true;
        verificationStatus = "VERIFIED_METAAPI";
        connectionMode = "metaapi-demo";
        accountLabel = String(acctInfo?.login || accountLabel || metaapi_account_id);
        serverLabel = String(acctInfo?.server || serverLabel);
        verificationNote = "Account verified directly against MetaApi Cloud Demo endpoint.";
        metaApiSnapshot = {
          login: accountLabel,
          balance: Number(acctInfo?.balance ?? 0),
          equity: Number(acctInfo?.equity ?? 0),
          currency: acctInfo?.currency || "USD"
        };
      } catch (err) {
        return response.status(502).json({
          connected: false,
          upstreamVerified: false,
          verification_status: "METAAPI_UNREACHABLE",
          code: "UPSTREAM_VERIFICATION_FAILED",
          error: `Could not reach MetaApi upstream to verify account (${err.message}). Connection was NOT saved.`
        });
      }
    } else if (reqMode === "ea_bridge" || reqMode === "mt5_bridge") {
      if (!accountLabel) {
        return response.status(400).json({
          connected: false,
          upstreamVerified: false,
          error: "Demo account label / login ID (non-secret) is required to provision an MT5 EA bridge."
        });
      }
      connectionMode = "ea_bridge";
      upstreamVerified = false;
      verificationStatus = "PENDING_EA_HEARTBEAT";
      verificationNote =
        "EA Bridge connector provisioned. Status remains PENDING until UltraLOB_Bridge_EA.mq5 sends a verified DEMO heartbeat.";
    } else {
      return response.status(400).json({
        connected: false,
        upstreamVerified: false,
        error: "Unsupported connection mode. Use 'ea_bridge' or 'metaapi_demo'."
      });
    }

    const bridgeToken = "ulb-" + crypto.randomBytes(12).toString("hex");
    let executionConnectorId = null;
    let executionAccessToken = null;

    if (connectionMode === "ea_bridge" && executionStore) {
      try {
        await executionStore.initialize();
        executionConnectorId = crypto.randomUUID();
        executionAccessToken = "ulb_demo_" + crypto.randomBytes(24).toString("base64url");
        const tokenHash = sha256Hex(executionAccessToken);
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

    const integrationId = crypto.randomUUID();
    const dbBrokerType = brokerType === "exness" ? "EXNESS_MT5" : "MT5";
    const dbStatus = upstreamVerified ? "CONNECTED" : "PENDING_VERIFICATION";

    const connection = {
      id: integrationId,
      type: brokerType,
      name: brokerType === "mt5" ? "MetaTrader 5 (Demo)" : "Exness MT5 (Demo)",
      environment: "DEMO",
      data_origin: upstreamVerified ? "DEMO_BROKER" : "AWAITING_VERIFICATION",
      account: accountLabel,
      server: serverLabel,
      credentialHint: connectionMode === "metaapi-demo" ? maskSecret(metaapi_token) : null,
      mode: connectionMode,
      connected: upstreamVerified,
      upstreamVerified,
      verification_status: verificationStatus,
      note: verificationNote,
      bridgeToken,
      executionConnectorId,
      account_snapshot: metaApiSnapshot,
      connectedAt: new Date().toISOString(),
      status: upstreamVerified ? "connected" : "pending_ea_heartbeat"
    };

    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(userId)) {
      await query(
        `UPDATE broker_integrations SET status = 'DISCONNECTED', updated_at = NOW()
         WHERE user_id = $1 AND status IN ('CONNECTED','PENDING_VERIFICATION','PAUSED')`,
        [userId]
      );
      await query(
        `INSERT INTO broker_integrations
         (id, user_id, broker_type, environment, server_name, account_label, bridge_token_hash,
          execution_connector_id, status, upstream_verified, verification_status, metadata)
         VALUES ($1,$2,$3,'DEMO',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          integrationId,
          userId,
          dbBrokerType,
          serverLabel,
          accountLabel,
          sha256Hex(bridgeToken),
          executionConnectorId,
          dbStatus,
          upstreamVerified,
          verificationStatus,
          JSON.stringify({
            mode: connectionMode,
            note: verificationNote,
            credentialHint: connection.credentialHint,
            bridgeToken,
            metaApiAccountId: connectionMode === "metaapi-demo" ? metaapi_account_id : null
          })
        ]
      );
      if (metaApiSnapshot) {
        await query(
          `INSERT INTO broker_accounts
           (integration_id, account_login, currency, balance, equity, trade_mode, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,'DEMO',NOW())`,
          [integrationId, metaApiSnapshot.login, metaApiSnapshot.currency, metaApiSnapshot.balance, metaApiSnapshot.equity]
        );
      }
      await recordAuditLog({
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: upstreamVerified ? "BROKER_VERIFIED_CONNECTED" : "BROKER_BRIDGE_PROVISIONED",
        targetType: "broker_integration",
        targetId: integrationId,
        details: { broker_type: dbBrokerType, mode: connectionMode, upstream_verified: upstreamVerified }
      });
    } else {
      mem.brokers.set(userId, connection);
    }

    return response.status(upstreamVerified ? 200 : 202).json({
      connected: upstreamVerified,
      paired: true,
      upstreamVerified,
      verification_status: verificationStatus,
      broker: connection,
      execution_connector: executionConnectorId
        ? { id: executionConnectorId, access_token: executionAccessToken, notice: "Save this token for UltraLOB_Bridge_EA.mq5" }
        : null
    });
  }

  if (request.method === "POST" && subPath === "/disconnect") {
    const current = await resolveUserBrokerStatus(userId, { executionStore, dbAvailable });
    if (executionStore && current.broker?.executionConnectorId) {
      try {
        await executionStore.initialize();
        await executionStore.setConnectorStatus(current.broker.executionConnectorId, "REVOKED");
      } catch {}
    }
    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(userId)) {
      await query(
        `UPDATE broker_integrations SET status = 'DISCONNECTED', upstream_verified = FALSE, updated_at = NOW()
         WHERE user_id = $1 AND status IN ('CONNECTED','PENDING_VERIFICATION','PAUSED')`,
        [userId]
      );
    }
    mem.brokers.delete(userId);
    return response.status(200).json({
      connected: false,
      paired: false,
      upstreamVerified: false,
      verification_status: "DISCONNECTED",
      broker: null
    });
  }

  return response.status(404).json({ error: "Broker endpoint not found." });
}
