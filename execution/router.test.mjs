import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import test from "node:test";

import { createExecutionRouter } from "./router.js";

class MemoryStore {
  constructor() {
    this.connectors = new Map();
    this.commands = new Map();
    this.events = [];
  }
  async initialize() {}
  async createConnector(input) {
    const connector = {
      ...input,
      broker: "MT5",
      environment: "DEMO",
      status: "ACTIVE",
      positions: [],
      symbol_specs: [],
      created_at: new Date().toISOString()
    };
    this.connectors.set(connector.id, connector);
    this.events.push({ connector_id: connector.id, command_id: null, event_type: "CONNECTOR_CREATED", payload: {} });
    return connector;
  }
  async getConnectorByTokenHash(hash) {
    return [...this.connectors.values()].find((item) => item.token_hash === hash && ["ACTIVE", "PAUSED"].includes(item.status)) || null;
  }
  async getConnector(id) { return this.connectors.get(id) || null; }
  async listConnectors() { return [...this.connectors.values()]; }
  async setConnectorStatus(id, status) {
    const item = this.connectors.get(id);
    if (!item) return null;
    item.status = status;
    this.events.push({ connector_id: id, command_id: null, event_type: "CONNECTOR_STATUS_CHANGED", payload: { status } });
    return { id: item.id, status: item.status };
  }
  async listCommands(limit = 100) { return [...this.commands.values()].slice(0, limit); }
  async listEvents({ connectorId = null, limit = 100 } = {}) {
    return this.events.filter((event) => !connectorId || event.connector_id === connectorId).slice(-limit).reverse();
  }
  async updateHeartbeat(id, snapshot) {
    const item = this.connectors.get(id);
    if (!item) throw new Error("not found");
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    item.day_start_equity = item.day_key === today && item.day_start_equity
      ? item.day_start_equity : snapshot.equity;
    item.equity_high_water = Math.max(item.equity_high_water || 0, snapshot.equity);
    Object.assign(item, snapshot, { day_key: today, last_heartbeat_at: now.toISOString() });
    return item;
  }
  async enqueueSignal(signal) {
    const ids = [];
    for (const connector of this.connectors.values()) {
      if (!connector.strategy_ids.includes(signal.strategy_id) ||
          !connector.allowed_symbols.includes(signal.symbol) ||
          connector.status !== "ACTIVE") continue;
      const duplicate = [...this.commands.values()].some((item) =>
        item.connector_id === connector.id && item.signal_id === signal.signal_id
      );
      if (duplicate) continue;
      const id = signal.command_id_factory();
      this.commands.set(id, {
        id, connector_id: connector.id, signal_id: signal.signal_id,
        strategy_id: signal.strategy_id, strategy_version: signal.strategy_version,
        symbol: signal.symbol, side: signal.side,
        requested_risk_pct: signal.risk_pct, risk_pct: signal.risk_pct,
        stop_loss: signal.stop_loss, take_profit: signal.take_profit,
        expires_at: signal.expires_at, status: "QUEUED"
      });
      ids.push(id);
      this.events.push({ connector_id: connector.id, command_id: id, event_type: "SIGNAL_QUEUED", payload: {} });
    }
    return { matched_connectors: ids.length, queued_commands: ids.length, command_ids: ids };
  }
  async takeNextQueuedCommand(connectorId) {
    const now = Date.now();
    const item = [...this.commands.values()].find((command) =>
      command.connector_id === connectorId && (
        command.status === "QUEUED" ||
        (command.status === "DISPATCHED" && Number(command.lease_expires_at || 0) < now)
      )
    );
    if (!item) return null;
    item.status = "DISPATCHED";
    item.attempts = (item.attempts || 0) + 1;
    item.lease_expires_at = now + 15000;
    this.events.push({ connector_id: connectorId, command_id: item.id, event_type: "COMMAND_DISPATCHED", payload: { attempts: item.attempts } });
    return item;
  }
  async updateCommandRisk(id, risk) {
    const item = this.commands.get(id);
    Object.assign(item, risk);
    return item;
  }
  async rejectCommand(id, code, message) {
    const item = this.commands.get(id);
    Object.assign(item, { status: "REJECTED", error_code: code, error_message: message });
    this.events.push({ connector_id: item.connector_id, command_id: id, event_type: "RISK_REJECTED", payload: { code, message } });
    return item;
  }
  async acknowledgeCommand(connectorId, commandId, ack) {
    const item = this.commands.get(commandId);
    if (!item || item.connector_id !== connectorId || !["DISPATCHED", "ACCEPTED"].includes(item.status)) return null;
    Object.assign(item, { ...ack, status: ack.status });
    this.events.push({ connector_id: connectorId, command_id: commandId, event_type: "BROKER_ACKNOWLEDGEMENT", payload: { status: ack.status } });
    return item;
  }
}

