import assert from "node:assert/strict";
import test from "node:test";

process.env.ULTRALOB_RENDER_MODE = "true";
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
    assert.match(await dashboard.text(), /UltraLOB/);

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

    const notFound = await fetch(baseUrl + "/unknown-route");
    assert.equal(notFound.status, 404);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
