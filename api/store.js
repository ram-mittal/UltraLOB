import crypto from "node:crypto";
import { isDatabaseConfigured, initializeDatabase, query, recordRiskEvent } from "../db/client.js";
import { createDefaultRiskState } from "../risk/engine.js";

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

export function createEmptyPortfolio(environment = "PAPER_SANDBOX") {
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
  auditLogs: [],
  backtests: []
};

export function getMemoryStore() {
  return memoryStore;
}

export function getPortfolioForUser(userId) {
  if (!userId || userId === "guest") {
    return createEmptyPortfolio("GUEST_READ_ONLY");
  }
  if (!memoryStore.portfolios.has(userId)) {
    memoryStore.portfolios.set(userId, createEmptyPortfolio("PAPER_SANDBOX"));
  }
  return memoryStore.portfolios.get(userId);
}

export function getRiskStateForUser(userId) {
  if (!userId || userId === "guest") {
    return createDefaultRiskState();
  }
  if (!memoryStore.riskConfigs.has(userId)) {
    memoryStore.riskConfigs.set(userId, createDefaultRiskState());
  }
  return memoryStore.riskConfigs.get(userId);
}

/**
 * Resolves and authorizes which target user's portfolio/risk state an operator can inspect or govern.
 * Non-admin operators can access ONLY their own records, or same-org records when explicitly authorized (e.g. risk_manager).
 */
export async function resolveManagedUserScope(auth, rawTargetUserId = null, { dbAvailable = false, allowSameOrgRoles = [] } = {}) {
  if (!auth || !auth.authenticated) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authentication required." };
  }
  const target = rawTargetUserId ? String(rawTargetUserId).trim() : auth.userId;
  if (!target || target === auth.userId) {
    return { ok: true, targetUserId: auth.userId };
  }
  if (auth.role === "admin") {
    return { ok: true, targetUserId: target };
  }
  if (allowSameOrgRoles.includes(auth.role) && auth.orgId) {
    let targetOrgId = null;
    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(target)) {
      const res = await query(`SELECT org_id FROM users WHERE id = $1`, [target]).catch(() => ({ rows: [] }));
      targetOrgId = res.rows[0]?.org_id || null;
    } else {
      targetOrgId = memoryStore.usersById.get(target)?.org_id || null;
    }
    if (targetOrgId && targetOrgId === auth.orgId) {
      return { ok: true, targetUserId: target };
    }
  }
  return {
    ok: false,
    status: 403,
    code: "FORBIDDEN_OWNERSHIP",
    error: "Cross-account access denied: insufficient ownership or organization scope."
  };
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

const KNOWN_INSECURE_SECRETS = new Set([
  "ultralob-dev-secret-change-in-prod",
  "replace-with-a-long-random-secret",
  "changeme",
  "secret",
  "dev-secret",
  "development"
]);

const MIN_JWT_SECRET_LENGTH = 32;
let ephemeralProcessSecret = null;

export function isStrictProductionRuntime() {
  if (process.env.ULTRALOB_REQUIRE_JWT_SECRET === "true") return true;
  const inTestRunner = Boolean(
    process.env.NODE_TEST_CONTEXT ||
    process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS === "true" ||
    process.env.NODE_ENV === "test"
  );
  if (inTestRunner) return false;
  return Boolean(
    process.env.NODE_ENV === "production" ||
    process.env.RENDER === "true" ||
    process.env.RENDER_SERVICE_ID ||
    process.env.RENDER_EXTERNAL_HOSTNAME ||
    process.env.VERCEL === "1" ||
    (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "development") ||
    (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) ||
    process.env.ULTRALOB_RENDER_MODE === "true"
  );
}

