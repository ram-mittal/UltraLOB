import { getAllStrategies, getStore, saveStore } from "./store.js";

export default function strategiesHandler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  // GET /api/strategies/:id
  const idMatch = request.path?.match(/\/api\/strategies\/([^/]+)$/);
  if (request.method === "GET" && idMatch) {
    const strategy = getAllStrategies().find((s) => s.id === idMatch[1]);
    if (!strategy) return response.status(404).json({ error: "Strategy not found" });
    return response.json(strategy);
  }

  // POST /api/strategies — allow creator/admin to publish a new EA/strategy to the catalogue
  if (request.method === "POST") {
    const body = request.body || {};
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    if (!name || name.length < 3 || !description) {
      return response.status(400).json({ error: "Strategy name and description are required." });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36).slice(-4);
    const totalReturn = Number(body.total_return ?? 24.5);
    const winRate = Number(body.win_rate ?? 61.0);
    const sharpeRatio = Number(body.sharpe_ratio ?? 1.85);
    const maxDrawdown = -Math.abs(Number(body.max_drawdown ?? 12.0));

    const newStrategy = {
      id: slug,
      name,
      author: String(body.author || "Ram Mittal").trim(),
      icon: String(body.icon || "🤖"),
      gradient: "from-brand-500 to-cyan-600",
      category: String(body.category || "trend"),
      description,
      instrument: String(body.instrument || "BTC/USD"),
      timeframe: String(body.timeframe || "1H"),
      risk_level: ["low", "medium", "high"].includes(body.risk_level) ? body.risk_level : "medium",
      status: "active",
      ea_type: String(body.ea_type || "Custom Web EA"),
      total_return: totalReturn,
      win_rate: winRate,
      sharpe_ratio: sharpeRatio,
      max_drawdown: maxDrawdown,
      profit_factor: Number(body.profit_factor ?? 1.95),
      total_trades: Number(body.total_trades ?? 120),
      avg_trade_duration: String(body.avg_trade_duration || "2.5 hours"),
      subscribers: 1,
      min_capital: Math.max(100, Number(body.min_capital ?? 500)),
      created_at: new Date().toISOString().slice(0, 10),
      monthly_returns: [2.1, 1.4, -0.8, 3.2, 2.5, -1.1, 2.9, 1.8, 3.4, 2.0, -0.5, 2.7],
      equity_curve: [10000, 10210, 10353, 10270, 10599, 10864, 10744, 11056, 11255, 11638, 11870, 11811, 12130],
      drawdown: [0, 0, 0, -0.8, 0, 0, -1.1, 0, 0, 0, 0, -0.5, 0]
    };

    const store = getStore();
    store.customStrategies.unshift(newStrategy);
    saveStore();
    return response.status(201).json({ strategy: newStrategy });
  }

  // GET /api/strategies?category=trend&sort=return&q=...
  const strategies = getAllStrategies();
  const category = request.query?.category;
  const sort = request.query?.sort || "return";
  const q = String(request.query?.q || "").trim().toLowerCase();

  let result = category && category !== "all"
    ? strategies.filter((s) => s.category === category)
    : [...strategies];

  if (q) {
    result = result.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q) ||
        s.instrument.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }

  const riskOrder = { low: 0, medium: 1, high: 2 };
  const sorters = {
    return: (a, b) => b.total_return - a.total_return,
    sharpe: (a, b) => b.sharpe_ratio - a.sharpe_ratio,
    winrate: (a, b) => b.win_rate - a.win_rate,
    drawdown: (a, b) => b.max_drawdown - a.max_drawdown,
    subscribers: (a, b) => b.subscribers - a.subscribers,
    "risk-low": (a, b) => (riskOrder[a.risk_level] ?? 1) - (riskOrder[b.risk_level] ?? 1)
  };
  if (sorters[sort]) result.sort(sorters[sort]);

  return response.json({ strategies: result, total: result.length });
}
