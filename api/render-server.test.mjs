import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { once } from "node:events";

process.env.ULTRALOB_RENDER_MODE = "true";
process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS = "true";
delete process.env.PRICING_SERVICE_URL;
delete process.env.DATABASE_URL;
delete process.env.ULTRALOB_EXECUTION_ADMIN_KEY;

const { default: server } = await import("./market-data.js");

test("Render adapter serves Phase 1 institutional SPA, RBAC auth, honest strategy registry, risk & broker APIs", async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Institutional SPA shell & all 12 workspace routes
    const spa = await fetch(baseUrl + "/");
    assert.equal(spa.status, 200);
    const spaHtml = await spa.text();
    assert.match(spaHtml, /UltraLOB — Institutional Strategy Allocation & Risk Infrastructure/);
    assert.match(spaHtml, /\/public\/js\/app\.js/);

    for (const route of [
      "/overview", "/marketplace", "/portfolio", "/ai", "/markets", "/risk",
      "/copy-trading", "/broker", "/execution", "/research", "/reports", "/settings",
      "/dashboard", "/terminal"
    ]) {
      const page = await fetch(baseUrl + route);
      assert.equal(page.status, 200, `Expected 200 for ${route}`);
      assert.match(await page.text(), /UltraLOB/);
    }

    const appJs = await fetch(baseUrl + "/public/js/app.js");
    assert.equal(appJs.status, 200);
    assert.match(appJs.headers.get("content-type") || "", /javascript/);

    // 2. Classic FIX / Market Monte Carlo terminal preserved at /legacy
    const legacy = await fetch(baseUrl + "/legacy");
    assert.equal(legacy.status, 200);
    const legacyHtml = await legacy.text();
    assert.match(legacyHtml, /wss:\/\/ws\.kraken\.com\/v2/);
    assert.match(legacyHtml, /Market Monte Carlo Simulation/);
    assert.match(legacyHtml, /runMarketMonteCarlo\(\)/);
    const scriptStart = legacyHtml.indexOf("<script>");
    const scriptEnd = legacyHtml.indexOf("</script>", scriptStart);
    assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "legacy inline script should be present");
    assert.doesNotThrow(() => new Function(legacyHtml.slice(scriptStart + "<script>".length, scriptEnd)));

    // 3. System Status & Execution Health
    const health = await fetch(baseUrl + "/healthz");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");

    const sysStatus = await fetch(baseUrl + "/api/system/status");
    assert.equal(sysStatus.status, 200);
    const sysPayload = await sysStatus.json();
    assert.equal(sysPayload.execution.environment, "DEMO_ONLY");
    assert.equal(sysPayload.execution.live_execution_enabled, false);
    assert.equal(sysPayload.market_feeds.xauusd.origin, "AWAITING_DATA");

    const executionHealth = await fetch(baseUrl + "/api/execution/health");
    const executionHealthPayload = await executionHealth.json();
    assert.equal(executionHealth.status, 200);
    assert.equal(executionHealthPayload.environment, "DEMO_ONLY");
    assert.equal(executionHealthPayload.storage, "not-configured");
    assert.equal(executionHealthPayload.live_execution_enabled, false);

    // 4. RBAC Auth + Refresh Token Rotation
    const investorEmail = `investor-${Date.now()}@ultralob.io`;
    const invReg = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Investor Test", email: investorEmail, password: "secret123", role: "investor" })
    });
    assert.equal(invReg.status, 201);
    const invData = await invReg.json();
    assert.equal(invData.user.role, "investor");
    assert.ok(invData.token && invData.refreshToken);

    const providerEmail = `provider-${Date.now()}@ultralob.io`;
    const provReg = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Quant Provider",
        email: providerEmail,
        password: "secret123",
        role: "strategy_provider",
        organization_name: "Alpha Gold Desk"
      })
    });
    assert.equal(provReg.status, 201);
    const provData = await provReg.json();
    assert.equal(provData.user.role, "strategy_provider");
    assert.equal(provData.user.org_name, "Alpha Gold Desk");

    const refreshRes = await fetch(baseUrl + "/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: provData.refreshToken })
    });
    assert.equal(refreshRes.status, 200);
    const refreshed = await refreshRes.json();
    assert.ok(refreshed.token && refreshed.refreshToken !== provData.refreshToken);

    const me = await fetch(baseUrl + "/api/auth/me", {
      headers: { Authorization: `Bearer ${refreshed.token}` }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, providerEmail);

    // 5. Strategy Registry (UL-01..UL-05 with zero fabricated returns + RBAC publish)
    const strats = await fetch(baseUrl + "/api/strategies");
    assert.equal(strats.status, 200);
    const stratData = await strats.json();
    assert.equal(stratData.strategies.length, 5);
    assert.ok(stratData.strategies.every((s) => s.lifecycle_status === "RESEARCH"));
    assert.ok(stratData.strategies.every((s) => s.total_return === null && s.sharpe_ratio === null));
    assert.ok(stratData.strategies.some((s) => s.code === "UL-01" && s.instrument === "XAUUSD"));

    // Investor role cannot publish strategies
    const forbiddenStrat = await fetch(baseUrl + "/api/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ name: "Unauthorized Spec", description: "Should be rejected" })
    });
    assert.equal(forbiddenStrat.status, 403);

    // Strategy provider can publish a RESEARCH strategy (no invented return stats)
    const createStrat = await fetch(baseUrl + "/api/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshed.token}` },
      body: JSON.stringify({
        name: "UL-06 Session Breakout",
        code: "UL-06",
        description: "London session breakout specification on XAUUSD",
        instrument: "XAUUSD",
        risk_level: "medium"
      })
    });
    assert.equal(createStrat.status, 201);
    const createdPayload = await createStrat.json();
    assert.equal(createdPayload.strategy.lifecycle_status, "RESEARCH");
    assert.equal(createdPayload.strategy.total_return, null);

    // 6. Broker connection rejects LIVE mode, pairs DEMO mode
    const liveBlocked = await fetch(baseUrl + "/api/broker/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        type: "exness",
        environment: "LIVE",
        server: "Exness-MT5Real",
        account_id: "19283746",
        api_key: "ex-key",
        api_secret: "ex-sec"
      })
    });
    assert.equal(liveBlocked.status, 403);

    const conn = await fetch(baseUrl + "/api/broker/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        type: "exness",
        environment: "DEMO",
        server: "Exness-MT5Trial8",
        account_id: "19283746",
        api_key: "ex-key-demo",
        api_secret: "ex-sec-demo"
      })
    });
    assert.equal(conn.status, 200);
    const connData = await conn.json();
    assert.equal(connData.connected, true);
    assert.equal(connData.broker.environment, "DEMO");
    assert.ok(connData.broker.bridgeToken);

    const eaFile = await fetch(baseUrl + "/api/broker/mt5/ea", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal(eaFile.status, 200);
    assert.match(await eaFile.text(), /UltraLOB_CopyBridge\.mq5/);

    // 7. Portfolio starts at $0 (honest), sandbox funding enables MC execution, kill switch blocks
    const emptyPort = await fetch(baseUrl + "/api/copy-trading/portfolio", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal((await emptyPort.json()).summary.balance, 0);

    const fundRes = await fetch(baseUrl + "/api/copy-trading/sandbox-capital", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ amount: 10000 })
    });
    assert.equal(fundRes.status, 200);
    assert.equal((await fundRes.json()).balance, 10000);

    const mcExec = await fetch(baseUrl + "/api/copy-trading/mc-signal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        symbol: "BTC/USD",
        spot: 97500,
        direction: "long",
        targetFirstProb: 0.68,
        stopFirstProb: 0.22,
        expectedReturn: 0.012,
        medianReturn: 0.010,
        stopPrice: 96525,
        targetPrice: 98962.5,
        execute: true
      })
    });
    assert.equal(mcExec.status, 200);
    const mcData = await mcExec.json();
    assert.equal(mcData.evaluation.qualified, true);
    assert.equal(mcData.executedTrades.length, 1);

    const signals = await fetch(
      baseUrl + `/api/broker/mt5/signals?token=${encodeURIComponent(connData.broker.bridgeToken)}`
    );
    assert.equal(signals.status, 200);
    const sigPayload = await signals.json();
    assert.equal(sigPayload.count, 1);
    assert.equal(sigPayload.signals[0].side, "BUY");

    // Kill switch blocks new executions
    await fetch(baseUrl + "/api/copy-trading/risk-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ kill_switch_active: true })
    });
    const blockedExec = await fetch(baseUrl + "/api/copy-trading/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ symbol: "BTC/USD", side: "BUY", qty: 0.01, price: 97500 })
    });
    assert.equal(blockedExec.status, 403);
    assert.equal((await blockedExec.json()).code, "KILL_SWITCH_ACTIVE");

    // 8. WebSocket heartbeat & 404
    const socketUrl = baseUrl.replace(/^http/, "ws") + "/api/market-data?symbols=BTCUSDT";
    const socket = new WebSocket(socketUrl, { origin: baseUrl });
    const messages = [];
    socket.on("message", (raw) => {
      try { messages.push(JSON.parse(raw.toString())); } catch {}
    });
    await once(socket, "open");
    socket.send(JSON.stringify({ event: "ping", timestamp: Date.now() }));
    for (let attempt = 0; attempt < 20 && !messages.some((item) => item.event === "heartbeat"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(messages.some((item) => item.event === "heartbeat"));
    const socketClosed = once(socket, "close");
    socket.close(1000, "test complete");
    await socketClosed;

    const notFound = await fetch(baseUrl + "/unknown-route");
    assert.equal(notFound.status, 404);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
