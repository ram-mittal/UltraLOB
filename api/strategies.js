import {
  ensureDbReady,
  getAllStrategiesInMemory,
  getMemoryStore,
  extractAuthContext,
  query
} from "./store.js";
import { roleHasPermission } from "./security.js";
import { recordAuditLog } from "../db/client.js";

function mapDbStrategyRow(row, versionRow = null, backtestRow = null) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    author: row.author,
    icon: row.instrument === "XAUUSD" ? "🥇" : "📐",
    gradient: "from-brand-500 to-indigo-600",
    category: row.category,
    category_label: row.category,
    instrument: row.instrument,
    supported_instruments: row.supported_instruments || [row.instrument],
    timeframes: row.timeframes || ["H1", "M15"],
    timeframe: Array.isArray(row.timeframes) ? row.timeframes.join(" / ") : "H1 / M15",
    risk_level: row.risk_level,
    lifecycle_status: row.lifecycle_status,
    data_source_label: row.data_source_label || row.lifecycle_status,
    status: row.lifecycle_status.toLowerCase(),
    version: row.current_version,
    description: row.description,
    entry_logic: versionRow?.entry_logic || null,
    exit_logic: versionRow?.exit_logic || null,
    stop_loss_methodology: versionRow?.stop_loss_methodology || null,
    take_profit_methodology: versionRow?.take_profit_methodology || null,
    position_sizing_methodology: versionRow?.position_sizing_methodology || null,
    risk_per_trade_pct: versionRow ? Number(versionRow.risk_per_trade_pct) : null,
    cost_slippage_assumptions: versionRow?.cost_slippage_assumptions || null,
    supported_brokers: row.supported_brokers || ["MT5 Demo", "Exness MT5 Demo"],
    capacity_limit_usd: row.capacity_limit_usd == null ? null : Number(row.capacity_limit_usd),
    min_capital: Number(row.min_capital || 1000),
    status_note: row.status_note,
    // Strictly null unless empirical backtest or broker record exists
    total_return: backtestRow?.total_return_pct ?? null,
    cagr: backtestRow?.cagr_pct ?? null,
    sharpe_ratio: backtestRow?.sharpe_ratio ?? null,
    sortino_ratio: backtestRow?.sortino_ratio ?? null,
    max_drawdown: backtestRow?.max_drawdown_pct ?? null,
    profit_factor: backtestRow?.profit_factor ?? null,
    win_rate: backtestRow?.win_rate_pct ?? null,
    avg_profit_trade: backtestRow?.avg_profit_trade ?? null,
    avg_loss_trade: backtestRow?.avg_loss_trade ?? null,
    expectancy: backtestRow?.expectancy ?? null,
    total_trades: backtestRow?.total_trades ?? 0,
    avg_trade_duration: backtestRow?.avg_holding_minutes ? `${backtestRow.avg_holding_minutes} min` : null,
    max_consecutive_losses: backtestRow?.max_consecutive_losses ?? null,
    risk_of_ruin: backtestRow?.risk_of_ruin_pct ?? null,
    out_of_sample: backtestRow?.oos_metrics ?? null,
    walk_forward: backtestRow?.walk_forward_metrics ?? null,
    equity_curve: backtestRow?.equity_curve ?? [],
    drawdown: backtestRow?.drawdown_series ?? [],
    monthly_returns: backtestRow?.monthly_returns ?? [],
    subscribers: 0,
    created_at: row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : null
  };
}

async function listStrategies(dbAvailable) {
  if (!dbAvailable) {
    return getAllStrategiesInMemory();
  }
  const stratRes = await query(`SELECT * FROM strategies ORDER BY code ASC`);
  const verRes = await query(`SELECT * FROM strategy_versions WHERE is_active = TRUE`);
  const verMap = new Map(verRes.rows.map((v) => [v.strategy_id, v]));
  // Attach latest completed backtest if any exists
  const btRes = await query(
    `SELECT DISTINCT ON (b.strategy_id) b.strategy_id, br.*
     FROM backtests b
     JOIN backtest_results br ON br.backtest_id = b.id
     WHERE b.status = 'COMPLETED'
     ORDER BY b.strategy_id, b.completed_at DESC`
  );
  const btMap = new Map(btRes.rows.map((r) => [r.strategy_id, r]));

  return stratRes.rows.map((row) => mapDbStrategyRow(row, verMap.get(row.id), btMap.get(row.id)));
}

