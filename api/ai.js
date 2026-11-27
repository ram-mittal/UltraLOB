import crypto from "node:crypto";
import {
  ensureDbReady,
  extractAuthContext,
  getAllStrategiesInMemory,
  getMemoryStore,
  getPortfolioForUser,
  getRiskStateForUser,
  query
} from "./store.js";
import { getDatabaseStatus, recordAuditLog } from "../db/client.js";
import { fetchMacroCalendar, evaluateEventRestriction } from "../ai/events.js";
import { evaluateAdvisoryPipeline } from "../ai/engines.js";
import { evaluateTradeGovernance } from "../risk/engine.js";

export default async function aiHandler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/ai/, "").split("?")[0];
  const auth = extractAuthContext(request);
  const userId = auth.userId;
  const mem = getMemoryStore();
  if (!mem.aiDecisions) mem.aiDecisions = [];
  if (!mem.customMacroEvents) mem.customMacroEvents = [];

  const dbAvailable = await ensureDbReady().catch(() => false);

  // GET /api/ai/events — Fetch macro calendar + operator restriction windows
  if (request.method === "GET" && subPath === "/events") {
    const symbol = String(request.query?.symbol || "XAUUSD").toUpperCase();
    const cal = await fetchMacroCalendar();
    const restriction = evaluateEventRestriction({
      symbol,
      events: cal.events,
      customBlackouts: mem.customMacroEvents
    });
    return response.status(200).json({
      calendar_status: cal.status,
      calendar_source: cal.source,
      calendar_error: cal.error || null,
      custom_blackout_windows: mem.customMacroEvents,
      restriction
    });
  }

  // POST /api/ai/events — Register an operator macro blackout window (FOMC/CPI/NFP etc.)
  if (request.method === "POST" && subPath === "/events") {
    const { title, currency = "USD", impact = "HIGH", timestamp_utc } = request.body || {};
    if (!title || !timestamp_utc || Number.isNaN(Date.parse(timestamp_utc))) {
      return response.status(400).json({ error: "Valid title and ISO-8601 timestamp_utc are required." });
    }
    const ev = {
      id: "macro-" + crypto.randomUUID().slice(0, 8),
      title: String(title).trim().slice(0, 120),
      currency: String(currency).toUpperCase(),
      impact: ["HIGH", "MEDIUM", "LOW"].includes(String(impact).toUpperCase()) ? String(impact).toUpperCase() : "HIGH",
      timestamp_utc: new Date(timestamp_utc).toISOString(),
      source: "OPERATOR_DECLARED"
    };
    mem.customMacroEvents.unshift(ev);
    return response.status(201).json({ event: ev });
  }

  // GET /api/ai/decisions
  if (request.method === "GET" && (subPath === "/decisions" || subPath === "/decisions/")) {
    if (dbAvailable) {
      const res = await query(
        `SELECT id, strategy_id, mode, decision, confidence, risk_approved, human_approved_by, rationale, engine_outputs, created_at
         FROM ai_decisions ORDER BY created_at DESC LIMIT 30`
      );
      return response.status(200).json({ decisions: res.rows });
    }
    return response.status(200).json({ decisions: mem.aiDecisions.slice(0, 30) });
  }

  // POST /api/ai/evaluate — Execute full 7-engine advisory pipeline
  if (request.method === "POST" && subPath === "/evaluate") {
    const b = request.body || {};
    const strategyId = String(b.strategy_id || "ul-01-gold-trend").trim();
    const symbol = String(b.symbol || "XAUUSD").replace("/", "").toUpperCase();
    const side = ["BUY", "SELL"].includes(String(b.side || "").toUpperCase()) ? String(b.side).toUpperCase() : "BUY";
    const proposedRiskPct = Number(b.proposed_risk_pct ?? 0.5);
    const proposedAllocationUsd = Number(b.proposed_allocation_usd ?? 1000);
    const spreadPoints = b.spread_points != null ? Number(b.spread_points) : null;

    const strategy = getAllStrategiesInMemory().find((s) => s.id === strategyId || s.code === strategyId);
    if (!strategy) return response.status(404).json({ error: "Strategy not found." });

    const portfolio = getPortfolioForUser(userId);
    const riskState = getRiskStateForUser(userId);
    const openTrades = (portfolio.trades || []).filter((t) => t.status === "open");
    const unrealized = openTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const equity = Number((portfolio.balance + unrealized).toFixed(2));
    const portfolioMetrics = {
      balance: portfolio.balance,
      equity,
      open_positions_count: openTrades.length,
      drawdown_pct: portfolio.equity_high_water > 0
        ? Math.max(0, ((portfolio.equity_high_water - equity) / portfolio.equity_high_water) * 100)
        : 0
    };

    const cal = await fetchMacroCalendar();
    const latestBacktest = (mem.backtests || []).find(
      (bt) => bt.strategy_id === strategy.id && bt.data_origin === "REAL_MARKET"
    ) || null;

    const evaluation = evaluateAdvisoryPipeline({
      strategy,
      latestBacktest,
      symbol,
      side,
      proposedRiskPct,
      proposedAllocationUsd,
      spreadPoints,
      candles: Array.isArray(b.candles) ? b.candles : [],
      portfolioMetrics,
      subscriptions: portfolio.subscriptions,
      riskState,
      broker: mem.brokers.get(userId) || null,
      postgresConfigured: getDatabaseStatus().configured,
      macroEvents: cal.events,
      customBlackouts: mem.customMacroEvents
    });

    const recordId = crypto.randomUUID();
    const record = {
      id: recordId,
      userId,
      ...evaluation,
      human_approval_status: "PENDING",
      human_approved_by: null,
      human_approved_at: null
    };
    mem.aiDecisions.unshift(record);
    if (mem.aiDecisions.length > 50) mem.aiDecisions.length = 50;

    if (dbAvailable) {
      await query(
        `INSERT INTO ai_decisions
         (id, strategy_id, engine_outputs, mode, decision, confidence, risk_approved, rationale)
         VALUES ($1,$2,$3::jsonb,'ADVISORY',$4,$5,$6,$7)`,
        [
          recordId,
          strategy.id,
          JSON.stringify(evaluation.pipeline_stages),
          evaluation.decision,
          evaluation.confidence,
          evaluation.pipeline_stages["3_risk_engine"].approved,
          evaluation.rationale
        ]
      );
      await recordAuditLog({
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: "AI_ADVISORY_EVALUATED",
        targetType: "ai_decision",
        targetId: recordId,
        details: { strategy_id: strategy.id, decision: evaluation.decision }
      });
    }

    return response.status(200).json({ decision: record });
  }

  // POST /api/ai/decisions/:id/authorize — Human authorization step (re-validates Hard Risk Gate!)
  const authMatch = subPath.match(/^\/decisions\/([^/]+)\/authorize$/);
  if (request.method === "POST" && authMatch) {
    if (!auth.authenticated) {
      return response.status(401).json({ error: "Authentication required to authorize advisory decisions.", code: "AUTH_REQUIRED" });
    }
    const id = authMatch[1];
    const approve = request.body?.approve !== false;
    const record = mem.aiDecisions.find((d) => d.id === id);
    if (!record) return response.status(404).json({ error: "AI decision record not found." });

    if (approve) {
      // Independent Risk Engine MUST still pass at time of authorization!
      const portfolio = getPortfolioForUser(userId);
      const riskState = getRiskStateForUser(userId);
      const openTrades = (portfolio.trades || []).filter((t) => t.status === "open");
      const unrealized = openTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
      const equity = Number((portfolio.balance + unrealized).toFixed(2));
      const recheck = evaluateTradeGovernance({
        riskState,
        portfolioMetrics: { balance: portfolio.balance, equity, open_positions_count: openTrades.length },
        strategyId: record.proposal?.strategy_id,
        symbol: record.proposal?.symbol,
        proposedRiskPct: record.proposal?.proposed_risk_pct
      });
      if (!recheck.approved) {
        return response.status(403).json({
          error: `Authorization denied by Independent Risk Engine (${recheck.code}): ${recheck.message}`,
          code: recheck.code
        });
      }
      record.human_approval_status = "APPROVED";
    } else {
      record.human_approval_status = "REJECTED";
    }

    record.human_approved_by = auth.email || auth.name;
    record.human_approved_at = new Date().toISOString();

    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(id) && /^[0-9a-f-]{36}$/i.test(auth.userId)) {
      await query(`UPDATE ai_decisions SET human_approved_by = $2 WHERE id = $1`, [id, auth.userId]);
    }
    return response.status(200).json({ decision: record });
  }

  return response.status(404).json({ error: "AI endpoint not found." });
}
