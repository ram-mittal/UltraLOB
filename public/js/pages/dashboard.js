// Dashboard Page (Live API-backed portfolio, copy subscriptions & trade management)
import { createEquityCurve, createDonutChart, destroyAllCharts } from '../components/charts.js';
import { api } from '../api.js';
import { showToast } from '../app.js';

export function render() {
  return `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10" id="dashboard-root">
    <div class="flex items-center justify-center min-h-[50vh]">
      <div class="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  </div>`;
}

function renderDashboardHTML(data) {
  const p = data.summary;
  const subs = data.subscriptions || [];
  const trades = data.trades || [];
  const broker = data.broker;
  const pnlClass = p.total_pnl >= 0 ? 'text-profit' : 'text-loss';

  return `
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl font-bold text-white mb-1">Copy Trading Dashboard</h1>
        <p class="text-sm text-surface-400">
          ${broker
            ? `Broker Connected: <span class="text-profit font-medium">${broker.name} (${broker.account})</span>`
            : `Execution Mode: <span class="text-brand-300 font-medium">Paper Demo Engine</span> • <a href="#/broker" class="underline hover:text-white">Link MT5 / Exness</a>`}
        </p>
      </div>
      <div class="flex gap-3">
        <a href="#/terminal" class="btn-outline px-4 py-2 rounded-lg text-sm font-medium text-white">🎲 MC Auto-Trader</a>
        <a href="#/marketplace" class="btn-outline px-4 py-2 rounded-lg text-sm font-medium text-white">+ Add Strategy</a>
        <a href="#/broker" class="btn-primary px-4 py-2 rounded-lg text-sm font-medium text-white">${broker ? 'Broker Settings' : 'Connect Broker'}</a>
      </div>
    </div>

    <!-- Portfolio Summary -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-500 mb-1">Balance</div>
        <div class="text-lg font-bold text-white">$${p.balance.toLocaleString()}</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-500 mb-1">Equity</div>
        <div class="text-lg font-bold text-white">$${p.equity.toLocaleString()}</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-500 mb-1">Unrealized P&L</div>
        <div class="text-lg font-bold ${p.unrealized_pnl >= 0 ? 'text-profit' : 'text-loss'}">
          ${p.unrealized_pnl >= 0 ? '+' : ''}$${p.unrealized_pnl.toLocaleString()}
        </div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-500 mb-1">Total P&L</div>
        <div class="text-lg font-bold ${pnlClass}">
          ${p.total_pnl >= 0 ? '+' : ''}$${p.total_pnl.toLocaleString()} <span class="text-xs opacity-75">(${p.total_pnl >= 0 ? '+' : ''}${p.pnl_percent}%)</span>
        </div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-500 mb-1">Active Copies</div>
        <div class="text-lg font-bold text-brand-400">${p.active_copies}</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-500 mb-1">Win Rate</div>
        <div class="text-lg font-bold text-white">${p.win_rate_today}% <span class="text-xs text-surface-400">(${p.total_trades_today} trades)</span></div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="grid lg:grid-cols-3 gap-6 mb-8">
      <div class="glass-card rounded-xl p-6 lg:col-span-2">
        <h3 class="text-sm font-semibold text-white mb-4">📈 Portfolio Equity Curve</h3>
        <div class="h-64"><canvas id="dash-equity"></canvas></div>
      </div>
      <div class="glass-card rounded-xl p-6">
        <h3 class="text-sm font-semibold text-white mb-4">🎯 Capital Allocation</h3>
        <div class="h-64"><canvas id="dash-allocation"></canvas></div>
      </div>
    </div>

    <!-- Active Copies -->
    <div class="glass-card rounded-xl p-6 mb-8">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold text-white">🤖 Subscribed Copy Strategies</h3>
        <a href="#/marketplace" class="text-xs text-brand-400 hover:text-brand-300">+ Browse Marketplace</a>
      </div>
      ${subs.length ? `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-800">
              <th class="text-left text-xs text-surface-500 pb-3 font-medium">Strategy</th>
              <th class="text-right text-xs text-surface-500 pb-3 font-medium">Allocation</th>
              <th class="text-right text-xs text-surface-500 pb-3 font-medium">Lot Mult</th>
              <th class="text-right text-xs text-surface-500 pb-3 font-medium">P&L</th>
              <th class="text-right text-xs text-surface-500 pb-3 font-medium">Trades</th>
              <th class="text-center text-xs text-surface-500 pb-3 font-medium">Status</th>
              <th class="text-right text-xs text-surface-500 pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${subs.map(c => `
              <tr class="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors">
                <td class="py-3">
                  <a href="#/strategy/${c.strategyId}" class="flex items-center gap-2 hover:text-brand-300 transition-colors">
                    <span>${c.icon || '📈'}</span>
                    <span class="font-medium text-white">${c.strategyName}</span>
                  </a>
                </td>
                <td class="py-3 text-right text-surface-300">$${Number(c.allocation).toLocaleString()}</td>
                <td class="py-3 text-right text-surface-400 font-mono">${c.lotMultiplier || 1.0}x</td>
                <td class="py-3 text-right ${c.pnl >= 0 ? 'text-profit' : 'text-loss'} font-medium">
                  ${c.pnl >= 0 ? '+' : ''}$${Number(c.pnl).toFixed(2)}
                </td>
                <td class="py-3 text-right text-surface-300">${c.trades}</td>
                <td class="py-3 text-center">
                  <span class="chip ${c.status === 'active' ? 'chip-green' : 'chip-yellow'} text-xs">
                    ${c.status === 'active' ? '● active' : '⏸ paused'}
                  </span>
                </td>
                <td class="py-3 text-right space-x-2">
                  <button onclick="window.__toggleCopy?.('${c.strategyId}')"
                          class="text-xs text-surface-300 hover:text-white px-2 py-1 rounded border border-surface-700">
                    ${c.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                  <button onclick="window.__stopCopy?.('${c.strategyId}')"
                          class="text-xs text-surface-400 hover:text-loss px-2 py-1 rounded border border-surface-700 hover:border-loss/50">
                    Stop
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : `<div class="text-sm text-surface-500 py-6 text-center">No active copy subscriptions. <a href="#/marketplace" class="text-brand-400 underline">Choose a strategy</a> to begin.</div>`}
    </div>

    <!-- Recent Trades -->
    <div class="glass-card rounded-xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold text-white">📋 Execution & Copy Trade History</h3>
        <span class="text-xs text-surface-500">Showing latest ${trades.length} orders</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-800">
              <th class="text-left text-xs text-surface-500 pb-3 font-medium">Time</th>
              <th class="text-left text-xs text-surface-500 pb-3 font-medium">Strategy / Source</th>
              <th class="text-left text-xs text-surface-500 pb-3 font-medium">Broker</th>
              <th class="text-left text-xs text-surface-500 pb-3 font-medium">Symbol</th>
              <th class="text-center text-xs text-surface-500 pb-3 font-medium">Side</th>
              <th class="text-right text-xs text-surface-500 pb-3 font-medium">Qty</th>
              <th class="text-right text-xs text-surface-500 pb-3 font-medium">Price</th>
              <th class="text-right text-xs text-surface-500 pb-3 font-medium">P&L</th>
              <th class="text-center text-xs text-surface-500 pb-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            ${trades.map(t => `
              <tr class="border-b border-surface-800/50 hover:bg-surface-800/30 transition-colors">
                <td class="py-2.5 font-mono text-xs text-surface-400">${t.time}</td>
                <td class="py-2.5 text-surface-300">${t.strategy} <span class="text-xs text-surface-500">(${t.source || 'EA'})</span></td>
                <td class="py-2.5 text-xs text-surface-400">${t.broker || 'Paper'}</td>
                <td class="py-2.5 text-white font-medium">${t.symbol}</td>
                <td class="py-2.5 text-center"><span class="chip ${t.side === 'BUY' ? 'chip-green' : 'chip-red'} text-xs">${t.side}</span></td>
                <td class="py-2.5 text-right font-mono text-surface-300">${t.qty}</td>
                <td class="py-2.5 text-right font-mono text-white">$${Number(t.price).toLocaleString()}</td>
                <td class="py-2.5 text-right font-medium ${t.pnl === null ? 'text-surface-500' : t.pnl >= 0 ? 'text-profit' : 'text-loss'}">
                  ${t.pnl === null ? '—' : (t.pnl >= 0 ? '+' : '') + '$' + Number(t.pnl).toFixed(2)}
                </td>
                <td class="py-2.5 text-center">
                  ${t.status === 'open'
                    ? `<button onclick="window.__closeTrade?.('${t.id}', ${t.price})" class="chip chip-blue text-xs hover:opacity-80">Close</button>`
                    : `<span class="chip chip-green text-xs">closed</span>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

export async function init() {
  const root = document.getElementById('dashboard-root');
  if (!root) return;

  async function refresh() {
    try {
      const data = await api.getPortfolio();
      root.innerHTML = renderDashboardHTML(data);

      const eqLabels = (data.equityHistory || []).map(p => p.label);
      const eqData = (data.equityHistory || []).map(p => p.value);
      const subs = data.subscriptions || [];

      setTimeout(() => {
        if (eqLabels.length) createEquityCurve('dash-equity', eqLabels, eqData);
        if (subs.length) {
          createDonutChart(
            'dash-allocation',
            subs.map(c => c.strategyName),
            subs.map(c => c.allocation),
            ['#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#ec4899']
          );
        }
      }, 50);
    } catch (err) {
      root.innerHTML = `<div class="p-8 text-center text-loss">Failed to load dashboard: ${err.message}</div>`;
    }
  }

  window.__toggleCopy = async (strategyId) => {
    try {
      await api.toggleCopy(strategyId);
      showToast('Strategy copy state updated.', 'info');
      await refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.__stopCopy = async (strategyId) => {
    try {
      await api.unsubscribe(strategyId);
      showToast('Stopped copying strategy.', 'info');
      await refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.__closeTrade = async (tradeId, fallbackPrice) => {
    try {
      await api.closeTrade(tradeId, fallbackPrice);
      showToast('Position closed.', 'success');
      await refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  await refresh();

  return () => {
    destroyAllCharts();
    delete window.__toggleCopy;
    delete window.__stopCopy;
    delete window.__closeTrade;
  };
}
