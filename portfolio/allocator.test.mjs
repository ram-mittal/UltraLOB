import test from "node:test";
import assert from "node:assert/strict";
import {
  allocatePortfolio,
  computePortfolioExposure,
  computeStrategyCorrelationMatrix
} from "./allocator.js";

test("allocates capital across RISK_WEIGHTED and VOLATILITY_ADJUSTED with strict caps", () => {
  const candidates = [
    { id: "ul-01", code: "UL-01", instrument: "XAUUSD", risk_per_trade_pct: 0.5, risk_level: "medium", min_capital: 500 },
    { id: "ul-02", code: "UL-02", instrument: "XAUUSD", risk_per_trade_pct: 0.5, risk_level: "high", min_capital: 500 },
    { id: "ul-03", code: "UL-03", instrument: "EURUSD", risk_per_trade_pct: 0.25, risk_level: "low", min_capital: 500 }
  ];

  const rw = allocatePortfolio({
    totalCapital: 10000,
    method: "RISK_WEIGHTED",
    strategies: candidates,
    constraints: { max_allocation_per_strategy_pct: 40, max_instrument_exposure_pct: 60, cash_reserve_floor_pct: 10 }
  });

  // Combined XAUUSD strategies must be scaled cleanly to <= 60% ($6000)
  const xauTotal = rw.allocations.filter((a) => a.instrument === "XAUUSD").reduce((s, a) => s + a.weight_pct, 0);
  assert.ok(xauTotal <= 60.01);
  assert.ok(rw.cash_reserve_usd >= 1000);
  assert.ok(rw.warnings.some((w) => w.includes("XAUUSD")));

  const va = allocatePortfolio({
    totalCapital: 10000,
    method: "VOLATILITY_ADJUSTED",
    strategies: candidates
  });
  const lowVol = va.allocations.find((a) => a.id === "ul-03" || a.strategy_id === "ul-03");
  const highVol = va.allocations.find((a) => a.id === "ul-02" || a.strategy_id === "ul-02");
  assert.ok(lowVol.weight_pct >= highVol.weight_pct);
});

test("computes exposure and never fabricates correlations when return overlap is missing", () => {
  const corr = computeStrategyCorrelationMatrix([
    { id: "ul-01", returns: [] },
    { id: "ul-02", returns: [] }
  ]);
  assert.equal(corr.has_empirical_data, false);
  assert.equal(corr.data_origin, "AWAITING_BACKTEST_OVERLAP");
  assert.equal(corr.matrix["ul-01"]["ul-02"], null);

  const exp = computePortfolioExposure({
    equity: 10000,
    openTrades: [
      { status: "open", symbol: "XAUUSD", side: "BUY", qty: 1, price: 2500 },
      { status: "open", symbol: "XAUUSD", side: "SELL", qty: 0.4, price: 2500 }
    ]
  });
  assert.equal(exp.gross_notional, 3500);
  assert.equal(exp.instruments[0].net_notional, 1500);
  assert.equal(exp.portfolio_leverage, 0.35);
});
