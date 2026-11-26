import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeFile = path.join(projectRoot, "data", "runtime.json");

export const DEFAULT_STRATEGIES = [
  {
    id: "mc-momentum",
    name: "Monte Carlo Momentum",
    author: "UltraLOB Quant",
    icon: "📈",
    gradient: "from-indigo-500 to-purple-600",
    category: "trend",
    description: "Trend-following EA validated by 10M Monte Carlo simulations. Enters on momentum breakouts when simulated target-first probability exceeds stop-first probability by >12%.",
    instrument: "BTC/USD",
    timeframe: "4H",
    risk_level: "medium",
    status: "active",
    ea_type: "Monte Carlo Automated",
    total_return: 67.4,
    win_rate: 58.3,
    sharpe_ratio: 1.87,
    max_drawdown: -18.4,
    profit_factor: 1.92,
    total_trades: 342,
    avg_trade_duration: "6.2 hours",
    subscribers: 487,
    min_capital: 500,
    created_at: "2025-03-15",
    monthly_returns: [3.2, -1.4, 5.8, 2.1, -3.6, 7.2, 4.5, -0.8, 6.3, 1.9, -2.1, 8.4, 5.1, -1.2, 4.7, 3.3, -0.5, 6.8, 2.4, -1.8, 5.2, 3.9, 7.1, 4.2],
    equity_curve: [10000, 10320, 10175, 10765, 10991, 10596, 11359, 11870, 11775, 12517, 12755, 12487, 13536, 14228, 14057, 14718, 15204, 15128, 16157, 16544, 16246, 17091, 17757, 19019, 19817],
    drawdown: [0, -1.2, -2.8, -0.5, 0, -3.6, -0.8, 0, -0.8, 0, -1.5, -3.2, -0.4, 0, -1.2, 0, -0.5, -1.1, 0, -0.3, -1.8, -0.6, 0, 0, 0]
  },
  {
    id: "mean-rev-alpha",
    name: "Mean Reversion Alpha",
    author: "StatArb Labs",
    icon: "🔄",
    gradient: "from-emerald-500 to-teal-600",
    category: "mean-reversion",
    description: "Statistical arbitrage EA exploiting price mean-reversion in BTC and US equities. Uses Ornstein-Uhlenbeck process with z-score bands and Monte Carlo tail-risk stops.",
    instrument: "BTC/USD",
    timeframe: "1H",
    risk_level: "low",
    status: "active",
    ea_type: "Statistical Arbitrage EA",
    total_return: 34.8,
    win_rate: 72.1,
    sharpe_ratio: 2.34,
    max_drawdown: -8.7,
    profit_factor: 2.45,
    total_trades: 891,
    avg_trade_duration: "1.8 hours",
    subscribers: 623,
    min_capital: 300,
    created_at: "2025-01-10",
    monthly_returns: [2.1, 1.8, 3.4, 2.7, 1.2, -0.5, 3.1, 2.4, 1.9, -1.2, 2.8, 3.6, 1.5, 2.2, -0.3, 2.9, 1.7, 3.2, 2.1, 1.4, -0.8, 2.6, 3.1, 2.3],
    equity_curve: [10000, 10210, 10394, 10747, 11037, 11169, 11113, 11458, 11733, 11956, 11813, 12143, 12581, 12770, 13051, 13012, 13389, 13617, 14053, 14348, 14549, 14433, 14808, 15267, 15618],
    drawdown: [0, 0, 0, 0, 0, 0, -0.5, 0, 0, 0, -1.2, -0.3, 0, 0, 0, -0.3, 0, 0, 0, 0, 0, -0.8, 0, 0, 0]
  },
  {
    id: "vol-breakout",
    name: "Volatility Breakout",
    author: "Gamma Desk",
    icon: "💥",
    gradient: "from-amber-500 to-orange-600",
    category: "volatility",
    description: "Captures explosive moves during high-volatility regimes. Uses ATR-based entries with dynamic stop-losses calibrated by realized volatility and MC quantiles.",
    instrument: "BTC/USD",
    timeframe: "15m",
    risk_level: "high",
    status: "active",
    ea_type: "Breakout EA",
    total_return: 112.6,
    win_rate: 45.2,
    sharpe_ratio: 1.54,
    max_drawdown: -32.1,
    profit_factor: 1.68,
    total_trades: 1247,
    avg_trade_duration: "42 minutes",
    subscribers: 198,
    min_capital: 1000,
    created_at: "2025-06-22",
    monthly_returns: [8.4, -5.2, 12.1, -3.8, 15.6, -7.1, 9.3, 4.2, -6.5, 18.2, -4.3, 11.7, -2.8, 7.6, -8.9, 14.2, 6.1, -3.4, 10.8, -5.7, 13.4, 7.8, -2.1, 16.3],
    equity_curve: [10000, 10840, 10277, 11520, 11082, 12811, 11901, 13008, 13555, 12674, 14979, 14335, 16012, 15564, 16746, 15256, 17424, 18487, 17858, 19785, 18657, 21158, 22809, 22330, 25969],
    drawdown: [0, 0, -5.2, 0, -3.8, 0, -7.1, -2.3, 0, -6.5, 0, -4.3, 0, -2.8, 0, -8.9, 0, 0, -3.4, 0, -5.7, 0, 0, -2.1, 0]
  },
  {
    id: "neural-scalper",
    name: "Neural Scalper",
    author: "DeepTrade AI",
    icon: "🧠",
    gradient: "from-cyan-500 to-blue-600",
    category: "scalping",
    description: "Microstructure scalping EA trained on order-book imbalance and tick returns. Executes sub-second entries directly on MT5 and Exness raw-spread accounts.",
    instrument: "BTC/USD",
    timeframe: "5m",
    risk_level: "medium",
    status: "active",
    ea_type: "AI Scalper EA",
    total_return: 52.8,
    win_rate: 64.7,
    sharpe_ratio: 2.11,
    max_drawdown: -14.2,
    profit_factor: 2.08,
    total_trades: 3284,
    avg_trade_duration: "12 minutes",
    subscribers: 345,
    min_capital: 500,
    created_at: "2025-04-01",
    monthly_returns: [3.8, 2.1, -1.5, 4.6, 3.2, 1.7, -2.3, 5.1, 2.8, 3.4, -0.9, 4.2, 3.6, -1.1, 2.9, 4.8, 1.3, -0.7, 3.5, 2.6, 4.1, -1.4, 3.7, 5.2],
    equity_curve: [10000, 10380, 10598, 10439, 10919, 11268, 11460, 11196, 11767, 12097, 12508, 12395, 12916, 13381, 13234, 13617, 14271, 14457, 14356, 14858, 15244, 15869, 15647, 16226, 17069],
    drawdown: [0, 0, 0, -1.5, 0, 0, 0, -2.3, 0, 0, 0, -0.9, 0, 0, -1.1, 0, 0, 0, -0.7, 0, 0, 0, -1.4, 0, 0]
  },
  {
    id: "multi-hedge",
    name: "Multi-Asset Hedge",
    author: "Macro Desk",
    icon: "🛡️",
    gradient: "from-slate-500 to-zinc-600",
    category: "hedge",
    description: "Market-neutral portfolio hedging EA. Pairs BTC with US equities and FX pairs using Monte Carlo CVaR bounds to cap portfolio drawdown.",
    instrument: "Multi-Asset",
    timeframe: "1D",
    risk_level: "low",
    status: "active",
    ea_type: "Portfolio Hedge EA",
    total_return: 21.3,
    win_rate: 68.4,
    sharpe_ratio: 2.87,
    max_drawdown: -5.2,
    profit_factor: 2.72,
    total_trades: 156,
    avg_trade_duration: "3.4 days",
    subscribers: 892,
    min_capital: 2000,
    created_at: "2024-11-05",
    monthly_returns: [1.2, 0.8, 1.5, 2.1, 0.6, 1.9, 1.3, -0.4, 2.2, 1.1, 1.7, 0.9, 1.4, -0.2, 1.8, 2.3, 0.7, 1.1, -0.3, 1.6, 2.0, 1.2, 0.5, 1.9],
    equity_curve: [10000, 10120, 10201, 10354, 10571, 10635, 10837, 10978, 10934, 11174, 11297, 11489, 11592, 11754, 11731, 11942, 12217, 12302, 12437, 12400, 12598, 12850, 13004, 13069, 13317],
    drawdown: [0, 0, 0, 0, 0, 0, 0, 0, -0.4, 0, 0, 0, 0, 0, -0.2, 0, 0, 0, 0, -0.3, 0, 0, 0, 0, 0]
  },
  {
    id: "crypto-surfer",
    name: "Crypto Trend Surfer",
    author: "Wave Capital",
    icon: "🏄",
    gradient: "from-violet-500 to-fuchsia-600",
    category: "trend",
    description: "Multi-timeframe trend detection using fractal analysis and Hurst exponent. Rides major BTC trends with trailing stops.",
    instrument: "BTC/USD",
    timeframe: "4H",
    risk_level: "high",
    status: "active",
    ea_type: "Trend Follower EA",
    total_return: 89.7,
    win_rate: 51.8,
    sharpe_ratio: 1.63,
    max_drawdown: -27.4,
    profit_factor: 1.78,
    total_trades: 203,
    avg_trade_duration: "18 hours",
    subscribers: 267,
    min_capital: 750,
    created_at: "2025-02-18",
    monthly_returns: [5.6, -3.2, 8.4, 2.1, -6.8, 11.3, -1.5, 7.2, 4.8, -4.1, 9.7, 3.4, -2.6, 6.8, 5.1, -3.9, 8.2, 2.7, -1.8, 7.4, 6.3, -2.4, 10.1, 4.5],
    equity_curve: [10000, 10560, 10222, 11081, 11314, 10545, 11736, 11560, 12392, 12987, 12455, 13664, 14129, 13762, 14698, 15447, 14845, 16062, 16496, 16199, 17398, 18494, 18050, 19873, 20767],
    drawdown: [0, 0, -3.2, 0, 0, -6.8, 0, -1.5, 0, 0, -4.1, 0, 0, -2.6, 0, 0, -3.9, 0, 0, -1.8, 0, 0, -2.4, 0, 0]
  },
  {
    id: "grid-harvester",
    name: "Grid Harvester",
    author: "Algo Grid Co.",
    icon: "🔲",
    gradient: "from-rose-500 to-pink-600",
    category: "grid",
    description: "Dynamic grid trading EA with adaptive spacing based on volatility regime. Harvests profits from oscillating price action.",
    instrument: "BTC/USD",
    timeframe: "1H",
    risk_level: "medium",
    status: "paused",
    ea_type: "Adaptive Grid EA",
    total_return: 28.5,
    win_rate: 76.3,
    sharpe_ratio: 1.95,
    max_drawdown: -11.8,
    profit_factor: 2.21,
    total_trades: 2104,
    avg_trade_duration: "2.1 hours",
    subscribers: 156,
    min_capital: 500,
    created_at: "2025-05-10",
    monthly_returns: [2.4, 1.8, -0.6, 3.1, 2.2, -1.9, 2.7, 1.5, 3.4, -0.3, 2.1, 1.9, 2.8, -1.1, 1.6, 3.2, -0.8, 2.3, 1.4, 2.9, -0.5, 1.7, 2.6, 3.1],
    equity_curve: [10000, 10240, 10424, 10362, 10683, 10918, 10711, 10999, 11164, 11543, 11509, 11750, 11973, 12308, 12173, 12368, 12764, 12662, 12953, 13134, 13515, 13448, 13677, 14032, 14467],
    drawdown: [0, 0, 0, -0.6, 0, 0, -1.9, 0, 0, 0, -0.3, 0, 0, 0, -1.1, 0, 0, -0.8, 0, 0, 0, -0.5, 0, 0, 0]
  },
  {
    id: "arb-flash",
    name: "Arbitrage Flash",
    author: "HFT Systems",
    icon: "⚡",
    gradient: "from-yellow-500 to-amber-600",
    category: "arbitrage",
    description: "Cross-exchange arbitrage EA exploiting price discrepancies via institutional FIX 4.4 and MT5 raw bridges.",
    instrument: "BTC/USD",
    timeframe: "1m",
    risk_level: "low",
    status: "active",
    ea_type: "Cross-Venue Arb EA",
    total_return: 18.9,
    win_rate: 89.2,
    sharpe_ratio: 3.41,
    max_drawdown: -3.1,
    profit_factor: 3.87,
    total_trades: 12847,
    avg_trade_duration: "23 seconds",
    subscribers: 1024,
    min_capital: 5000,
    created_at: "2024-09-01",
    monthly_returns: [1.1, 0.9, 1.3, 0.7, 1.5, 1.2, 0.8, 1.4, 1.0, 1.6, 0.6, 1.1, 0.9, 1.3, 1.1, 0.8, 1.4, 1.0, 1.2, 0.7, 1.5, 1.3, 0.9, 1.1],
    equity_curve: [10000, 10110, 10201, 10334, 10406, 10562, 10689, 10774, 10925, 11034, 11211, 11278, 11402, 11505, 11654, 11782, 11877, 12044, 12164, 12310, 12396, 12582, 12746, 12861, 13003],
    drawdown: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  }
];

