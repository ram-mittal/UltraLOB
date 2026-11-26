// Trading Terminal Page — Live Kraken Feed + Historical Monte Carlo Auto-Trader + MT5/Exness Order Routing
import { createMonteCarloFan, destroyAllCharts } from '../components/charts.js';
import { api } from '../api.js';
import { showToast } from '../app.js';

export function render() {
  return `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-bold text-white mb-1">Live Trading Terminal & Monte Carlo Auto-Trader</h1>
        <p class="text-sm text-surface-400">BTC/USD — Kraken Spot • Real-time feed driving automated MT5 / Exness execution</p>
      </div>
      <div class="flex items-center gap-3">
        <a href="/legacy" class="text-xs btn-outline px-3 py-1.5 rounded-lg text-surface-300">Classic FIX Terminal</a>
        <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-profit/10 border border-profit/20" id="ws-status">
          <span class="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" id="ws-dot"></span>
          <span class="text-xs font-medium text-profit" id="ws-text">Connecting...</span>
        </div>
      </div>
    </div>

    <!-- Terminal Grid -->
    <div class="grid lg:grid-cols-4 gap-4">
      <!-- Main Area -->
      <div class="lg:col-span-3 space-y-4">
        <!-- Live Price Display -->
        <div class="glass-card rounded-xl p-6">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-3 mb-1">
                <span class="text-3xl font-bold text-white font-mono" id="live-price">—</span>
                <span class="chip chip-blue text-xs" id="broker-route-pill">Paper Engine</span>
              </div>
              <div class="text-xs text-surface-400" id="price-info">Connecting to Kraken BTC/USD stream...</div>
            </div>
            <div class="grid grid-cols-3 gap-6 text-right">
              <div>
                <span class="text-xs text-surface-500 block">Bid</span>
                <span class="text-sm font-mono text-profit font-medium" id="live-bid">—</span>
              </div>
              <div>
                <span class="text-xs text-surface-500 block">Ask</span>
                <span class="text-sm font-mono text-loss font-medium" id="live-ask">—</span>
              </div>
              <div>
                <span class="text-xs text-surface-500 block">Spread</span>
                <span class="text-sm font-mono text-white font-medium" id="stat-spread">—</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Historical Market Monte Carlo Auto-Trading Engine -->
        <div class="glass-card rounded-xl p-6">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 class="text-base font-bold text-white">🎲 Monte Carlo Signal & Automated Trading Engine</h3>
              <p class="text-xs text-surface-400">Calibrates block-bootstrap paths from real Kraken candles and auto-executes when probability edge exceeds threshold</p>
            </div>
            <div class="flex items-center gap-2">
              <button id="mc-arm-btn" class="px-4 py-2 rounded-lg text-xs font-semibold bg-surface-800 border border-surface-700 text-surface-300 hover:text-white transition-colors">
                🤖 Auto-Trade: OFF
              </button>
              <button id="mc-run-eval-btn" class="btn-primary px-4 py-2 rounded-lg text-xs font-semibold text-white">
                Run MC & Evaluate
              </button>
            </div>
          </div>

          <!-- Controls -->
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <div>
              <label class="text-xs text-surface-500 block mb-1">Interval</label>
              <select id="mc-interval" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-2.5 py-1.5 text-xs text-white">
                <option value="1m">1m</option>
                <option value="5m" selected>5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-surface-500 block mb-1">Direction</label>
              <select id="mc-direction" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-2.5 py-1.5 text-xs text-white">
                <option value="long">LONG (Buy)</option>
                <option value="short">SHORT (Sell)</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-surface-500 block mb-1">Target %</label>
              <input id="mc-target-pct" type="number" step="0.1" value="1.5" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono">
            </div>
            <div>
              <label class="text-xs text-surface-500 block mb-1">Stop %</label>
              <input id="mc-stop-pct" type="number" step="0.1" value="1.0" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono">
            </div>
            <div>
              <label class="text-xs text-surface-500 block mb-1">Min Target Prob %</label>
              <input id="mc-min-prob" type="number" step="1" value="55" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono">
            </div>
            <div>
              <label class="text-xs text-surface-500 block mb-1">Risk / Trade ($)</label>
              <input id="mc-risk-usd" type="number" step="50" value="250" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono">
            </div>
          </div>

          <!-- Signal KPIs -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
            <div class="p-3 rounded-lg bg-surface-800/50 border border-surface-700/40">
              <div class="text-xs text-surface-500">Signal Decision</div>
              <div class="text-base font-bold text-surface-300 mt-0.5" id="mc-signal-badge">—</div>
            </div>
            <div class="p-3 rounded-lg bg-surface-800/50 border border-surface-700/40">
              <div class="text-xs text-surface-500">Target Hit First</div>
              <div class="text-base font-bold text-profit mt-0.5" id="mc-target-prob">—</div>
            </div>
            <div class="p-3 rounded-lg bg-surface-800/50 border border-surface-700/40">
              <div class="text-xs text-surface-500">Stop Hit First</div>
              <div class="text-base font-bold text-loss mt-0.5" id="mc-stop-prob">—</div>
            </div>
            <div class="p-3 rounded-lg bg-surface-800/50 border border-surface-700/40">
              <div class="text-xs text-surface-500">Median Forecast</div>
              <div class="text-base font-bold text-white mt-0.5 font-mono" id="mc-median-price">—</div>
            </div>
            <div class="p-3 rounded-lg bg-surface-800/50 border border-surface-700/40">
              <div class="text-xs text-surface-500">Prob. Edge</div>
              <div class="text-base font-bold text-brand-400 mt-0.5" id="mc-edge-pct">—</div>
            </div>
          </div>

          <!-- MC Fan Chart -->
          <div class="h-60 mb-3"><canvas id="terminal-mc-fan"></canvas></div>
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-400">
            <span id="mc-status-line">Click "Run MC & Evaluate" to calibrate from Kraken OHLC candles and generate a trading signal.</span>
            <button id="mc-force-exec-btn" class="hidden text-xs text-profit border border-profit/30 px-3 py-1 rounded-lg hover:bg-profit/10">
              Execute Signal Now →
            </button>
          </div>
        </div>

        <!-- Trade Feed -->
        <div class="glass-card rounded-xl p-6">
          <h3 class="text-sm font-semibold text-white mb-3">📡 Live Trade Feed (Kraken BTC/USD)</h3>
          <div class="h-64 overflow-y-auto" id="trade-feed">
            <table class="w-full text-xs font-mono">
              <thead class="sticky top-0 bg-surface-900/90 backdrop-blur">
                <tr class="border-b border-surface-800">
                  <th class="text-left text-surface-500 pb-2 font-medium">Time</th>
                  <th class="text-right text-surface-500 pb-2 font-medium">Price</th>
                  <th class="text-right text-surface-500 pb-2 font-medium">Qty</th>
                  <th class="text-center text-surface-500 pb-2 font-medium">Side</th>
                </tr>
              </thead>
              <tbody id="trade-rows">
                <tr><td colspan="4" class="text-center text-surface-600 py-8">Waiting for live trades...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="space-y-4">
        <!-- Order Panel -->
        <div class="glass-card rounded-xl p-5">
          <h3 class="text-sm font-semibold text-white mb-4">📝 Order Ticket (Routes to Broker)</h3>
          <form onsubmit="return false;" id="order-form" class="space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <button type="button" data-side="buy" class="side-btn py-2.5 rounded-lg text-sm font-semibold bg-profit/20 text-profit border border-profit/30 transition-colors">
                BUY
              </button>
              <button type="button" data-side="sell" class="side-btn py-2.5 rounded-lg text-sm font-semibold bg-surface-800 text-surface-400 border border-surface-700 transition-colors">
                SELL
              </button>
            </div>
            <div>
              <label class="text-xs text-surface-500 mb-1 block">Quantity (BTC)</label>
              <input type="number" step="0.001" min="0.001" value="0.05" name="qty"
                     class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand-500">
            </div>
            <div>
              <label class="text-xs text-surface-500 mb-1 block">Order Type</label>
              <select name="type" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
            </div>
            <div id="limit-price-field" class="hidden">
              <label class="text-xs text-surface-500 mb-1 block">Limit Price</label>
              <input type="number" step="0.01" name="price"
                     class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-brand-500">
            </div>
            <button type="submit" class="btn-primary w-full py-2.5 rounded-lg text-sm font-semibold text-white" id="submit-order">
              Place Order
            </button>
          </form>
        </div>

        <!-- Option Pricing MC Widget -->
        <div class="glass-card rounded-xl p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-white">⚡ Quant Option Pricer</h3>
            <button id="run-option-mc-btn" class="text-xs btn-outline px-2.5 py-1 rounded-lg text-brand-300">Price</button>
          </div>
          <div id="mc-result" class="text-xs text-surface-400">
            Runs 100,000 antithetic GBM paths via <code class="text-surface-300">/api/pricing</code>.
          </div>
        </div>

        <!-- Auto-Trade Execution Log -->
        <div class="glass-card rounded-xl p-5">
          <h3 class="text-sm font-semibold text-white mb-3">🤖 Automated Execution Log</h3>
          <div id="auto-exec-log" class="space-y-2 text-xs text-surface-400 max-h-56 overflow-y-auto">
            <div class="text-surface-500">No automated orders triggered yet.</div>
          </div>
        </div>

        <!-- Session Stats -->
        <div class="glass-card rounded-xl p-5">
          <h3 class="text-sm font-semibold text-white mb-3">📊 Session Stats</h3>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between"><span class="text-surface-500">Ticks Received</span><span class="text-white font-mono" id="stat-ticks">0</span></div>
            <div class="flex justify-between"><span class="text-surface-500">Trades Received</span><span class="text-white font-mono" id="stat-trades">0</span></div>
            <div class="flex justify-between"><span class="text-surface-500">Session High</span><span class="text-profit font-mono" id="stat-high">—</span></div>
            <div class="flex justify-between"><span class="text-surface-500">Session Low</span><span class="text-loss font-mono" id="stat-low">—</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

export function init() {
  let ws = null;
  let tickCount = 0, tradeCount = 0;
  let sessionHigh = -Infinity, sessionLow = Infinity;
  let lastPrice = 97000;
  let selectedSide = 'buy';
  let autoTradeArmed = false;
  let autoTimer = null;
  let latestMcPayload = null;
  const maxRows = 80;

  function quantile(values, p) {
    const sorted = values.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo);
  }

  async function refreshBrokerPill() {
    try {
      const res = await api.getBrokerStatus();
      const pill = document.getElementById('broker-route-pill');
      if (pill) {
        if (res.connected && res.broker) {
          pill.textContent = `${res.broker.name} (${res.broker.account})`;
          pill.className = 'chip chip-green text-xs';
        } else {
          pill.textContent = 'Paper Engine (Link MT5/Exness)';
          pill.className = 'chip chip-blue text-xs';
        }
      }
    } catch {}
  }

  function appendAutoLog(msg, tone = 'info') {
    const log = document.getElementById('auto-exec-log');
    if (!log) return;
    if (log.children.length === 1 && log.children[0].textContent.includes('No automated orders')) {
      log.innerHTML = '';
    }
    const item = document.createElement('div');
    const color = tone === 'buy' ? 'border-profit/30 text-profit' : tone === 'sell' ? 'border-loss/30 text-loss' : 'border-surface-700 text-surface-300';
    item.className = `p-2 rounded bg-surface-800/60 border ${color}`;
    item.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    log.insertBefore(item, log.firstChild);
  }

  async function runMonteCarloAndEvaluate(allowAutoExecute = false) {
    const btn = document.getElementById('mc-run-eval-btn');
    const statusLine = document.getElementById('mc-status-line');
    const interval = document.getElementById('mc-interval')?.value || '5m';
    const direction = document.getElementById('mc-direction')?.value || 'long';
    const targetPct = Number(document.getElementById('mc-target-pct')?.value || 1.5) / 100;
    const stopPct = Number(document.getElementById('mc-stop-pct')?.value || 1.0) / 100;
    const minTargetProb = Number(document.getElementById('mc-min-prob')?.value || 55) / 100;
    const riskAmountUsd = Number(document.getElementById('mc-risk-usd')?.value || 250);

    if (btn) { btn.disabled = true; btn.textContent = 'Simulating...'; }
    if (statusLine) statusLine.textContent = `Fetching Kraken BTC/USD ${interval} candles & simulating 2,000 paths...`;

    try {
      const history = await api.getMarketHistory({ symbol: 'BTCUSDT', interval, limit: 200 });
      const candles = (history.candles || []).filter(c => c.close > 0).sort((a, b) => a.time - b.time);
      if (candles.length < 21) throw new Error('Need at least 21 historical candles.');

      const returns = [];
      for (let i = 1; i < candles.length; i++) {
        returns.push(Math.log(candles[i].close / candles[i - 1].close));
      }

      const spot = lastPrice > 0 && tickCount > 0 ? lastPrice : candles[candles.length - 1].close;
      const horizon = 24;
      const pathCount = 2000;
      const blockLen = 4;
      const targetPrice = direction === 'long' ? spot * (1 + targetPct) : spot * (1 - targetPct);
      const stopPrice = direction === 'long' ? spot * (1 - stopPct) : spot * (1 + stopPct);

      const paths = new Array(pathCount);
      const terminals = new Array(pathCount);
      let targetFirst = 0, stopFirst = 0;

      for (let p = 0; p < pathCount; p++) {
        const path = new Array(horizon + 1);
        path[0] = spot;
        let price = spot, step = 0, hit = 'none';
        while (step < horizon) {
          const start = Math.floor(Math.random() * Math.max(1, returns.length - blockLen + 1));
          for (let k = 0; k < blockLen && step < horizon; k++) {
            price *= Math.exp(returns[start + k]);
            step++;
            path[step] = price;
            if (hit === 'none') {
              const hitT = direction === 'long' ? price >= targetPrice : price <= targetPrice;
              const hitS = direction === 'long' ? price <= stopPrice : price >= stopPrice;
              if (hitT) hit = 'target';
              else if (hitS) hit = 'stop';
            }
          }
        }
        paths[p] = path;
        terminals[p] = price;
        if (hit === 'target') targetFirst++;
        else if (hit === 'stop') stopFirst++;
      }

      const bands = { p05: [], p25: [], p50: [], p75: [], p95: [] };
      const labels = [];
      for (let s = 0; s <= horizon; s++) {
        labels.push(s === 0 ? 'Now' : `+${s}`);
        const slice = paths.map(pt => pt[s]);
        bands.p05.push(Math.round(quantile(slice, 0.05)));
        bands.p25.push(Math.round(quantile(slice, 0.25)));
        bands.p50.push(Math.round(quantile(slice, 0.50)));
        bands.p75.push(Math.round(quantile(slice, 0.75)));
        bands.p95.push(Math.round(quantile(slice, 0.95)));
      }
      createMonteCarloFan('terminal-mc-fan', labels, [bands.p05, bands.p25, bands.p50, bands.p75, bands.p95]);

      const avgTerminal = terminals.reduce((a, b) => a + b, 0) / pathCount;
      const medianTerminal = quantile(terminals, 0.5);
      const targetFirstProb = targetFirst / pathCount;
      const stopFirstProb = stopFirst / pathCount;
      const expectedReturn = direction === 'long' ? (avgTerminal / spot - 1) : (1 - avgTerminal / spot);
      const medianReturn = direction === 'long' ? (medianTerminal / spot - 1) : (1 - medianTerminal / spot);

      await api.saveMcConfig({ minTargetProb, riskAmountUsd, enabled: autoTradeArmed });

      latestMcPayload = {
        symbol: 'BTC/USD',
        spot,
        direction,
        targetFirstProb,
        stopFirstProb,
        expectedReturn,
        medianReturn,
        stopPrice,
        targetPrice,
        execute: allowAutoExecute && autoTradeArmed
      };

      const evalRes = await api.evaluateMcSignal(latestMcPayload);
      const ev = evalRes.evaluation;

      const badge = document.getElementById('mc-signal-badge');
      if (badge) {
        badge.textContent = ev.signal;
        badge.className = `text-base font-bold mt-0.5 ${ev.signal === 'BUY' ? 'text-profit' : ev.signal === 'SELL' ? 'text-loss' : 'text-warn'}`;
      }
      document.getElementById('mc-target-prob').textContent = (ev.targetFirstProb * 100).toFixed(1) + '%';
      document.getElementById('mc-stop-prob').textContent = (ev.stopFirstProb * 100).toFixed(1) + '%';
      document.getElementById('mc-median-price').textContent = '$' + Math.round(medianTerminal).toLocaleString();
      document.getElementById('mc-edge-pct').textContent = (ev.edgePct >= 0 ? '+' : '') + ev.edgePct.toFixed(1) + '%';

      const forceBtn = document.getElementById('mc-force-exec-btn');
      if (ev.qualified) {
        forceBtn?.classList.remove('hidden');
      } else {
        forceBtn?.classList.add('hidden');
      }

      if (evalRes.executedTrades?.length) {
        const t = evalRes.executedTrades[0].trade;
        appendAutoLog(`AUTO ${t.side} ${t.qty} BTC @ $${t.price} → ${t.broker}`, t.side === 'BUY' ? 'buy' : 'sell');
        showToast(`Monte Carlo Auto-Trader executed ${t.side} ${t.qty} BTC!`, 'success');
      } else {
        appendAutoLog(`MC Signal: ${ev.signal} (Edge ${ev.edgePct}%, TargetProb ${(ev.targetFirstProb * 100).toFixed(1)}%)`);
      }

      if (statusLine) {
        statusLine.textContent = `${pathCount.toLocaleString()} paths calibrated from ${candles.length} ${interval} Kraken candles · ${ev.reasons.join(' · ')}`;
      }
    } catch (err) {
      if (statusLine) statusLine.textContent = `Error: ${err.message}`;
      showToast(err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Run MC & Evaluate'; }
    }
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/api/market-data?symbols=BTCUSDT`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => updateStatus('connected');
    ws.onclose = () => { updateStatus('disconnected'); setTimeout(connect, 3000); };
    ws.onerror = () => updateStatus('error');

    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }

      if (data.event === 'price') {
        tickCount++;
        lastPrice = data.price;
        if (data.price > sessionHigh) sessionHigh = data.price;
        if (data.price < sessionLow) sessionLow = data.price;

        const priceEl = document.getElementById('live-price');
        if (priceEl) priceEl.textContent = `$${data.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        const infoEl = document.getElementById('price-info');
        if (infoEl) infoEl.textContent = `${data.provider || 'Kraken Spot'} • ${new Date(data.timestamp).toLocaleTimeString()}`;
        const ticksEl = document.getElementById('stat-ticks');
        if (ticksEl) ticksEl.textContent = tickCount.toLocaleString();
        const highEl = document.getElementById('stat-high');
        if (highEl && sessionHigh < Infinity) highEl.textContent = `$${sessionHigh.toLocaleString()}`;
        const lowEl = document.getElementById('stat-low');
        if (lowEl && sessionLow > -Infinity) lowEl.textContent = `$${sessionLow.toLocaleString()}`;

        if (data.trade_quantity > 0) {
          tradeCount++;
          const trEl = document.getElementById('stat-trades');
          if (trEl) trEl.textContent = tradeCount.toLocaleString();
          addTradeRow(data);
        }
      }

      if (data.event === 'book') {
        const bidEl = document.getElementById('live-bid');
        const askEl = document.getElementById('live-ask');
        const spreadEl = document.getElementById('stat-spread');
        if (bidEl) bidEl.textContent = `$${data.bid.toLocaleString()}`;
        if (askEl) askEl.textContent = `$${data.ask.toLocaleString()}`;
        if (spreadEl) spreadEl.textContent = `$${(data.ask - data.bid).toFixed(2)}`;
      }
    };

    const hb = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: 'ping' }));
    }, 60000);
    return () => clearInterval(hb);
  }

  function updateStatus(status) {
    const dot = document.getElementById('ws-dot');
    const text = document.getElementById('ws-text');
    const colors = { connected: 'bg-profit', connecting: 'bg-warn', disconnected: 'bg-loss', error: 'bg-loss' };
    const labels = { connected: 'Live', connecting: 'Connecting...', disconnected: 'Reconnecting...', error: 'Error' };
    if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${colors[status] || 'bg-surface-500'} animate-pulse`;
    if (text) { text.textContent = labels[status] || status; text.className = `text-xs font-medium ${status === 'connected' ? 'text-profit' : status === 'error' || status === 'disconnected' ? 'text-loss' : 'text-warn'}`; }
  }

  function addTradeRow(data) {
    const tbody = document.getElementById('trade-rows');
    if (!tbody) return;
    if (tbody.children.length === 1 && tbody.children[0].querySelector('td[colspan]')) tbody.innerHTML = '';
    const row = document.createElement('tr');
    const isBuy = !data.buyer_is_maker;
    row.className = 'border-b border-surface-800/30 animate-fade-in';
    row.innerHTML = `
      <td class="py-1.5 text-surface-400">${new Date(data.timestamp).toLocaleTimeString()}</td>
      <td class="py-1.5 text-right ${isBuy ? 'text-profit' : 'text-loss'} font-medium">$${data.price.toLocaleString()}</td>
      <td class="py-1.5 text-right text-surface-300">${(data.trade_quantity || 0).toFixed(4)}</td>
      <td class="py-1.5 text-center"><span class="chip ${isBuy ? 'chip-green' : 'chip-red'}">${isBuy ? 'BUY' : 'SELL'}</span></td>
    `;
    tbody.insertBefore(row, tbody.firstChild);
    while (tbody.children.length > maxRows) tbody.removeChild(tbody.lastChild);
  }

  // Order side toggle
  document.querySelectorAll('.side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedSide = btn.dataset.side;
      document.querySelectorAll('.side-btn').forEach(b => {
        if (b.dataset.side === selectedSide) {
          b.className = `side-btn py-2.5 rounded-lg text-sm font-semibold ${selectedSide === 'buy' ? 'bg-profit/20 text-profit border border-profit/30' : 'bg-loss/20 text-loss border border-loss/30'} transition-colors`;
        } else {
          b.className = 'side-btn py-2.5 rounded-lg text-sm font-semibold bg-surface-800 text-surface-400 border border-surface-700 transition-colors';
        }
      });
    });
  });

  const typeSelect = document.querySelector('select[name="type"]');
  typeSelect?.addEventListener('change', () => {
    document.getElementById('limit-price-field')?.classList.toggle('hidden', typeSelect.value === 'market');
  });

  // Order ticket submission -> /api/copy-trading/execute
  document.getElementById('order-form')?.addEventListener('submit', async (e) => {
    const form = e.target;
    const btn = document.getElementById('submit-order');
    const qty = Number(form.qty.value);
    const orderType = form.type.value;
    const price = orderType === 'limit' && Number(form.price.value) > 0 ? Number(form.price.value) : lastPrice;

    if (btn) btn.disabled = true;
    try {
      const res = await api.executeOrder({
        symbol: 'BTC/USD',
        side: selectedSide.toUpperCase(),
        qty,
        price,
        orderType
      });
      showToast(`Executed ${res.trade.side} ${res.trade.qty} BTC @ $${res.trade.price} (${res.trade.broker})`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // MC Auto-Trade toggle & buttons
  document.getElementById('mc-run-eval-btn')?.addEventListener('click', () => runMonteCarloAndEvaluate(false));

  document.getElementById('mc-arm-btn')?.addEventListener('click', () => {
    autoTradeArmed = !autoTradeArmed;
    const armBtn = document.getElementById('mc-arm-btn');
    if (armBtn) {
      armBtn.textContent = autoTradeArmed ? '🤖 Auto-Trade: ARMED' : '🤖 Auto-Trade: OFF';
      armBtn.className = autoTradeArmed
        ? 'px-4 py-2 rounded-lg text-xs font-semibold bg-profit/20 border border-profit/40 text-profit'
        : 'px-4 py-2 rounded-lg text-xs font-semibold bg-surface-800 border border-surface-700 text-surface-300';
    }
    if (autoTradeArmed) {
      showToast('Monte Carlo Auto-Trader ARMED! Evaluating every 30s.', 'success');
      runMonteCarloAndEvaluate(true);
      autoTimer = setInterval(() => runMonteCarloAndEvaluate(true), 30000);
    } else {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      showToast('Monte Carlo Auto-Trader disarmed.', 'info');
    }
  });

  document.getElementById('mc-force-exec-btn')?.addEventListener('click', async () => {
    if (!latestMcPayload) return;
    try {
      const res = await api.evaluateMcSignal({ ...latestMcPayload, execute: true });
      if (res.executedTrades?.length) {
        const t = res.executedTrades[0].trade;
        appendAutoLog(`MANUAL EXEC ${t.side} ${t.qty} BTC @ $${t.price} → ${t.broker}`, t.side === 'BUY' ? 'buy' : 'sell');
        showToast(`Routed ${t.side} ${t.qty} BTC to ${t.broker}`, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Option pricing Monte Carlo (/api/pricing)
  document.getElementById('run-option-mc-btn')?.addEventListener('click', async () => {
    const el = document.getElementById('mc-result');
    if (!el) return;
    el.innerHTML = 'Running 100,000 antithetic paths...';
    try {
      const spot = lastPrice || 97000;
      const data = await api.runMonteCarlo({
        spot,
        strike: spot * 1.05,
        risk_free_rate: 0.05,
        dividend_yield: 0,
        volatility: 0.65,
        maturity_years: 30 / 365,
        paths: 100000,
        seed: 42,
        backend: 'cpu'
      });
      el.innerHTML = `
        <div class="grid grid-cols-2 gap-2 mt-1">
          <div class="p-2 rounded bg-surface-800/50">
            <div class="text-surface-500">Call</div>
            <div class="font-bold text-profit">$${Number(data.call.price).toFixed(2)}</div>
          </div>
          <div class="p-2 rounded bg-surface-800/50">
            <div class="text-surface-500">Put</div>
            <div class="font-bold text-loss">$${Number(data.put.price).toFixed(2)}</div>
          </div>
          <div class="p-2 rounded bg-surface-800/50">
            <div class="text-surface-500">Paths</div>
            <div class="font-bold text-white">${Number(data.paths).toLocaleString()}</div>
          </div>
          <div class="p-2 rounded bg-surface-800/50">
            <div class="text-surface-500">Elapsed</div>
            <div class="font-bold text-brand-400">${Number(data.elapsed_ms).toFixed(1)}ms</div>
          </div>
        </div>`;
    } catch (err) {
      el.innerHTML = `<span class="text-loss">${err.message}</span>`;
    }
  });

  refreshBrokerPill();
  const cleanupHb = connect();

  return () => {
    if (ws) { ws.onclose = null; ws.close(); }
    if (autoTimer) clearInterval(autoTimer);
    cleanupHb?.();
    destroyAllCharts();
  };
}
