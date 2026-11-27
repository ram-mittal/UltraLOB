// Engine 6: Economic Event Intelligence & High-Impact Blackout Monitor
// Fetches public Forex Factory JSON schedule cleanly when network access is permitted,
// accepts operator-registered blackout windows, and never invents fake events when offline.

const CACHE_TTL_MS = 15 * 60 * 1000;
let calendarCache = { fetchedAt: 0, events: [], status: "NOT_FETCHED", error: null };

export async function fetchMacroCalendar({ fetchImpl = (...args) => fetch(...args), now = () => Date.now(), disableRemote = false } = {}) {
  if (disableRemote || process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS === "true") {
    return {
      status: "OFFLINE_SANDBOX",
      source: "LOCAL_OPERATOR_WINDOWS",
      events: [],
      note: "Remote economic calendar fetch disabled in test/offline mode."
    };
  }

  const ts = now();
  if (calendarCache.fetchedAt > 0 && ts - calendarCache.fetchedAt < CACHE_TTL_MS) {
    return {
      status: calendarCache.status,
      source: "ForexFactory Weekly Feed (Cached)",
      events: calendarCache.events,
      error: calendarCache.error
    };
  }

  try {
    const res = await fetchImpl("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      headers: { Accept: "application/json", "User-Agent": "UltraLOB-EventIntel/1.0" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`Calendar HTTP ${res.status}`);
    const rows = await res.json();
    const relevant = (Array.isArray(rows) ? rows : [])
      .filter((r) => ["USD", "XAU", "ALL"].includes(String(r.country || "").toUpperCase()))
      .filter((r) => ["High", "Medium"].includes(String(r.impact || "")))
      .map((r, idx) => ({
        id: `ff-${idx}-${r.date || ""}`,
        title: String(r.title || "Macro Event"),
        currency: String(r.country || "USD").toUpperCase(),
        impact: String(r.impact || "Medium").toUpperCase(),
        timestamp_utc: r.date ? new Date(r.date).toISOString() : null,
        forecast: r.forecast || null,
        previous: r.previous || null,
        source: "ForexFactory Public Calendar"
      }))
      .filter((e) => e.timestamp_utc && !Number.isNaN(Date.parse(e.timestamp_utc)));

    calendarCache = { fetchedAt: ts, events: relevant, status: "LIVE", error: null };
    return { status: "LIVE", source: "ForexFactory Weekly Feed", events: relevant, error: null };
  } catch (err) {
    calendarCache = { fetchedAt: ts, events: [], status: "UNAVAILABLE", error: err.message };
    return { status: "UNAVAILABLE", source: "NONE", events: [], error: err.message };
  }
}

export function evaluateEventRestriction({
  symbol = "XAUUSD",
  events = [],
  customBlackouts = [],
  nowMs = Date.now(),
  blackoutMinutesBefore = 30,
  blackoutMinutesAfter = 30
} = {}) {
  const cleanSym = String(symbol || "").toUpperCase();
  const relevantCurrencies = cleanSym.includes("XAU") || cleanSym.includes("USD") ? new Set(["USD", "XAU", "ALL"]) : new Set(["ALL"]);

  const allEvents = [...(events || []), ...(customBlackouts || [])];
  const beforeMs = blackoutMinutesBefore * 60_000;
  const afterMs = blackoutMinutesAfter * 60_000;

  const activeRestrictions = [];
  const upcomingHighImpact = [];

  for (const ev of allEvents) {
    const impact = String(ev.impact || "HIGH").toUpperCase();
    const cur = String(ev.currency || "USD").toUpperCase();
    if (!relevantCurrencies.has(cur) && impact !== "HIGH") continue;

    const evTs = ev.timestamp_utc ? Date.parse(ev.timestamp_utc) : NaN;
    if (!Number.isFinite(evTs)) continue;

    const diffMs = evTs - nowMs;
    if (impact === "HIGH" && diffMs <= beforeMs && diffMs >= -afterMs) {
      activeRestrictions.push({
        id: ev.id,
        title: ev.title,
        currency: cur,
        impact,
        timestamp_utc: ev.timestamp_utc,
        minutes_to_event: Math.round(diffMs / 60_000),
        source: ev.source || "OPERATOR_WINDOW"
      });
    } else if (impact === "HIGH" && diffMs > 0 && diffMs <= 24 * 3_600_000) {
      upcomingHighImpact.push({
        id: ev.id,
        title: ev.title,
        currency: cur,
        impact,
        timestamp_utc: ev.timestamp_utc,
        minutes_to_event: Math.round(diffMs / 60_000)
      });
    }
  }

  return {
    engine: "EventIntelligenceEngine",
    status: activeRestrictions.length > 0 ? "RESTRICTED" : upcomingHighImpact.length > 0 ? "CAUTION" : "CLEAR",
    restricted: activeRestrictions.length > 0,
    active_restrictions: activeRestrictions,
    upcoming_24h_high_impact: upcomingHighImpact.slice(0, 10),
    blackout_window_minutes: { before: blackoutMinutesBefore, after: blackoutMinutesAfter }
  };
}
