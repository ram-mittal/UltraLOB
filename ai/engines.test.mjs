import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultRiskState } from "../risk/engine.js";
import { evaluateEventRestriction } from "./events.js";
import { evaluateAdvisoryPipeline } from "./engines.js";

test("AI advisory pipeline never bypasses Risk Engine veto or lifecycle gates", () => {
  const riskState = createDefaultRiskState();
  riskState.kill_switches.global_active = true;
  riskState.kill_switches.global_reason = "Emergency risk halt";

  const strat = { id: "ul-01-gold-trend", code: "UL-01", version: "1.0.0", lifecycle_status: "BACKTESTED" };

  const blocked = evaluateAdvisoryPipeline({
    strategy: strat,
    symbol: "XAUUSD",
    side: "BUY",
    proposedRiskPct: 0.5,
    portfolioMetrics: { equity: 10000, open_positions_count: 0 },
    riskState
  });
  assert.equal(blocked.mode, "ADVISORY");
  assert.equal(blocked.autonomous_override_permitted, false);
  assert.equal(blocked.decision, "HALT");
  assert.equal(blocked.gate_status, "BLOCKED_BY_RISK");
  assert.equal(blocked.pipeline_stages["3_risk_engine"].approved, false);

  // Unblocked risk + RESEARCH lifecycle puts recommendation in WAIT
  riskState.kill_switches.global_active = false;
  const researchBlocked = evaluateAdvisoryPipeline({
    strategy: { ...strat, lifecycle_status: "RESEARCH" },
    symbol: "XAUUSD",
    side: "BUY",
    proposedRiskPct: 0.5,
    portfolioMetrics: { equity: 10000, open_positions_count: 0 },
    riskState
  });
  assert.equal(researchBlocked.decision, "WAIT");
  assert.equal(researchBlocked.gate_status, "BLOCKED_BY_LIFECYCLE");
  assert.equal(researchBlocked.instrument, "XAUUSD");
  assert.equal(researchBlocked.monetary_risk_usd, 50);
  assert.ok(Array.isArray(researchBlocked.supporting_evidence) && researchBlocked.supporting_evidence.length >= 4);
  assert.ok(researchBlocked.expires_at);

  // Aligned bullish candles yield TRADE on validated strategy
  const bullCandles = Array.from({ length: 30 }, (_, i) => ({
    open: 2600 + i * 1.2,
    high: 2603 + i * 1.2,
    low: 2598 + i * 1.2,
    close: 2602 + i * 1.2,
    data_origin: "REAL_MARKET"
  }));
  const tradeReady = evaluateAdvisoryPipeline({
    strategy: { ...strat, avg_profit_trade: 180, avg_loss_trade: -90 },
    symbol: "XAUUSD",
    side: "BUY",
    proposedRiskPct: 0.5,
    candles: bullCandles,
    portfolioMetrics: { equity: 10000, open_positions_count: 0 },
    riskState
  });
  assert.equal(tradeReady.decision, "TRADE");
  assert.equal(tradeReady.estimated_net_r, 2);
  assert.equal(tradeReady.directional_bias, "LONG (BULLISH)");

  // Unverified EA bridge must never report as active verified broker
  const unverifiedEval = evaluateAdvisoryPipeline({
    strategy: strat,
    symbol: "XAUUSD",
    broker: { name: "MetaTrader 5 (Demo)", upstreamVerified: false, verification_status: "PENDING_EA_HEARTBEAT" },
    portfolioMetrics: { equity: 10000, open_positions_count: 0 },
    riskState
  });
  assert.equal(unverifiedEval.pipeline_stages["5_execution_quality"].broker_paired, true);
  assert.equal(unverifiedEval.pipeline_stages["5_execution_quality"].broker_verified, false);
});

test("Event Intelligence flags active high-impact macro blackouts accurately", () => {
  const nowMs = Date.UTC(2026, 10, 27, 13, 20, 0);
  const restriction = evaluateEventRestriction({
    symbol: "XAUUSD",
    customBlackouts: [{
      id: "nfp-1",
      title: "US Non-Farm Payrolls",
      currency: "USD",
      impact: "HIGH",
      timestamp_utc: new Date(nowMs + 10 * 60_000).toISOString()
    }],
    nowMs
  });
  assert.equal(restriction.status, "RESTRICTED");
  assert.equal(restriction.restricted, true);
  assert.equal(restriction.active_restrictions[0].title, "US Non-Farm Payrolls");
});
