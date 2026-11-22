import assert from "node:assert/strict";
import test from "node:test";
import handler from "./pricing.js";

async function invoke(method, body) {
  let statusCode = 200;
  let payload = null;
  const headers = {};
  const response = {
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      statusCode = code;
      return response;
    },
    json(value) {
      payload = value;
      return response;
    }
  };
  await handler({ method, body }, response);
  return { statusCode, payload, headers };
}

const baseRequest = {
  spot: 100,
  strike: 100,
  risk_free_rate: 0.05,
  dividend_yield: 0,
  volatility: 0.2,
  maturity_years: 1,
  paths: 100000,
  seed: 42,
  backend: "auto"
};

test("health exposes the built-in CPU fallback when no service is configured", async () => {
  const response = await invoke("GET");
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "ok");
  assert.equal(response.payload.fallback_enabled, true);
  assert.equal(response.payload.native_library_available, false);
  assert.equal(response.payload.cuda_build_enabled, false);
});

test("CPU fallback returns seeded prices and confidence intervals", async () => {
  const first = await invoke("POST", baseRequest);
  const second = await invoke("POST", baseRequest);
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.backend, "CPU");
  assert.equal(first.payload.execution_engine, "javascript-fallback");
  assert.equal(first.payload.paths, baseRequest.paths);
  assert.equal(first.payload.call.price, second.payload.call.price);
  assert.equal(first.payload.put.price, second.payload.put.price);
  assert.ok(first.payload.call.price > 0);
  assert.ok(first.payload.put.price > 0);
  assert.ok(first.payload.call.confidence_low_95 <= first.payload.call.black_scholes);
  assert.ok(first.payload.call.confidence_high_95 >= first.payload.call.black_scholes);
  assert.ok(first.payload.put.confidence_low_95 <= first.payload.put.black_scholes);
  assert.ok(first.payload.put.confidence_high_95 >= first.payload.put.black_scholes);
  assert.equal(first.payload.gpu_utilization, null);
});

test("CUDA is never silently replaced with CPU", async () => {
  const response = await invoke("POST", { ...baseRequest, backend: "cuda" });
  assert.equal(response.statusCode, 503);
  assert.match(response.payload.error, /CUDA pricing is not connected/);
});

test("odd path counts are rejected", async () => {
  const response = await invoke("POST", { ...baseRequest, paths: 999 });
  assert.equal(response.statusCode, 422);
  assert.match(response.payload.error, /even integer/);
});

test("serverless fallback refuses workloads above its configured cap", async () => {
  const response = await invoke("POST", { ...baseRequest, paths: 10000002 });
  assert.equal(response.statusCode, 413);
  assert.match(response.payload.error, /capped at/);
});

test("unsupported HTTP methods are rejected", async () => {
  const response = await invoke("DELETE");
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "GET, POST");
});
