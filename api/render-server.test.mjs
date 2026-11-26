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

test("Render adapter serves copy-trading SPA, legacy terminal, broker & MC auto-trading APIs", async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. SPA shell & static assets
    const spa = await fetch(baseUrl + "/");
    assert.equal(spa.status, 200);
    const spaHtml = await spa.text();
    assert.match(spaHtml, /UltraLOB — Institutional Copy Trading Platform/);
    assert.match(spaHtml, /\/public\/js\/app\.js/);

    for (const route of ["/marketplace", "/dashboard", "/broker", "/terminal"]) {
      const page = await fetch(baseUrl + route);
      assert.equal(page.status, 200);
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

    // 3. Health & existing market/pricing APIs
    const health = await fetch(baseUrl + "/healthz");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");

    const executionHealth = await fetch(baseUrl + "/api/execution/health");
    const executionHealthPayload = await executionHealth.json();
    assert.equal(executionHealth.status, 200);
    assert.equal(executionHealthPayload.environment, "DEMO_ONLY");
    assert.equal(executionHealthPayload.storage, "not-configured");
    assert.equal(executionHealthPayload.live_execution_enabled, false);
    const executionDisabled = await fetch(baseUrl + "/api/execution/connectors", {
      headers: { "x-ultralob-admin-key": "not-configured" }
    });
    assert.equal(executionDisabled.status, 503);
    assert.equal((await executionDisabled.json()).code, "EXECUTION_STORAGE_NOT_CONFIGURED");

    const market = await fetch(baseUrl + "/api/market-data");
    const marketPayload = await market.json();
    assert.equal(market.status, 200);
    assert.equal(marketPayload.providers.crypto.provider, "Kraken Spot");

    const historyInvalid = await fetch(baseUrl + "/api/market-history?symbol=TSLA&interval=1m&limit=100");
    assert.equal(historyInvalid.status, 400);

    const pricing = await fetch(baseUrl + "/api/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spot: 100, strike: 100, risk_free_rate: 0.05, dividend_yield: 0,
        volatility: 0.2, maturity_years: 1, paths: 10000, seed: 42, backend: "cpu"
      })
    });
    const pricingPayload = await pricing.json();
    assert.equal(pricing.status, 200);
    assert.equal(pricingPayload.backend, "CPU");
    assert.equal(pricingPayload.paths, 10000);

    // 4. Auth flow
    const testEmail = `trader-${Date.now()}@ultralob.io`;
    const reg = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ram Test", email: testEmail, password: "secret123" })
    });
    assert.equal(reg.status, 201);
    const regData = await reg.json();
    assert.ok(regData.token);

    const me = await fetch(baseUrl + "/api/auth/me", {
      headers: { Authorization: `Bearer ${regData.token}` }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, testEmail);

    // 5. Strategies marketplace API
    const strats = await fetch(baseUrl + "/api/strategies");
    assert.equal(strats.status, 200);
    const stratData = await strats.json();
    assert.ok(stratData.total >= 8);

    const createStrat = await fetch(baseUrl + "/api/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${regData.token}` },
      body: JSON.stringify({
        name: "Exness MC Sniper",
        description: "Test EA strategy",
        instrument: "BTC/USD",
        risk_level: "medium"
      })
    });
    assert.equal(createStrat.status, 201);

    // 6. Broker connection (Exness / MT5) + MQL5 EA + signal queue
    const conn = await fetch(baseUrl + "/api/broker/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${regData.token}` },
      body: JSON.stringify({
        type: "exness",
        server: "Exness-MT5Trial8",
        account_id: "19283746",
        api_key: "ex-key-demo",
        api_secret: "ex-sec-demo"
      })
    });
    assert.equal(conn.status, 200);
    const connData = await conn.json();
    assert.equal(connData.connected, true);
    assert.ok(connData.broker.bridgeToken);

    const eaFile = await fetch(baseUrl + "/api/broker/mt5/ea", {
      headers: { Authorization: `Bearer ${regData.token}` }
    });
    assert.equal(eaFile.status, 200);
    assert.match(await eaFile.text(), /UltraLOB_CopyBridge\.mq5/);

    // 7. Monte Carlo automated signal evaluation & order routing to MT5/Exness queue
    const mcExec = await fetch(baseUrl + "/api/copy-trading/mc-signal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${regData.token}` },
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
    assert.equal(mcData.evaluation.signal, "BUY");
    assert.equal(mcData.executedTrades.length, 1);

    const signals = await fetch(
      baseUrl + `/api/broker/mt5/signals?token=${encodeURIComponent(connData.broker.bridgeToken)}`
    );
    assert.equal(signals.status, 200);
    const sigPayload = await signals.json();
    assert.equal(sigPayload.count, 1);
    assert.equal(sigPayload.signals[0].side, "BUY");

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