function createDefaultState() {
  return {
    users: {},
    customStrategies: [],
    portfolios: {
      guest: {
        balance: 25420.50,
        equity: 27183.20,
        margin_used: 4820.00,
        subscriptions: [
          {
            strategyId: "mc-momentum",
            strategyName: "Monte Carlo Momentum",
            icon: "📈",
            allocation: 8000,
            lotMultiplier: 1.0,
            maxDrawdownPct: 15,
            autoMcEnabled: true,
            pnl: 892.40,
            pnl_pct: 11.2,
            trades: 23,
            status: "active",
            startedAt: "2025-09-01T00:00:00Z"
          },
          {
            strategyId: "mean-rev-alpha",
            strategyName: "Mean Reversion Alpha",
            icon: "🔄",
            allocation: 5000,
            lotMultiplier: 0.5,
            maxDrawdownPct: 10,
            autoMcEnabled: false,
            pnl: 423.80,
            pnl_pct: 8.5,
            trades: 67,
            status: "active",
            startedAt: "2025-09-12T00:00:00Z"
          },
          {
            strategyId: "arb-flash",
            strategyName: "Arbitrage Flash",
            icon: "⚡",
            allocation: 10000,
            lotMultiplier: 1.5,
            maxDrawdownPct: 5,
            autoMcEnabled: false,
            pnl: 446.50,
            pnl_pct: 4.5,
            trades: 312,
            status: "active",
            startedAt: "2025-10-03T00:00:00Z"
          }
        ],
        trades: [
          { id: "tr-1", time: "09:14:32", timestamp: Date.now() - 120000, strategyId: "mc-momentum", strategy: "MC Momentum", symbol: "BTC/USD", side: "BUY", qty: 0.15, price: 97234.50, stopPrice: 95289.81, targetPrice: 101123.88, pnl: 42.30, status: "closed", broker: "Demo Paper Engine", source: "Monte Carlo Auto" },
          { id: "tr-2", time: "09:12:18", timestamp: Date.now() - 240000, strategyId: "arb-flash", strategy: "Arb Flash", symbol: "BTC/USD", side: "SELL", qty: 0.08, price: 97289.10, stopPrice: null, targetPrice: null, pnl: 12.80, status: "closed", broker: "Demo Paper Engine", source: "Copy EA" },
          { id: "tr-3", time: "09:10:45", timestamp: Date.now() - 360000, strategyId: "mean-rev-alpha", strategy: "Mean Rev", symbol: "BTC/USD", side: "BUY", qty: 0.12, price: 97198.20, stopPrice: 96000.00, targetPrice: 98500.00, pnl: null, status: "open", broker: "Demo Paper Engine", source: "Copy EA" },
          { id: "tr-4", time: "09:08:03", timestamp: Date.now() - 500000, strategyId: "mc-momentum", strategy: "MC Momentum", symbol: "BTC/USD", side: "SELL", qty: 0.10, price: 97312.80, stopPrice: 99259.05, targetPrice: 93420.29, pnl: -18.50, status: "closed", broker: "Demo Paper Engine", source: "Monte Carlo Auto" }
        ],
        equityHistory: [
          { label: "Jan", value: 21000 },
          { label: "Feb", value: 21840 },
          { label: "Mar", value: 22190 },
          { label: "Apr", value: 23150 },
          { label: "May", value: 22680 },
          { label: "Jun", value: 23890 },
          { label: "Jul", value: 24310 },
          { label: "Aug", value: 23980 },
          { label: "Sep", value: 25120 },
          { label: "Oct", value: 25840 },
          { label: "Nov", value: 26430 },
          { label: "Dec", value: 27183.20 }
        ],
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
      }
    },
    brokers: {},
    mt5Signals: []
  };
}

