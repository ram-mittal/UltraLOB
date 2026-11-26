import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import { evaluateDemoCommand } from "./risk-manager.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYMBOL_PATTERN = /^[A-Z0-9._-]{2,32}$/;
const STRATEGY_PATTERN = /^[a-zA-Z0-9._:-]{2,64}$/;
const ACK_STATUSES = new Set(["ACCEPTED", "REJECTED", "FILLED", "PARTIAL", "CANCELLED"]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanString(value, maxLength = 128) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isFiniteRange(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: message, code });
}

function validateHeartbeat(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Heartbeat body must be a JSON object.";
  const requiredStrings = ["login", "server", "company", "currency", "trade_mode"];
  for (const key of requiredStrings) {
    if (!cleanString(body[key], 128)) return key + " is required.";
  }
  for (const key of ["balance", "equity", "margin", "margin_free", "leverage"]) {
    if (!Number.isFinite(Number(body[key])) || Number(body[key]) < 0) return key + " must be a non-negative number.";
  }
  for (const key of ["terminal_connected", "terminal_trade_allowed", "ea_trade_allowed"]) {
    if (typeof body[key] !== "boolean") return key + " must be a boolean.";
  }
  if (!Array.isArray(body.positions) || body.positions.length > 100) return "positions must be an array with at most 100 items.";
  if (!Array.isArray(body.symbol_specs) || body.symbol_specs.length > 50) return "symbol_specs must be an array with at most 50 items.";

  for (const position of body.positions) {
    if (!position || !cleanString(position.symbol, 32) || !Number.isFinite(Number(position.volume)) || Number(position.volume) < 0) {
      return "Each position must include a symbol and non-negative volume.";
    }
  }
  for (const spec of body.symbol_specs) {
    if (!spec || !SYMBOL_PATTERN.test(cleanString(spec.symbol, 32))) return "Each symbol specification must include a valid symbol.";
    for (const key of ["bid", "ask", "point", "tick_size", "tick_value", "volume_min", "volume_max", "volume_step"]) {
      if (!Number.isFinite(Number(spec[key])) || Number(spec[key]) < 0) return "Invalid " + key + " in symbol specification for " + spec.symbol + ".";
    }
  }
  return null;
}

function sanitizeConnector(row) {
  const heartbeat = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : NaN;
  const age = Number.isFinite(heartbeat) ? Math.max(0, Date.now() - heartbeat) : null;
  return {
    id: row.id,
    label: row.label,
    broker: row.broker,
    environment: row.environment,
    status: row.status,
    strategy_ids: row.strategy_ids,
    allowed_symbols: row.allowed_symbols,
    risk: {
      max_trade_risk_pct: row.max_trade_risk_pct,
      max_daily_loss_pct: row.max_daily_loss_pct,
      max_drawdown_pct: row.max_drawdown_pct,
      max_spread_points: row.max_spread_points,
      max_open_positions: row.max_open_positions
    },
    account: row.account_login ? {
      login: row.account_login,
      server: row.account_server,
      company: row.account_company,
      currency: row.account_currency,
      trade_mode: row.trade_mode,
      balance: row.balance,
      equity: row.equity,
      margin: row.margin,
      margin_free: row.margin_free,
      open_positions: Array.isArray(row.positions) ? row.positions.length : 0
    } : null,
    connection: {
      connected: age !== null && age <= 15000 && row.terminal_connected === true,
      last_heartbeat_at: row.last_heartbeat_at || null,
      age_ms: age
    },
    created_at: row.created_at
  };
}