export function resolveJwtSecret({ allowEphemeralTest = false } = {}) {
  const raw = String(process.env.ULTRALOB_JWT_SECRET || "").trim();
  if (raw) {
    if (raw.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `FATAL: ULTRALOB_JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long.`
      );
    }
    if (KNOWN_INSECURE_SECRETS.has(raw.toLowerCase())) {
      throw new Error(
        "FATAL: ULTRALOB_JWT_SECRET uses a known insecure placeholder. Generate a random secret with at least 32 characters."
      );
    }
    return raw;
  }

  if (!allowEphemeralTest && isStrictProductionRuntime()) {
    throw new Error(
      "FATAL: ULTRALOB_JWT_SECRET environment variable is missing. Production startup aborted to prevent predictable token signing."
    );
  }

  // Strictly non-production (unit tests / ephemeral local sandbox): unique CSPRNG secret per process.
  if (!ephemeralProcessSecret) {
    ephemeralProcessSecret = crypto.randomBytes(48).toString("hex");
  }
  return ephemeralProcessSecret;
}

export function assertJwtSecretConfigured() {
  return resolveJwtSecret({ allowEphemeralTest: false });
}

export function hashRefreshToken(token) {
  const secret = resolveJwtSecret();
  return crypto.createHmac("sha256", secret).update(String(token), "utf8").digest("hex");
}

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
  const secret = resolveJwtSecret();
  const now = Date.now();
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      jti: crypto.randomUUID(),
      typ: "ultralob-access-v2",
      iat: now,
      exp: now + ttlSeconds * 1000
    })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const secret = resolveJwtSecret();
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed?.id || !Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return null;
    if (Date.now() > parsed.exp) return null;
    const minIatRaw = Number(process.env.ULTRALOB_JWT_MIN_IAT || 0);
    if (Number.isFinite(minIatRaw) && minIatRaw > 0) {
      const minIatMs = minIatRaw < 1e12 ? minIatRaw * 1000 : minIatRaw;
      if (parsed.iat < minIatMs) return null;
    }
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
        orgId: decoded.orgId || null,
        authMethod: "jwt"
      };
    }
  }
  const apiKey = request.headers?.["x-api-key"];
  if (apiKey && typeof apiKey === "string" && apiKey.startsWith("ulb_ent_")) {
    const hash = sha256Hex(apiKey.trim());
    const found = (memoryStore.apiKeys || []).find((k) => k.key_hash === hash && k.status === "ACTIVE");
    if (found) {
      return {
        authenticated: true,
        userId: found.userId,
        email: null,
        name: found.label,
        role: "investor",
        scopes: found.scopes || [],
        orgId: found.orgId || null,
        authMethod: "api_key"
      };
    }
  }
  return {
    authenticated: false,
    userId: "guest",
    email: null,
    name: "Guest Sandbox",
    role: "guest",
    orgId: null,
    authMethod: "none"
  };
}

