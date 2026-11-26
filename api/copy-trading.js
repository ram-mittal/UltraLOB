import crypto from "node:crypto";
import { getStore, saveStore, getPortfolioForUser, getAllStrategies, extractUserId } from "./store.js";

function computePortfolioMetrics(portfolio) {
  const subs = portfolio.subscriptions || [];
  const activeSubs = subs.filter((s) => s.status === "active");
  const openTrades = (portfolio.trades || []).filter((t) => t.status === "open");
  const closedTrades = (portfolio.trades || []).filter((t) => t.status === "closed");

  const unrealized = openTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const realized = closedTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const subPnl = subs.reduce((sum, s) => sum + (Number(s.pnl) || 0), 0);
  const totalPnl = Number((subPnl + realized).toFixed(2));
  const equity = Number((portfolio.balance + unrealized).toFixed(2));
  const wins = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(1)) : 0;

  return {
    balance: Number(portfolio.balance.toFixed(2)),
    equity,
    margin_used: Number((activeSubs.reduce((sum, s) => sum + s.allocation * 0.25, 0)).toFixed(2)),
    free_margin: Number(Math.max(0, equity - activeSubs.reduce((sum, s) => sum + s.allocation * 0.25, 0)).toFixed(2)),
    unrealized_pnl: Number(unrealized.toFixed(2)),
    total_pnl: totalPnl,
    pnl_percent: portfolio.balance > 0 ? Number(((totalPnl / portfolio.balance) * 100).toFixed(2)) : 0,
    active_copies: activeSubs.length,
    total_trades_today: portfolio.trades.length,
    win_rate_today: winRate
  };
}

