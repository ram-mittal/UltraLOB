import crypto from "node:crypto";
import { isDatabaseConfigured, initializeDatabase, query } from "../db/client.js";

export const STRATEGY_LIFECYCLE_STATUSES = Object.freeze([
  "RESEARCH",
  "BACKTESTED",
  "FORWARD_TESTING",
  "LIVE_PILOT",
  "VERIFIED_LIVE",
  "PAUSED",
  "RETIRED"
]);

export const DATA_ORIGIN_LABELS = Object.freeze({
  REAL_MARKET: "REAL_MARKET",
  BACKTEST: "BACKTEST",
  DEMO_BROKER: "DEMO_BROKER",
  LIVE_BROKER: "LIVE_BROKER",
  PAPER_SANDBOX: "PAPER_SANDBOX",
  SIMULATED_RESEARCH: "SIMULATED_RESEARCH",
  RESEARCH: "RESEARCH"
});

/**
 * Core institutional strategy catalogue (UL-01 through UL-05).
 * No performance metrics are invented: all empirical fields remain null
 * until backed by verified historical backtests or broker-confirmed records.
 */
export const CORE_STRATEGIES = [
  {
    id: "ul-01-gold-trend",
    code: "UL-01",
    name: "UL-01: Gold Institutional Trend",
    author: "UltraLOB Quant Research",
    icon: "🥇",
    gradient: "from-amber-500 to-yellow-600",
    category: "trend",
    category_label: "Trend Following",
    instrument: "XAUUSD",
    supported_instruments: ["XAUUSD"],
    timeframe: "H4 / H1 / M15",
    timeframes: ["H4", "H1", "M15"],
    risk_level: "medium",
    lifecycle_status: "RESEARCH",
    data_source_label: "RESEARCH",
    status: "research",
    version: "1.0.0",
    ea_type: "Institutional Trend EA",
    description:
      "Captures directional XAUUSD movements across H4/H1 regime structure and M15 entry confirmation while filtering low-quality sideways and wide-spread regimes.",
    entry_logic:
      "H4/H1 EMA & market structure establish directional bias; ATR expansion & breakout retest or continuation confirmed on M15 under spread/session gates.",
    exit_logic:
      "Partial profit booking at structural targets, break-even transition, dynamic trailing stops, and maximum holding-time rule.",
    stop_loss_methodology: "Swing structure invalidation combined with ATR buffer.",
    take_profit_methodology: "Dynamic R-multiple & structural liquidity partial exits.",
    risk_per_trade_pct: 0.5,
    position_sizing_methodology: "Monetary risk budget normalized by stop distance, tick size, and tick value.",
    cost_slippage_assumptions: {
      spread_points_assumed: 25,
      commission_per_lot_usd: 7.0,
      slippage_points_assumed: 5,
      swap_modeled: true
    },
    supported_brokers: ["MT5 Demo", "Exness MT5 Demo"],
    capacity_limit_usd: 5000000,
    min_capital: 1000,
    status_note: "RESEARCH — Backtesting in progress. Performance metrics pending empirical validation.",
    // Quantitative empirical metrics (populated only by real backtest / broker execution)
    total_return: null,
    cagr: null,
    win_rate: null,
    sharpe_ratio: null,
    sortino_ratio: null,
    max_drawdown: null,
    profit_factor: null,
    avg_profit_trade: null,
    avg_loss_trade: null,
    expectancy: null,
    total_trades: 0,
    avg_trade_duration: null,
    max_consecutive_losses: null,
    risk_of_ruin: null,
    out_of_sample: null,
    walk_forward: null,
    monte_carlo_risk: null,
    subscribers: 0,
    created_at: "2026-11-27",
    monthly_returns: [],
    equity_curve: [],
    drawdown: []
  },
  {
    id: "ul-02-liquidity-sweep",
    code: "UL-02",
    name: "UL-02: Liquidity Sweep Reversal",
    author: "UltraLOB Quant Research",
    icon: "💧",
    gradient: "from-sky-500 to-indigo-600",
    category: "market-structure",
    category_label: "Smart Money / Market Structure",
    instrument: "XAUUSD",
    supported_instruments: ["XAUUSD"],
    timeframe: "H4 / H1 / M15",
    timeframes: ["H4", "H1", "M15"],
    risk_level: "medium",
    lifecycle_status: "RESEARCH",
    data_source_label: "RESEARCH",
    status: "research",
    version: "1.0.0",
    ea_type: "Market Structure Reversal EA",
    description:
      "Identifies failed breakouts and liquidity sweeps near previous day H/L, Asian session H/L, and H1/H4 swing levels. Requires displacement and market structure shift rather than raw wick touches.",
    entry_logic:
      "Monitor previous-day & Asian session highs/lows and H1/H4 swings; confirm sweep rejection via displacement candle + Market Structure Shift + optional FVG retest.",
    exit_logic: "Opposing liquidity pools, structural targets, and time/volatility invalidation.",
    stop_loss_methodology: "Placed strictly beyond sweep invalidation point with spread margin.",
    take_profit_methodology: "Dynamic risk/reward scaled across opposing liquidity levels.",
    risk_per_trade_pct: 0.5,
    position_sizing_methodology: "Fixed fractional equity risk normalized by invalidation stop distance.",
    cost_slippage_assumptions: {
      spread_points_assumed: 25,
      commission_per_lot_usd: 7.0,
      slippage_points_assumed: 8,
      swap_modeled: true
    },
    supported_brokers: ["MT5 Demo", "Exness MT5 Demo"],
    capacity_limit_usd: 3000000,
    min_capital: 1000,
    status_note: "RESEARCH — Backtesting in progress. Simple wicks do not trigger trades; displacement & MSS validation pending.",
    total_return: null,
    cagr: null,
    win_rate: null,
    sharpe_ratio: null,
    sortino_ratio: null,
    max_drawdown: null,
    profit_factor: null,
    avg_profit_trade: null,
    avg_loss_trade: null,
    expectancy: null,
    total_trades: 0,
    avg_trade_duration: null,
    max_consecutive_losses: null,
    risk_of_ruin: null,
    out_of_sample: null,
    walk_forward: null,
    monte_carlo_risk: null,
    subscribers: 0,
    created_at: "2026-11-27",
    monthly_returns: [],
    equity_curve: [],
    drawdown: []
  },
  {
    id: "ul-03-volume-profile",
    code: "UL-03",
    name: "UL-03: Volume Profile Mean Reversion",
    author: "UltraLOB Quant Research",
    icon: "📊",
    gradient: "from-emerald-500 to-teal-600",
    category: "mean-reversion",
    category_label: "Mean Reversion / Volume Profile",
    instrument: "XAUUSD",
    supported_instruments: ["XAUUSD"],
    timeframe: "H1 / M15",
    timeframes: ["H1", "M15"],
    risk_level: "low",
    lifecycle_status: "RESEARCH",
    data_source_label: "RESEARCH",
    status: "research",
    version: "1.0.0",
    ea_type: "Value Area Mean Reversion EA",
    description:
      "Targets mean reversion toward Point of Control (POC) during range-bound XAUUSD regimes using Session/Fixed Volume Profile (VAH/VAL) and VWAP deviation bands. Explicitly labels broker tick volume vs centralized volume.",
    entry_logic:
      "Detect range-bound regime via ADX/ATR filters; identify extension beyond VAH/VAL & VWAP bands; enter only on rejection confirmation toward POC.",
    exit_logic: "Target POC or opposing value boundary; abort immediately if trend regime emerges.",
    stop_loss_methodology: "Structure-based invalidation outside accepted value excursion + ATR buffer.",
    take_profit_methodology: "Dynamic target selection anchored to Session POC / VWAP.",
    risk_per_trade_pct: 0.4,
    position_sizing_methodology: "Risk-normalized volume accounting for tick volume data-source limitations.",
    cost_slippage_assumptions: {
      spread_points_assumed: 25,
      commission_per_lot_usd: 7.0,
      slippage_points_assumed: 5,
      volume_source_disclosure: "Broker tick volume (not centralized exchange volume)"
    },
    supported_brokers: ["MT5 Demo", "Exness MT5 Demo"],
    capacity_limit_usd: 4000000,
    min_capital: 1000,
    status_note: "RESEARCH — Backtesting in progress. Uses labeled broker tick volume profile; avoids fading strong directional trends.",
    total_return: null,
    cagr: null,
    win_rate: null,
    sharpe_ratio: null,
    sortino_ratio: null,
    max_drawdown: null,
    profit_factor: null,
    avg_profit_trade: null,
    avg_loss_trade: null,
    expectancy: null,
    total_trades: 0,
    avg_trade_duration: null,
    max_consecutive_losses: null,
    risk_of_ruin: null,
    out_of_sample: null,
    walk_forward: null,
    monte_carlo_risk: null,
    subscribers: 0,
    created_at: "2026-11-27",
    monthly_returns: [],
    equity_curve: [],
    drawdown: []
  },
  {
    id: "ul-04-gold-scalper",
    code: "UL-04",
    name: "UL-04: Gold Momentum Scalper",
    author: "UltraLOB Quant Research",
    icon: "⚡",
    gradient: "from-cyan-500 to-blue-600",
    category: "scalping",
    category_label: "Short-Term Momentum / Execution-Aware",
    instrument: "XAUUSD",
    supported_instruments: ["XAUUSD"],
    timeframe: "Tick / M1 / M5",
    timeframes: ["Tick", "M1", "M5"],
    risk_level: "high",
    lifecycle_status: "RESEARCH",
    data_source_label: "RESEARCH",
    status: "research",
    version: "1.0.0",
    ea_type: "Execution-Aware Momentum EA",
    description:
      "Captures short-term XAUUSD price acceleration under strict spread, tick-rate, and slippage gates. Never relies on fabricated order-book depth when broker feeds lack L2 data.",
    entry_logic:
      "Verify tight bid/ask spread and session liquidity; detect short-term price velocity/acceleration with tick-volume expansion.",
    exit_logic: "Tight execution target, momentum decay exit, or hard time-based exit.",
    stop_loss_methodology: "Execution risk budget with strict spread-widening circuit breaker.",
    take_profit_methodology: "Short-horizon momentum target or trailing micro-structure stop.",
    risk_per_trade_pct: 0.25,
    position_sizing_methodology: "Execution-budgeted sizing sensitive to spread and modeled slippage.",
    cost_slippage_assumptions: {
      spread_points_assumed: 18,
      commission_per_lot_usd: 7.0,
      slippage_points_assumed: 10,
      requires_raw_spread: true
    },
    supported_brokers: ["MT5 Demo (Raw Spread)", "Exness MT5 Demo"],
    capacity_limit_usd: 1000000,
    min_capital: 2000,
    status_note: "RESEARCH — Requires tick-level spread/slippage calibration prior to forward testing.",
    total_return: null,
    cagr: null,
    win_rate: null,
    sharpe_ratio: null,
    sortino_ratio: null,
    max_drawdown: null,
    profit_factor: null,
    avg_profit_trade: null,
    avg_loss_trade: null,
    expectancy: null,
    total_trades: 0,
    avg_trade_duration: null,
    max_consecutive_losses: null,
    risk_of_ruin: null,
    out_of_sample: null,
    walk_forward: null,
    monte_carlo_risk: null,
    subscribers: 0,
    created_at: "2026-11-27",
    monthly_returns: [],
    equity_curve: [],
    drawdown: []
  },
  {
    id: "ul-05-adaptive-regime",
    code: "UL-05",
    name: "UL-05: Adaptive Multi-Regime Strategy",
    author: "UltraLOB Quant Research",
    icon: "🧭",
    gradient: "from-brand-500 to-purple-600",
    category: "multi-regime",
    category_label: "Regime-Adaptive Quantitative",
    instrument: "XAUUSD",
    supported_instruments: ["XAUUSD", "EURUSD", "NAS100", "BTCUSD"],
    timeframe: "H4 / H1 / M15",
    timeframes: ["H4", "H1", "M15"],
    risk_level: "medium",
    lifecycle_status: "RESEARCH",
    data_source_label: "RESEARCH",
    status: "research",
    version: "1.0.0",
    ea_type: "Regime-Switching Meta-Strategy",
    description:
      "Classifies market conditions into trending, range-bound, high-volatility breakout, or low-liquidity chop, activating only compatible sub-strategies and standing aside during adverse regimes.",
    entry_logic:
      "Multi-feature regime classifier routes active state to Trend, Mean-Reversion, or Cash/Stand-Aside posture.",
    exit_logic: "Regime transition exit + sub-strategy structural profit/stop rules.",
    stop_loss_methodology: "Volatility-regime scaled structural stop with drawdown throttling.",
    take_profit_methodology: "Adaptive to active regime (trailing in trend, value target in range).",
    risk_per_trade_pct: 0.5,
    position_sizing_methodology: "Volatility-adjusted & regime-confidence weighted risk normalization.",
    cost_slippage_assumptions: {
      spread_points_assumed: 25,
      commission_per_lot_usd: 7.0,
      slippage_points_assumed: 6,
      swap_modeled: true
    },
    supported_brokers: ["MT5 Demo", "Exness MT5 Demo"],
    capacity_limit_usd: 10000000,
    min_capital: 2500,
    status_note: "RESEARCH — Meta-regime engine built in Phase 2 after UL-01..UL-03 individual validations.",
    total_return: null,
    cagr: null,
    win_rate: null,
    sharpe_ratio: null,
    sortino_ratio: null,
    max_drawdown: null,
    profit_factor: null,
    avg_profit_trade: null,
    avg_loss_trade: null,
    expectancy: null,
    total_trades: 0,
    avg_trade_duration: null,
    max_consecutive_losses: null,
    risk_of_ruin: null,
    out_of_sample: null,
    walk_forward: null,
    monte_carlo_risk: null,
    subscribers: 0,
    created_at: "2026-11-27",
    monthly_returns: [],
    equity_curve: [],
    drawdown: []
  }
];

