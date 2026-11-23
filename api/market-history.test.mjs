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

function makeKrakenPayload(count = 60) {
  const startSeconds = 1700000000;
  return {
    error: [],
    result: {
      XXBTZUSD: Array.from({ length: count }, (_, index) => {
        const price = 100 + index;
        return [
          startSeconds + index * 60,
          String(price),
          String(price + 1),
          String(price - 1),
          String(price + 0.5),
          String(price + 0.25),
          "10.5",
          25
        ];
      }),
      last: startSeconds + count * 60
    }
  };
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

test("returns normalized chronological Kraken BTC candles without an API key", async () => {
  clearMarketHistoryCache();
  let requestedUrl = "";
  const handler = createMarketHistoryHandler({
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => makeKrakenPayload() };
    },
    env: {}
  });
  const res = mockResponse();
  await handler({ method: "GET", query: { symbol: "BTCUSDT", interval: "1m", limit: "60" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, "Kraken Spot");
  assert.equal(res.body.market_symbol, "BTC/USD");
  assert.equal(res.body.quote_currency, "USD");
  assert.equal(res.body.count, 60);
  assert.ok(requestedUrl.startsWith("https://api.kraken.com/0/public/OHLC?"));
  assert.equal(new URL(requestedUrl).searchParams.get("pair"), "XBTUSD");
  assert.equal(new URL(requestedUrl).searchParams.get("interval"), "1");
  assert.ok(res.body.candles[0].time < res.body.candles.at(-1).time);
  assert.equal(res.body.candles[0].open, 100);
  assert.equal(res.body.candles[0].close, 100.5);
  assert.equal(res.body.candles[0].close_time, 1700000000999);
});

test("returns cached Kraken candles within the cache window", async () => {
  clearMarketHistoryCache();
  let calls = 0;
  let clock = 100000;
  const handler = createMarketHistoryHandler({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => makeKrakenPayload() };
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
  assert.equal(res.body.candles[0].close_time, res.body.candles[0].time + 299999);
});

test("rejects methods other than GET", async () => {
  clearMarketHistoryCache();
  const handler = createMarketHistoryHandler();
  const res = mockResponse();
  await handler({ method: "POST", query: {} }, res);
  assert.equal(res.statusCode, 405);
});