function queueBrokerSignal(store, userId, trade) {
  const broker = store.brokers[userId];
  if (!broker) return null;
  const signal = {
    id: "sig-" + crypto.randomUUID().slice(0, 8),
    bridgeToken: broker.bridgeToken,
    brokerType: broker.type,
    account: broker.account,
    symbol: trade.symbol.replace("/", ""),
    side: trade.side,
    volume: trade.qty,
    entryPrice: trade.price,
    stopLoss: trade.stopPrice,
    takeProfit: trade.targetPrice,
    comment: `UltraLOB:${trade.strategyId || "terminal"}`,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  store.mt5Signals.unshift(signal);
  if (store.mt5Signals.length > 200) store.mt5Signals.length = 200;
  return signal;
}

export default function copyTradingHandler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/copy-trading/, "").split("?")[0];
  const userId = extractUserId(request);
  const store = getStore();
  const portfolio = getPortfolioForUser(userId);

  // GET /api/copy-trading/portfolio
  if (request.method === "GET" && subPath === "/portfolio") {
    return response.status(200).json({
      summary: computePortfolioMetrics(portfolio),
      subscriptions: portfolio.subscriptions,
      trades: portfolio.trades.slice(0, 50),
      equityHistory: portfolio.equityHistory,
      mcConfig: portfolio.mcConfig,
      broker: store.brokers[userId] || null
    });
  }

  // POST /api/copy-trading/subscribe
  if (request.method === "POST" && subPath === "/subscribe") {
    const { strategyId, allocation = 1000, lotMultiplier = 1.0, maxDrawdownPct = 15, autoMcEnabled = true } = request.body || {};
    const strategy = getAllStrategies().find((s) => s.id === strategyId);
    if (!strategy) return response.status(404).json({ error: "Strategy not found." });

    const allocNum = Number(allocation);
    if (!Number.isFinite(allocNum) || allocNum < strategy.min_capital) {
      return response.status(400).json({ error: `Minimum capital for ${strategy.name} is $${strategy.min_capital}.` });
    }

    const existing = portfolio.subscriptions.find((s) => s.strategyId === strategyId);
    if (existing) {
      existing.allocation = allocNum;
      existing.lotMultiplier = Number(lotMultiplier) || 1.0;
      existing.maxDrawdownPct = Number(maxDrawdownPct) || 15;
      existing.autoMcEnabled = Boolean(autoMcEnabled);
      existing.status = "active";
    } else {
      portfolio.subscriptions.unshift({
        strategyId: strategy.id,
        strategyName: strategy.name,
        icon: strategy.icon || "📈",
        allocation: allocNum,
        lotMultiplier: Number(lotMultiplier) || 1.0,
        maxDrawdownPct: Number(maxDrawdownPct) || 15,
        autoMcEnabled: Boolean(autoMcEnabled),
        pnl: 0,
        pnl_pct: 0,
        trades: 0,
        status: "active",
        startedAt: new Date().toISOString()
      });
    }
    saveStore();
    return response.status(200).json({ status: "subscribed", subscriptions: portfolio.subscriptions });
  }

  // POST /api/copy-trading/unsubscribe
  if (request.method === "POST" && subPath === "/unsubscribe") {
    const { strategyId } = request.body || {};
    const idx = portfolio.subscriptions.findIndex((s) => s.strategyId === strategyId);
    if (idx === -1) return response.status(404).json({ error: "Subscription not found." });
    portfolio.subscriptions.splice(idx, 1);
    saveStore();
    return response.status(200).json({ status: "unsubscribed", subscriptions: portfolio.subscriptions });
  }

  // POST /api/copy-trading/toggle
  if (request.method === "POST" && subPath === "/toggle") {
    const { strategyId } = request.body || {};
    const sub = portfolio.subscriptions.find((s) => s.strategyId === strategyId);
    if (!sub) return response.status(404).json({ error: "Subscription not found." });
    sub.status = sub.status === "active" ? "paused" : "active";
    saveStore();
    return response.status(200).json({ status: sub.status, subscription: sub });
  }

  // POST /api/copy-trading/mc-config
  if (request.method === "POST" && subPath === "/mc-config") {
    const cfg = request.body || {};
    portfolio.mcConfig = {
      ...portfolio.mcConfig,
      enabled: cfg.enabled !== undefined ? Boolean(cfg.enabled) : portfolio.mcConfig.enabled,
      minTargetProb: Number(cfg.minTargetProb) || portfolio.mcConfig.minTargetProb,
      minEdgePct: Number(cfg.minEdgePct) >= 0 ? Number(cfg.minEdgePct) : portfolio.mcConfig.minEdgePct,
      minExpectedReturnPct: Number.isFinite(Number(cfg.minExpectedReturnPct)) ? Number(cfg.minExpectedReturnPct) : portfolio.mcConfig.minExpectedReturnPct,
      riskAmountUsd: Math.max(10, Number(cfg.riskAmountUsd) || portfolio.mcConfig.riskAmountUsd)
    };
    saveStore();
    return response.status(200).json({ mcConfig: portfolio.mcConfig });
  }

  // POST /api/copy-trading/mc-signal
  // Evaluates Monte Carlo results and optionally auto-executes onto connected MT5/Exness + copiers
  if (request.method === "POST" && subPath === "/mc-signal") {
    const {
      symbol = "BTC/USD",
      spot,
      direction = "long",
      targetFirstProb,
      stopFirstProb,
      expectedReturn,
      medianReturn,
      stopPrice,
      targetPrice,
      execute = false
    } = request.body || {};

    const spotNum = Number(spot);
    const tProb = Number(targetFirstProb);
    const sProb = Number(stopFirstProb);
    const expRet = Number(expectedReturn);

    if (!Number.isFinite(spotNum) || spotNum <= 0 || !Number.isFinite(tProb) || !Number.isFinite(sProb)) {
      return response.status(400).json({ error: "Valid spot, targetFirstProb, and stopFirstProb are required." });
    }

    const edgePct = (tProb - sProb) * 100;
    const expRetPct = (Number.isFinite(expRet) ? expRet : 0) * 100;
    const cfg = portfolio.mcConfig;

    const meetsProb = tProb >= cfg.minTargetProb;
    const meetsEdge = edgePct >= cfg.minEdgePct;
    const meetsReturn = expRetPct >= cfg.minExpectedReturnPct;
    const qualified = meetsProb && meetsEdge && meetsReturn;
    const signalSide = qualified ? (direction === "short" ? "SELL" : "BUY") : "HOLD";

    const evaluation = {
      signal: signalSide,
      qualified,
      symbol,
      spot: spotNum,
      targetFirstProb: tProb,
      stopFirstProb: sProb,
      edgePct: Number(edgePct.toFixed(2)),
      expectedReturnPct: Number(expRetPct.toFixed(3)),
      medianReturnPct: Number(((Number(medianReturn) || 0) * 100).toFixed(3)),
      stopPrice: Number(stopPrice) || null,
      targetPrice: Number(targetPrice) || null,
      reasons: [
        `Target-first prob ${(tProb * 100).toFixed(1)}% (min ${(cfg.minTargetProb * 100).toFixed(0)}%)`,
        `Probability edge ${edgePct.toFixed(1)}% (min ${cfg.minEdgePct}%)`,
        `Expected return ${expRetPct.toFixed(2)}% (min ${cfg.minExpectedReturnPct}%)`
      ],
      evaluatedAt: new Date().toISOString()
    };

    portfolio.mcConfig.lastEvaluatedAt = evaluation.evaluatedAt;
    portfolio.mcConfig.lastSignal = evaluation;

    let executedTrades = [];
    if (qualified && execute) {
      const stopDist = Math.abs(spotNum - (Number(stopPrice) || spotNum * 0.98)) / spotNum;
      const notional = stopDist > 0 ? Math.min(portfolio.balance * 0.5, cfg.riskAmountUsd / stopDist) : cfg.riskAmountUsd * 5;
      const qty = Number(Math.max(0.001, notional / spotNum).toFixed(4));
      const brokerName = store.brokers[userId]?.name || "Demo Paper Engine";

      const mainTrade = {
        id: "tr-" + crypto.randomUUID().slice(0, 8),
        time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
        timestamp: Date.now(),
        strategyId: "mc-momentum",
        strategy: "MC Auto-Trader",
        symbol,
        side: signalSide,
        qty,
        price: Number(spotNum.toFixed(2)),
        stopPrice: Number(stopPrice) ? Number(Number(stopPrice).toFixed(2)) : null,
        targetPrice: Number(targetPrice) ? Number(Number(targetPrice).toFixed(2)) : null,
        pnl: 0,
        status: "open",
        broker: brokerName,
        source: "Monte Carlo Auto"
      };
      portfolio.trades.unshift(mainTrade);
      const brokerSignal = queueBrokerSignal(store, userId, mainTrade);
      executedTrades.push({ trade: mainTrade, brokerSignal });

      // Update active MC-enabled copy subscription stats
      const mcSub = portfolio.subscriptions.find((s) => s.strategyId === "mc-momentum" && s.status === "active");
      if (mcSub) mcSub.trades += 1;
    }

    saveStore();
    return response.status(200).json({ evaluation, executedTrades });
  }

  // POST /api/copy-trading/execute (Manual order from terminal + mirror to connected broker)
  if (request.method === "POST" && subPath === "/execute") {
    const { symbol = "BTC/USD", side = "BUY", qty = 0.05, price, orderType = "market", strategyId = "manual" } = request.body || {};
    const sideUpper = String(side).toUpperCase();
    const qtyNum = Number(qty);
    const priceNum = Number(price);
    if (!["BUY", "SELL"].includes(sideUpper) || !Number.isFinite(qtyNum) || qtyNum <= 0 || !Number.isFinite(priceNum) || priceNum <= 0) {
      return response.status(400).json({ error: "Valid side (BUY/SELL), qty, and price are required." });
    }

    const brokerName = store.brokers[userId]?.name || "Demo Paper Engine";
    const trade = {
      id: "tr-" + crypto.randomUUID().slice(0, 8),
      time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      timestamp: Date.now(),
      strategyId,
      strategy: strategyId === "manual" ? `Terminal (${orderType})` : strategyId,
      symbol,
      side: sideUpper,
      qty: Number(qtyNum.toFixed(4)),
      price: Number(priceNum.toFixed(2)),
      stopPrice: null,
      targetPrice: null,
      pnl: 0,
      status: "open",
      broker: brokerName,
      source: "Terminal"
    };

    portfolio.trades.unshift(trade);
    const brokerSignal = queueBrokerSignal(store, userId, trade);
    saveStore();

    return response.status(201).json({ trade, brokerSignal });
  }

  // POST /api/copy-trading/close-trade
  if (request.method === "POST" && subPath === "/close-trade") {
    const { tradeId, closePrice } = request.body || {};
    const trade = portfolio.trades.find((t) => t.id === tradeId);
    if (!trade) return response.status(404).json({ error: "Trade not found." });
    if (trade.status === "closed") return response.status(200).json({ trade });

    const exit = Number(closePrice) > 0 ? Number(closePrice) : trade.price;
    const diff = trade.side === "BUY" ? exit - trade.price : trade.price - exit;
    const realized = Number((diff * trade.qty).toFixed(2));
    trade.pnl = realized;
    trade.closePrice = Number(exit.toFixed(2));
    trade.status = "closed";
    portfolio.balance = Number((portfolio.balance + realized).toFixed(2));
    saveStore();

    return response.status(200).json({ trade, balance: portfolio.balance });
  }

  return response.status(404).json({ error: "Copy trading endpoint not found." });
}