export async function resolveAuthContext(request, dbAvailable = false) {
  const ctx = extractAuthContext(request);
  if (ctx.authenticated || !dbAvailable) return ctx;

  const apiKey = request.headers?.["x-api-key"];
  if (apiKey && typeof apiKey === "string" && apiKey.startsWith("ulb_ent_")) {
    try {
      const hash = sha256Hex(apiKey.trim());
      const res = await query(
        `SELECT k.id, k.user_id, k.org_id, k.label, k.scopes, u.email, u.name, u.role
         FROM enterprise_api_keys k
         JOIN users u ON u.id = k.user_id
         WHERE k.key_hash = $1 AND k.status = 'ACTIVE'`,
        [hash]
      );
      if (res.rows[0]) {
        const r = res.rows[0];
        await query(`UPDATE enterprise_api_keys SET last_used_at = NOW() WHERE id = $1`, [r.id]);
        return {
          authenticated: true,
          userId: r.user_id,
          email: r.email,
          name: r.name,
          role: r.role || "investor",
          scopes: r.scopes || [],
          orgId: r.org_id || null,
          authMethod: "api_key"
        };
      }
    } catch {}
  }
  return ctx;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function hydrateUserRiskState(userId, dbAvailable = false) {
  const riskState = getRiskStateForUser(userId);
  if (!dbAvailable || !UUID_REGEX.test(userId || "") || riskState._hydratedFromDb) {
    return riskState;
  }
  try {
    const res = await query(
      `SELECT * FROM risk_configs WHERE scope_type = 'USER' AND scope_id = $1 LIMIT 1`,
      [userId]
    );
    if (res.rows[0]) {
      const r = res.rows[0];
      riskState.limits = {
        ...riskState.limits,
        max_risk_per_trade_pct: Number(r.max_risk_per_trade_pct ?? riskState.limits.max_risk_per_trade_pct),
        max_daily_loss_pct: Number(r.max_daily_loss_pct ?? riskState.limits.max_daily_loss_pct),
        max_weekly_loss_pct: Number(r.max_weekly_loss_pct ?? riskState.limits.max_weekly_loss_pct),
        max_monthly_loss_pct: Number(r.max_monthly_loss_pct ?? riskState.limits.max_monthly_loss_pct),
        max_drawdown_pct: Number(r.max_drawdown_pct ?? riskState.limits.max_drawdown_pct),
        max_open_positions: Number(r.max_open_positions ?? riskState.limits.max_open_positions),
        max_leverage: Number(r.max_leverage ?? riskState.limits.max_leverage),
        max_margin_usage_pct: Number(r.max_margin_usage_pct ?? riskState.limits.max_margin_usage_pct),
        max_spread_points: Number(r.max_spread_points ?? riskState.limits.max_spread_points),
        max_slippage_points: Number(r.max_slippage_points ?? riskState.limits.max_slippage_points)
      };
      const ks = r.kill_switches && typeof r.kill_switches === "object" ? r.kill_switches : {};
      riskState.kill_switches = {
        global_active: Boolean(ks.global_active ?? r.kill_switch_active),
        global_reason: ks.global_reason || null,
        strategies: ks.strategies && typeof ks.strategies === "object" ? ks.strategies : {},
        instruments: ks.instruments && typeof ks.instruments === "object" ? ks.instruments : {}
      };
      riskState.updated_at = r.updated_at ? new Date(r.updated_at).toISOString() : riskState.updated_at;
    }
    riskState._hydratedFromDb = true;
  } catch (err) {
    console.warn("[store] non-fatal risk_configs hydrate warning:", err.message);
  }
  return riskState;
}

export async function hydrateUserPortfolio(userId, dbAvailable = false) {
  const portfolio = getPortfolioForUser(userId);
  if (!dbAvailable || !UUID_REGEX.test(userId || "") || portfolio._hydratedFromDb) {
    return portfolio;
  }
  try {
    const res = await query(
      `SELECT * FROM portfolios WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );
    if (res.rows[0]) {
      const p = res.rows[0];
      const paper = p.paper_state && typeof p.paper_state === "object" ? p.paper_state : {};
      portfolio.dataOrigin = p.environment || portfolio.dataOrigin || "PAPER_SANDBOX";
      portfolio.balance = Number(p.balance ?? 0);
      portfolio.equity = Number(p.equity ?? portfolio.balance);
      portfolio.margin_used = Number(p.margin_used ?? 0);
      portfolio.equity_high_water = Number(p.equity_high_water ?? portfolio.balance);
      if (p.mc_config && typeof p.mc_config === "object") {
        portfolio.mcConfig = { ...portfolio.mcConfig, ...p.mc_config };
      }
      if (Array.isArray(paper.trades)) portfolio.trades = paper.trades;
      if (Array.isArray(paper.equityHistory)) portfolio.equityHistory = paper.equityHistory;

      const allocRes = await query(
        `SELECT a.*, s.code, s.name, s.instrument, s.lifecycle_status
         FROM allocations a
         JOIN strategies s ON s.id = a.strategy_id
         WHERE a.portfolio_id = $1
         ORDER BY a.started_at DESC`,
        [p.id]
      );
      if (allocRes.rows.length > 0) {
        portfolio.subscriptions = allocRes.rows.map((a) => ({
          strategyId: a.strategy_id,
          code: a.code,
          strategyName: a.name,
          instrument: a.instrument,
          lifecycle_status: a.lifecycle_status,
          allocationMethod: a.allocation_method,
          allocation: Number(a.allocated_capital ?? 0),
          riskPerTradePct: Number(a.risk_per_trade_pct ?? 0.5),
          maxDrawdownPct: Number(a.max_drawdown_pct ?? 10),
          autoMcEnabled: Boolean(a.auto_mc_enabled),
          pnl: 0,
          pnl_pct: 0,
          trades: 0,
          status: a.lifecycle_status === "RESEARCH" && a.status === "ACTIVE" ? "research_watch" : String(a.status || "active").toLowerCase(),
          startedAt: a.started_at ? new Date(a.started_at).toISOString() : new Date().toISOString()
        }));
      } else if (Array.isArray(paper.subscriptions)) {
        portfolio.subscriptions = paper.subscriptions;
      }
    }
    portfolio._hydratedFromDb = true;
  } catch (err) {
    console.warn("[store] non-fatal portfolio hydrate warning:", err.message);
  }
  return portfolio;
}

export async function listRiskEventsForUser(userId, { mem, dbAvailable = false, limit = 50 } = {}) {
  if (dbAvailable && UUID_REGEX.test(userId || "")) {
    try {
      const res = await query(
        `SELECT id, scope_id AS "userId", event_type AS "eventType", severity, message, details, created_at AS "createdAt"
         FROM risk_events
         WHERE scope_type = 'USER' AND scope_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [userId, limit]
      );
      return res.rows;
    } catch (err) {
      console.warn("[store] risk_events read warning:", err.message);
    }
  }
  return (mem?.riskEvents || []).filter((e) => e.userId === userId).slice(0, limit);
}