export function createExecutionRouter({ store = null, adminKey = "", liveExecutionEnabled = false } = {}) {
  const router = express.Router();

  async function requireStore(_req, res, next) {
    if (!store) {
      return errorResponse(res, 503, "EXECUTION_STORAGE_NOT_CONFIGURED",
        "Execution API is disabled. Configure DATABASE_URL and run the execution schema initializer.");
    }
    try {
      await store.initialize();
      next();
    } catch (error) {
      console.error("[execution] storage initialization failed:", error.message);
      return errorResponse(res, 503, "EXECUTION_STORAGE_UNAVAILABLE", "Execution storage is unavailable.");
    }
  }

  function requireAdmin(req, res, next) {
    const provided = req.get("x-ultralob-admin-key") || "";
    if (!adminKey || !secureEqual(provided, adminKey)) {
      return errorResponse(res, 401, "ADMIN_UNAUTHORIZED", "Admin authorization is required.");
    }
    next();
  }

  async function requireConnector(req, res, next) {
    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{32,160})$/);
    if (!match) return errorResponse(res, 401, "CONNECTOR_UNAUTHORIZED", "A valid connector bearer token is required.");
    try {
      const connector = await store.getConnectorByTokenHash(sha256(match[1]));
      if (!connector || connector.id !== req.params.connectorId) {
        return errorResponse(res, 401, "CONNECTOR_UNAUTHORIZED", "Connector credentials are invalid.");
      }
      req.connector = connector;
      next();
    } catch (error) {
      console.error("[execution] connector authentication failed:", error.message);
      return errorResponse(res, 503, "EXECUTION_STORAGE_UNAVAILABLE", "Execution storage is unavailable.");
    }
  }

  router.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      status: store ? "configured" : "disabled",
      storage: store ? "postgresql" : "not-configured",
      broker: "MT5",
      environment: "DEMO_ONLY",
      live_execution_enabled: Boolean(liveExecutionEnabled),
      note: "Live-account execution is disabled in this build."
    });
  });

  router.post("/connectors", requireStore, requireAdmin, async (req, res) => {
    const body = req.body || {};
    const label = cleanString(body.label, 80);
    const strategyIds = Array.isArray(body.strategy_ids) ? [...new Set(body.strategy_ids.map((x) => cleanString(x, 64)))] : [];
    const symbols = Array.isArray(body.allowed_symbols) ? [...new Set(body.allowed_symbols.map((x) => cleanString(x, 32).toUpperCase()))] : [];
    const risk = body.risk || {};

    if (!label) return errorResponse(res, 400, "INVALID_LABEL", "A connector label is required.");
    if (body.broker !== "MT5") return errorResponse(res, 400, "UNSUPPORTED_BROKER", "This first connector supports MT5 only.");
    if (body.environment !== "DEMO") return errorResponse(res, 400, "DEMO_ONLY", "Only DEMO connector profiles can be created.");
    if (strategyIds.length < 1 || strategyIds.length > 20 || strategyIds.some((x) => !STRATEGY_PATTERN.test(x))) {
      return errorResponse(res, 400, "INVALID_STRATEGIES", "Provide 1–20 valid strategy IDs.");
    }
    if (symbols.length < 1 || symbols.length > 30 || symbols.some((x) => !SYMBOL_PATTERN.test(x))) {
      return errorResponse(res, 400, "INVALID_SYMBOLS", "Provide 1–30 valid broker symbol names.");
    }

    const riskSettings = {
      max_trade_risk_pct: risk.max_trade_risk_pct == null ? 0.5 : Number(risk.max_trade_risk_pct),
      max_daily_loss_pct: risk.max_daily_loss_pct == null ? 2 : Number(risk.max_daily_loss_pct),
      max_drawdown_pct: risk.max_drawdown_pct == null ? 8 : Number(risk.max_drawdown_pct),
      max_spread_points: risk.max_spread_points == null ? 100 : Number(risk.max_spread_points),
      max_open_positions: risk.max_open_positions == null ? 2 : Number(risk.max_open_positions),
      max_deviation_points: risk.max_deviation_points == null ? 20 : Number(risk.max_deviation_points)
    };
    if (!isFiniteRange(riskSettings.max_trade_risk_pct, 0.05, 1) ||
        !isFiniteRange(riskSettings.max_daily_loss_pct, 0.25, 5) ||
        !isFiniteRange(riskSettings.max_drawdown_pct, 1, 15) ||
        !isFiniteRange(riskSettings.max_spread_points, 1, 10000) ||
        !Number.isInteger(riskSettings.max_open_positions) || riskSettings.max_open_positions < 1 || riskSettings.max_open_positions > 10 ||
        !Number.isInteger(riskSettings.max_deviation_points) || riskSettings.max_deviation_points < 0 || riskSettings.max_deviation_points > 500) {
      return errorResponse(res, 400, "INVALID_RISK_PROFILE", "Risk settings exceed the supported conservative demo limits.");
    }

    const token = "ulb_demo_" + randomBytes(32).toString("base64url");
    const connector = await store.createConnector({
      id: randomUUID(),
      token_hash: sha256(token),
      label,
      strategy_ids: strategyIds,
      allowed_symbols: symbols,
      ...riskSettings
    });
    return res.status(201).json({
      connector: sanitizeConnector(connector),
      access_token: token,
      token_notice: "Copy this token now. It is stored only as a SHA-256 hash and cannot be retrieved later.",
      environment: "DEMO"
    });
  });

  router.get("/connectors", requireStore, requireAdmin, async (_req, res) => {
    const connectors = await store.listConnectors();
    res.json({ connectors: connectors.map(sanitizeConnector) });
  });

  router.post("/signals", requireStore, requireAdmin, async (req, res) => {
    const body = req.body || {};
    const signalId = cleanString(body.signal_id, 100);
    const strategyId = cleanString(body.strategy_id, 64);
    const strategyVersion = cleanString(body.strategy_version, 32);
    const symbol = cleanString(body.symbol, 32).toUpperCase();
    const side = cleanString(body.side, 8).toUpperCase();
    const riskPct = Number(body.risk_pct);
    const stopLoss = Number(body.stop_loss);
    const takeProfit = Number(body.take_profit);
    const ttlSeconds = body.ttl_seconds == null ? 60 : Number(body.ttl_seconds);

    if (signalId.length < 8 || !STRATEGY_PATTERN.test(strategyId) || !strategyVersion ||
        !SYMBOL_PATTERN.test(symbol) || !["BUY", "SELL"].includes(side) ||
        !isFiniteRange(riskPct, 0.05, 1) ||
        !finiteNumber(stopLoss) || stopLoss <= 0 ||
        !finiteNumber(takeProfit) || takeProfit <= 0 ||
        !Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 300) {
      return errorResponse(res, 400, "INVALID_SIGNAL", "Signal must include a unique signal_id, strategy/version, symbol, side, risk_pct, stop_loss, take_profit and 5–300 second TTL.");
    }

    const result = await store.enqueueSignal({
      signal_id: signalId,
      strategy_id: strategyId,
      strategy_version: strategyVersion,
      symbol,
      side,
      risk_pct: riskPct,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      command_id_factory: randomUUID
    });
    return res.status(202).json({
      status: "accepted",
      signal_id: signalId,
      ...result,
      note: "A queued signal is not an order. Each connector performs local broker checks before OrderSend."
    });
  });

  router.post("/connectors/:connectorId/heartbeat", requireStore, async (req, res, next) => {
    if (!UUID_PATTERN.test(req.params.connectorId)) {
      return errorResponse(res, 400, "INVALID_CONNECTOR_ID", "Connector ID is invalid.");
    }
    next();
  }, requireConnector, async (req, res) => {
    const body = req.body || {};
    const validation = validateHeartbeat(body);
    if (validation) return errorResponse(res, 400, "INVALID_HEARTBEAT", validation);

    const snapshot = {
      login: cleanString(body.login, 64),
      server: cleanString(body.server, 128),
      company: cleanString(body.company, 128),
      currency: cleanString(body.currency, 16),
      leverage: Math.min(100000, Math.max(1, Math.round(Number(body.leverage)))),
      trade_mode: cleanString(body.trade_mode, 16).toUpperCase(),
      terminal_connected: body.terminal_connected,
      terminal_trade_allowed: body.terminal_trade_allowed,
      ea_trade_allowed: body.ea_trade_allowed,
      balance: Number(body.balance),
      equity: Number(body.equity),
      margin: Number(body.margin),
      margin_free: Number(body.margin_free),
      positions: body.positions,
      symbol_specs: body.symbol_specs
    };
    if (snapshot.balance <= 0 || snapshot.equity <= 0) {
      return errorResponse(res, 400, "INVALID_ACCOUNT_STATE", "Balance and equity must be greater than zero.");
    }
    const updated = await store.updateHeartbeat(req.connector.id, snapshot);
    return res.json({
      status: "received",
      connector_id: updated.id,
      account_mode: updated.trade_mode,
      open_positions: updated.positions.length,
      received_at: updated.last_heartbeat_at
    });
  });

  router.get("/connectors/:connectorId/next", requireStore, async (req, res, next) => {
    if (!UUID_PATTERN.test(req.params.connectorId)) {
      return errorResponse(res, 400, "INVALID_CONNECTOR_ID", "Connector ID is invalid.");
    }
    next();
  }, requireConnector, async (req, res) => {
    const connector = await store.getConnector(req.connector.id);
    if (!connector || connector.status !== "ACTIVE") return errorResponse(res, 403, "CONNECTOR_INACTIVE", "Connector is not active.");
    if (connector.environment !== "DEMO" || String(connector.trade_mode || "").toUpperCase() !== "DEMO") {
      return errorResponse(res, 403, "DEMO_ACCOUNT_REQUIRED", "This build will not dispatch commands to a non-demo account.");
    }
    const heartbeatAge = connector.last_heartbeat_at
      ? Date.now() - new Date(connector.last_heartbeat_at).getTime()
      : Infinity;
    if (heartbeatAge > 15000 || connector.terminal_connected !== true) {
      return res.status(409).json({ status: "paused", code: "STALE_ACCOUNT_SNAPSHOT", message: "Heartbeat missing, stale, or terminal disconnected." });
    }

    const queued = await store.takeNextQueuedCommand(connector.id);
    if (!queued) return res.json({ status: "empty" });

    const evaluated = evaluateDemoCommand(connector, {
      ...queued,
      risk_pct: queued.requested_risk_pct
    });
    if (!evaluated.ok) {
      await store.rejectCommand(queued.id, evaluated.code, evaluated.message);
      return res.json({ status: "rejected", command_id: queued.id, code: evaluated.code, message: evaluated.message });
    }
    await store.updateCommandRisk(queued.id, {
      volume: evaluated.command.volume,
      entry_reference: evaluated.command.entry_reference,
      risk_amount: evaluated.command.risk_amount,
      risk_pct: evaluated.command.risk_pct,
      spread_points: evaluated.command.spread_points
    });

    return res.json({
      status: "command",
      command_id: queued.id,
      signal_id: queued.signal_id,
      strategy_id: queued.strategy_id,
      strategy_version: queued.strategy_version,
      order_type: "MARKET",
      symbol: evaluated.command.symbol,
      side: evaluated.command.side,
      volume: evaluated.command.volume,
      entry_reference: evaluated.command.entry_reference,
      stop_loss: evaluated.command.stop_loss,
      take_profit: evaluated.command.take_profit,
      risk_amount: evaluated.command.risk_amount,
      risk_pct: evaluated.command.risk_pct,
      spread_points: evaluated.command.spread_points,
      max_deviation_points: evaluated.command.max_deviation_points,
      expires_at: queued.expires_at
    });
  });

  router.post("/connectors/:connectorId/commands/:commandId/ack", requireStore, async (req, res, next) => {
    if (!UUID_PATTERN.test(req.params.connectorId) || !UUID_PATTERN.test(req.params.commandId)) {
      return errorResponse(res, 400, "INVALID_IDENTIFIER", "Connector or command ID is invalid.");
    }
    next();
  }, requireConnector, async (req, res) => {
    const body = req.body || {};
    const status = cleanString(body.status, 16).toUpperCase();
    if (!ACK_STATUSES.has(status)) return errorResponse(res, 400, "INVALID_ACK_STATUS", "Unsupported acknowledgement status.");
    if (status === "REJECTED" && !cleanString(body.error_message, 240)) {
      return errorResponse(res, 400, "REJECTION_REASON_REQUIRED", "A rejection reason is required.");
    }

    const updated = await store.acknowledgeCommand(req.connector.id, req.params.commandId, {
      status,
      broker_order_id: cleanString(body.broker_order_id, 64) || null,
      broker_deal_id: cleanString(body.broker_deal_id, 64) || null,
      broker_retcode: cleanString(body.broker_retcode, 64) || null,
      broker_comment: cleanString(body.broker_comment, 240) || null,
      error_code: cleanString(body.error_code, 64) || null,
      error_message: cleanString(body.error_message, 240) || null
    });
    if (!updated) return errorResponse(res, 404, "COMMAND_NOT_FOUND_OR_FINAL", "Command was not found or is no longer awaiting acknowledgement.");
    return res.json({ status: "recorded", command_id: updated.id, command_status: updated.status });
  });

  return router;
}

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}
