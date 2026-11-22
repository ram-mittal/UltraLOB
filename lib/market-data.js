export const LIVE_SYMBOLS = Object.freeze(["AAPL", "MSFT", "GOOGL"]);

export function normalizeSymbols(raw) {
  const requested = raw == null || String(raw).trim() === ""
    ? [...LIVE_SYMBOLS]
    : String(raw).split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);

  if (requested.length < 1 || requested.length > LIVE_SYMBOLS.length) {
    throw new Error("Request one to three supported symbols.");
  }

  const unique = [...new Set(requested)];
  if (unique.length !== requested.length) {
    throw new Error("Duplicate symbols are not allowed.");
  }

  const unsupported = unique.filter((symbol) => !LIVE_SYMBOLS.includes(symbol));
  if (unsupported.length) {
    throw new Error("Unsupported symbol(s): " + unsupported.join(", "));
  }

  return unique;
}

export function normalizeTwelveDataMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  if (message.event !== "price") return null;

  const symbol = String(message.symbol || "").trim().toUpperCase();
  const price = Number(message.price);
  const timestampSeconds = Number(message.timestamp);

  if (!LIVE_SYMBOLS.includes(symbol) || !Number.isFinite(price) || price <= 0) return null;

  return {
    event: "price",
    provider: "Twelve Data",
    symbol,
    price,
    currency: typeof message.currency === "string" ? message.currency : null,
    exchange: typeof message.exchange === "string" ? message.exchange : null,
    timestamp: Number.isFinite(timestampSeconds) && timestampSeconds > 0
      ? timestampSeconds * 1000
      : Date.now(),
    day_volume: Number.isFinite(Number(message.day_volume))
      ? Number(message.day_volume)
      : null
  };
}