let cachedState = null;

function loadState() {
  if (cachedState) return cachedState;
  try {
    if (fs.existsSync(runtimeFile)) {
      const raw = fs.readFileSync(runtimeFile, "utf8");
      cachedState = JSON.parse(raw);
      return cachedState;
    }
  } catch (err) {
    console.warn("[store] failed to load runtime state, using defaults:", err.message);
  }
  cachedState = createDefaultState();
  return cachedState;
}

export function getStore() {
  return loadState();
}

export function saveStore() {
  if (!cachedState) return;
  try {
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
    fs.writeFileSync(runtimeFile, JSON.stringify(cachedState, null, 2), "utf8");
  } catch (err) {
    // Ephemeral/read-only serverless platforms (e.g., Vercel) continue in-memory
    console.warn("[store] non-fatal write warning:", err.message);
  }
}

export function getPortfolioForUser(userId = "guest") {
  const store = getStore();
  if (!store.portfolios[userId]) {
    store.portfolios[userId] = structuredClone(createDefaultState().portfolios.guest);
    saveStore();
  }
  return store.portfolios[userId];
}

export function getAllStrategies() {
  const store = getStore();
  return [...DEFAULT_STRATEGIES, ...(store.customStrategies || [])];
}

const TOKEN_SECRET = process.env.ULTRALOB_JWT_SECRET || crypto.createHash("sha256").update("ultralob-dev-secret-change-in-prod").digest("hex");

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

export function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 7 * 86400 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
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

export function extractUserId(request) {
  const auth = request.headers?.authorization || "";
  if (auth.startsWith("Bearer ")) {
    const decoded = verifyToken(auth.slice(7).trim());
    if (decoded?.id) return decoded.id;
  }
  return "guest";
}
