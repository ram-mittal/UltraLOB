import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_SYMBOLS,
  EQUITY_SYMBOLS,
  CRYPTO_SYMBOLS,
  normalizeSymbols,
  normalizeTwelveDataMessage,
  normalizeBinanceTradeMessage,
  normalizeBinanceBookTickerMessage
} from "../lib/market-data.js";

test("default subscription contains equities and BTCUSDT", () => {
  assert.deepEqual(normalizeSymbols(null), ["AAPL", "MSFT", "GOOGL", "BTCUSDT"]);
  assert.deepEqual(CRYPTO_SYMBOLS, ["BTCUSDT"]);
  assert.deepEqual(EQUITY_SYMBOLS, ["AAPL", "MSFT", "GOOGL"]);
});

test("normalizes permitted symbols and removes surrounding whitespace", () => {
  assert.deepEqual(normalizeSymbols(" msft, btcusdt "), ["MSFT", "BTCUSDT"]);
});

test("rejects symbols outside the configured allowlist", () => {
  assert.throws(() => normalizeSymbols("AAPL,TSLA"), /Unsupported symbol/);
});

test("rejects duplicate symbols", () => {
  assert.throws(() => normalizeSymbols("AAPL,AAPL"), /Duplicate symbols/);
});

test("rejects empty or oversized symbol requests", () => {
  assert.throws(() => normalizeSymbols(" , "), /one to four/);
  assert.throws(() => normalizeSymbols(LIVE_SYMBOLS.join(",") + ",NVDA"), /one to four/);
});

test("maps a Twelve Data equity price event to a normalized live tick", () => {
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
  assert.equal(
    normalizeTwelveDataMessage({ event: "price", symbol: "BTCUSDT", price: "67000" }),
    null
  );
});

test("normalizes a Binance BTCUSDT trade event", () => {
  assert.deepEqual(
    normalizeBinanceTradeMessage({
      e: "trade",
      E: 1700000000123,
      s: "BTCUSDT",
      t: 987654,
      p: "67234.50",
      q: "0.025",
      T: 1700000000456,
      m: false
    }),
    {
      event: "price",
      provider: "Binance Spot",
      symbol: "BTCUSDT",
      price: 67234.5,
      currency: "USDT",
      exchange: "BINANCE",
      timestamp: 1700000000456,
      trade_id: 987654,
      trade_quantity: 0.025,
      buyer_is_maker: false
    }
  );
});

test("normalizes Binance best-bid/ask updates", () => {
  const quote = normalizeBinanceBookTickerMessage({
    e: "bookTicker",
    u: 400900217,
    s: "BTCUSDT",
    b: "67234.40",
    B: "1.250",
    a: "67234.50",
    A: "0.875"
  });
  assert.equal(quote.event, "book");
  assert.equal(quote.provider, "Binance Spot");
  assert.equal(quote.symbol, "BTCUSDT");
  assert.equal(quote.bid, 67234.4);
  assert.equal(quote.ask, 67234.5);
  assert.equal(quote.bid_quantity, 1.25);
  assert.equal(quote.ask_quantity, 0.875);
  assert.equal(quote.update_id, 400900217);
});

test("ignores malformed, unsupported, and non-market messages", () => {
  assert.equal(normalizeTwelveDataMessage({ event: "subscribe-status", status: "ok" }), null);
  assert.equal(normalizeBinanceTradeMessage({ e: "trade", s: "ETHUSDT", p: "2000", q: "1" }), null);
  assert.equal(normalizeBinanceTradeMessage({ e: "trade", s: "BTCUSDT", p: "NaN", q: "1" }), null);
  assert.equal(normalizeBinanceBookTickerMessage({ e: "bookTicker", s: "BTCUSDT", b: "101", B: "1", a: "100", A: "1" }), null);
});
