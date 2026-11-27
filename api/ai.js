import crypto from "node:crypto";
import {
  ensureDbReady,
  resolveAuthContext,
  getAllStrategiesInMemory,
  getMemoryStore,
  getPortfolioForUser,
  getRiskStateForUser,
  query
} from "./store.js";
import { authorizeRequest, authorizeOwnership } from "./security.js";
import { getDatabaseStatus, recordAuditLog } from "../db/client.js";
import { fetchMacroCalendar, evaluateEventRestriction } from "../ai/events.js";
import { evaluateAdvisoryPipeline } from "../ai/engines.js";
import { evaluateTradeGovernance } from "../risk/engine.js";
import { resolveUserBrokerStatus } from "./broker.js";

export default async function aiHandler(request, response, { executionStore = null } = {}) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/ai/, "").split("?")[0];
  const dbAvailable = await ensureDbReady().catch(() => false);
  const auth = await resolveAuthContext(request, dbAvailable);
  const userId = auth.userId;
  const mem = getMemoryStore();
  if (!mem.aiDecisions) mem.aiDecisions = [];
  if (!mem.customMacroEvents) mem.customMacroEvents = [];

  // GET /api/ai/events — Public macro calendar + caller's declared blackout windows
  if (request.method === "GET" && subPath === "/events") {
    const symbol = String(request.query?.symbol || "XAUUSD").toUpperCase();
    const cal = await fetchMacroCalendar();
    const visibleBlackouts = mem.customMacroEvents.filter(
      (ev) => !ev.userId || (auth.authenticated && (ev.userId === userId || auth.role === "admin"))
    );
    const restriction = evaluateEventRestriction({
      symbol,
      events: cal.events,
      customBlackouts: visibleBlackouts
    });
    return response.status(200).json({
      calendar_status: cal.status,
      calendar_source: cal.source,
      calendar_error: cal.error || null,
      custom_blackout_windows: visibleBlackouts,
      restriction
    });
  }

  // POST /api/ai/events — Register an operator macro blackout window (FOMC/CPI/NFP etc.)
  if (request.method === "POST" && subPath === "/events") {
    const gate = authorizeRequest(auth, ["risk:configure", "portfolio:manage", "ai:evaluate"], { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const { title, currency = "USD", impact = "HIGH", timestamp_utc } = request.body || {};
    if (!title || !timestamp_utc || Number.isNaN(Date.parse(timestamp_utc))) {
      return response.status(400).json({ error: "Valid title and ISO-8601 timestamp_utc are required." });
    }
    const ev = {
      id: "macro-" + crypto.randomUUID().slice(0, 8),
      userId,
      title: String(title).trim().slice(0, 120),
      currency: String(currency).toUpperCase(),
      impact: ["HIGH", "MEDIUM", "LOW"].includes(String(impact).toUpperCase()) ? String(impact).toUpperCase() : "HIGH",
      timestamp_utc: new Date(timestamp_utc).toISOString(),
      source: "OPERATOR_DECLARED"
    };
    mem.customMacroEvents.unshift(ev);
    return response.status(201).json({ event: ev });
  }

  // GET /api/ai/decisions — Authenticated & strictly owner-scoped decision audit history
  if (request.method === "GET" && (subPath === "/decisions" || subPath === "/decisions/")) {
    const gate = authorizeRequest(auth, ["ai:evaluate", "risk:read", "portfolio:read"], {
      isMutation: false,
      apiKeyScope: "portfolio:read"
    });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    if (dbAvailable) {
      const isAdmin = auth.role === "admin";
      const res = isAdmin
        ? await query(
            `SELECT id, user_id, strategy_id, mode, decision, confidence, risk_approved, human_approved_by, rationale, engine_outputs, created_at
             FROM ai_decisions ORDER BY created_at DESC LIMIT 30`
          )
        : await query(
            `SELECT id, user_id, strategy_id, mode, decision, confidence, risk_approved, human_approved_by, rationale, engine_outputs, created_at
             FROM ai_decisions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
            [/^[0-9a-f-]{36}$/i.test(userId) ? userId : null]
          );
      const decisions = res.rows.map((r) => {
        const spec = r.engine_outputs?._decision_spec || {};
        return {
          ...spec,
          id: r.id,
          userId: r.user_id,
          strategy_id: r.strategy_id,
          mode: r.mode,
          decision: r.decision,
          confidence: Number(r.confidence),
          risk_approved: r.risk_approved,
          human_approved_by: r.human_approved_by,
          human_approval_status: r.human_approved_by ? "APPROVED" : "PENDING",
          rationale: r.rationale,
          pipeline_stages: r.engine_outputs,
          evaluated_at: spec.evaluated_at || r.created_at
        };
      });
      return response.status(200).json({ decisions });
    }
    const filtered = auth.role === "admin"
      ? mem.aiDecisions
      : mem.aiDecisions.filter((d) => d.userId === userId);
    return response.status(200).json({ decisions: filtered.slice(0, 30) });
  }

  // POST /api/ai/evaluate — Execute full 7-engine advisory pipeline (Authenticated)
  if (request.method === "POST" && subPath === "/evaluate") {
    const gate = authorizeRequest(auth, "ai:evaluate", { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });
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

    const visibleBlackouts = mem.customMacroEvents.filter(
      (ev) => !ev.userId || ev.userId === userId || auth.role === "admin"
    );
    const brokerState = await resolveUserBrokerStatus(userId, { executionStore, dbAvailable });
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
      broker: brokerState.broker,
      postgresConfigured: getDatabaseStatus().configured,
      macroEvents: cal.events,
      customBlackouts: visibleBlackouts
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
      const ownerUuid = /^[0-9a-f-]{36}$/i.test(userId) ? userId : null;
      await query(
        `INSERT INTO ai_decisions
         (id, user_id, strategy_id, mode, decision, confidence, risk_approved, human_approved_by, rationale, engine_outputs)
         VALUES ($1,$2,$3,'ADVISORY',$4,$5,$6,NULL,$7,$8::jsonb)`,
        [
          recordId,
          ownerUuid,
          strategy.id,
          evaluation.decision,
          evaluation.confidence,
          evaluation.pipeline_stages["3_risk_engine"].approved,
          evaluation.rationale,
          JSON.stringify({
            ...evaluation.pipeline_stages,
            _decision_spec: {
              instrument: evaluation.instrument,
              strategy_id: evaluation.strategy_id,
              strategy_code: evaluation.strategy_code,
              market_regime: evaluation.market_regime,
              directional_bias: evaluation.directional_bias,
              signal_quality: evaluation.signal_quality,
              signal_quality_score: evaluation.signal_quality_score,
              entry_conditions: evaluation.entry_conditions,
              invalidation: evaluation.invalidation,
              estimated_net_r: evaluation.estimated_net_r,
              monetary_risk_usd: evaluation.monetary_risk_usd,
              portfolio_impact: evaluation.portfolio_impact,
              supporting_evidence: evaluation.supporting_evidence,
              expires_at: evaluation.expires_at,
              gate_status: evaluation.gate_status,
              proposal: evaluation.proposal,
              recommendation_status: evaluation.recommendation_status,
              execution_authorization_status: evaluation.execution_authorization_status,
              evaluated_at: evaluation.evaluated_at
            }
          })
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

  // POST /api/ai/decisions/:id/authorize — Human authorization step with ownership & Hard Risk Gate
  const authMatch = subPath.match(/^\/decisions\/([^/]+)\/authorize$/);
  if (request.method === "POST" && authMatch) {
    const gate = authorizeRequest(auth, "ai:authorize", { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const id = authMatch[1];
    const approve = request.body?.approve !== false;
    let record = mem.aiDecisions.find((d) => d.id === id);
    if (!record && dbAvailable && /^[0-9a-f-]{36}$/i.test(id)) {
      const dbRes = await query(`SELECT * FROM ai_decisions WHERE id = $1`, [id]);
      if (dbRes.rows[0]) {
        const r = dbRes.rows[0];
        const spec = r.engine_outputs?._decision_spec || {};
        record = { ...spec, id: r.id, userId: r.user_id, strategy_id: r.strategy_id, decision: r.decision };
      }
    }
    if (!record) return response.status(404).json({ error: "AI decision record not found." });

    const own = authorizeOwnership(auth, record.userId);
    if (!own.ok) return response.status(own.status).json({ error: own.error, code: own.code });

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