function createEmptyPortfolio(environment = "PAPER_SANDBOX") {
  return {
    environment,
    dataOrigin: environment,
    balance: 0,
    equity: 0,
    margin_used: 0,
    equity_high_water: 0,
    subscriptions: [],
    trades: [],
    equityHistory: [],
    mcConfig: {
      enabled: false,
      minTargetProb: 0.55,
      minEdgePct: 10,
      minExpectedReturnPct: 0.25,
      riskAmountUsd: 250,
      maxConcurrentTrades: 3,
      cooldownSeconds: 30,
      lastEvaluatedAt: null,
      lastSignal: null
    }
  };
}

// Ephemeral in-memory fallback store used ONLY when DATABASE_URL is not configured
const memoryStore = {
  usersByEmail: new Map(),
  usersById: new Map(),
  refreshTokens: new Map(),
  customStrategies: [],
  portfolios: new Map(),
  brokers: new Map(),
  mt5Signals: [],
  riskConfigs: new Map(),
  riskEvents: [],
  auditLogs: []
};

export function getMemoryStore() {
  return memoryStore;
}

export function getPortfolioForUser(userId = "guest") {
  if (!memoryStore.portfolios.has(userId)) {
    memoryStore.portfolios.set(userId, createEmptyPortfolio("PAPER_SANDBOX"));
  }
  return memoryStore.portfolios.get(userId);
}

