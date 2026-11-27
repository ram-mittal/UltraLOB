// Independent Portfolio & Trade Risk Governance Engine (Phase 4)
// Enforces hard quantitative risk limits and hierarchical kill switches
// independently of UltraLOB AI recommendations or strategy outputs.

export function createDefaultRiskState() {
  return {
    limits: {
      max_risk_per_trade_pct: 0.5,
      max_daily_loss_pct: 2.0,
      max_weekly_loss_pct: 5.0,
      max_monthly_loss_pct: 10.0,
      max_drawdown_pct: 12.0,
      max_open_positions: 5,
      max_leverage: 20.0,
      max_margin_usage_pct: 60.0,
      max_spread_points: 100.0,
      max_slippage_points: 25.0
    },
    kill_switches: {
      global_active: false,
      global_reason: null,
      strategies: {},   // { [strategyId]: { active: true, reason, triggered_at, actor } }
      instruments: {}   // { [symbol]: { active: true, reason, triggered_at, actor } }
    },
    updated_at: new Date().toISOString()
  };
}

/**
 * Evaluates a trade or signal strictly against all hard portfolio & execution limits.
 * Kill switches block NEW orders only and never silently liquidate open positions.
 */
export function evaluateTradeGovernance({
  riskState,
  portfolioMetrics = {},
  strategyId = null,
  symbol = "",
  proposedRiskPct = 0.5,
  proposedNotional = 0,
  proposedMargin = 0,
  currentSpreadPoints = null,
  expectedSlippagePoints = null
} = {}) {
  const state = riskState || createDefaultRiskState();
  const limits = state.limits;
  const ks = state.kill_switches;
  const cleanSymbol = String(symbol || "").replace("/", "").toUpperCase();

  // 1. Hierarchical Kill Switches (Global -> Strategy -> Instrument)
  if (ks.global_active) {
    return {
      approved: false,
      code: "GLOBAL_KILL_SWITCH_ACTIVE",
      message: `Global kill switch is active (${ks.global_reason || "Halted by risk governance"}). Existing positions remain untouched; new entries are blocked.`
    };
  }
  if (strategyId && ks.strategies?.[strategyId]?.active) {
    return {
      approved: false,
      code: "STRATEGY_KILL_SWITCH_ACTIVE",
      message: `Strategy '${strategyId}' kill switch is active (${ks.strategies[strategyId].reason || "Halted"}).`
    };
  }
  if (cleanSymbol && ks.instruments?.[cleanSymbol]?.active) {
    return {
      approved: false,
      code: "INSTRUMENT_KILL_SWITCH_ACTIVE",
      message: `Instrument '${cleanSymbol}' kill switch is active (${ks.instruments[cleanSymbol].reason || "Halted"}).`
    };
  }

  // 2. Capital & Position Count
  const equity = Number(portfolioMetrics.equity ?? portfolioMetrics.balance ?? 0);
  if (!Number.isFinite(equity) || equity <= 0) {
    return {
      approved: false,
      code: "NO_ALLOCATED_CAPITAL",
      message: "Portfolio equity is $0. Fund sandbox capital or pair an active demo account first."
    };
  }

  const openPositions = Number(portfolioMetrics.open_positions_count || 0);
  if (openPositions >= Number(limits.max_open_positions)) {
    return {
      approved: false,
      code: "MAX_OPEN_POSITIONS",
      message: `Open position cap (${limits.max_open_positions}) reached.`
    };
  }

  // 3. Multi-Horizon Loss & Drawdown Limits (Daily / Weekly / Monthly / Peak-to-Trough)
  const dailyLossPct = Number(portfolioMetrics.daily_loss_pct || 0);
  const weeklyLossPct = Number(portfolioMetrics.weekly_loss_pct || 0);
  const monthlyLossPct = Number(portfolioMetrics.monthly_loss_pct || 0);
  const drawdownPct = Number(portfolioMetrics.drawdown_pct || 0);

  if (dailyLossPct >= Number(limits.max_daily_loss_pct)) {
    return { approved: false, code: "DAILY_LOSS_LIMIT", message: `Daily loss (${dailyLossPct.toFixed(2)}%) reached limit (${limits.max_daily_loss_pct}%).` };
  }
  if (weeklyLossPct >= Number(limits.max_weekly_loss_pct)) {
    return { approved: false, code: "WEEKLY_LOSS_LIMIT", message: `Weekly loss (${weeklyLossPct.toFixed(2)}%) reached limit (${limits.max_weekly_loss_pct}%).` };
  }
  if (monthlyLossPct >= Number(limits.max_monthly_loss_pct)) {
    return { approved: false, code: "MONTHLY_LOSS_LIMIT", message: `Monthly loss (${monthlyLossPct.toFixed(2)}%) reached limit (${limits.max_monthly_loss_pct}%).` };
  }
  if (drawdownPct >= Number(limits.max_drawdown_pct)) {
    return { approved: false, code: "MAX_DRAWDOWN_LIMIT", message: `Portfolio drawdown (${drawdownPct.toFixed(2)}%) reached limit (${limits.max_drawdown_pct}%).` };
  }

  // 4. Per-Trade Risk Budget
  const reqRisk = Number(proposedRiskPct);
  if (Number.isFinite(reqRisk) && reqRisk > Number(limits.max_risk_per_trade_pct) + 1e-9) {
    return {
      approved: false,
      code: "TRADE_RISK_LIMIT",
      message: `Requested trade risk (${reqRisk.toFixed(2)}%) exceeds cap (${limits.max_risk_per_trade_pct}%).`
    };
  }

  // 5. Leverage & Margin Usage Checks
  const curGross = Number(portfolioMetrics.gross_notional || 0);
  const newLeverage = (curGross + Math.max(0, Number(proposedNotional || 0))) / equity;
  if (newLeverage > Number(limits.max_leverage) + 1e-9) {
    return {
      approved: false,
      code: "MAX_LEVERAGE_LIMIT",
      message: `Projected portfolio leverage (${newLeverage.toFixed(2)}x) exceeds hard cap (${limits.max_leverage}x).`
    };
  }

  const curMargin = Number(portfolioMetrics.margin_used || 0);
  const marginPct = ((curMargin + Math.max(0, Number(proposedMargin || 0))) / equity) * 100;
  if (marginPct > Number(limits.max_margin_usage_pct) + 1e-9) {
    return {
      approved: false,
      code: "MAX_MARGIN_LIMIT",
      message: `Projected margin utilization (${marginPct.toFixed(1)}%) exceeds limit (${limits.max_margin_usage_pct}%).`
    };
  }

  // 6. Execution Quality Gates (Spread & Slippage)
  if (currentSpreadPoints != null && Number(currentSpreadPoints) > Number(limits.max_spread_points)) {
    return {
      approved: false,
      code: "SPREAD_LIMIT",
      message: `Current spread (${currentSpreadPoints} pts) exceeds max spread (${limits.max_spread_points} pts).`
    };
  }
  if (expectedSlippagePoints != null && Number(expectedSlippagePoints) > Number(limits.max_slippage_points)) {
    return {
      approved: false,
      code: "SLIPPAGE_LIMIT",
      message: `Observed slippage (${expectedSlippagePoints} pts) exceeds max slippage (${limits.max_slippage_points} pts).`
    };
  }

  return {
    approved: true,
    code: "RISK_APPROVED",
    projected_leverage: Number(newLeverage.toFixed(3)),
    projected_margin_pct: Number(marginPct.toFixed(2))
  };
}

