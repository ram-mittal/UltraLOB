// Portfolio Allocation, Exposure Aggregation & Empirical Correlation Engine (Phase 4)

export const ALLOCATION_METHODS = Object.freeze([
  "FIXED",
  "RISK_WEIGHTED",
  "VOLATILITY_ADJUSTED",
  "EQUAL_RISK_CONTRIBUTION",
  "FRACTIONAL"
]);

function stdDev(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function pearsonCorrelation(a, b) {
  const len = Math.min(a?.length || 0, b?.length || 0);
  if (len < 3) return null;
  const sa = a.slice(0, len);
  const sb = b.slice(0, len);
  const ma = sa.reduce((x, y) => x + y, 0) / len;
  const mb = sb.reduce((x, y) => x + y, 0) / len;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < len; i++) {
    const xa = sa[i] - ma;
    const xb = sb[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const denom = Math.sqrt(da * db);
  if (denom <= 1e-12) return null;
  return Number((num / denom).toFixed(3));
}

/**
 * Computes empirical pairwise correlations strictly from backtest / broker return series.
 * Never fabricates correlations when fewer than 3 overlapping return points exist.
 */
export function computeStrategyCorrelationMatrix(strategies = []) {
  const matrix = {};
  let hasEmpiricalData = false;

  for (const sA of strategies) {
    matrix[sA.id] = {};
    const retA = Array.isArray(sA.returns) ? sA.returns : [];
    for (const sB of strategies) {
      if (sA.id === sB.id) {
        matrix[sA.id][sB.id] = retA.length >= 2 ? 1.0 : null;
      } else {
        const retB = Array.isArray(sB.returns) ? sB.returns : [];
        const corr = pearsonCorrelation(retA, retB);
        if (corr !== null) hasEmpiricalData = true;
        matrix[sA.id][sB.id] = corr;
      }
    }
  }

  return {
    has_empirical_data: hasEmpiricalData,
    data_origin: hasEmpiricalData ? "EMPIRICAL_RETURNS" : "AWAITING_BACKTEST_OVERLAP",
    matrix
  };
}

/**
 * Aggregates net and gross exposure per instrument across open positions & active mandates.
 */
export function computePortfolioExposure({ equity = 0, openTrades = [], subscriptions = [] } = {}) {
  const bySymbol = new Map();
  let grossNotional = 0;

  for (const t of openTrades) {
    if (t.status !== "open") continue;
    const symbol = String(t.symbol || "UNKNOWN").toUpperCase();
    const qty = Number(t.qty || 0);
    const price = Number(t.price || 0);
    // For XAUUSD in sandbox/demo, treat spot * qty as base notional unless contract size specified
    const notional = Number((qty * price * Number(t.contractSize || 1)).toFixed(2));
    const signed = t.side === "BUY" ? notional : -notional;
    grossNotional += notional;

    const entry = bySymbol.get(symbol) || {
      symbol,
      long_notional: 0,
      short_notional: 0,
      net_notional: 0,
      gross_notional: 0,
      open_positions: 0,
      allocated_mandate_usd: 0
    };
    if (signed >= 0) entry.long_notional += notional;
    else entry.short_notional += notional;
    entry.net_notional = Number((entry.long_notional - entry.short_notional).toFixed(2));
    entry.gross_notional = Number((entry.long_notional + entry.short_notional).toFixed(2));
    entry.open_positions += 1;
    bySymbol.set(symbol, entry);
  }

  for (const sub of subscriptions) {
    const symbol = String(sub.instrument || "XAUUSD").toUpperCase();
    const entry = bySymbol.get(symbol) || {
      symbol,
      long_notional: 0,
      short_notional: 0,
      net_notional: 0,
      gross_notional: 0,
      open_positions: 0,
      allocated_mandate_usd: 0
    };
    entry.allocated_mandate_usd += Number(sub.allocation || 0);
    bySymbol.set(symbol, entry);
  }

  const eq = Math.max(0, Number(equity || 0));
  const instruments = [...bySymbol.values()].map((item) => ({
    ...item,
    exposure_pct_of_equity: eq > 0 ? Number(((item.gross_notional / eq) * 100).toFixed(2)) : 0,
    allocation_pct_of_equity: eq > 0 ? Number(((item.allocated_mandate_usd / eq) * 100).toFixed(2)) : 0
  }));

  return {
    equity: Number(eq.toFixed(2)),
    gross_notional: Number(grossNotional.toFixed(2)),
    portfolio_leverage: eq > 0 ? Number((grossNotional / eq).toFixed(3)) : 0,
    instruments
  };
}

/**
 * Computes portfolio capital allocations subject to hard per-strategy and per-instrument limits.
 */
export function allocatePortfolio({
  totalCapital,
  method = "RISK_WEIGHTED",
  strategies = [],
  constraints = {}
} = {}) {
  const capital = Number(totalCapital);
  if (!Number.isFinite(capital) || capital <= 0) {
    throw new Error("totalCapital must be a positive number.");
  }
  const cleanMethod = String(method).toUpperCase();
  if (!ALLOCATION_METHODS.includes(cleanMethod)) {
    throw new Error(`Unsupported allocation method '${method}'.`);
  }
  if (!Array.isArray(strategies) || strategies.length === 0) {
    return {
      method: cleanMethod,
      total_capital: capital,
      investable_capital: 0,
      cash_reserve_usd: capital,
      allocations: [],
      warnings: ["No candidate strategies supplied."]
    };
  }

  const maxStrategyPct = Math.min(100, Math.max(5, Number(constraints.max_allocation_per_strategy_pct ?? 35)));
  const maxInstrumentPct = Math.min(100, Math.max(5, Number(constraints.max_instrument_exposure_pct ?? 60)));
  const cashReservePct = Math.min(90, Math.max(0, Number(constraints.cash_reserve_floor_pct ?? 10)));

  const investablePct = 100 - cashReservePct;
  const warnings = [];

  // Raw scores by method
  const rawWeights = strategies.map((s) => {
    const empiricalVol = stdDev(s.returns);
    const volProxy = empiricalVol !== null && empiricalVol > 1e-6
      ? empiricalVol
      : Number(s.volatility_proxy || (s.risk_level === "high" ? 0.03 : s.risk_level === "low" ? 0.01 : 0.02));
    const riskPct = Math.max(0.05, Number(s.risk_per_trade_pct ?? 0.5));

    if (cleanMethod === "FIXED") {
      return Math.max(0, Number(s.target_weight ?? (1 / strategies.length)));
    }
    if (cleanMethod === "RISK_WEIGHTED") {
      return riskPct;
    }
    if (cleanMethod === "VOLATILITY_ADJUSTED") {
      return 1 / volProxy;
    }
    if (cleanMethod === "EQUAL_RISK_CONTRIBUTION") {
      // With uncorrelated or baseline diagonal covariance assumption, ERC weight ~ 1 / sigma_i * 1 / sqrt(cor_penalty)
      const corrPenalty = Math.max(1, Number(s.avg_abs_correlation || 1));
      return 1 / (volProxy * Math.sqrt(corrPenalty));
    }
    // FRACTIONAL
    return Math.max(0, Number(s.fractional_weight ?? (1 / strategies.length)));
  });

  const rawSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  let weightsPct = rawWeights.map((w) => (w / rawSum) * investablePct);

  // Enforce per-strategy ceiling iteratively (redistribute clipped excess only to uncapped names)
  for (let iter = 0; iter < 5; iter++) {
    let excess = 0;
    const uncappedIdx = [];
    for (let i = 0; i < weightsPct.length; i++) {
      if (weightsPct[i] > maxStrategyPct) {
        excess += weightsPct[i] - maxStrategyPct;
        weightsPct[i] = maxStrategyPct;
      } else if (weightsPct[i] < maxStrategyPct - 1e-6) {
        uncappedIdx.push(i);
      }
    }
    if (excess <= 1e-6 || uncappedIdx.length === 0) break;
    const share = excess / uncappedIdx.length;
    for (const i of uncappedIdx) {
      weightsPct[i] += share;
    }
  }

  // Enforce per-instrument combined exposure ceiling
  const byInstrument = new Map();
  strategies.forEach((s, i) => {
    const inst = String(s.instrument || "XAUUSD").toUpperCase();
    if (!byInstrument.has(inst)) byInstrument.set(inst, []);
    byInstrument.get(inst).push(i);
  });

  for (const [inst, indices] of byInstrument.entries()) {
    const totalInstPct = indices.reduce((acc, idx) => acc + weightsPct[idx], 0);
    if (totalInstPct > maxInstrumentPct) {
      const scale = maxInstrumentPct / totalInstPct;
      for (const idx of indices) {
        weightsPct[idx] *= scale;
      }
      warnings.push(`Scaled combined ${inst} allocation from ${totalInstPct.toFixed(1)}% down to ${maxInstrumentPct}% instrument limit.`);
    }
  }

  const totalRiskWeighted = strategies.reduce((acc, s, i) => {
    return acc + weightsPct[i] * Math.max(0.05, Number(s.risk_per_trade_pct ?? 0.5));
  }, 0) || 1;

  const allocations = strategies.map((s, i) => {
    const weightPct = Number(weightsPct[i].toFixed(2));
    const allocatedUsd = Number(((capital * weightPct) / 100).toFixed(2));
    const riskPerTrade = Number(s.risk_per_trade_pct ?? 0.5);
    const riskContributionPct = Number((((weightsPct[i] * riskPerTrade) / totalRiskWeighted) * 100).toFixed(2));
    const belowMin = allocatedUsd < Number(s.min_capital || 0);
    if (belowMin) {
      warnings.push(`${s.code || s.id}: allocated $${allocatedUsd} is below min_capital $${s.min_capital}.`);
    }
    return {
      strategy_id: s.id,
      code: s.code || s.id,
      name: s.name || s.id,
      instrument: String(s.instrument || "XAUUSD").toUpperCase(),
      lifecycle_status: s.lifecycle_status || "RESEARCH",
      weight_pct: weightPct,
      risk_contribution_pct: riskContributionPct,
      allocated_usd: allocatedUsd,
      risk_per_trade_pct: riskPerTrade,
      vol_source: Array.isArray(s.returns) && s.returns.length >= 2 ? "EMPIRICAL_RETURNS" : "SPEC_PROXY",
      meets_min_capital: !belowMin
    };
  });

  const totalAllocatedUsd = Number(allocations.reduce((sum, a) => sum + a.allocated_usd, 0).toFixed(2));
  const cashReserveUsd = Number(Math.max(0, capital - totalAllocatedUsd).toFixed(2));

  return {
    method: cleanMethod,
    total_capital: Number(capital.toFixed(2)),
    investable_capital: totalAllocatedUsd,
    cash_reserve_usd: cashReserveUsd,
    constraints_applied: {
      max_allocation_per_strategy_pct: maxStrategyPct,
      max_instrument_exposure_pct: maxInstrumentPct,
      cash_reserve_floor_pct: cashReservePct
    },
    allocations,
    warnings
  };
}