async function startTestServer() {
  const store = new MemoryStore();
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(createExecutionRouter({
    store,
    adminKey: "unit-test-admin-key",
    liveExecutionEnabled: false
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const url = "http://127.0.0.1:" + server.address().port;
  return { server, url, store };
}

function heartbeatBody(overrides = {}) {
  return {
    login: "12345678",
    server: "Demo-Server",
    company: "Demo Broker",
    currency: "USD",
    leverage: 100,
    trade_mode: "DEMO",
    terminal_connected: true,
    terminal_trade_allowed: true,
    ea_trade_allowed: true,
    balance: 10000,
    equity: 10000,
    margin: 100,
    margin_free: 9900,
    positions: [],
    symbol_specs: [{
      symbol: "XAUUSD", bid: 2000, ask: 2000.2, point: 0.01,
      tick_size: 0.01, tick_value: 1, volume_min: 0.01,
      volume_max: 100, volume_step: 0.01, stops_level: 50
    }],
    ...overrides
  };
}

async function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

test("health makes the demo-only and live-disabled status explicit", async () => {
  const ctx = await startTestServer();
  try {
    const response = await fetch(ctx.url + "/health");
    const body = await response.json();
    assert.equal(body.environment, "DEMO_ONLY");
    assert.equal(body.live_execution_enabled, false);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
});

test("pairs an MT5 demo connector, receives a risk-sized command, and acknowledges it", async () => {
  const ctx = await startTestServer();
  try {
    const adminHeaders = { "x-ultralob-admin-key": "unit-test-admin-key" };
    const create = await postJson(ctx.url + "/connectors", {
      label: "MT5 demo - XAUUSD",
      broker: "MT5",
      environment: "DEMO",
      strategy_ids: ["valor-xau"],
      allowed_symbols: ["XAUUSD"],
      risk: {
        max_trade_risk_pct: 0.5,
        max_daily_loss_pct: 2,
        max_drawdown_pct: 8,
        max_spread_points: 30,
        max_open_positions: 2,
        max_deviation_points: 20
      }
    }, adminHeaders);
    assert.equal(create.status, 201);
    const paired = await create.json();
    assert.ok(paired.connector.id);
    assert.match(paired.access_token, /^ulb_demo_/);
    assert.equal([...ctx.store.connectors.values()][0].token_hash,
      createHash("sha256").update(paired.access_token).digest("hex"));
    assert.equal(JSON.stringify([...ctx.store.connectors.values()][0]).includes(paired.access_token), false);

    const bearer = { Authorization: "Bearer " + paired.access_token };
    const heartbeat = await postJson(
      ctx.url + "/connectors/" + paired.connector.id + "/heartbeat",
      heartbeatBody(),
      bearer
    );
    assert.equal(heartbeat.status, 200);

    const signal = {
      signal_id: "signal-valor-0001",
      strategy_id: "valor-xau",
      strategy_version: "1.0.0",
      symbol: "XAUUSD",
      side: "BUY",
      risk_pct: 0.5,
      stop_loss: 1995,
      take_profit: 2010,
      ttl_seconds: 60
    };
    const published = await postJson(ctx.url + "/signals", signal, adminHeaders);
    assert.equal(published.status, 202);
    const publishedBody = await published.json();
    assert.equal(publishedBody.queued_commands, 1);

    const next = await fetch(ctx.url + "/connectors/" + paired.connector.id + "/next", { headers: bearer });
    const command = await next.json();
    assert.equal(command.status, "command");
    assert.equal(command.side, "BUY");
    assert.equal(command.volume, 0.09);
    assert.ok(command.risk_pct <= 0.5);
    assert.equal(command.symbol, "XAUUSD");

    const duplicatePublish = await postJson(ctx.url + "/signals", signal, adminHeaders);
    assert.equal((await duplicatePublish.json()).queued_commands, 0);

    const acknowledgement = await postJson(
      ctx.url + "/connectors/" + paired.connector.id + "/commands/" + command.command_id + "/ack",
      { status: "ACCEPTED", broker_order_id: "1000123", broker_retcode: "10009", broker_comment: "done" },
      bearer
    );
    assert.equal(acknowledgement.status, 200);
    assert.equal((await acknowledgement.json()).command_status, "ACCEPTED");

    const commandList = await fetch(ctx.url + "/commands", { headers: adminHeaders });
    assert.equal(commandList.status, 200);
    assert.equal((await commandList.json()).commands.length, 1);

    const eventList = await fetch(ctx.url + "/events?limit=20", { headers: adminHeaders });
    assert.equal(eventList.status, 200);
    assert.ok((await eventList.json()).events.length >= 4);

    const pause = await fetch(ctx.url + "/connectors/" + paired.connector.id + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders },
      body: JSON.stringify({ status: "PAUSED" })
    });
    assert.equal(pause.status, 200);
    const pausedNext = await fetch(ctx.url + "/connectors/" + paired.connector.id + "/next", { headers: bearer });
    assert.equal(pausedNext.status, 403);
    assert.equal((await pausedNext.json()).code, "CONNECTOR_INACTIVE");
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
});

test("rejects connector creation without admin authorization and rejects non-demo profiles", async () => {
  const ctx = await startTestServer();
  try {
    const base = {
      label: "Demo connector",
      broker: "MT5",
      environment: "DEMO",
      strategy_ids: ["valor-xau"],
      allowed_symbols: ["XAUUSD"]
    };
    const unauthorized = await postJson(ctx.url + "/connectors", base);
    assert.equal(unauthorized.status, 401);
    const live = await postJson(ctx.url + "/connectors", { ...base, environment: "LIVE" }, {
      "x-ultralob-admin-key": "unit-test-admin-key"
    });
    assert.equal(live.status, 400);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
});

test("does not dispatch from a non-demo heartbeat", async () => {
  const ctx = await startTestServer();
  try {
    const admin = { "x-ultralob-admin-key": "unit-test-admin-key" };
    const created = await postJson(ctx.url + "/connectors", {
      label: "MT5 demo",
      broker: "MT5",
      environment: "DEMO",
      strategy_ids: ["valor-xau"],
      allowed_symbols: ["XAUUSD"]
    }, admin);
    const pairing = await created.json();
    const bearer = { Authorization: "Bearer " + pairing.access_token };
    await postJson(ctx.url + "/connectors/" + pairing.connector.id + "/heartbeat",
      heartbeatBody({ trade_mode: "REAL" }), bearer);
    await postJson(ctx.url + "/signals", {
      signal_id: "signal-valor-0002",
      strategy_id: "valor-xau",
      strategy_version: "1.0.0",
      symbol: "XAUUSD",
      side: "BUY",
      risk_pct: 0.5,
      stop_loss: 1995,
      take_profit: 2010
    }, admin);
    const response = await fetch(ctx.url + "/connectors/" + pairing.connector.id + "/next", { headers: bearer });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "DEMO_ACCOUNT_REQUIRED");
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
});

test("replays expired leases on reconnect and enforces broker order & deal reconciliation", async () => {
  const ctx = await startTestServer();
  try {
    const admin = { "x-ultralob-admin-key": "unit-test-admin-key" };
    const created = await postJson(ctx.url + "/connectors", {
      label: "MT5 reconnect test",
      broker: "MT5",
      environment: "DEMO",
      strategy_ids: ["ul-01-gold-trend"],
      allowed_symbols: ["XAUUSD"]
    }, admin);
    const pairing = await created.json();
    const bearer = { Authorization: "Bearer " + pairing.access_token };

    await postJson(ctx.url + "/connectors/" + pairing.connector.id + "/heartbeat", heartbeatBody(), bearer);

    await postJson(ctx.url + "/signals", {
      signal_id: "signal-reconnect-001",
      strategy_id: "ul-01-gold-trend",
      strategy_version: "1.0.0",
      symbol: "XAUUSD",
      side: "BUY",
      risk_pct: 0.5,
      stop_loss: 1995,
      take_profit: 2010
    }, admin);

    const firstPoll = await fetch(ctx.url + "/connectors/" + pairing.connector.id + "/next", { headers: bearer });
    const firstCmd = await firstPoll.json();
    assert.equal(firstCmd.status, "command");

    // Simulate network drop before ack and lease expiration, followed by reconnect heartbeat
    ctx.store.commands.get(firstCmd.command_id).lease_expires_at = Date.now() - 1000;
    await postJson(ctx.url + "/connectors/" + pairing.connector.id + "/heartbeat", heartbeatBody(), bearer);

    const reconnectPoll = await fetch(ctx.url + "/connectors/" + pairing.connector.id + "/next", { headers: bearer });
    const replayedCmd = await reconnectPoll.json();
    assert.equal(replayedCmd.status, "command");
    assert.equal(replayedCmd.command_id, firstCmd.command_id);
    assert.equal(ctx.store.commands.get(firstCmd.command_id).attempts, 2);

    // Reject FILLED ack missing broker_deal_id reconciliation record
    const missingDealAck = await postJson(
      ctx.url + "/connectors/" + pairing.connector.id + "/commands/" + firstCmd.command_id + "/ack",
      { status: "FILLED", broker_order_id: "550101" },
      bearer
    );
    assert.equal(missingDealAck.status, 400);
    assert.equal((await missingDealAck.json()).code, "BROKER_RECONCILIATION_REQUIRED");

    // Valid FILLED ack with both broker_order_id and broker_deal_id reconciles cleanly
    const reconciledAck = await postJson(
      ctx.url + "/connectors/" + pairing.connector.id + "/commands/" + firstCmd.command_id + "/ack",
      { status: "FILLED", broker_order_id: "550101", broker_deal_id: "880202", broker_retcode: "10009" },
      bearer
    );
    assert.equal(reconciledAck.status, 200);
    assert.equal((await reconciledAck.json()).command_status, "FILLED");
    assert.equal(ctx.store.commands.get(firstCmd.command_id).broker_deal_id, "880202");
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
  }
});