export async function listAuditLogsForUser(userId, { mem, dbAvailable = false, limit = 50 } = {}) {
  if (dbAvailable && UUID_REGEX.test(userId || "")) {
    try {
      const res = await query(
        `SELECT id, actor_user_id AS "userId", actor_role AS role, action, target_type, target_id, details, created_at AS "createdAt"
         FROM audit_logs
         WHERE actor_user_id = $1 OR target_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [userId, limit]
      );
      return res.rows;
    } catch (err) {
      console.warn("[store] audit_logs read warning:", err.message);
    }
  }
  return (mem?.auditLogs || []).filter((a) => a.userId === userId).slice(0, limit);
}

export async function syncPgRiskState(userId, riskState, dbAvailable = false) {
  if (!dbAvailable || !UUID_REGEX.test(userId || "")) return;
  try {
    const l = riskState.limits;
    const ks = riskState.kill_switches || {};
    await query(
      `INSERT INTO risk_configs
       (scope_type, scope_id, max_risk_per_trade_pct, max_daily_loss_pct, max_weekly_loss_pct,
        max_monthly_loss_pct, max_drawdown_pct, max_open_positions, max_leverage,
        max_margin_usage_pct, max_spread_points, max_slippage_points, kill_switch_active, kill_switches, updated_by, updated_at)
       VALUES ('USER',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$1,NOW())
       ON CONFLICT (scope_type, scope_id) DO UPDATE SET
         max_risk_per_trade_pct=$2, max_daily_loss_pct=$3, max_weekly_loss_pct=$4,
         max_monthly_loss_pct=$5, max_drawdown_pct=$6, max_open_positions=$7,
         max_leverage=$8, max_margin_usage_pct=$9, max_spread_points=$10,
         max_slippage_points=$11, kill_switch_active=$12, kill_switches=$13::jsonb, updated_at=NOW()`,
      [
        userId,
        l.max_risk_per_trade_pct,
        l.max_daily_loss_pct,
        l.max_weekly_loss_pct,
        l.max_monthly_loss_pct,
        l.max_drawdown_pct,
        l.max_open_positions,
        l.max_leverage,
        l.max_margin_usage_pct ?? 80,
        l.max_spread_points,
        l.max_slippage_points ?? 30,
        Boolean(ks.global_active),
        JSON.stringify(ks)
      ]
    );
  } catch (err) {
    console.warn("[store] non-fatal risk_configs sync warning:", err.message);
  }
}

export async function syncPgPortfolio(userId, portfolio, dbAvailable = false) {
  if (!dbAvailable || !UUID_REGEX.test(userId || "")) return;
  try {
    const paperState = {
      trades: Array.isArray(portfolio.trades) ? portfolio.trades.slice(0, 200) : [],
      equityHistory: Array.isArray(portfolio.equityHistory) ? portfolio.equityHistory.slice(-200) : []
    };
    const pRes = await query(
      `INSERT INTO portfolios (user_id, environment, balance, equity, margin_used, equity_high_water, mc_config, paper_state, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,NOW())
       ON CONFLICT (user_id, environment) DO UPDATE SET
         balance=$3, equity=$4, margin_used=$5, equity_high_water=$6, mc_config=$7::jsonb, paper_state=$8::jsonb, updated_at=NOW()
       RETURNING id`,
      [
        userId,
        portfolio.dataOrigin || "PAPER_SANDBOX",
        portfolio.balance,
        portfolio.equity,
        portfolio.margin_used || 0,
        portfolio.equity_high_water || portfolio.balance,
        JSON.stringify(portfolio.mcConfig || {}),
        JSON.stringify(paperState)
      ]
    );
    const portfolioId = pRes.rows[0]?.id;
    if (!portfolioId) return;

    const subs = Array.isArray(portfolio.subscriptions) ? portfolio.subscriptions : [];
    const stratIds = subs.map((s) => s.strategyId).filter(Boolean);
    if (stratIds.length === 0) {
      await query(`DELETE FROM allocations WHERE portfolio_id = $1`, [portfolioId]);
      return;
    }

    const existingStrats = await query(`SELECT id FROM strategies WHERE id = ANY($1::text[])`, [stratIds]);
    const validIds = existingStrats.rows.map((r) => r.id);
    const validSet = new Set(validIds);

    await query(`DELETE FROM allocations WHERE portfolio_id = $1 AND NOT (strategy_id = ANY($2::text[]))`, [
      portfolioId,
      validIds.length ? validIds : [""]
    ]);

    for (const s of subs) {
      if (!validSet.has(s.strategyId)) continue;
      const dbAllocStatus = s.status === "paused" ? "PAUSED" : s.status === "stopped" ? "STOPPED" : "ACTIVE";
      const dbMethod = ["FIXED", "RISK_NORMALIZED", "VOLATILITY_ADJUSTED", "EQUAL_RISK_CONTRIBUTION", "FRACTIONAL"].includes(s.allocationMethod)
        ? s.allocationMethod
        : "RISK_NORMALIZED";
      await query(
        `INSERT INTO allocations
         (portfolio_id, strategy_id, allocation_method, allocated_capital, risk_per_trade_pct, max_drawdown_pct, auto_mc_enabled, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (portfolio_id, strategy_id) DO UPDATE SET
           allocation_method=$3, allocated_capital=$4, risk_per_trade_pct=$5,
           max_drawdown_pct=$6, auto_mc_enabled=$7, status=$8, updated_at=NOW()`,
        [
          portfolioId,
          s.strategyId,
          dbMethod,
          Number(s.allocation || 0),
          Number(s.riskPerTradePct || 0.5),
          Number(s.maxDrawdownPct || 10),
          Boolean(s.autoMcEnabled),
          dbAllocStatus
        ]
      );
    }
  } catch (err) {
    console.warn("[store] non-fatal portfolios sync warning:", err.message);
  }
}

export { recordRiskEvent };

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
