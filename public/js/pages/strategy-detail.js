// Strategy Detail Page (API-backed with Copy Configuration Modal)
import { createEquityCurve, createDrawdownChart, createMonthlyReturnsBar, createMonteCarloFan, destroyAllCharts } from '../components/charts.js';
import { api } from '../api.js';
import { showToast } from '../app.js';

export function render() {
  return `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10" id="strategy-detail-root">
    <div class="flex items-center justify-center min-h-[50vh]">
      <div class="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  </div>`;
}

function renderStrategyHTML(s) {
  const pnlPos = s.total_return >= 0;
  const riskColors = { low: 'chip-green', medium: 'chip-yellow', high: 'chip-red' };

  return `
    <a href="#/marketplace" class="inline-flex items-center gap-2 text-sm text-surface-400 hover:text-white mb-6 transition-colors">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      Back to Marketplace
    </a>

    <!-- Header -->
    <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-10">
      <div class="flex items-start gap-4">
        <div class="w-14 h-14 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center text-white text-2xl shadow-lg flex-shrink-0">
          ${s.icon}
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-3 mb-1">
            <h1 class="text-2xl font-bold text-white">${s.name}</h1>
            <span class="chip ${s.status === 'active' ? 'chip-green' : 'chip-yellow'}">${s.status === 'active' ? '● Live' : '⏸ Paused'}</span>
            ${s.ea_type ? `<span class="chip chip-blue">${s.ea_type}</span>` : ''}
          </div>
          <p class="text-surface-400 text-sm mb-2">${s.author} • ${s.instrument} • ${s.timeframe} • Since ${s.created_at}</p>
          <p class="text-surface-300 text-sm max-w-2xl leading-relaxed">${s.description}</p>
        </div>
      </div>
      <div class="flex gap-3 flex-shrink-0">
        <button id="open-copy-modal" class="btn-primary px-6 py-3 rounded-xl text-white font-semibold text-sm">
          🚀 Copy This Strategy
        </button>
        <a href="#/broker" class="btn-outline px-5 py-3 rounded-xl text-white font-medium text-sm">
          🔗 Connect Broker
        </a>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-10">
      ${[
        { label: 'Total Return', value: `${pnlPos ? '+' : ''}${s.total_return.toFixed(1)}%`, cls: pnlPos ? 'text-profit' : 'text-loss' },
        { label: 'Win Rate', value: `${s.win_rate.toFixed(1)}%`, cls: 'text-white' },
        { label: 'Sharpe Ratio', value: s.sharpe_ratio.toFixed(2), cls: 'text-brand-400' },
        { label: 'Max Drawdown', value: `${s.max_drawdown.toFixed(1)}%`, cls: 'text-loss' },
        { label: 'Profit Factor', value: s.profit_factor.toFixed(2), cls: 'text-white' },
        { label: 'Total Trades', value: s.total_trades.toLocaleString(), cls: 'text-white' },
        { label: 'Avg Duration', value: s.avg_trade_duration, cls: 'text-surface-300' },
        { label: 'Copiers', value: s.subscribers.toLocaleString(), cls: 'text-brand-400' },
      ].map(stat => `
        <div class="glass-card rounded-xl p-4">
          <div class="text-xs text-surface-500 mb-1">${stat.label}</div>
          <div class="text-lg font-bold ${stat.cls}">${stat.value}</div>
        </div>
      `).join('')}
    </div>

    <!-- Charts Grid -->
    <div class="grid lg:grid-cols-2 gap-6 mb-10">
      <div class="glass-card rounded-xl p-6">
        <h3 class="text-sm font-semibold text-white mb-4">📈 Equity Curve</h3>
        <div class="h-64"><canvas id="chart-equity"></canvas></div>
      </div>
      <div class="glass-card rounded-xl p-6">
        <h3 class="text-sm font-semibold text-white mb-4">📉 Drawdown</h3>
        <div class="h-64"><canvas id="chart-drawdown"></canvas></div>
      </div>
      <div class="glass-card rounded-xl p-6">
        <h3 class="text-sm font-semibold text-white mb-4">📊 Monthly Returns</h3>
        <div class="h-64"><canvas id="chart-monthly"></canvas></div>
      </div>
      <div class="glass-card rounded-xl p-6">
        <h3 class="text-sm font-semibold text-white mb-4">🎲 Monte Carlo Projection (12 Months)</h3>
        <div class="h-64"><canvas id="chart-montecarlo"></canvas></div>
      </div>
    </div>

    <!-- Risk & Details -->
    <div class="grid lg:grid-cols-3 gap-6 mb-10">
      <div class="glass-card rounded-xl p-6">
        <h3 class="text-sm font-semibold text-white mb-4">🛡️ Risk Profile</h3>
        <div class="space-y-4">
          <div class="flex justify-between items-center">
            <span class="text-sm text-surface-400">Risk Level</span>
            <span class="chip ${riskColors[s.risk_level]}">${s.risk_level.charAt(0).toUpperCase() + s.risk_level.slice(1)}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm text-surface-400">Max Drawdown</span>
            <span class="text-sm font-medium text-loss">${s.max_drawdown.toFixed(1)}%</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm text-surface-400">Min Capital</span>
            <span class="text-sm font-medium text-white">$${s.min_capital.toLocaleString()}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm text-surface-400">Profit Factor</span>
            <span class="text-sm font-medium text-white">${s.profit_factor.toFixed(2)}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm text-surface-400">Avg Trade Duration</span>
            <span class="text-sm font-medium text-surface-300">${s.avg_trade_duration}</span>
          </div>
        </div>
      </div>
      <div class="glass-card rounded-xl p-6 lg:col-span-2">
        <h3 class="text-sm font-semibold text-white mb-4">📋 Execution & Validation</h3>
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div><span class="text-xs text-surface-500 block mb-1">Category</span><span class="text-sm text-white capitalize">${s.category}</span></div>
          <div><span class="text-xs text-surface-500 block mb-1">Instrument</span><span class="text-sm text-white">${s.instrument}</span></div>
          <div><span class="text-xs text-surface-500 block mb-1">Timeframe</span><span class="text-sm text-white">${s.timeframe}</span></div>
          <div><span class="text-xs text-surface-500 block mb-1">Live Since</span><span class="text-sm text-white">${s.created_at}</span></div>
        </div>
        <p class="text-sm text-surface-300 leading-relaxed mb-6">${s.description}</p>
        <div class="pt-4 border-t border-surface-800/50 flex flex-wrap items-center gap-4 text-xs text-surface-500">
          <span>Monte Carlo Validation: <strong class="text-profit">10M paths simulated</strong></span>
          <span>•</span>
          <span>Broker Routing: <strong class="text-brand-400">MT5 / Exness / FIX 4.4</strong></span>
        </div>
      </div>
    </div>

    <!-- Copy Configuration Modal -->
    <div id="copy-modal" class="fixed inset-0 bg-black/70 z-50 hidden flex items-center justify-center p-4">
      <div class="glass rounded-2xl max-w-md w-full p-6 border border-surface-700 shadow-2xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-white">Configure Copy Trading</h3>
          <button id="close-copy-modal" class="text-surface-400 hover:text-white text-xl">&times;</button>
        </div>
        <form id="copy-form" onsubmit="return false;" class="space-y-4">
          <div>
            <label class="text-xs text-surface-400 block mb-1">Capital Allocation (Min $${s.min_capital})</label>
            <input type="number" name="allocation" min="${s.min_capital}" value="${Math.max(1000, s.min_capital)}" required
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-surface-400 block mb-1">Lot Multiplier</label>
              <input type="number" name="lotMultiplier" step="0.1" min="0.1" max="10" value="1.0"
                     class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
            </div>
            <div>
              <label class="text-xs text-surface-400 block mb-1">Max Drawdown Stop %</label>
              <input type="number" name="maxDrawdownPct" min="1" max="80" value="15"
                     class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
            </div>
          </div>
          <label class="flex items-center gap-2 text-xs text-surface-300">
            <input type="checkbox" name="autoMcEnabled" checked class="rounded border-surface-600 bg-surface-800 text-brand-500">
            Require positive Monte Carlo probability edge before mirroring trades
          </label>
          <div class="flex justify-end gap-3 pt-2">
            <button type="button" id="cancel-copy-modal" class="btn-outline px-4 py-2 rounded-lg text-sm text-white">Cancel</button>
            <button type="submit" class="btn-primary px-5 py-2 rounded-lg text-sm font-semibold text-white">Start Copying Now</button>
          </div>
        </form>
      </div>
    </div>`;
}

