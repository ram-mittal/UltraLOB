import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { once } from "node:events";

process.env.ULTRALOB_RENDER_MODE = "true";
process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS = "true";
delete process.env.PRICING_SERVICE_URL;

const { default: server } = await import("./market-data.js");

test("Render adapter serves dashboard, health checks, and pricing API", async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const dashboard = await fetch(baseUrl + "/");
    assert.equal(dashboard.status, 200);
    const dashboardHtml = await dashboard.text();
    assert.match(dashboardHtml, /UltraLOB/);
    assert.match(dashboardHtml, /wss:\/\/stream\.binance\.com:443/);
    assert.match(dashboardHtml, /wss:\/\/data-stream\.binance\.vision:443/);
    assert.match(dashboardHtml, /let activeSymbol = 'BTCUSDT'/);
    assert.match(dashboardHtml, /scheduleLiveAutoPricing\(\)/);
    const scriptStart = dashboardHtml.indexOf("<script>");
    const scriptEnd = dashboardHtml.indexOf("</script>", scriptStart);
    assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "dashboard inline script should be present");
    const inlineScript = dashboardHtml.slice(scriptStart + "<script>".length, scriptEnd);
    assert.doesNotThrow(() => new Function(inlineScript), "dashboard inline JavaScript should parse");

    const alias = await fetch(baseUrl + "/terminal");
    assert.equal(alias.status, 200);
    assert.match(await alias.text(), /UltraLOB/);

    const health = await fetch(baseUrl + "/healthz");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");

    const market = await fetch(baseUrl + "/api/market-data");
    const marketPayload = await market.json();
    assert.equal(market.status, 200);
    assert.equal(marketPayload.status, "ok");
    assert.equal(marketPayload.providers.crypto.configured, true);

    const historyInvalid = await fetch(baseUrl + "/api/market-history?symbol=TSLA&interval=1m&limit=100");
    assert.equal(historyInvalid.status, 400);
    assert.match((await historyInvalid.json()).error, /Unsupported symbol/);
    const historyEquityMissingKey = await fetch(baseUrl + "/api/market-history?symbol=AAPL&interval=1m&limit=100");
    assert.equal(historyEquityMissingKey.status, 503);
    assert.equal((await historyEquityMissingKey.json()).code, "EQUITIES_KEY_MISSING");

    const pricingHealth = await fetch(baseUrl + "/api/pricing");
    const pricingHealthPayload = await pricingHealth.json();
    assert.equal(pricingHealth.status, 200);
    assert.equal(pricingHealthPayload.fallback_enabled, true);

    const pricing = await fetch(baseUrl + "/api/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spot: 100,
        strike: 100,
        risk_free_rate: 0.05,
        dividend_yield: 0,
        volatility: 0.2,
        maturity_years: 1,
        paths: 10000,
        seed: 42,
        backend: "cpu"
      })
    });
    const pricingPayload = await pricing.json();
    assert.equal(pricing.status, 200);
    assert.equal(pricingPayload.backend, "CPU");
    assert.equal(pricingPayload.paths, 10000);

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
    assert.ok(messages.some((item) => item.event === "gateway" && item.status === "connecting"));
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
