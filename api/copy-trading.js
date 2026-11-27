import crypto from "node:crypto";
import {
  ensureDbReady,
  getMemoryStore,
  getPortfolioForUser,
  getRiskStateForUser,
  getAllStrategiesInMemory,
  extractAuthContext,
  syncPgPortfolio,
  syncPgRiskState
} from "./store.js";
import { getDatabaseStatus } from "../db/client.js";
import { computeRiskNormalizedVolume } from "../execution/risk-manager.js";
import { computePortfolioExposure } from "../portfolio/allocator.js";
import { evaluateTradeGovernance } from "../risk/engine.js";
import { validateAgainstMandate, createDefaultMandate } from "../institutional/governance.js";

function computePortfolioMetrics(portfolio) {
  const subs = portfolio.subscriptions || [];
  const activeSubs = subs.filter((s) => s.status === "active");
  const openTrades = (portfolio.trades || []).filter((t) => t.status === "open");
  const closedTrades = (portfolio.trades || []).filter((t) => t.status === "closed");

  const now = Date.now();
  const dayMs = 86_400_000;
  const dailyPnl = Number(closedTrades.filter((t) => now - (t.timestamp || 0) <= dayMs).reduce((s, t) => s + (Number(t.pnl) || 0), 0).toFixed(2));
  const weeklyPnl = Number(closedTrades.filter((t) => now - (t.timestamp || 0) <= 7 * dayMs).reduce((s, t) => s + (Number(t.pnl) || 0), 0).toFixed(2));
  const monthlyPnl = Number(closedTrades.filter((t) => now - (t.timestamp || 0) <= 30 * dayMs).reduce((s, t) => s + (Number(t.pnl) || 0), 0).toFixed(2));

  const unrealized = openTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const realized = closedTrades.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const equity = Number((portfolio.balance + unrealized).toFixed(2));
  const highWater = Math.max(Number(portfolio.equity_high_water || 0), equity, portfolio.balance);
  portfolio.equity_high_water = highWater;
  const drawdownPct = highWater > 0 ? Number((((highWater - equity) / highWater) * 100).toFixed(2)) : 0;

  const allocatedCapital = Number(activeSubs.reduce((sum, s) => sum + Number(s.allocation || 0), 0).toFixed(2));
  const availableCapital = Number(Math.max(0, equity - allocatedCapital).toFixed(2));
  const marginUsed = Number(openTrades.reduce((sum, t) => sum + Number(t.margin || (t.qty * t.price * 0.05)), 0).toFixed(2));
  const marginUtilizationPct = equity > 0 ? Number(((marginUsed / equity) * 100).toFixed(2)) : 0;
  const wins = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(1)) : null;

  const exposure = computePortfolioExposure({ equity, openTrades, subscriptions: subs });

  return {
    data_origin: portfolio.dataOrigin || "PAPER_SANDBOX",
    balance: Number(portfolio.balance.toFixed(2)),
    equity,
    allocated_capital: allocatedCapital,
    available_capital: availableCapital,
    margin_used: marginUsed,
    margin_utilization_pct: marginUtilizationPct,
    free_margin: Number(Math.max(0, equity - marginUsed).toFixed(2)),
    gross_notional: exposure.gross_notional,
    portfolio_leverage: exposure.portfolio_leverage,
    drawdown_pct: drawdownPct,
    daily_pnl: dailyPnl,
    weekly_pnl: weeklyPnl,
    monthly_pnl: monthlyPnl,
    unrealized_pnl: Number(unrealized.toFixed(2)),
    realized_pnl: Number(realized.toFixed(2)),
    total_pnl: Number((realized + unrealized).toFixed(2)),
    pnl_percent: portfolio.balance > 0 ? Number((((realized + unrealized) / portfolio.balance) * 100).toFixed(2)) : 0,
    active_copies: activeSubs.length,
    open_positions_count: openTrades.length,
    total_trades: portfolio.trades.length,
    win_rate_today: winRate
  };
}

