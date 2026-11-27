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

function quantileSorted(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo);
}

/**
 * Computes Historical VaR (95%, 99%), Expected Shortfall / CVaR (95%, 99%), and
 * drawdown histogram buckets strictly from actual closed trades / equity snapshots.
 */
export function computePortfolioRiskAnalytics({ trades = [], equityHistory = [], initialCapital = 0 } = {}) {
  const closed = (trades || []).filter((t) => t.status === "closed" && Number.isFinite(Number(t.pnl)));
  const baseCap = Math.max(1, Number(initialCapital || equityHistory?.[0]?.value || 0));

  const returnsPct = [];
  if (closed.length >= 5) {
    let running = baseCap;
    for (const t of closed) {
      const p = Number(t.pnl);
      returnsPct.push((p / Math.max(1, running)) * 100);
      running += p;
    }
  } else if (Array.isArray(equityHistory) && equityHistory.length >= 6) {
    for (let i = 1; i < equityHistory.length; i++) {
      const prev = Number(equityHistory[i - 1]?.value || 0);
      const cur = Number(equityHistory[i]?.value || 0);
      if (prev > 0) returnsPct.push(((cur - prev) / prev) * 100);
    }
  }

  // Drawdown distribution buckets from equity snapshots
  const eqValues = (equityHistory || []).map((p) => Number(p?.value ?? p)).filter(Number.isFinite);
  const ddSeries = [];
  let peak = 0;
  for (const eq of eqValues) {
    peak = Math.max(peak, eq);
    if (peak > 0) ddSeries.push(Number((((peak - eq) / peak) * 100).toFixed(2)));
  }

  const buckets = [
    { label: "0–1%", count: 0 },
    { label: "1–3%", count: 0 },
    { label: "3–5%", count: 0 },
    { label: "5–10%", count: 0 },
    { label: ">10%", count: 0 }
  ];
  for (const dd of ddSeries) {
    if (dd <= 1) buckets[0].count++;
    else if (dd <= 3) buckets[1].count++;
    else if (dd <= 5) buckets[2].count++;
    else if (dd <= 10) buckets[3].count++;
    else buckets[4].count++;
  }

  if (returnsPct.length < 5) {
    return {
      status: "AWAITING_SAMPLE",
      data_origin: "AWAITING_SAMPLE",
      sample_size: returnsPct.length,
      min_required_sample: 5,
      var_95_pct: null,
      var_99_pct: null,
      cvar_95_pct: null,
      cvar_99_pct: null,
      drawdown_distribution: buckets,
      note: "At least 5 closed trades or equity observations are required for historical VaR and Expected Shortfall."
    };
  }

  const sorted = returnsPct.slice().sort((a, b) => a - b); // ascending (worst losses first)
  const var95 = Math.min(0, quantileSorted(sorted, 0.05) ?? 0);
  const var99 = Math.min(0, quantileSorted(sorted, 0.01) ?? 0);
  const tail95 = sorted.filter((r) => r <= var95);
  const tail99 = sorted.filter((r) => r <= var99);
  const cvar95 = tail95.length ? tail95.reduce((a, b) => a + b, 0) / tail95.length : var95;
  const cvar99 = tail99.length ? tail99.reduce((a, b) => a + b, 0) / tail99.length : var99;

  return {
    status: "READY",
    data_origin: closed.length >= 5 ? "EMPIRICAL_TRADES" : "EQUITY_SNAPSHOTS",
    sample_size: returnsPct.length,
    min_required_sample: 5,
    var_95_pct: Number(var95.toFixed(2)),
    var_99_pct: Number(var99.toFixed(2)),
    cvar_95_pct: Number(cvar95.toFixed(2)),
    cvar_99_pct: Number(cvar99.toFixed(2)),
    drawdown_distribution: buckets,
    note: `Historical distribution over ${returnsPct.length} observations.`
  };
}

/**
 * Evaluates deterministic adverse market & liquidity shocks against current portfolio exposure.
 */
export function runPortfolioStressTest({ equity = 0, grossNotional = 0, openTrades = [], riskLimits = {} } = {}) {
  const eq = Math.max(0, Number(equity || 0));
  const openCount = (openTrades || []).filter((t) => t.status === "open").length;
  const gross = Number(grossNotional || 0);
  const maxDdLimit = Number(riskLimits.max_drawdown_pct || 12);

  const scenarios = [
    { id: "gold_gap_down_2pct", name: "XAUUSD -2.0% Liquidity Gap", price_shock_pct: -2.0, spread_mult: 2.0 },
    { id: "vol_spike_5pct", name: "Extreme Macro Shock (-5.0% Exposure)", price_shock_pct: -5.0, spread_mult: 3.5 },
    { id: "spread_widening_200", name: "Spread Widening + Slippage Stress (3x)", price_shock_pct: -0.75, spread_mult: 3.0 }
  ];

  const results = scenarios.map((sc) => {
    const netDirectional = (openTrades || [])
      .filter((t) => t.status === "open")
      .reduce((acc, t) => {
        const val = Number(t.qty || 0) * Number(t.price || 0);
        return acc + (t.side === "BUY" ? val : -val);
      }, 0);

    // Directional loss + friction cost proportional to gross exposure
    const priceImpact = -Math.abs(netDirectional) * (Math.abs(sc.price_shock_pct) / 100);
    const liquidityFriction = -gross * 0.0005 * sc.spread_mult;
    const totalShockUsd = Number((priceImpact + liquidityFriction).toFixed(2));
    const impactPct = eq > 0 ? Number(((totalShockUsd / eq) * 100).toFixed(2)) : 0;
    const breachesDrawdownCap = Math.abs(impactPct) >= maxDdLimit;

    return {
      ...sc,
      classification: "SIMULATED_STRESS_TEST",
      open_positions_evaluated: openCount,
      estimated_pnl_impact_usd: totalShockUsd,
      estimated_equity_impact_pct: impactPct,
      breaches_drawdown_limit: breachesDrawdownCap,
      post_shock_equity_usd: Number(Math.max(0, eq + totalShockUsd).toFixed(2))
    };
  });

  return {
    data_origin: "SIMULATED_RESEARCH",
    evaluated_at: new Date().toISOString(),
    equity_base_usd: Number(eq.toFixed(2)),
    gross_exposure_usd: Number(gross.toFixed(2)),
    scenarios: results
  };
}
