import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDemoCommand } from "./risk-manager.js";

function fixture(overrides = {}) {
  const now = Date.now();
  const connector = {
    id: "connector-1",
    status: "ACTIVE",
    environment: "DEMO",
    trade_mode: "DEMO",
    terminal_connected: true,
    terminal_trade_allowed: true,
    ea_trade_allowed: true,
    last_heartbeat_at: new Date(now).toISOString(),
    equity: 10000,
    day_start_equity: 10000,
    equity_high_water: 10000,
    max_trade_risk_pct: 0.5,
    max_daily_loss_pct: 2,
    max_drawdown_pct: 8,
    max_spread_points: 30,
    max_open_positions: 2,
    max_deviation_points: 20,
    allowed_symbols: ["XAUUSD"],
    strategy_ids: ["valor-xau"],
    positions: [],
    symbol_specs: [{
      symbol: "XAUUSD",
      bid: 2000,
      ask: 2000.2,
      point: 0.01,
      tick_size: 0.01,
      tick_value: 1,
      volume_min: 0.01,
      volume_max: 100,
      volume_step: 0.01,
      stops_level: 50
    }],
    ...overrides
  };
  const signal = {
    command_id: "command-1",
    signal_id: "signal-0001",
    strategy_id: "valor-xau",
    strategy_version: "1.0.0",
    symbol: "XAUUSD",
    side: "BUY",
    requested_risk_pct: 0.5,
    risk_pct: 0.5,
    stop_loss: 1995,
    take_profit: 2010,
    expires_at: new Date(now + 30000).toISOString()
  };
  return { connector, signal, now };
}

test("sizes a demo position down to the configured risk budget", () => {
  const { connector, signal, now } = fixture();
  const result = evaluateDemoCommand(connector, signal, now);
  assert.equal(result.ok, true);
  assert.equal(result.command.volume, 0.1);
  assert.ok(result.command.risk_pct <= 0.5);
  assert.equal(result.command.side, "BUY");
  assert.equal(result.command.entry_reference, 2000.2);
});

test("rejects real accounts even if a connector is marked demo", () => {
  const { connector, signal, now } = fixture({ trade_mode: "REAL" });
  const result = evaluateDemoCommand(connector, signal, now);
  assert.equal(result.ok, false);
  assert.equal(result.code, "DEMO_ACCOUNT_REQUIRED");
});

test("rejects stale account snapshots", () => {
  const { connector, signal, now } = fixture({
    last_heartbeat_at: new Date(now - 16000).toISOString()
  });
  const result = evaluateDemoCommand(connector, signal, now);
  assert.equal(result.code, "STALE_ACCOUNT_SNAPSHOT");
});

test("rejects a breached daily loss limit", () => {
  const { connector, signal, now } = fixture({ equity: 9700, day_start_equity: 10000 });
  const result = evaluateDemoCommand(connector, signal, now);
  assert.equal(result.code, "DAILY_LOSS_LIMIT");
});

test("rejects a breached peak-to-trough drawdown limit", () => {
  const { connector, signal, now } = fixture({ equity: 9100, equity_high_water: 10000 });
  const result = evaluateDemoCommand(connector, signal, now);
  assert.equal(result.code, "MAX_DRAWDOWN_LIMIT");
});

test("rejects a spread that exceeds the account risk profile", () => {
  const { connector, signal, now } = fixture({
    symbol_specs: [{
      symbol: "XAUUSD", bid: 2000, ask: 2000.5, point: 0.01,
      tick_size: 0.01, tick_value: 1, volume_min: 0.01,
      volume_max: 100, volume_step: 0.01, stops_level: 0
    }]
  });
  const result = evaluateDemoCommand(connector, signal, now);
  assert.equal(result.code, "SPREAD_LIMIT");
});

test("rejects invalid stop direction and a volume below broker minimum", () => {
  const { connector, signal, now } = fixture();
  const wrongSide = evaluateDemoCommand(connector, { ...signal, stop_loss: 2001 }, now);
  assert.equal(wrongSide.code, "INVALID_PROTECTION_SIDE");

  const smallRisk = evaluateDemoCommand(connector, {
    ...signal,
    risk_pct: 0.05,
    requested_risk_pct: 0.05,
    stop_loss: 1900
  }, now);
  assert.equal(smallRisk.code, "VOLUME_BELOW_MINIMUM");
});

test("rejects symbol and strategy outside connector subscriptions", () => {
  const { connector, signal, now } = fixture();
  assert.equal(evaluateDemoCommand(connector, { ...signal, symbol: "EURUSD" }, now).code, "SYMBOL_NOT_ALLOWED");
  assert.equal(evaluateDemoCommand(connector, { ...signal, strategy_id: "unknown" }, now).code, "STRATEGY_NOT_SUBSCRIBED");
});

test("never rounds a too-small risk budget up to broker minimum volume", () => {
  const { connector, signal, now } = fixture({
    equity: 1000,
    day_start_equity: 1000,
    equity_high_water: 1000
  });
  const result = evaluateDemoCommand(connector, {
    ...signal,
    stop_loss: 1980,
    risk_pct: 0.05,
    requested_risk_pct: 0.05
  }, now);
  assert.equal(result.ok, false);
  assert.equal(result.code, "VOLUME_BELOW_MINIMUM");
});
