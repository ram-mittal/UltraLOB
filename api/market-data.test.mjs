import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_SYMBOLS, normalizeSymbols, normalizeTwelveDataMessage } from "../lib/market-data.js";

test("default subscription contains the current terminal instruments", () => {
  assert.deepEqual(normalizeSymbols(null), ["AAPL", "MSFT", "GOOGL"]);
});

test("normalizes permitted symbols and removes surrounding whitespace", () => {
  assert.deepEqual(normalizeSymbols(" msft, AAPL "), ["MSFT", "AAPL"]);
});

test("rejects symbols outside the configured allowlist", () => {
  assert.throws(() => normalizeSymbols("AAPL,TSLA"), /Unsupported symbol/);
});

test("rejects duplicate symbols", () => {
  assert.throws(() => normalizeSymbols("AAPL,AAPL"), /Duplicate symbols/);
});

test("rejects empty or oversized symbol requests", () => {
  assert.throws(() => normalizeSymbols(" , "), /one to three/);
  assert.throws(() => normalizeSymbols(LIVE_SYMBOLS.join(",") + ",NVDA"), /one to three/);
});

test("maps a Twelve Data price event to a normalized live tick", () => {
  assert.deepEqual(
    normalizeTwelveDataMessage({
      event: "price",
      symbol: "aapl",
      price: "192.45",
      currency: "USD",
      exchange: "NASDAQ",
      timestamp: 1700000000,
      day_volume: "123456"
    }),
    {
      event: "price",
      provider: "Twelve Data",
      symbol: "AAPL",
      price: 192.45,
      currency: "USD",
      exchange: "NASDAQ",
      timestamp: 1700000000000,
      day_volume: 123456
    }
  );
});

test("ignores invalid and non-price messages", () => {
  assert.equal(normalizeTwelveDataMessage({ event: "subscribe-status", status: "ok" }), null);
  assert.equal(normalizeTwelveDataMessage({ event: "price", symbol: "AAPL", price: "NaN" }), null);
  assert.equal(normalizeTwelveDataMessage({ event: "price", symbol: "TSLA", price: 200 }), null);
});
