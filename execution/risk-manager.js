const EPSILON = 1e-10;

function reject(code, message, details = {}) {
  return { ok: false, code, message, details };
}

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function roundVolumeDown(volume, step) {
  const precision = Math.max(0, Math.min(8, (String(step).split(".")[1] || "").length));
  return Number((Math.floor((volume + EPSILON) / step) * step).toFixed(precision));
}

/**
 * Shared risk-normalized position sizer used by both the MT5 execution bridge
 * and the copy-trading allocation engine. Never uses fixed lot sizes.
 */
export function computeRiskNormalizedVolume({
  equity,
  riskPct,
  stopDistance,
  tickSize,
  tickValue,
  volumeMin = 0.01,
  volumeMax = 100,
  volumeStep = 0.01
}) {
  if (!finitePositive(equity) || !finitePositive(riskPct) || !finitePositive(stopDistance) ||
      !finitePositive(tickSize) || !finitePositive(tickValue) || !finitePositive(volumeStep)) {
    return { ok: false, code: "INVALID_SIZING_INPUT", message: "Positive equity, risk, stop distance, and tick specs are required." };
  }
  const lossPerLot = (stopDistance / tickSize) * tickValue;
  if (!finitePositive(lossPerLot)) {
    return { ok: false, code: "RISK_CALCULATION_FAILED", message: "Could not calculate loss per lot." };
  }
  const riskBudget = (Number(equity) * Number(riskPct)) / 100;
  const rawVolume = riskBudget / lossPerLot;
  const boundedVolume = Math.min(rawVolume, Number(volumeMax));
  const volume = roundVolumeDown(boundedVolume, Number(volumeStep));
  if (!Number.isFinite(volume) || volume + EPSILON < Number(volumeMin)) {
    return {
      ok: false,
      code: "VOLUME_BELOW_MINIMUM",
      message: "Risk budget is too small for the broker minimum volume.",
      raw_volume: rawVolume,
      minimum_volume: Number(volumeMin),
      risk_budget: riskBudget
    };
  }
  const actualRiskAmount = lossPerLot * volume;
  const actualRiskPct = (actualRiskAmount / Number(equity)) * 100;
  return {
    ok: true,
    volume,
    loss_per_lot: lossPerLot,
    risk_budget: riskBudget,
    actual_risk_amount: actualRiskAmount,
    actual_risk_pct: actualRiskPct
  };
}

/**
 * Server-side pre-trade gate. Broker-side OrderCheck/OrderCalcProfit must still
 * run inside the terminal immediately before OrderSend.
 */