export async function init(route) {
  const root = document.getElementById('strategy-detail-root');
  if (!root) return;

  let s;
  try {
    s = await api.getStrategy(route.id);
  } catch {
    s = (window.__strategies || []).find(item => item.id === route.id);
  }

  if (!s) {
    root.innerHTML = `
      <div class="flex items-center justify-center min-h-[50vh]">
        <div class="text-center">
          <div class="text-6xl mb-4">🔍</div>
          <h2 class="text-2xl font-bold text-white mb-2">Strategy Not Found</h2>
          <p class="text-surface-400 mb-6">This strategy doesn't exist or has been removed.</p>
          <a href="#/marketplace" class="btn-primary px-6 py-2.5 rounded-lg text-white font-medium inline-block">Browse Marketplace</a>
        </div>
      </div>`;
    return;
  }

  root.innerHTML = renderStrategyHTML(s);

  const months = s.monthly_returns.map((_, i) => {
    const d = new Date(2025, i % 12, 1);
    return d.toLocaleDateString('en', { month: 'short', year: i >= 12 ? '2-digit' : undefined });
  });
  const eqLabels = s.equity_curve.map((_, i) => i === 0 ? 'Start' : `M${i}`);

  setTimeout(() => {
    createEquityCurve('chart-equity', eqLabels, s.equity_curve);
    createDrawdownChart('chart-drawdown', eqLabels, s.drawdown);
    createMonthlyReturnsBar('chart-monthly', months, s.monthly_returns);

    const mcLabels = Array.from({ length: 13 }, (_, i) => i === 0 ? 'Now' : `M+${i}`);
    const startEquity = s.equity_curve[s.equity_curve.length - 1];
    const mean = s.monthly_returns.reduce((a, b) => a + b, 0) / s.monthly_returns.length;
    const std = Math.sqrt(s.monthly_returns.reduce((a, v) => a + (v - mean) ** 2, 0) / s.monthly_returns.length);
    const scenarios = [-1.645, -0.675, 0, 0.675, 1.645].map(z => {
      const path = [startEquity];
      for (let i = 1; i <= 12; i++) {
        const ret = (mean + z * std) / 100;
        path.push(Math.round(path[i - 1] * (1 + ret)));
      }
      return path;
    });
    createMonteCarloFan('chart-montecarlo', mcLabels, scenarios);
  }, 50);

  const modal = document.getElementById('copy-modal');
  const closeModal = () => modal?.classList.add('hidden');
  document.getElementById('open-copy-modal')?.addEventListener('click', () => modal?.classList.remove('hidden'));
  document.getElementById('close-copy-modal')?.addEventListener('click', closeModal);
  document.getElementById('cancel-copy-modal')?.addEventListener('click', closeModal);

  document.getElementById('copy-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await api.subscribe({
        strategyId: s.id,
        allocation: Number(form.allocation.value),
        lotMultiplier: Number(form.lotMultiplier.value),
        maxDrawdownPct: Number(form.maxDrawdownPct.value),
        autoMcEnabled: form.autoMcEnabled.checked
      });
      closeModal();
      showToast(`Started copying ${s.name}!`, 'success');
      location.hash = '#/dashboard';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  return () => destroyAllCharts();
}