function flattenRiskConfig(riskState) {
  return {
    ...riskState.limits,
    kill_switch_active: Boolean(riskState.kill_switches.global_active),
    kill_switches: riskState.kill_switches,
    updated_at: riskState.updated_at
  };
}

async function queueBrokerSignal(mem, userId, trade, executionStore = null) {
  const broker = mem.brokers.get(userId);
  if (!broker) return null;

  const cleanSymbol = trade.symbol.replace("/", "").toUpperCase();
  const signal = {
    id: "sig-" + crypto.randomUUID().slice(0, 8),
    bridgeToken: broker.bridgeToken,
    brokerType: broker.type,
    environment: "DEMO",
    account: broker.account,
    symbol: cleanSymbol,
    side: trade.side,
    volume: trade.qty,
    entryPrice: trade.price,
    stopLoss: trade.stopPrice,
    takeProfit: trade.targetPrice,
    comment: `UltraLOB:${trade.strategyId || "terminal"}`,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  mem.mt5Signals.unshift(signal);
  if (mem.mt5Signals.length > 200) mem.mt5Signals.length = 200;

  if (executionStore && trade.stopPrice && trade.targetPrice) {
    try {
      await executionStore.initialize();
      await executionStore.enqueueSignal({
        signal_id: signal.id,
        strategy_id: trade.strategyId || "ul-01-gold-trend",
        strategy_version: "1.0.0",
        symbol: cleanSymbol,
        side: trade.side,
        risk_pct: Math.min(1.0, Math.max(0.05, Number(trade.riskPct || 0.5))),
        stop_loss: Number(trade.stopPrice),
        take_profit: Number(trade.targetPrice),
        expires_at: new Date(Date.now() + 120_000).toISOString(),
        command_id_factory: () => crypto.randomUUID()
      });
    } catch (err) {
      console.warn("[copy-trading] executionStore enqueue skipped:", err.message);
    }
  }

  return signal;
}

export default async function copyTradingHandler(request, response, { executionStore = null } = {}) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/copy-trading/, "").split("?")[0];
  const auth = extractAuthContext(request);
  const userId = auth.userId;
  const mem = getMemoryStore();
  const portfolio = getPortfolioForUser(userId);
  const riskState = getRiskStateForUser(userId);

  // GET /api/copy-trading/portfolio
  if (request.method === "GET" && subPath === "/portfolio") {
    const dbStatus = getDatabaseStatus();
    return response.status(200).json({
      summary: computePortfolioMetrics(portfolio),
      subscriptions: portfolio.subscriptions,
      trades: portfolio.trades.slice(0, 50),
      equityHistory: portfolio.equityHistory,
      mcConfig: portfolio.mcConfig,
      broker: mem.brokers.get(userId) || null,
      riskConfig: flattenRiskConfig(riskState),
      riskAlerts: mem.riskEvents.filter((e) => e.userId === userId).slice(0, 20),
      systemStatus: {
        database: dbStatus,
        executionEnvironment: "DEMO_ONLY"
      }
    });
  }

  // POST /api/copy-trading/size-preview
  if (request.method === "POST" && subPath === "/size-preview") {
    const b = request.body || {};
    const sizing = computeRiskNormalizedVolume({
      equity: Number(b.equity || portfolio.balance || 10_000),
      riskPct: Number(b.risk_pct || riskState.limits.max_risk_per_trade_pct || 0.5),
      stopDistance: Number(b.stop_distance || 5.0),
      tickSize: Number(b.tick_size || 0.01),
      tickValue: Number(b.tick_value || 1.0),
      volumeMin: Number(b.volume_min || 0.01),
      volumeMax: Number(b.volume_max || 50.0),
      volumeStep: Number(b.volume_step || 0.01)
    });
    return response.status(sizing.ok ? 200 : 400).json(sizing);
  }

  // POST /api/copy-trading/sandbox-capital
  if (request.method === "POST" && subPath === "/sandbox-capital") {
    const amount = Number(request.body?.amount);
    if (!Number.isFinite(amount) || amount < 100 || amount > 10_000_000) {
      return response.status(400).json({ error: "Sandbox allocation amount must be between $100 and $10,000,000." });
    }
    portfolio.balance = Number(amount.toFixed(2));
    portfolio.equity = portfolio.balance;
    portfolio.equity_high_water = portfolio.balance;
    portfolio.dataOrigin = "PAPER_SANDBOX";
    portfolio.equityHistory = [{ label: "Init", value: portfolio.balance }];
    const dbReady = await ensureDbReady().catch(() => false);
    await syncPgPortfolio(userId, portfolio, dbReady);
    return response.status(200).json({
      status: "funded",
      data_origin: "PAPER_SANDBOX",
      balance: portfolio.balance,
      summary: computePortfolioMetrics(portfolio)
    });
  }

  // POST /api/copy-trading/risk-config (Compatible endpoint backed by canonical riskState)
  if (request.method === "POST" && subPath === "/risk-config") {
    const b = request.body || {};
    if (b.kill_switch_active !== undefined) {
      riskState.kill_switches.global_active = Boolean(b.kill_switch_active);
      riskState.kill_switches.global_reason = riskState.kill_switches.global_active ? "Toggled from Overview/Risk panel" : null;
    }
    if (Number.isFinite(Number(b.max_risk_per_trade_pct))) {
      riskState.limits.max_risk_per_trade_pct = Math.min(2.0, Math.max(0.05, Number(b.max_risk_per_trade_pct)));
    }
    if (Number.isFinite(Number(b.max_daily_loss_pct))) {
      riskState.limits.max_daily_loss_pct = Math.min(10.0, Math.max(0.25, Number(b.max_daily_loss_pct)));
    }
    if (Number.isFinite(Number(b.max_drawdown_pct))) {
      riskState.limits.max_drawdown_pct = Math.min(30.0, Math.max(1.0, Number(b.max_drawdown_pct)));
    }
    if (Number.isInteger(Number(b.max_open_positions))) {
      riskState.limits.max_open_positions = Math.min(25, Math.max(1, Number(b.max_open_positions)));
    }
    riskState.updated_at = new Date().toISOString();

    mem.riskEvents.unshift({
      id: crypto.randomUUID().slice(0, 8),
      userId,
      severity: riskState.kill_switches.global_active ? "KILL_SWITCH" : "INFO",
      message: riskState.kill_switches.global_active
        ? "Global kill switch ACTIVATED — all new order execution halted."
        : "Risk governance limits updated.",
      createdAt: riskState.updated_at
    });

    return response.status(200).json({ riskConfig: flattenRiskConfig(riskState) });
  }

  // POST /api/copy-trading/subscribe
  if (request.method === "POST" && subPath === "/subscribe") {
    const {
      strategyId,
      allocation = 1000,
      riskPerTradePct = 0.5,
      maxDrawdownPct = 10,
      allocationMethod = "RISK_NORMALIZED",
      autoMcEnabled = true
    } = request.body || {};

    const strategy = getAllStrategiesInMemory().find((s) => s.id === strategyId || s.code === strategyId);
    if (!strategy) return response.status(404).json({ error: "Strategy not found." });

    const allocNum = Number(allocation);
    if (!Number.isFinite(allocNum) || allocNum < strategy.min_capital) {
      return response.status(400).json({ error: `Minimum capital for ${strategy.name} is $${strategy.min_capital}.` });
    }

    const userMandate = mem.mandates?.get(userId) || createDefaultMandate();
    const mandateCheck = validateAgainstMandate({
      mandate: userMandate,
      strategy,
      requestedMaxDrawdownPct: Number(maxDrawdownPct) || 10
    });
    if (!mandateCheck.allowed) {
      return response.status(403).json({ error: mandateCheck.message, code: mandateCheck.code });
    }

    const isResearchOnly = strategy.lifecycle_status === "RESEARCH";
    const statusLabel = isResearchOnly ? "research_watch" : "active";

    const existing = portfolio.subscriptions.find((s) => s.strategyId === strategy.id);
    if (existing) {
      existing.allocation = allocNum;
      existing.riskPerTradePct = Math.min(riskState.limits.max_risk_per_trade_pct, Math.max(0.05, Number(riskPerTradePct) || 0.5));
      existing.maxDrawdownPct = Number(maxDrawdownPct) || 10;
      existing.allocationMethod = allocationMethod;
      existing.autoMcEnabled = Boolean(autoMcEnabled);
      existing.status = statusLabel;
      existing.lifecycle_status = strategy.lifecycle_status;
    } else {
      portfolio.subscriptions.unshift({
        strategyId: strategy.id,
        code: strategy.code,
        strategyName: strategy.name,
        icon: strategy.icon || "🥇",
        instrument: strategy.instrument,
        lifecycle_status: strategy.lifecycle_status,
        allocationMethod,
        allocation: allocNum,
        riskPerTradePct: Math.min(riskState.limits.max_risk_per_trade_pct, Math.max(0.05, Number(riskPerTradePct) || 0.5)),
        maxDrawdownPct: Number(maxDrawdownPct) || 10,
        autoMcEnabled: Boolean(autoMcEnabled),
        pnl: 0,
        pnl_pct: 0,
        trades: 0,
        status: statusLabel,
        startedAt: new Date().toISOString()
      });
    }

    return response.status(200).json({
      status: isResearchOnly ? "subscribed_research_watch" : "subscribed",
      warning: isResearchOnly
        ? "Strategy is in RESEARCH status (pending backtest). Copy mandate saved in watch-only mode; live execution blocked until validated."
        : null,
      subscriptions: portfolio.subscriptions
    });
  }

  // POST /api/copy-trading/unsubscribe
  if (request.method === "POST" && subPath === "/unsubscribe") {
    const { strategyId } = request.body || {};
    const idx = portfolio.subscriptions.findIndex((s) => s.strategyId === strategyId);
    if (idx === -1) return response.status(404).json({ error: "Subscription not found." });
    portfolio.subscriptions.splice(idx, 1);
    return response.status(200).json({ status: "unsubscribed", subscriptions: portfolio.subscriptions });
  }

  // POST /api/copy-trading/toggle
  if (request.method === "POST" && subPath === "/toggle") {
    const { strategyId } = request.body || {};
    const sub = portfolio.subscriptions.find((s) => s.strategyId === strategyId);
    if (!sub) return response.status(404).json({ error: "Subscription not found." });
    if (sub.lifecycle_status === "RESEARCH") {
      return response.status(400).json({
        error: "Cannot activate live copying on a strategy in RESEARCH stage prior to backtest validation.",
        code: "LIFECYCLE_GATE_BLOCKED"
      });
    }
    sub.status = sub.status === "active" ? "paused" : "active";
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
      minExpectedReturnPct: Number.isFinite(Number(cfg.minExpectedReturnPct))
        ? Number(cfg.minExpectedReturnPct)
        : portfolio.mcConfig.minExpectedReturnPct,
      riskAmountUsd: Math.max(10, Number(cfg.riskAmountUsd) || portfolio.mcConfig.riskAmountUsd)
    };
    return response.status(200).json({ mcConfig: portfolio.mcConfig });
  }

  // POST /api/copy-trading/mc-signal
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
      strategyId = "mc-research-signal",
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
      data_origin: "SIMULATED_RESEARCH",
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
      const metrics = computePortfolioMetrics(portfolio);
      const effectiveRiskPct = metrics.balance > 0
        ? Math.min(riskState.limits.max_risk_per_trade_pct, Math.max(0.05, (cfg.riskAmountUsd / metrics.balance) * 100))
        : riskState.limits.max_risk_per_trade_pct;

      const gov = evaluateTradeGovernance({
        riskState,
        portfolioMetrics: metrics,
        strategyId,
        symbol,
        proposedRiskPct: effectiveRiskPct
      });
      if (!gov.approved) {
        mem.riskEvents.unshift({
          id: crypto.randomUUID().slice(0, 8),
          userId,
          severity: "BREACH",
          message: `MC order blocked (${gov.code}): ${gov.message}`,
          createdAt: new Date().toISOString()
        });
        const status = gov.code.includes("KILL_SWITCH") ? 403 : 400;
        return response.status(status).json({ error: gov.message, code: gov.code, evaluation });
      }

      const stopRef = Number(stopPrice) || spotNum * 0.98;
      const stopDistance = Math.abs(spotNum - stopRef);
      const sizing = computeRiskNormalizedVolume({
        equity: portfolio.balance,
        riskPct: effectiveRiskPct,
        stopDistance: Math.max(0.01, stopDistance),
        tickSize: 0.01,
        tickValue: 0.01,
        volumeMin: 0.001,
        volumeMax: 10.0,
        volumeStep: 0.001
      });
      const qty = sizing.ok ? sizing.volume : 0.001;
      const connectedBroker = mem.brokers.get(userId);
      const brokerName = connectedBroker ? connectedBroker.name : "Paper Sandbox Engine";

      const mainTrade = {
        id: "tr-" + crypto.randomUUID().slice(0, 8),
        time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
        timestamp: Date.now(),
        strategyId,
        strategy: "MC Research Signal",
        symbol,
        side: signalSide,
        qty,
        riskPct: effectiveRiskPct,
        price: Number(spotNum.toFixed(2)),
        stopPrice: Number(stopPrice) ? Number(Number(stopPrice).toFixed(2)) : null,
        targetPrice: Number(targetPrice) ? Number(Number(targetPrice).toFixed(2)) : null,
        pnl: 0,
        status: "open",
        broker: brokerName,
        data_origin: connectedBroker ? "DEMO_BROKER" : "PAPER_SANDBOX",
        source: "Monte Carlo Signal"
      };
      portfolio.trades.unshift(mainTrade);
      const brokerSignal = await queueBrokerSignal(mem, userId, mainTrade, executionStore);
      executedTrades.push({ trade: mainTrade, brokerSignal });
    }

    return response.status(200).json({ evaluation, executedTrades });
  }

  // POST /api/copy-trading/execute
  if (request.method === "POST" && subPath === "/execute") {
    const { symbol = "BTC/USD", side = "BUY", qty = 0.05, price, orderType = "market", strategyId = "manual" } = request.body || {};
    const sideUpper = String(side).toUpperCase();
    const qtyNum = Number(qty);
    const priceNum = Number(price);
    if (!["BUY", "SELL"].includes(sideUpper) || !Number.isFinite(qtyNum) || qtyNum <= 0 || !Number.isFinite(priceNum) || priceNum <= 0) {
      return response.status(400).json({ error: "Valid side (BUY/SELL), qty, and price are required." });
    }

    const metrics = computePortfolioMetrics(portfolio);
    const notional = qtyNum * priceNum;
    const gov = evaluateTradeGovernance({
      riskState,
      portfolioMetrics: metrics,
      strategyId,
      symbol,
      proposedRiskPct: riskState.limits.max_risk_per_trade_pct,
      proposedNotional: notional,
      proposedMargin: notional * 0.05
    });
    if (!gov.approved) {
      mem.riskEvents.unshift({
        id: crypto.randomUUID().slice(0, 8),
        userId,
        severity: "BREACH",
        message: `Manual execution blocked (${gov.code}): ${gov.message}`,
        createdAt: new Date().toISOString()
      });
      const status = gov.code.includes("KILL_SWITCH") ? 403 : 400;
      return response.status(status).json({ error: gov.message, code: gov.code });
    }

    const connectedBroker = mem.brokers.get(userId);
    const brokerName = connectedBroker ? connectedBroker.name : "Paper Sandbox Engine";
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
      data_origin: connectedBroker ? "DEMO_BROKER" : "PAPER_SANDBOX",
      source: "Terminal"
    };

    portfolio.trades.unshift(trade);
    const brokerSignal = await queueBrokerSignal(mem, userId, trade, executionStore);

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
    portfolio.equityHistory.push({
      label: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      value: portfolio.balance
    });

    return response.status(200).json({ trade, balance: portfolio.balance });
  }

  return response.status(404).json({ error: "Copy trading endpoint not found." });
}