export function evaluateDemoCommand(connector, signal, now = Date.now()) {
  if (!connector || connector.status !== "ACTIVE") {
    return reject("CONNECTOR_INACTIVE", "Connector is not active.");
  }
  if (connector.environment !== "DEMO" || String(connector.trade_mode || "").toUpperCase() !== "DEMO") {
    return reject("DEMO_ACCOUNT_REQUIRED", "This execution service only accepts MT5 demo accounts.");
  }
  if (connector.terminal_connected !== true) {
    return reject("TERMINAL_DISCONNECTED", "MT5 terminal is not connected.");
  }
  if (connector.terminal_trade_allowed !== true || connector.ea_trade_allowed !== true) {
    return reject("AUTOTRADING_DISABLED", "MT5 terminal or Expert Advisor trading permission is disabled.");
  }

  const heartbeatTime = connector.last_heartbeat_at ? new Date(connector.last_heartbeat_at).getTime() : NaN;
  if (!Number.isFinite(heartbeatTime) || now - heartbeatTime > 15000 || now < heartbeatTime - 5000) {
    return reject("STALE_ACCOUNT_SNAPSHOT", "The connector account snapshot is stale.");
  }

  const equity = Number(connector.equity);
  if (!finitePositive(equity)) return reject("INVALID_EQUITY", "Account equity must be positive.");

  const dayStartEquity = Number(connector.day_start_equity);
  if (!finitePositive(dayStartEquity)) return reject("DAILY_BASELINE_MISSING", "Daily equity baseline is not available.");
  const highWater = Number(connector.equity_high_water);
  if (!finitePositive(highWater)) return reject("DRAWDOWN_BASELINE_MISSING", "Equity high-water mark is not available.");

  const dailyLossPct = Math.max(0, (dayStartEquity - equity) / dayStartEquity * 100);
  const drawdownPct = Math.max(0, (highWater - equity) / highWater * 100);
  if (dailyLossPct >= Number(connector.max_daily_loss_pct)) {
    return reject("DAILY_LOSS_LIMIT", "Daily loss limit reached.", { daily_loss_pct: dailyLossPct });
  }
  if (drawdownPct >= Number(connector.max_drawdown_pct)) {
    return reject("MAX_DRAWDOWN_LIMIT", "Maximum drawdown limit reached.", { drawdown_pct: drawdownPct });
  }

  const symbol = String(signal.symbol || "").trim().toUpperCase();
  const allowedSymbols = Array.isArray(connector.allowed_symbols) ? connector.allowed_symbols : [];
  if (!allowedSymbols.includes(symbol)) {
    return reject("SYMBOL_NOT_ALLOWED", "Symbol is not enabled for this connector.", { symbol });
  }

  const strategyIds = Array.isArray(connector.strategy_ids) ? connector.strategy_ids : [];
  if (!strategyIds.includes(signal.strategy_id)) {
    return reject("STRATEGY_NOT_SUBSCRIBED", "Connector is not subscribed to this strategy.");
  }

  const expiresAt = signal.expires_at ? new Date(signal.expires_at).getTime() : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return reject("SIGNAL_EXPIRED", "Signal has expired.");
  }

  const openPositions = Array.isArray(connector.positions) ? connector.positions : [];
  if (openPositions.length >= Number(connector.max_open_positions)) {
    return reject("MAX_OPEN_POSITIONS", "Maximum open-position limit reached.", { open_positions: openPositions.length });
  }

  const specs = Array.isArray(connector.symbol_specs)
    ? connector.symbol_specs.find((item) => String(item.symbol || "").toUpperCase() === symbol)
    : connector.symbol_specs?.[symbol];
  if (!specs) return reject("SYMBOL_SPEC_MISSING", "Broker symbol specifications are not available.", { symbol });

  const bid = Number(specs.bid);
  const ask = Number(specs.ask);
  const point = Number(specs.point);
  const tickSize = Number(specs.tick_size);
  const tickValue = Number(specs.tick_value);
  const volumeMin = Number(specs.volume_min);
  const volumeMax = Number(specs.volume_max);
  const volumeStep = Number(specs.volume_step);
  const stopsLevel = Math.max(0, Number(specs.stops_level) || 0);

  if (![bid, ask, point, tickSize, tickValue, volumeMin, volumeMax, volumeStep].every(Number.isFinite) ||
      bid <= 0 || ask < bid || point <= 0 || tickSize <= 0 || tickValue <= 0 ||
      volumeMin <= 0 || volumeMax < volumeMin || volumeStep <= 0) {
    return reject("INVALID_SYMBOL_SPEC", "Broker returned invalid price, tick or volume specifications.", { symbol });
  }

  const spreadPoints = (ask - bid) / point;
  if (spreadPoints > Number(connector.max_spread_points)) {
    return reject("SPREAD_LIMIT", "Current spread exceeds the connector limit.", {
      spread_points: spreadPoints,
      max_spread_points: Number(connector.max_spread_points)
    });
  }

  const side = String(signal.side || "").toUpperCase();
  if (side !== "BUY" && side !== "SELL") return reject("INVALID_SIDE", "Signal side must be BUY or SELL.");
  const entryPrice = side === "BUY" ? ask : bid;
  const stopLoss = Number(signal.stop_loss);
  const takeProfit = Number(signal.take_profit);
  if (!finitePositive(stopLoss) || !finitePositive(takeProfit)) {
    return reject("INVALID_PROTECTION", "Both stop-loss and take-profit prices are required.");
  }

  if (side === "BUY" && !(stopLoss < entryPrice && takeProfit > entryPrice)) {
    return reject("INVALID_PROTECTION_SIDE", "BUY requires stop-loss below entry and take-profit above entry.");
  }
  if (side === "SELL" && !(stopLoss > entryPrice && takeProfit < entryPrice)) {
    return reject("INVALID_PROTECTION_SIDE", "SELL requires stop-loss above entry and take-profit below entry.");
  }

  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (stopDistance + EPSILON < stopsLevel * point) {
    return reject("STOP_TOO_CLOSE", "Stop-loss is inside the broker minimum stop distance.", {
      stop_distance_points: stopDistance / point,
      minimum_points: stopsLevel
    });
  }

  const riskPct = Number(signal.risk_pct);
  const maxRiskPct = Number(connector.max_trade_risk_pct);
  if (!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > maxRiskPct) {
    return reject("RISK_LIMIT", "Signal risk exceeds the connector's per-trade risk limit.", {
      requested_risk_pct: riskPct,
      max_trade_risk_pct: maxRiskPct
    });
  }

  // SYMBOL_TRADE_TICK_VALUE is supplied by the local terminal in account currency.
  const lossPerLot = stopDistance / tickSize * tickValue;
  if (!finitePositive(lossPerLot)) return reject("RISK_CALCULATION_FAILED", "Could not calculate loss per lot.");
  const riskBudget = equity * riskPct / 100;
  const rawVolume = riskBudget / lossPerLot;
  const boundedVolume = Math.min(rawVolume, volumeMax);
  const volume = roundVolumeDown(boundedVolume, volumeStep);
  if (!Number.isFinite(volume) || volume + EPSILON < volumeMin) {
    return reject("VOLUME_BELOW_MINIMUM", "Risk budget is too small for the broker's minimum volume.", {
      raw_volume: rawVolume,
      minimum_volume: volumeMin,
      risk_budget: riskBudget
    });
  }

  const actualRiskAmount = lossPerLot * volume;
  const actualRiskPct = actualRiskAmount / equity * 100;
  if (actualRiskPct > maxRiskPct + EPSILON || actualRiskAmount > riskBudget + EPSILON) {
    return reject("POSITION_SIZE_EXCEEDS_RISK", "Calculated volume exceeds the configured risk budget.", {
      actual_risk_pct: actualRiskPct,
      requested_risk_pct: riskPct
    });
  }

  return {
    ok: true,
    command: {
      command_id: signal.command_id,
      signal_id: signal.signal_id,
      strategy_id: signal.strategy_id,
      strategy_version: signal.strategy_version,
      symbol,
      side,
      order_type: "MARKET",
      volume,
      entry_reference: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      risk_amount: actualRiskAmount,
      risk_pct: actualRiskPct,
      spread_points: spreadPoints,
      max_deviation_points: Number(connector.max_deviation_points)
    },
    metrics: {
      daily_loss_pct: dailyLossPct,
      drawdown_pct: drawdownPct,
      risk_budget: riskBudget,
      actual_risk_amount: actualRiskAmount,
      actual_risk_pct: actualRiskPct
    }
  };
}
