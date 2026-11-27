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
  assert.equal(blocked.decision, "BLOCKED_BY_RISK");
  assert.equal(blocked.pipeline_stages["3_risk_engine"].approved, false);

  // Unblocked risk + RESEARCH lifecycle still blocks execution
  riskState.kill_switches.global_active = false;
  const researchBlocked = evaluateAdvisoryPipeline({
    strategy: { ...strat, lifecycle_status: "RESEARCH" },
    symbol: "XAUUSD",
    side: "BUY",
    proposedRiskPct: 0.5,
    portfolioMetrics: { equity: 10000, open_positions_count: 0 },
    riskState
  });
  assert.equal(researchBlocked.decision, "BLOCKED_BY_LIFECYCLE");
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