export function getAllStrategiesInMemory() {
  return [...CORE_STRATEGIES, ...memoryStore.customStrategies];
}

export async function seedCoreStrategies(pool) {
  if (!pool) return;
  for (const s of CORE_STRATEGIES) {
    await pool.query(
      `INSERT INTO strategies
       (id, code, name, author, category, instrument, supported_instruments, timeframes,
        lifecycle_status, data_source_label, current_version, description, risk_level,
        min_capital, capacity_limit_usd, supported_brokers, status_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [
        s.id,
        s.code,
        s.name,
        s.author,
        s.category,
        s.instrument,
        s.supported_instruments,
        s.timeframes,
        s.lifecycle_status,
        s.data_source_label,
        s.version,
        s.description,
        s.risk_level,
        s.min_capital,
        s.capacity_limit_usd,
        s.supported_brokers,
        s.status_note
      ]
    );
    await pool.query(
      `INSERT INTO strategy_versions
       (strategy_id, version, entry_logic, exit_logic, stop_loss_methodology,
        take_profit_methodology, position_sizing_methodology, risk_per_trade_pct,
        cost_slippage_assumptions, changelog)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       ON CONFLICT (strategy_id, version) DO NOTHING`,
      [
        s.id,
        s.version,
        s.entry_logic,
        s.exit_logic,
        s.stop_loss_methodology,
        s.take_profit_methodology,
        s.position_sizing_methodology,
        s.risk_per_trade_pct,
        JSON.stringify(s.cost_slippage_assumptions || {}),
        "Initial Phase 1 research specification."
      ]
    );
  }
}

export async function ensureDbReady() {
  if (!isDatabaseConfigured()) return false;
  await initializeDatabase({ seedStrategiesFn: seedCoreStrategies });
  return true;
}

const TOKEN_SECRET =
  process.env.ULTRALOB_JWT_SECRET ||
  crypto.createHash("sha256").update("ultralob-dev-secret-change-in-prod").digest("hex");

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, keyHex] = String(storedHash || "").split(":");
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function signToken(payload, ttlSeconds = 3600) {
  const now = Date.now();
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds * 1000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractAuthContext(request) {
  const auth = request.headers?.authorization || "";
  if (auth.startsWith("Bearer ")) {
    const decoded = verifyToken(auth.slice(7).trim());
    if (decoded?.id) {
      return {
        authenticated: true,
        userId: decoded.id,
        email: decoded.email || null,
        name: decoded.name || null,
        role: decoded.role || "investor",
        orgId: decoded.orgId || null
      };
    }
  }
  return {
    authenticated: false,
    userId: "guest",
    email: null,
    name: "Guest Sandbox",
    role: "guest",
    orgId: null
  };
}

export function extractUserId(request) {
  return extractAuthContext(request).userId;
}

export function saveStore() {
  // No-op kept for module compatibility; persistence now routes through PostgreSQL (db/client.js).
}

export function getStore() {
  // Compatibility wrapper returning a structured view over memoryStore
  return {
    customStrategies: memoryStore.customStrategies,
    brokers: Object.fromEntries(memoryStore.brokers),
    mt5Signals: memoryStore.mt5Signals
  };
}

export { query };
