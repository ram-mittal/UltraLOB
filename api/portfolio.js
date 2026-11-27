import crypto from "node:crypto";
import {
  ensureDbReady,
  resolveAuthContext,
  resolveManagedUserScope,
  createEmptyPortfolio,
  getAllStrategiesInMemory,
  getMemoryStore,
  getPortfolioForUser,
  getRiskStateForUser,
  syncPgRiskState,
  syncPgPortfolio
} from "./store.js";
import { authorizeRequest } from "./security.js";
import { createDefaultRiskState } from "../risk/engine.js";
import {
  ALLOCATION_METHODS,
  allocatePortfolio,
  computePortfolioExposure,
  computeStrategyCorrelationMatrix
} from "../portfolio/allocator.js";
import { computeBoundedKelly, computePortfolioRiskAnalytics, runPortfolioStressTest } from "../risk/engine.js";
import { recordAuditLog } from "../db/client.js";

function appendRiskAudit(mem, userId, actor, action, details) {
  const entry = {
    id: "ra-" + crypto.randomUUID().slice(0, 8),
    userId,
    actor: actor.email || actor.name || "user",
    role: actor.role || "investor",
    action,
    details,
    createdAt: new Date().toISOString()
  };
  mem.auditLogs.unshift(entry);
  if (mem.auditLogs.length > 200) mem.auditLogs.length = 200;
  return entry;
}

function appendRiskEvent(mem, userId, severity, message, details = {}) {
  const ev = {
    id: "re-" + crypto.randomUUID().slice(0, 8),
    userId,
    severity,
    message,
    details,
    createdAt: new Date().toISOString()
  };
  mem.riskEvents.unshift(ev);
  if (mem.riskEvents.length > 200) mem.riskEvents.length = 200;
  return ev;
}