export default async function strategiesHandler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const dbAvailable = await ensureDbReady().catch(() => false);

  // GET /api/strategies/:id
  const idMatch = request.path?.match(/\/api\/strategies\/([^/]+)$/);
  if (request.method === "GET" && idMatch) {
    const id = idMatch[1];
    const strategies = await listStrategies(dbAvailable);
    const strategy = strategies.find((s) => s.id === id || s.code === id);
    if (!strategy) return response.status(404).json({ error: "Strategy not found." });
    return response.json(strategy);
  }

  // POST /api/strategies — Submit a new quantitative strategy specification in RESEARCH status.
  // Never invents performance numbers; requires strategy_provider / researcher / fund_manager / admin role.
  if (request.method === "POST") {
    const auth = extractAuthContext(request);
    if (!auth.authenticated) {
      return response.status(401).json({ error: "Authentication required to register a strategy.", code: "AUTH_REQUIRED" });
    }
    if (!roleHasPermission(auth.role, "strategies:create")) {
      return response.status(403).json({
        error: `Role '${auth.role}' cannot submit strategies. Switch to a Strategy Provider or Researcher account.`,
        code: "FORBIDDEN_ROLE"
      });
    }

    const body = request.body || {};
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    if (!name || name.length < 3 || !description) {
      return response.status(400).json({ error: "Strategy name (min 3 chars) and description are required." });
    }

    const slug =
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
      "-" +
      Date.now().toString(36).slice(-4);
    const code = String(body.code || `UL-${Date.now().toString().slice(-4)}`).trim().toUpperCase();
    const instrument = String(body.instrument || "XAUUSD").trim().toUpperCase();
    const timeframes = Array.isArray(body.timeframes)
      ? body.timeframes
      : String(body.timeframe || "H1,M15").split(/[,/]/).map((s) => s.trim()).filter(Boolean);
    const riskLevel = ["low", "medium", "high"].includes(body.risk_level) ? body.risk_level : "medium";
    const minCapital = Math.max(100, Number(body.min_capital || 1000));
    const entryLogic = String(body.entry_logic || "Rule specification pending formal quantitative review.").trim();
    const exitLogic = String(body.exit_logic || "Rule specification pending formal quantitative review.").trim();
    const slMethod = String(body.stop_loss_methodology || "Structure + ATR invalidation").trim();
    const tpMethod = String(body.take_profit_methodology || "Dynamic R-multiple target").trim();
    const sizingMethod = String(body.position_sizing_methodology || "Risk-normalized equity fraction").trim();
    const riskPerTrade = Math.min(2.0, Math.max(0.05, Number(body.risk_per_trade_pct || 0.5)));

    const newStrategy = {
      id: slug,
      code,
      name,
      author: String(body.author || auth.name || "Strategy Provider").trim(),
      icon: instrument === "XAUUSD" ? "🥇" : "📐",
      gradient: "from-brand-500 to-indigo-600",
      category: String(body.category || "trend"),
      category_label: String(body.category || "trend"),
      instrument,
      supported_instruments: [instrument],
      timeframes,
      timeframe: timeframes.join(" / "),
      risk_level: riskLevel,
      lifecycle_status: "RESEARCH",
      data_source_label: "RESEARCH",
      status: "research",
      version: "1.0.0",
      ea_type: String(body.ea_type || "Quantitative Strategy Specification"),
      description,
      entry_logic: entryLogic,
      exit_logic: exitLogic,
      stop_loss_methodology: slMethod,
      take_profit_methodology: tpMethod,
      position_sizing_methodology: sizingMethod,
      risk_per_trade_pct: riskPerTrade,
      cost_slippage_assumptions: {
        spread_points_assumed: Number(body.spread_points_assumed || 25),
        slippage_points_assumed: Number(body.slippage_points_assumed || 5)
      },
      supported_brokers: ["MT5 Demo", "Exness MT5 Demo"],
      capacity_limit_usd: Number(body.capacity_limit_usd || 1000000),
      min_capital: minCapital,
      status_note: "RESEARCH — Submitted without backtest. Empirical metrics remain null until Phase 2 validation runs.",
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
      created_at: new Date().toISOString().slice(0, 10),
      monthly_returns: [],
      equity_curve: [],
      drawdown: []
    };

    if (dbAvailable) {
      const ownerUuid = /^[0-9a-f-]{36}$/i.test(auth.userId) ? auth.userId : null;
      await query(
        `INSERT INTO strategies
         (id, code, name, author, owner_user_id, category, instrument, supported_instruments, timeframes,
          lifecycle_status, data_source_label, current_version, description, risk_level,
          min_capital, capacity_limit_usd, supported_brokers, status_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RESEARCH','RESEARCH','1.0.0',$10,$11,$12,$13,$14,$15)`,
        [
          newStrategy.id,
          newStrategy.code,
          newStrategy.name,
          newStrategy.author,
          ownerUuid,
          newStrategy.category,
          newStrategy.instrument,
          newStrategy.supported_instruments,
          newStrategy.timeframes,
          newStrategy.description,
          newStrategy.risk_level,
          newStrategy.min_capital,
          newStrategy.capacity_limit_usd,
          newStrategy.supported_brokers,
          newStrategy.status_note
        ]
      );
      await query(
        `INSERT INTO strategy_versions
         (strategy_id, version, entry_logic, exit_logic, stop_loss_methodology,
          take_profit_methodology, position_sizing_methodology, risk_per_trade_pct, cost_slippage_assumptions, changelog)
         VALUES ($1,'1.0.0',$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [
          newStrategy.id,
          entryLogic,
          exitLogic,
          slMethod,
          tpMethod,
          sizingMethod,
          riskPerTrade,
          JSON.stringify(newStrategy.cost_slippage_assumptions),
          "Submitted in RESEARCH stage."
        ]
      );
      await recordAuditLog({
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: "STRATEGY_CREATED",
        targetType: "strategy",
        targetId: newStrategy.id,
        details: { code: newStrategy.code, instrument: newStrategy.instrument, lifecycle_status: "RESEARCH" }
      });
    } else {
      getMemoryStore().customStrategies.unshift(newStrategy);
    }

    return response.status(201).json({ strategy: newStrategy });
  }

  // GET /api/strategies?category=...&lifecycle_status=...&instrument=...&q=...&sort=...
  const strategies = await listStrategies(dbAvailable);
  const category = request.query?.category;
  const lifecycle = String(request.query?.lifecycle_status || "").trim().toUpperCase();
  const instrument = String(request.query?.instrument || "").trim().toUpperCase();
  const sort = request.query?.sort || "code";
  const q = String(request.query?.q || "").trim().toLowerCase();

  let result = [...strategies];
  if (category && category !== "all") {
    result = result.filter((s) => s.category === category);
  }
  if (lifecycle && lifecycle !== "ALL") {
    result = result.filter((s) => s.lifecycle_status === lifecycle);
  }
  if (instrument && instrument !== "ALL") {
    result = result.filter((s) => s.instrument === instrument || (s.supported_instruments || []).includes(instrument));
  }
  if (q) {
    result = result.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.code || "").toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q) ||
        s.instrument.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }

  const riskOrder = { low: 0, medium: 1, high: 2 };
  const sorters = {
    code: (a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id)),
    return: (a, b) => (b.total_return ?? -Infinity) - (a.total_return ?? -Infinity),
    sharpe: (a, b) => (b.sharpe_ratio ?? -Infinity) - (a.sharpe_ratio ?? -Infinity),
    winrate: (a, b) => (b.win_rate ?? -Infinity) - (a.win_rate ?? -Infinity),
    drawdown: (a, b) => (b.max_drawdown ?? -Infinity) - (a.max_drawdown ?? -Infinity),
    subscribers: (a, b) => (b.subscribers || 0) - (a.subscribers || 0),
    "risk-low": (a, b) => (riskOrder[a.risk_level] ?? 1) - (riskOrder[b.risk_level] ?? 1)
  };
  if (sorters[sort]) result.sort(sorters[sort]);

  return response.json({
    strategies: result,
    total: result.length,
    lifecycle_stages: ["RESEARCH", "BACKTESTED", "FORWARD_TESTING", "LIVE_PILOT", "VERIFIED_LIVE"],
    data_disclosure: "Strategies in RESEARCH status have null empirical performance metrics until validated by backtesting and broker-confirmed execution."
  });
}
