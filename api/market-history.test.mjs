import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarketHistoryHandler,
  clearMarketHistoryCache
} from "./market-history.js";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers[name] = value; }
  };
}

function makeBinanceRows(count = 60) {
  return Array.from({ length: count }, (_, index) => {
    const price = 100 + index;
    return [
      1700000000000 + index * 60000,
      String(price),
      String(price + 1),
      String(price - 1),
      String(price + 0.5),
      "10.5",
      1700000059999 + index * 60000
    ];
  });
}

function makeTwelvePayload(count = 60) {
  return {
    status: "ok",
    values: Array.from({ length: count }, (_, index) => {
      const price = 150 + index;
      return {
        datetime: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString().slice(0, 19).replace("T", " "),
        open: String(price),
        high: String(price + 1),
        low: String(price - 1),
        close: String(price + 0.5),
        volume: "1000"
      };
    }).reverse()
  };
}

test("rejects unsupported symbols, intervals, and limits", async () => {
  clearMarketHistoryCache();
  const handler = createMarketHistoryHandler({ fetchImpl: async () => { throw new Error("should not fetch"); } });

  for (const query of [
    { symbol: "TSLA", interval: "1m", limit: "100" },
    { symbol: "BTCUSDT", interval: "2m", limit: "100" },
    { symbol: "BTCUSDT", interval: "1m", limit: "20" }
  ]) {
    const res = mockResponse();
    await handler({ method: "GET", query }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error);
  }
});

test("returns normalized chronological Binance BTC candles without an API key", async () => {
  clearMarketHistoryCache();
  let requestedUrl = "";
  const handler = createMarketHistoryHandler({
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => makeBinanceRows() };
    },
    env: {}
  });
  const res = mockResponse();
  await handler({ method: "GET", query: { symbol: "BTCUSDT", interval: "1m", limit: "60" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, "Binance Spot");
  assert.equal(res.body.count, 60);
  assert.ok(requestedUrl.startsWith("https://data-api.binance.vision/api/v3/klines?"));
  assert.ok(res.body.candles[0].time < res.body.candles.at(-1).time);
  assert.equal(res.body.candles[0].open, 100);
  assert.equal(res.body.candles[0].close, 100.5);
});

test("returns cached Binance candles within the cache window", async () => {
  clearMarketHistoryCache();
  let calls = 0;
  let clock = 100000;
  const handler = createMarketHistoryHandler({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => makeBinanceRows() };
    },
    now: () => clock
  });
  const req = { method: "GET", query: { symbol: "BTCUSDT", interval: "1m", limit: "60" } };
  const first = mockResponse();
  await handler(req, first);
  const second = mockResponse();
  await handler(req, second);

  assert.equal(calls, 1);
  assert.equal(second.body.cached, true);
});

test("requires the Twelve Data key for equity history", async () => {
  clearMarketHistoryCache();
  const handler = createMarketHistoryHandler({ env: {}, fetchImpl: async () => { throw new Error("must not fetch"); } });
  const res = mockResponse();
  await handler({ method: "GET", query: { symbol: "AAPL", interval: "5m", limit: "100" } }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "EQUITIES_KEY_MISSING");
});

test("returns normalized chronological Twelve Data equity candles", async () => {
  clearMarketHistoryCache();
  let requestedUrl = "";
  const handler = createMarketHistoryHandler({
    env: { TWELVE_DATA_API_KEY: "unit-test-key" },
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => makeTwelvePayload() };
    }
  });
  const res = mockResponse();
  await handler({ method: "GET", query: { symbol: "AAPL", interval: "5m", limit: "60" } }, res);

  const url = new URL(requestedUrl);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, "Twelve Data");
  assert.equal(res.body.count, 60);
  assert.equal(url.searchParams.get("interval"), "5min");
  assert.equal(url.searchParams.get("symbol"), "AAPL");
  assert.equal(url.searchParams.get("outputsize"), "60");
  assert.equal(url.searchParams.get("apikey"), "unit-test-key");
  assert.ok(res.body.candles[0].time < res.body.candles.at(-1).time);
});

test("rejects methods other than GET", async () => {
  clearMarketHistoryCache();
  const handler = createMarketHistoryHandler();
  const res = mockResponse();
  await handler({ method: "POST", query: {} }, res);
  assert.equal(res.statusCode, 405);
});
