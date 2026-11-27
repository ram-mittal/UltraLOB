// Institutional Governance: Investor Mandates, Statements, CSV Export & HWM Fee Framework (Phase 6)

export const RISK_TOLERANCE_TIERS = Object.freeze([
  "CONSERVATIVE",
  "MODERATE",
  "AGGRESSIVE",
  "INSTITUTIONAL_MANDATE"
]);

export function createDefaultMandate() {
  return {
    risk_tolerance: "CONSERVATIVE",
    base_currency: "USD",
    permitted_instruments: ["XAUUSD", "BTC/USD"],
    max_portfolio_drawdown_pct: 10.0,
    max_daily_loss_pct: 2.0,
    mandate_notes: "Initial institutional preservation mandate focusing on XAUUSD.",
    updated_at: new Date().toISOString()
  };
}

/**
 * Enforces investor mandate constraints prior to subscribing/allocating to a strategy.
 */
export function validateAgainstMandate({ mandate, strategy, requestedMaxDrawdownPct } = {}) {
  const m = mandate || createDefaultMandate();
  if (!strategy) return { allowed: false, code: "STRATEGY_MISSING", message: "Strategy not provided." };

  const inst = String(strategy.instrument || "XAUUSD").replace("/", "").toUpperCase();
  const permitted = new Set(
    (m.permitted_instruments || []).map((s) => String(s).replace("/", "").toUpperCase())
  );
  if (permitted.size > 0 && !permitted.has(inst)) {
    return {
      allowed: false,
      code: "MANDATE_INSTRUMENT_RESTRICTED",
      message: `Investor mandate permits [${[...permitted].join(", ")}], which excludes '${strategy.instrument}'.`
    };
  }

  if (m.risk_tolerance === "CONSERVATIVE" && strategy.risk_level === "high") {
    return {
      allowed: false,
      code: "MANDATE_RISK_TIER_EXCEEDED",
      message: "CONSERVATIVE investor mandate prohibits allocating to 'high' risk strategies."
    };
  }

  if (requestedMaxDrawdownPct != null && Number(requestedMaxDrawdownPct) > Number(m.max_portfolio_drawdown_pct) + 1e-9) {
    return {
      allowed: false,
      code: "MANDATE_DRAWDOWN_EXCEEDED",
      message: `Requested stop-drawdown (${requestedMaxDrawdownPct}%) exceeds mandate ceiling (${m.max_portfolio_drawdown_pct}%).`
    };
  }

  return { allowed: true, code: "MANDATE_COMPLIANT" };
}

/**
 * High-Water-Mark (HWM) Management & Performance Fee Accounting Calculator.
 * Explicitly disabled from real billing until regulatory licensing & custody are established.
 */
export function computeFeeSchedule({
  beginningEquity,
  endingEquity,
  highWaterMarkEquity,
  annualMgmtFeePct = 1.0,
  performanceFeePct = 15.0,
  periodDays = 30
} = {}) {
  const beg = Number(beginningEquity);
  const end = Number(endingEquity);
  const hwm = Math.max(Number(highWaterMarkEquity || beg), beg);

  if (!Number.isFinite(beg) || beg < 0 || !Number.isFinite(end) || end < 0) {
    return { ok: false, error: "Equity values must be non-negative finite numbers." };
  }

  const mgmtPct = Math.min(5.0, Math.max(0, Number(annualMgmtFeePct) || 0));
  const perfPct = Math.min(50.0, Math.max(0, Number(performanceFeePct) || 0));
  const days = Math.max(1, Math.min(366, Number(periodDays) || 30));

  const avgEquity = (beg + end) / 2;
  const managementFeeUsd = Number((avgEquity * (mgmtPct / 100) * (days / 365)).toFixed(2));
  const equityAfterMgmt = Math.max(0, end - managementFeeUsd);

  const profitAboveHwm = Math.max(0, equityAfterMgmt - hwm);
  const performanceFeeUsd = Number((profitAboveHwm * (perfPct / 100)).toFixed(2));
  const newHighWaterMark = Number(Math.max(hwm, equityAfterMgmt - performanceFeeUsd).toFixed(2));
  const totalFeeUsd = Number((managementFeeUsd + performanceFeeUsd).toFixed(2));

  return {
    ok: true,
    billing_status: "ACCOUNTING_FRAMEWORK_ONLY_NO_BILLING",
    disclosure: "Accounting preview only. UltraLOB collects zero fees until regulatory authorization and custody arrangements are established.",
    period_days: days,
    beginning_equity: Number(beg.toFixed(2)),
    ending_equity_gross: Number(end.toFixed(2)),
    prior_high_water_mark: Number(hwm.toFixed(2)),
    management_fee_usd: managementFeeUsd,
    profit_above_hwm_usd: Number(profitAboveHwm.toFixed(2)),
    performance_fee_usd: performanceFeeUsd,
    total_accrued_fee_usd: totalFeeUsd,
    net_ending_equity: Number(Math.max(0, end - totalFeeUsd).toFixed(2)),
    new_high_water_mark: newHighWaterMark
  };
}

