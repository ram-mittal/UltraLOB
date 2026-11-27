const HISTORY_SYMBOLS = Object.freeze(["BTCUSDT", "XAUUSD", "AAPL", "MSFT", "GOOGL"]);
const HISTORY_INTERVALS = Object.freeze(["1m", "5m", "15m", "1h", "4h"]);
const CACHE_TTL_MS = Object.freeze({ crypto: 15000, equity: 60000 });
const historyCache = new Map();

function parseQuery(req) {
  const query = req.query || {};
  if (Object.keys(query).length) return query;
  const url = new URL(req.url || "/", "http://ultralob.local");
  return Object.fromEntries(url.searchParams.entries());
}

function parseRequest(req) {
  const query = parseQuery(req);
  const symbol = String(query.symbol || "").trim().toUpperCase();
  const interval = String(query.interval || "1m").trim();
  const limit = Number.parseInt(query.limit || "300", 10);

  if (!HISTORY_SYMBOLS.includes(symbol)) {
    return { error: "Unsupported symbol. Choose BTCUSDT, XAUUSD, AAPL, MSFT or GOOGL.", status: 400 };
  }
  if (!HISTORY_INTERVALS.includes(interval)) {
    return { error: "Unsupported interval. Choose 1m, 5m, 15m, 1h or 4h.", status: 400 };
  }
  if (!Number.isInteger(limit) || limit < 50 || limit > 500) {
    return { error: "limit must be an integer between 50 and 500.", status: 400 };
  }
  return { value: { symbol, interval, limit } };
}

function validCandle(candle) {
  return candle &&
    Number.isFinite(candle.time) && candle.time > 0 &&
    Number.isFinite(candle.open) && candle.open > 0 &&
    Number.isFinite(candle.high) && candle.high > 0 &&
    Number.isFinite(candle.low) && candle.low > 0 &&
    Number.isFinite(candle.close) && candle.close > 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high) &&
    Number.isFinite(candle.volume) && candle.volume >= 0;
}

function normalizeKrakenCandles(rows, interval) {
  if (!Array.isArray(rows)) return [];
  const intervalMs = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000 }[interval];
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length < 8) return null;
    const time = Number(row[0]) * 1000;
    return {
      time,
      close_time: time + intervalMs - 1,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[6])
    };
  }).filter(validCandle).sort((a, b) => a.time - b.time);
}

function parseTwelveDataTime(value) {
  if (typeof value !== "string") return NaN;
  const normalized = value.includes("T") || /(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? value
    : value.replace(" ", "T") + "Z";
  return Date.parse(normalized);
}

function normalizeTwelveDataCandles(payload, interval) {
  if (!payload || !Array.isArray(payload.values)) return [];
  const intervalMs = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000 }[interval];
  return payload.values.map((row) => {
    const time = parseTwelveDataTime(row.datetime);
    return {
    time,
    close_time: time + intervalMs - 1,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume == null || row.volume === "" ? 0 : Number(row.volume)
    };
  }).filter(validCandle).sort((a, b) => a.time - b.time);
}

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

export function createMarketHistoryHandler({
  fetchImpl = (...args) => fetch(...args),
  env = process.env,
  now = () => Date.now()
} = {}) {
  return async function marketHistoryHandler(req, res) {
    res.setHeader?.("Cache-Control", "no-store, max-age=0");
    if (req.method !== "GET") {
      res.setHeader?.("Allow", "GET");
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    const parsed = parseRequest(req);
    if (parsed.error) return sendJson(res, parsed.status, { error: parsed.error });

    const { symbol, interval, limit } = parsed.value;
    const isCrypto = symbol === "BTCUSDT";
    const isGold = symbol === "XAUUSD";
    const provider = isCrypto ? "Kraken Spot" : "Twelve Data";
    const cacheKey = [symbol, interval, limit].join(":");
    const timestamp = now();
    const cached = historyCache.get(cacheKey);
    const ttl = isCrypto ? CACHE_TTL_MS.crypto : CACHE_TTL_MS.equity;
    if (cached && timestamp - cached.fetchedAt < ttl) {
      return sendJson(res, 200, { ...cached.payload, cached: true });
    }

    try {
      let candles;
      if (isCrypto) {
        // Kraken's public Spot OHLC endpoint is used instead of Binance because
        // Binance returned a geographic-eligibility rejection to this deployment.
        const intervalMap = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240 };
        const params = new URLSearchParams({
          pair: "XBTUSD",
          interval: String(intervalMap[interval])
        });
        const response = await fetchImpl("https://api.kraken.com/0/public/OHLC?" + params.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(12000)
        });
        const payload = await response.json();
        if (!response.ok || (Array.isArray(payload?.error) && payload.error.length)) {
          throw new Error(
            (Array.isArray(payload?.error) ? payload.error.join("; ") : "") ||
            "Kraken returned HTTP " + response.status
          );
        }
        const resultEntries = Object.entries(payload?.result || {})
          .filter(([key, value]) => key !== "last" && Array.isArray(value));
        if (!resultEntries.length) throw new Error("Kraken returned no XBT/USD OHLC series.");
        candles = normalizeKrakenCandles(resultEntries[0][1], interval);
        if (!candles || candles.length < 20) {
          throw new Error("Kraken returned fewer than 20 valid BTC/USD candles.");
        }
        candles = candles.slice(-limit);
      } else {
        const apiKey = String(env.TWELVE_DATA_API_KEY || "").trim();
        if (!apiKey) {
          return sendJson(res, 503, {
            error: "Twelve Data historical candles are not configured on this host.",
            code: "EQUITIES_KEY_MISSING",
            hint: "Add TWELVE_DATA_API_KEY to the Render environment and redeploy. BTC history uses Kraken public market data and does not need a key."
          });
        }
        const intervalMap = { "1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h" };
        const tdSymbol = isGold ? "XAU/USD" : symbol;
        const url = new URL("https://api.twelvedata.com/time_series");
        url.search = new URLSearchParams({
          symbol: tdSymbol,
          interval: intervalMap[interval],
          outputsize: String(limit),
          order: "ASC",
          timezone: "UTC",
          apikey: apiKey
        }).toString();

        const response = await fetchImpl(url.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(12000)
        });
        const payload = await response.json();
        if (!response.ok || payload?.status === "error" || payload?.code) {
          throw new Error(payload?.message || payload?.msg || "Twelve Data returned HTTP " + response.status);
        }
        candles = normalizeTwelveDataCandles(payload, interval);
        if (candles.length < 20) {
          throw new Error("Twelve Data returned fewer than 20 valid candles for " + symbol + ".");
        }
      }

      const result = {
        status: "ok",
        symbol,
        market_symbol: isCrypto ? "BTC/USD" : isGold ? "XAU/USD" : symbol,
        quote_currency: "USD",
        provider,
        interval,
        count: candles.length,
        candles,
        fetched_at: now(),
        cached: false,
        calibration: "historical-close-to-close-returns"
      };
      historyCache.set(cacheKey, { payload: result, fetchedAt: now() });
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 502, {
        error: error?.message || "Could not retrieve historical candles.",
        code: isCrypto ? "KRAKEN_HISTORY_UNAVAILABLE" : "TWELVE_DATA_HISTORY_UNAVAILABLE",
        provider,
        symbol
      });
    }
  };
}

export function clearMarketHistoryCache() {
  historyCache.clear();
}

export default createMarketHistoryHandler();