/**
 * Optional research-only bounded Kelly Criterion calculator.
 * Never bypasses or overrides hard risk limits.
 */
export function computeBoundedKelly({
  winProbability,
  payoffRatio,
  kellyFractionMultiplier = 0.5,
  hardMaxRiskPct = 1.0
}) {
  const p = Number(winProbability);
  const b = Number(payoffRatio);
  if (!Number.isFinite(p) || p <= 0 || p >= 1 || !Number.isFinite(b) || b <= 0) {
    return { ok: false, error: "Provide winProbability in (0, 1) and positive payoffRatio." };
  }
  const q = 1 - p;
  const fullKellyPct = Math.max(0, (p - q / b) * 100);
  const fractionalKellyPct = fullKellyPct * Math.min(1, Math.max(0.1, Number(kellyFractionMultiplier) || 0.5));
  const boundedRiskPct = Number(Math.min(Number(hardMaxRiskPct) || 1.0, fractionalKellyPct).toFixed(3));

  return {
    ok: true,
    classification: "SIMULATED_RESEARCH_INPUT_ONLY",
    full_kelly_pct: Number(fullKellyPct.toFixed(3)),
    fractional_kelly_pct: Number(fractionalKellyPct.toFixed(3)),
    hard_capped_risk_pct: boundedRiskPct,
    warning: "Research input only. Subject to independent hard portfolio risk caps."
  };
}
