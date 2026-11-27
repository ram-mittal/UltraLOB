// UltraLOB AI — Engines 1..5 & Decision Synthesis Engine (Phase 5)
// Strictly advisory by design: never bypasses hard Risk Engine limits or invents market/backtest numbers.

import { evaluateTradeGovernance } from "../risk/engine.js";
import { computePortfolioExposure } from "../portfolio/allocator.js";
import { evaluateEventRestriction } from "./events.js";

function utcSessionLabel(tsMs = Date.now()) {
  const h = new Date(tsMs).getUTCHours();
  if (h >= 0 && h < 7) return "ASIA";
  if (h >= 7 && h < 13) return "LONDON";
  if (h >= 13 && h <= 20) return "NEW_YORK_OVERLAP";
  return "ROLLOVER_OFF_HOURS";
}

/**
 * Engine 1: Market Intelligence Engine
 */
export function runMarketIntelligence({ symbol = "XAUUSD", candles = [], nowMs = Date.now() } = {}) {
  const session = utcSessionLabel(nowMs);
  if (!Array.isArray(candles) || candles.length < 20) {
    return {
      engine: "MarketIntelligenceEngine",
      data_origin: "AWAITING_MARKET_DATA",
      symbol,
      session,
      regime: "AWAITING_DATA",
      ema_fast: null,
      ema_slow: null,
      atr_pct: null,
      last_close: null,
      note: "Insufficient OHLCV candles supplied for market regime classification."
    };
  }

  const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
  const ema = (vals, n) => {
    const k = 2 / (n + 1);
    let e = vals.slice(0, n).reduce((a, b) => a + b, 0) / n;
    for (let i = n; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
    return e;
  };
  const emaFast = ema(closes, Math.min(12, closes.length));
  const emaSlow = ema(closes, Math.min(26, closes.length));
  const lastClose = closes[closes.length - 1];

  // Simple ATR(14) proxy
  const trs = [];
  for (let i = Math.max(1, candles.length - 14); i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atr = trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0;
  const atrPct = lastClose > 0 ? (atr / lastClose) * 100 : 0;

  let regime = "RANGE_BOUND";
  if (atrPct > 0.85) regime = "HIGH_VOLATILITY";
  else if (emaFast > emaSlow * 1.0015) regime = "TRENDING_BULLISH";
  else if (emaFast < emaSlow * 0.9985) regime = "TRENDING_BEARISH";

  return {
    engine: "MarketIntelligenceEngine",
    data_origin: candles[0]?.data_origin || "REAL_MARKET",
    symbol,
    session,
    regime,
    last_close: Number(lastClose.toFixed(2)),
    ema_fast: Number(emaFast.toFixed(2)),
    ema_slow: Number(emaSlow.toFixed(2)),
    atr_pct: Number(atrPct.toFixed(4)),
    candle_count: candles.length
  };
}

/**
 * Engine 2: Quantitative Research Engine
 */
export function runQuantEvaluation({ strategy = null, latestBacktest = null } = {}) {
  if (!strategy) {
    return {
      engine: "QuantResearchEngine",
      data_origin: "UNKNOWN",
      validated: false,
      lifecycle_status: "UNKNOWN",
      note: "Strategy not found in registry."
    };
  }
  const validated = strategy.lifecycle_status !== "RESEARCH";
  const empiricalMetrics = latestBacktest?.metrics || (strategy.total_return != null ? {
    total_return_pct: strategy.total_return,
    sharpe_ratio: strategy.sharpe_ratio,
    max_drawdown_pct: strategy.max_drawdown,
    win_rate_pct: strategy.win_rate,
    total_trades: strategy.total_trades
  } : null);

  return {
    engine: "QuantResearchEngine",
    strategy_id: strategy.id,
    code: strategy.code,
    version: strategy.version,
    lifecycle_status: strategy.lifecycle_status,
    data_origin: strategy.data_source_label || strategy.lifecycle_status,
    validated,
    empirical_metrics: empiricalMetrics,
    note: validated
      ? `Validated through ${strategy.lifecycle_status} gate.`
      : "Strategy remains in RESEARCH stage without empirical historical validation."
  };
}

/**
 * Engine 4: Portfolio Fit & Correlation Engine
 */
export function runPortfolioFit({ portfolioMetrics = {}, subscriptions = [], exposure = null, symbol = "XAUUSD", proposedAllocationUsd = 0 } = {}) {
  const exp = exposure || computePortfolioExposure({ equity: portfolioMetrics.equity || 0, subscriptions });
  const cleanSym = String(symbol || "").toUpperCase();
  const symExp = (exp.instruments || []).find((i) => i.symbol === cleanSym);
  const eq = Number(portfolioMetrics.equity || 0);
  const curAllocPct = symExp ? symExp.allocation_pct_of_equity : 0;
  const projectedPct = eq > 0 ? Number((curAllocPct + (proposedAllocationUsd / eq) * 100).toFixed(2)) : 0;

  return {
    engine: "PortfolioEngine",
    equity: eq,
    current_leverage: exp.portfolio_leverage,
    symbol_allocation_pct: curAllocPct,
    projected_symbol_allocation_pct: projectedPct,
    concentration_warning: projectedPct > 60 ? `${cleanSym} projected allocation (${projectedPct}%) exceeds 60% concentration guideline.` : null
  };
}

/**
 * Engine 5: Execution Quality Engine
 */
export function runExecutionAssessment({ broker = null, spreadPoints = null, maxSpreadPoints = 100, postgresConfigured = false } = {}) {
  const spreadOk = spreadPoints == null || Number(spreadPoints) <= Number(maxSpreadPoints);
  return {
    engine: "ExecutionEngine",
    broker_paired: Boolean(broker),
    broker_name: broker?.name || "Paper Sandbox Engine",
    environment: "DEMO_ONLY",
    postgres_execution_configured: Boolean(postgresConfigured),
    observed_spread_points: spreadPoints,
    spread_ok: spreadOk,
    note: broker
      ? "MT5 Demo bridge paired; subject to live EA heartbeat & OrderCheck."
      : "No MT5 terminal paired; operating in Paper Sandbox."
  };
}

/**
 * Engine 7: Decision Synthesis Engine (Advisory Mode Only)
 * Pipeline: Market Data -> Quant -> Risk Gate -> Portfolio -> Execution -> Events -> Advisory Decision
 */
export function evaluateAdvisoryPipeline({
  strategy,
  latestBacktest = null,
  symbol = "XAUUSD",
  side = "BUY",
  proposedRiskPct = 0.5,
  proposedAllocationUsd = 1000,
  spreadPoints = null,
  candles = [],
  portfolioMetrics = {},
  subscriptions = [],
  riskState,
  broker = null,
  postgresConfigured = false,
  macroEvents = [],
  customBlackouts = [],
  nowMs = Date.now()
} = {}) {
  // 1-6 Deterministic sub-engines
  const market = runMarketIntelligence({ symbol, candles, nowMs });
  const quant = runQuantEvaluation({ strategy, latestBacktest });
  const portfolio = runPortfolioFit({ portfolioMetrics, subscriptions, symbol, proposedAllocationUsd });
  const execution = runExecutionAssessment({
    broker,
    spreadPoints,
    maxSpreadPoints: riskState?.limits?.max_spread_points ?? 100,
    postgresConfigured
  });
  const events = evaluateEventRestriction({ symbol, events: macroEvents, customBlackouts, nowMs });

  // Engine 3: Independent Hard Risk Engine (cannot be overridden by AI)
  const riskCheck = evaluateTradeGovernance({
    riskState,
    portfolioMetrics,
    strategyId: strategy?.id || null,
    symbol,
    proposedRiskPct,
    currentSpreadPoints: spreadPoints
  });

  // Determine advisory synthesis strictly honoring deterministic gates
  let decision = "APPROVE_ADVISORY";
  let confidence = 0.72;
  const reasons = [];

  if (!riskCheck.approved) {
    decision = "BLOCKED_BY_RISK";
    confidence = 0.0;
    reasons.push(`Independent Risk Engine veto (${riskCheck.code}): ${riskCheck.message}`);
  } else if (!quant.validated) {
    decision = "BLOCKED_BY_LIFECYCLE";
    confidence = 0.15;
    reasons.push(`${quant.code || "Strategy"} is in ${quant.lifecycle_status} status; empirical validation required prior to execution.`);
  } else if (events.restricted) {
    decision = "BLOCKED_BY_MACRO_EVENT";
    confidence = 0.2;
    reasons.push(`Active high-impact macro blackout: ${events.active_restrictions.map((r) => r.title).join(", ")}.`);
  } else {
    // Market alignment score when regime data exists
    if (market.regime === "TRENDING_BULLISH" && side === "SELL") {
      decision = "HOLD_WAIT";
      confidence = 0.4;
      reasons.push("Counter-trend SELL conflicts with detected TRENDING_BULLISH regime.");
    } else if (market.regime === "TRENDING_BEARISH" && side === "BUY") {
      decision = "HOLD_WAIT";
      confidence = 0.4;
      reasons.push("Counter-trend BUY conflicts with detected TRENDING_BEARISH regime.");
    } else {
      reasons.push("Independent Risk Gate passed.");
      reasons.push(`Quant lifecycle gate verified (${quant.lifecycle_status}).`);
      reasons.push(`Macro window is ${events.status}.`);
      if (portfolio.concentration_warning) {
        confidence -= 0.15;
        reasons.push(portfolio.concentration_warning);
      }
      if (market.regime === "AWAITING_DATA") {
        confidence = Math.min(confidence, 0.55);
        reasons.push("Live XAUUSD regime feed awaiting candles; verify terminal chart context before human approval.");
      }
    }
  }

  return {
    mode: "ADVISORY",
    autonomous_override_permitted: false,
    decision,
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(2)),
    proposal: {
      strategy_id: strategy?.id || null,
      symbol,
      side,
      proposed_risk_pct: Number(proposedRiskPct),
      proposed_allocation_usd: Number(proposedAllocationUsd)
    },
    pipeline_stages: {
      "1_market_intelligence": market,
      "2_quant_research": quant,
      "3_risk_engine": { engine: "IndependentRiskEngine", ...riskCheck },
      "4_portfolio_fit": portfolio,
      "5_execution_quality": execution,
      "6_event_intelligence": events
    },
    rationale: reasons.join(" "),
    requires_human_approval: true,
    evaluated_at: new Date(nowMs).toISOString()
  };
}