export default async function portfolioHandler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/portfolio/, "").split("?")[0];
  const dbAvailable = await ensureDbReady().catch(() => false);
  const auth = await resolveAuthContext(request, dbAvailable);
  const userId = auth.userId;
  const mem = getMemoryStore();

  // GET /api/portfolio/summary — Read-only isolated guest snapshot or authenticated owner-scoped summary
  if (request.method === "GET" && (subPath === "/summary" || subPath === "/")) {
    if (!auth.authenticated) {
      const guestPortfolio = createEmptyPortfolio("GUEST_READ_ONLY");
      const defRisk = createDefaultRiskState();
      return response.status(200).json({
        guest_read_only: true,
        data_origin: "GUEST_READ_ONLY",
        balance: 0,
        equity: 0,
        methods_supported: ALLOCATION_METHODS,
        subscriptions: [],
        exposure: computePortfolioExposure({ equity: 0, openTrades: [], subscriptions: [] }),
        correlations: computeStrategyCorrelationMatrix([]),
        risk_limits: defRisk.limits,
        kill_switches: defRisk.kill_switches
      });
    }

    const gate = authorizeRequest(auth, ["portfolio:read", "portfolio:manage"], {
      isMutation: false,
      apiKeyScope: "portfolio:read"
    });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const scope = await resolveManagedUserScope(auth, request.query?.user_id, {
      dbAvailable,
      allowSameOrgRoles: ["risk_manager", "fund_manager"]
    });
    if (!scope.ok) return response.status(scope.status).json({ error: scope.error, code: scope.code });

    const targetPortfolio = getPortfolioForUser(scope.targetUserId);
    const targetRisk = getRiskStateForUser(scope.targetUserId);
    const openTrades = (targetPortfolio.trades || []).filter((t) => t.status === "open");
    const unrealized = openTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const equity = Number((targetPortfolio.balance + unrealized).toFixed(2));

    const exposure = computePortfolioExposure({
      equity,
      openTrades,
      subscriptions: targetPortfolio.subscriptions
    });

    const strategiesWithReturns = getAllStrategiesInMemory().map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      returns: Array.isArray(s.monthly_returns) ? s.monthly_returns : []
    }));
    const correlations = computeStrategyCorrelationMatrix(strategiesWithReturns);

    return response.status(200).json({
      data_origin: targetPortfolio.dataOrigin || "PAPER_SANDBOX",
      balance: Number(targetPortfolio.balance.toFixed(2)),
      equity,
      methods_supported: ALLOCATION_METHODS,
      subscriptions: targetPortfolio.subscriptions,
      exposure,
      correlations,
      risk_limits: targetRisk.limits,
      kill_switches: targetRisk.kill_switches
    });
  }

  // POST /api/portfolio/rebalance — Authenticated & role-gated portfolio allocation modification
  if (request.method === "POST" && subPath === "/rebalance") {
    const gate = authorizeRequest(auth, "allocations:manage", { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const portfolio = getPortfolioForUser(userId);
    const riskState = getRiskStateForUser(userId);
    const body = request.body || {};
    const method = String(body.method || "RISK_WEIGHTED").toUpperCase();
    const apply = Boolean(body.apply);
    const openTrades = (portfolio.trades || []).filter((t) => t.status === "open");
    const unrealized = openTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const totalCapital = Number(body.total_capital || (portfolio.balance + unrealized) || 0);

    if (totalCapital <= 0) {
      return response.status(400).json({
        error: "Portfolio capital is $0. Fund Paper Sandbox or supply total_capital to compute an allocation preview.",
        code: "NO_ALLOCATED_CAPITAL"
      });
    }

    const selectedIds = Array.isArray(body.strategy_ids) && body.strategy_ids.length > 0
      ? new Set(body.strategy_ids)
      : null;

    const allStrategies = getAllStrategiesInMemory().filter((s) => !selectedIds || selectedIds.has(s.id));
    try {
      const plan = allocatePortfolio({
        totalCapital,
        method,
        strategies: allStrategies.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          instrument: s.instrument,
          lifecycle_status: s.lifecycle_status,
          risk_per_trade_pct: s.risk_per_trade_pct,
          risk_level: s.risk_level,
          min_capital: s.min_capital,
          returns: s.monthly_returns
        })),
        constraints: body.constraints || {}
      });

      if (apply) {
        for (const item of plan.allocations) {
          const existing = portfolio.subscriptions.find((s) => s.strategyId === item.strategy_id);
          const status = item.lifecycle_status === "RESEARCH" ? "research_watch" : "active";
          if (existing) {
            existing.allocation = item.allocated_usd;
            existing.allocationMethod = plan.method;
            existing.riskPerTradePct = item.risk_per_trade_pct;
          } else if (item.allocated_usd > 0) {
            portfolio.subscriptions.push({
              strategyId: item.strategy_id,
              code: item.code,
              strategyName: item.name,
              instrument: item.instrument,
              lifecycle_status: item.lifecycle_status,
              allocationMethod: plan.method,
              allocation: item.allocated_usd,
              riskPerTradePct: item.risk_per_trade_pct,
              maxDrawdownPct: riskState.limits.max_drawdown_pct,
              pnl: 0,
              trades: 0,
              status,
              startedAt: new Date().toISOString()
            });
          }
        }
        appendRiskAudit(mem, userId, auth, "PORTFOLIO_REBALANCED", {
          method: plan.method,
          total_capital: plan.total_capital,
          allocations: plan.allocations.length
        });
      }

      return response.status(200).json({ applied: apply, plan });
    } catch (err) {
      return response.status(400).json({ error: err.message });
    }
  }

  // GET /api/portfolio/risk — Isolated default read-only view for guests; strictly scoped for authenticated users
  if (request.method === "GET" && subPath === "/risk") {
    if (!auth.authenticated) {
      const defRisk = createDefaultRiskState();
      return response.status(200).json({
        guest_read_only: true,
        limits: defRisk.limits,
        kill_switches: defRisk.kill_switches,
        updated_at: defRisk.updated_at,
        analytics: computePortfolioRiskAnalytics({ trades: [], equityHistory: [], initialCapital: 0 }),
        stress_preview: runPortfolioStressTest({ equity: 0, grossNotional: 0, openTrades: [], riskLimits: defRisk.limits }),
        events: [],
        audit_history: [],
        governance_note: "Guest read-only view. Sign in as Risk Manager or Investor to view account-scoped telemetry."
      });
    }

    const gate = authorizeRequest(auth, ["risk:read", "portfolio:read", "portfolio:manage"], {
      isMutation: false,
      apiKeyScope: "portfolio:read"
    });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const scope = await resolveManagedUserScope(auth, request.query?.user_id, {
      dbAvailable,
      allowSameOrgRoles: ["risk_manager", "fund_manager"]
    });
    if (!scope.ok) return response.status(scope.status).json({ error: scope.error, code: scope.code });
    const targetId = scope.targetUserId;
    const targetPortfolio = getPortfolioForUser(targetId);
    const targetRisk = getRiskStateForUser(targetId);

    const openTrades = (targetPortfolio.trades || []).filter((t) => t.status === "open");
    const unrealized = openTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const equity = Number((targetPortfolio.balance + unrealized).toFixed(2));
    const analytics = computePortfolioRiskAnalytics({
      trades: targetPortfolio.trades || [],
      equityHistory: targetPortfolio.equityHistory || [],
      initialCapital: targetPortfolio.balance
    });
    const stress = runPortfolioStressTest({
      equity,
      grossNotional: computePortfolioExposure({ equity, openTrades, subscriptions: targetPortfolio.subscriptions }).gross_notional,
      openTrades,
      riskLimits: targetRisk.limits
    });

    return response.status(200).json({
      limits: targetRisk.limits,
      kill_switches: targetRisk.kill_switches,
      updated_at: targetRisk.updated_at,
      analytics,
      stress_preview: stress,
      events: mem.riskEvents.filter((e) => e.userId === targetId).slice(0, 50),
      audit_history: mem.auditLogs.filter((a) => a.userId === targetId).slice(0, 50),
      governance_note: "Independent hard limits are enforced before any execution. UltraLOB AI cannot bypass these limits."
    });
  }

  // POST /api/portfolio/risk/stress-test (Authenticated & owner-scoped)
  if (request.method === "POST" && subPath === "/risk/stress-test") {
    const gate = authorizeRequest(auth, ["portfolio:manage", "portfolio:read", "risk:read"], {
      isMutation: false,
      apiKeyScope: "portfolio:read"
    });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const portfolio = getPortfolioForUser(userId);
    const riskState = getRiskStateForUser(userId);
    const openTrades = (portfolio.trades || []).filter((t) => t.status === "open");
    const unrealized = openTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const eq = Number(request.body?.equity_override || (portfolio.balance + unrealized) || 0);
    const exp = computePortfolioExposure({ equity: eq, openTrades, subscriptions: portfolio.subscriptions });
    const stress = runPortfolioStressTest({
      equity: eq,
      grossNotional: exp.gross_notional || Number(request.body?.gross_notional_override || 0),
      openTrades,
      riskLimits: riskState.limits
    });
    return response.status(200).json({ stress });
  }

  // POST /api/portfolio/risk/limits — Strictly restricted to Risk Managers & Admins
  if (request.method === "POST" && subPath === "/risk/limits") {
    const gate = authorizeRequest(auth, "risk:configure", { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const b = request.body || {};
    const scope = await resolveManagedUserScope(auth, b.target_user_id, {
      dbAvailable,
      allowSameOrgRoles: ["risk_manager"]
    });
    if (!scope.ok) return response.status(scope.status).json({ error: scope.error, code: scope.code });

    const targetId = scope.targetUserId;
    const riskState = getRiskStateForUser(targetId);
    const prevLimits = { ...riskState.limits };

    const clamp = (val, min, max, fallback) => {
      const n = Number(val);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };

    riskState.limits = {
      max_risk_per_trade_pct: clamp(b.max_risk_per_trade_pct, 0.05, 2.0, prevLimits.max_risk_per_trade_pct),
      max_daily_loss_pct: clamp(b.max_daily_loss_pct, 0.25, 10.0, prevLimits.max_daily_loss_pct),
      max_weekly_loss_pct: clamp(b.max_weekly_loss_pct, 0.5, 20.0, prevLimits.max_weekly_loss_pct),
      max_monthly_loss_pct: clamp(b.max_monthly_loss_pct, 1.0, 35.0, prevLimits.max_monthly_loss_pct),
      max_drawdown_pct: clamp(b.max_drawdown_pct, 1.0, 30.0, prevLimits.max_drawdown_pct),
      max_open_positions: Math.round(clamp(b.max_open_positions, 1, 25, prevLimits.max_open_positions)),
      max_leverage: clamp(b.max_leverage, 1.0, 50.0, prevLimits.max_leverage),
      max_margin_usage_pct: clamp(b.max_margin_usage_pct, 10.0, 90.0, prevLimits.max_margin_usage_pct),
      max_spread_points: clamp(b.max_spread_points, 5.0, 500.0, prevLimits.max_spread_points),
      max_slippage_points: clamp(b.max_slippage_points, 1.0, 200.0, prevLimits.max_slippage_points)
    };
    riskState.updated_at = new Date().toISOString();

    const audit = appendRiskAudit(mem, targetId, auth, "RISK_LIMITS_UPDATED", {
      before: prevLimits,
      after: riskState.limits
    });
    appendRiskEvent(mem, targetId, "INFO", "Hard risk governance limits updated.", riskState.limits);
    await syncPgRiskState(targetId, riskState, dbAvailable);
    if (dbAvailable) {
      await recordAuditLog({
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: "RISK_LIMITS_UPDATED",
        targetType: "portfolio_risk",
        targetId,
        details: { before: prevLimits, after: riskState.limits }
      });
    }

    return response.status(200).json({ limits: riskState.limits, audit });
  }

  // POST /api/portfolio/risk/kill-switch — Strictly restricted to Risk Managers & Admins
  if (request.method === "POST" && subPath === "/risk/kill-switch") {
    const gate = authorizeRequest(auth, "risk:kill_switch", { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const b = request.body || {};
    const scopeCheck = await resolveManagedUserScope(auth, b.target_user_id, {
      dbAvailable,
      allowSameOrgRoles: ["risk_manager"]
    });
    if (!scopeCheck.ok) return response.status(scopeCheck.status).json({ error: scopeCheck.error, code: scopeCheck.code });

    const targetUserId = scopeCheck.targetUserId;
    const riskState = getRiskStateForUser(targetUserId);
    const scope = String(b.scope || "GLOBAL").toUpperCase();
    const target = String(b.target || "").trim();
    const active = Boolean(b.active);
    const reason = String(b.reason || (active ? "Manual risk halt" : "Manual reset")).trim();

    if (scope === "GLOBAL") {
      riskState.kill_switches.global_active = active;
      riskState.kill_switches.global_reason = active ? reason : null;
    } else if (scope === "STRATEGY") {
      if (!target) return response.status(400).json({ error: "target strategy_id is required for STRATEGY scope." });
      if (active) {
        riskState.kill_switches.strategies[target] = {
          active: true,
          reason,
          triggered_at: new Date().toISOString(),
          actor: auth.email || auth.name
        };
      } else {
        delete riskState.kill_switches.strategies[target];
      }
    } else if (scope === "INSTRUMENT") {
      const sym = target.replace("/", "").toUpperCase();
      if (!sym) return response.status(400).json({ error: "target symbol is required for INSTRUMENT scope." });
      if (active) {
        riskState.kill_switches.instruments[sym] = {
          active: true,
          reason,
          triggered_at: new Date().toISOString(),
          actor: auth.email || auth.name
        };
      } else {
        delete riskState.kill_switches.instruments[sym];
      }
    } else {
      return response.status(400).json({ error: "scope must be GLOBAL, STRATEGY, or INSTRUMENT." });
    }

    riskState.updated_at = new Date().toISOString();
    await syncPgRiskState(targetUserId, riskState, dbAvailable);
    appendRiskAudit(mem, targetUserId, auth, "KILL_SWITCH_TOGGLED", { scope, target: target || "ALL", active, reason });
    appendRiskEvent(
      mem,
      targetUserId,
      active ? "KILL_SWITCH" : "INFO",
      `${scope} kill switch ${active ? "ACTIVATED" : "CLEARED"}${target ? " (" + target + ")" : ""}: ${reason}`
    );

    return response.status(200).json({
      kill_switches: riskState.kill_switches,
      note: "Kill switches block NEW orders only and do not silently liquidate existing positions."
    });
  }

  // POST /api/portfolio/risk/kelly-research
  if (request.method === "POST" && subPath === "/risk/kelly-research") {
    const gate = authorizeRequest(auth, ["portfolio:manage", "risk:configure", "research:read"], {
      isMutation: false,
      apiKeyScope: "portfolio:read"
    });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const b = request.body || {};
    const riskState = getRiskStateForUser(userId);
    const calc = computeBoundedKelly({
      winProbability: b.win_probability,
      payoffRatio: b.payoff_ratio,
      kellyFractionMultiplier: b.kelly_fraction ?? 0.5,
      hardMaxRiskPct: riskState.limits.max_risk_per_trade_pct
    });
    return response.status(calc.ok ? 200 : 400).json(calc);
  }

  return response.status(404).json({ error: "Portfolio endpoint not found." });
}