/**
 * Generates an institutional portfolio statement separated cleanly by data origin.
 */
export function generateInstitutionalStatement({
  user = {},
  portfolio = {},
  mandate = null,
  broker = null,
  auditLogs = [],
  riskEvents = []
} = {}) {
  const trades = portfolio.trades || [];
  const subs = portfolio.subscriptions || [];
  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status === "closed");

  const realizedPnl = Number(closedTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0).toFixed(2));
  const unrealizedPnl = Number(openTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0).toFixed(2));
  const equity = Number((Number(portfolio.balance || 0) + unrealizedPnl).toFixed(2));
  const hwm = Math.max(Number(portfolio.equity_high_water || 0), equity, Number(portfolio.balance || 0));
  const drawdownPct = hwm > 0 ? Number((((hwm - equity) / hwm) * 100).toFixed(2)) : 0;

  // Attribution grouped strictly by strategyId
  const attributionMap = new Map();
  for (const t of closedTrades) {
    const sid = t.strategyId || "manual";
    const row = attributionMap.get(sid) || {
      strategy_id: sid,
      strategy_name: t.strategy || sid,
      trades_closed: 0,
      winning_trades: 0,
      realized_pnl_usd: 0,
      data_origin: t.data_origin || portfolio.dataOrigin || "PAPER_SANDBOX"
    };
    row.trades_closed += 1;
    if ((Number(t.pnl) || 0) > 0) row.winning_trades += 1;
    row.realized_pnl_usd = Number((row.realized_pnl_usd + (Number(t.pnl) || 0)).toFixed(2));
    attributionMap.set(sid, row);
  }

  return {
    statement_id: "stmt-" + Date.now().toString(36),
    generated_at: new Date().toISOString(),
    account_holder: {
      name: user.name || "Guest Sandbox",
      email: user.email || null,
      role: user.role || "guest",
      organization: user.org_name || null
    },
    data_origin: broker?.upstreamVerified ? "DEMO_BROKER" : (portfolio.dataOrigin || "PAPER_SANDBOX"),
    execution_environment: "DEMO_ONLY",
    summary: {
      balance_usd: Number(Number(portfolio.balance || 0).toFixed(2)),
      equity_usd: equity,
      high_water_mark_usd: Number(hwm.toFixed(2)),
      current_drawdown_pct: drawdownPct,
      realized_pnl_usd: realizedPnl,
      unrealized_pnl_usd: unrealizedPnl,
      active_mandates_count: subs.length,
      open_positions_count: openTrades.length,
      closed_trades_count: closedTrades.length
    },
    mandate: mandate || createDefaultMandate(),
    strategy_attribution: [...attributionMap.values()].map((r) => ({
      ...r,
      win_rate_pct: r.trades_closed > 0 ? Number(((r.winning_trades / r.trades_closed) * 100).toFixed(1)) : null
    })),
    trades: trades.slice(0, 200),
    recent_risk_events: riskEvents.slice(0, 25),
    recent_audit_logs: auditLogs.slice(0, 25)
  };
}

export function formatStatementCsv(statement) {
  const header = [
    "StatementID", "GeneratedAt", "DataOrigin", "TradeID", "Time",
    "Strategy", "Symbol", "Side", "Quantity", "EntryPrice", "ClosePrice", "RealizedPnL", "Status", "Broker"
  ].join(",");

  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = (statement.trades || []).map((t) => [
    statement.statement_id,
    statement.generated_at,
    t.data_origin || statement.data_origin,
    t.id,
    t.time,
    t.strategy,
    t.symbol,
    t.side,
    t.qty,
    t.price,
    t.closePrice ?? "",
    t.pnl ?? 0,
    t.status,
    t.broker
  ].map(esc).join(","));

  return [header, ...rows].join("\n");
}
