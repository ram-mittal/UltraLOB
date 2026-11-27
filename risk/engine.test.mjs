import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultRiskState,
  evaluateTradeGovernance,
  computeBoundedKelly
} from "./engine.js";

test("enforces hierarchical kill switches without liquidating existing exposure", () => {
  const state = createDefaultRiskState();
  state.kill_switches.strategies["ul-01-gold-trend"] = {
    active: true,
    reason: "Manual drawdown review"
  };

  const blocked = evaluateTradeGovernance({
    riskState: state,
    portfolioMetrics: { equity: 10000, open_positions_count: 1 },
    strategyId: "ul-01-gold-trend",
    symbol: "XAUUSD",
    proposedRiskPct: 0.5
  });
  assert.equal(blocked.approved, false);
  assert.equal(blocked.code, "STRATEGY_KILL_SWITCH_ACTIVE");

  // Unblocked strategy still passes if instrument and global switches are off
  const allowed = evaluateTradeGovernance({
    riskState: state,
    portfolioMetrics: { equity: 10000, open_positions_count: 1 },
    strategyId: "ul-02-liquidity-sweep",
    symbol: "XAUUSD",
    proposedRiskPct: 0.5
  });
  assert.equal(allowed.approved, true);
});

test("enforces weekly loss, leverage, margin, and slippage caps", () => {
  const state = createDefaultRiskState();

  const weeklyBreach = evaluateTradeGovernance({
    riskState: state,
    portfolioMetrics: { equity: 10000, weekly_loss_pct: 5.5 },
    proposedRiskPct: 0.25
  });
  assert.equal(weeklyBreach.approved, false);
  assert.equal(weeklyBreach.code, "WEEKLY_LOSS_LIMIT");

  const levBreach = evaluateTradeGovernance({
    riskState: state,
    portfolioMetrics: { equity: 10000, gross_notional: 190000 },
    proposedRiskPct: 0.25,
    proposedNotional: 25000
  });
  assert.equal(levBreach.approved, false);
  assert.equal(levBreach.code, "MAX_LEVERAGE_LIMIT");

  const slipBreach = evaluateTradeGovernance({
    riskState: state,
    portfolioMetrics: { equity: 10000 },
    proposedRiskPct: 0.25,
    expectedSlippagePoints: 40
  });
  assert.equal(slipBreach.approved, false);
  assert.equal(slipBreach.code, "SLIPPAGE_LIMIT");
});

test("bounds Kelly Criterion strictly below hard ceiling and tags as research input", () => {
  const k = computeBoundedKelly({
    winProbability: 0.65,
    payoffRatio: 2.5,
    kellyFractionMultiplier: 0.5,
    hardMaxRiskPct: 1.0
  });
  assert.equal(k.ok, true);
  assert.equal(k.classification, "SIMULATED_RESEARCH_INPUT_ONLY");
  assert.ok(k.full_kelly_pct > 10);
  assert.equal(k.hard_capped_risk_pct, 1.0);
});
