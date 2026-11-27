import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAgainstMandate,
  computeFeeSchedule,
  generateInstitutionalStatement,
  formatStatementCsv
} from "./governance.js";

test("investor mandate blocks unpermitted instruments and excessive risk tiers", () => {
  const mandate = {
    risk_tolerance: "CONSERVATIVE",
    permitted_instruments: ["XAUUSD"],
    max_portfolio_drawdown_pct: 10
  };

  const blockedInst = validateAgainstMandate({
    mandate,
    strategy: { id: "btc-1", instrument: "BTC/USD", risk_level: "medium" },
    requestedMaxDrawdownPct: 8
  });
  assert.equal(blockedInst.allowed, false);
  assert.equal(blockedInst.code, "MANDATE_INSTRUMENT_RESTRICTED");

  const blockedTier = validateAgainstMandate({
    mandate,
    strategy: { id: "ul-04", instrument: "XAUUSD", risk_level: "high" },
    requestedMaxDrawdownPct: 8
  });
  assert.equal(blockedTier.allowed, false);
  assert.equal(blockedTier.code, "MANDATE_RISK_TIER_EXCEEDED");

  const allowed = validateAgainstMandate({
    mandate,
    strategy: { id: "ul-01", instrument: "XAUUSD", risk_level: "medium" },
    requestedMaxDrawdownPct: 10
  });
  assert.equal(allowed.allowed, true);
});

test("HWM fee schedule enforces high-water mark and stays non-billing", () => {
  // Below high-water mark -> 0 performance fee
  const drawdownPeriod = computeFeeSchedule({
    beginningEquity: 10000,
    endingEquity: 10500,
    highWaterMarkEquity: 12000,
    annualMgmtFeePct: 1.0,
    performanceFeePct: 20.0,
    periodDays: 30
  });
  assert.equal(drawdownPeriod.billing_status, "ACCOUNTING_FRAMEWORK_ONLY_NO_BILLING");
  assert.equal(drawdownPeriod.performance_fee_usd, 0);

  // Above HWM -> charges only on net new gains above HWM
  const profitPeriod = computeFeeSchedule({
    beginningEquity: 10000,
    endingEquity: 12000,
    highWaterMarkEquity: 10000,
    annualMgmtFeePct: 0,
    performanceFeePct: 20.0,
    periodDays: 30
  });
  assert.equal(profitPeriod.performance_fee_usd, 400);
  assert.equal(profitPeriod.new_high_water_mark, 11600);
});

test("institutional statement preserves data origin attribution and formats CSV cleanly", () => {
  const stmt = generateInstitutionalStatement({
    user: { name: "Fund CIO", email: "cio@desk.io", role: "fund_manager" },
    portfolio: {
      balance: 10420,
      dataOrigin: "PAPER_SANDBOX",
      trades: [
        { id: "t1", time: "10:00", strategyId: "ul-01", strategy: "UL-01", symbol: "XAUUSD", side: "BUY", qty: 0.1, price: 2650, closePrice: 2670, pnl: 420, status: "closed", broker: "Paper" }
      ]
    }
  });
  assert.equal(stmt.data_origin, "PAPER_SANDBOX");
  assert.equal(stmt.strategy_attribution[0].realized_pnl_usd, 420);
  const csv = formatStatementCsv(stmt);
  assert.match(csv, /StatementID,GeneratedAt,DataOrigin/);
  assert.match(csv, /XAUUSD/);
});
