// Strategy Detail Page — Rule Spec, Lifecycle Gates, Honest Provenance & Risk-Normalized Copy Config
import { createEquityCurve, createDrawdownChart, createMonthlyReturnsBar, destroyAllCharts } from '../components/charts.js';
import { getLifecycleBadge } from '../components/strategy-card.js';
import { api } from '../api.js';
import { showToast } from '../app.js';

const LIFECYCLE_STAGES = ['RESEARCH', 'BACKTESTED', 'FORWARD_TESTING', 'LIVE_PILOT', 'VERIFIED_LIVE'];

function fmt(val, suffix = '%', digits = 1, signed = false) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return 'Pending Backtest';
  const n = Number(val);
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(digits)}${suffix}`;
}

function renderStrategyHTML(s) {
  const lifecycle = getLifecycleBadge(s.lifecycle_status);
  const currentIdx = Math.max(0, LIFECYCLE_STAGES.indexOf(s.lifecycle_status));
  const riskColors = { low: 'chip-green', medium: 'chip-yellow', high: 'chip-red' };
  const hasCurves = Array.isArray(s.equity_curve) && s.equity_curve.length > 0;
  const costs = s.cost_slippage_assumptions || {};

  return `
    <a href="#/marketplace" class="inline-flex items-center gap-2 text-sm text-surface-400 hover:text-white mb-6 transition-colors">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      Back to Strategy Registry
    </a>

    <!-- Header -->
    <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8">
      <div class="flex items-start gap-4">
        <div class="w-14 h-14 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center text-white text-2xl shadow-lg flex-shrink-0">
          ${s.icon || '📐'}
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-2.5 mb-1">
            <span class="font-mono text-xs px-2 py-0.5 rounded bg-surface-800 text-brand-300 border border-surface-700">${s.code || s.id} v${s.version || '1.0.0'}</span>
            <h1 class="text-2xl font-bold text-white">${s.name}</h1>
            <span class="chip ${lifecycle.cls}">${lifecycle.label}</span>
          </div>
          <p class="text-surface-400 text-sm mb-2">${s.author} • ${s.instrument} • ${s.timeframe} • Data Origin: <span class="font-mono text-surface-200">${s.data_source_label || s.lifecycle_status}</span></p>
          <p class="text-surface-300 text-sm max-w-3xl leading-relaxed">${s.description}</p>
        </div>
      </div>
      <div class="flex gap-3 flex-shrink-0">
        <button id="open-copy-modal" class="btn-primary px-5 py-2.5 rounded-xl text-white font-semibold text-xs">
          ${s.lifecycle_status === 'RESEARCH' ? '📌 Configure Watch Mandate' : '🚀 Allocate Capital'}
        </button>
        <a href="#/broker" class="btn-outline px-4 py-2.5 rounded-xl text-white font-medium text-xs">
          🔗 Connect MT5 Demo
        </a>
      </div>
    </div>

    <!-- Lifecycle Gate Stepper -->
    <div class="glass-card rounded-xl p-5 mb-8">
      <div class="text-xs text-surface-400 font-semibold uppercase tracking-wider mb-3">Strategy Lifecycle Progression</div>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
        ${LIFECYCLE_STAGES.map((stage, i) => `
          <div class="p-2.5 rounded-lg border text-xs ${i === currentIdx ? 'border-brand-500 bg-brand-500/15 text-white font-semibold' : i < currentIdx ? 'border-profit/40 bg-profit/10 text-profit' : 'border-surface-800 bg-surface-900/50 text-surface-500'}">
            <div class="font-mono text-[10px] opacity-75">STAGE ${i + 1}</div>
            <div>${stage.replace('_', ' ')}</div>
          </div>
        `).join('')}
      </div>
      ${s.status_note ? `<p class="text-xs text-warn mt-3">${s.status_note}</p>` : ''}
    </div>

    <!-- Empirical Metrics Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
      ${[
        { label: 'Total Return', value: fmt(s.total_return, '%', 1, true) },
        { label: 'CAGR', value: fmt(s.cagr, '%', 1, true) },
        { label: 'Sharpe Ratio', value: fmt(s.sharpe_ratio, '', 2) },
        { label: 'Sortino Ratio', value: fmt(s.sortino_ratio, '', 2) },
        { label: 'Max Drawdown', value: fmt(s.max_drawdown, '%', 1) },
        { label: 'Profit Factor', value: fmt(s.profit_factor, '', 2) },
        { label: 'Win Rate', value: fmt(s.win_rate, '%', 1) },
        { label: 'Expectancy', value: fmt(s.expectancy, ' R', 2) },
        { label: 'Risk / Trade', value: `${s.risk_per_trade_pct ?? 0.5}%` },
        { label: 'Total Trades', value: s.total_trades ? s.total_trades.toLocaleString() : '0 (Pending)' },
        { label: 'Risk of Ruin', value: fmt(s.risk_of_ruin, '%', 2) },
        { label: 'Capacity Limit', value: s.capacity_limit_usd ? `$${(s.capacity_limit_usd / 1e6).toFixed(1)}M` : 'TBD' },
      ].map(stat => `
        <div class="glass-card rounded-xl p-4">
          <div class="text-[11px] text-surface-500 mb-1">${stat.label}</div>
          <div class="text-sm font-bold text-white font-mono">${stat.value}</div>
        </div>
      `).join('')}
    </div>

    <!-- Performance Charts OR Honest Awaiting-Backtest State -->
    <div class="grid lg:grid-cols-2 gap-6 mb-8">
      <div class="glass-card rounded-xl p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold text-white">📈 Equity Curve</h3>
          <span class="text-[11px] font-mono text-surface-500">${hasCurves ? s.data_source_label : 'NO BACKTEST DATA'}</span>
        </div>
        ${hasCurves
          ? '<div class="h-60"><canvas id="chart-equity"></canvas></div>'
          : '<div class="h-48 rounded-xl border border-dashed border-surface-700 flex flex-col items-center justify-center text-center p-6 text-xs text-surface-400">No historical backtest or confirmed broker equity curve available yet.<br><span class="text-surface-500 mt-1">Populated in Phase 2 when Python OHLCV backtests run with transaction costs.</span></div>'}
      </div>
      <div class="glass-card rounded-xl p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold text-white">📉 Drawdown & Monthly Distribution</h3>
          <span class="text-[11px] font-mono text-surface-500">${hasCurves ? s.data_source_label : 'NO BACKTEST DATA'}</span>
        </div>
        ${hasCurves
          ? '<div class="h-60"><canvas id="chart-drawdown"></canvas></div>'
          : '<div class="h-48 rounded-xl border border-dashed border-surface-700 flex flex-col items-center justify-center text-center p-6 text-xs text-surface-400">Drawdown and monthly return distribution remain blank until empirical trade logs are generated.<br><span class="text-surface-500 mt-1">Out-of-sample, walk-forward, and Monte Carlo stress metrics attach here.</span></div>'}
      </div>
    </div>

    <!-- Quantitative Rule & Execution Specification -->
    <div class="grid lg:grid-cols-3 gap-6 mb-10">
      <div class="glass-card rounded-xl p-6">
        <h3 class="text-sm font-semibold text-white mb-4">🛡️ Risk & Cost Assumptions</h3>
        <div class="space-y-3 text-xs">
          <div class="flex justify-between"><span class="text-surface-400">Risk Rating</span><span class="chip ${riskColors[s.risk_level]}">${s.risk_level}</span></div>
          <div class="flex justify-between"><span class="text-surface-400">Min Allocation</span><span class="text-white font-mono">$${Number(s.min_capital || 1000).toLocaleString()}</span></div>
          <div class="flex justify-between"><span class="text-surface-400">Position Sizing</span><span class="text-surface-200 text-right max-w-[60%]">${s.position_sizing_methodology || 'Risk-normalized'}</span></div>
          <div class="flex justify-between"><span class="text-surface-400">Assumed Spread</span><span class="text-white font-mono">${costs.spread_points_assumed ?? '—'} pts</span></div>
          <div class="flex justify-between"><span class="text-surface-400">Assumed Slippage</span><span class="text-white font-mono">${costs.slippage_points_assumed ?? '—'} pts</span></div>
          <div class="flex justify-between"><span class="text-surface-400">Commission / Lot</span><span class="text-white font-mono">$${costs.commission_per_lot_usd ?? '—'}</span></div>
          ${costs.volume_source_disclosure ? `<div class="pt-2 border-t border-surface-800 text-warn">${costs.volume_source_disclosure}</div>` : ''}
        </div>
      </div>

      <div class="glass-card rounded-xl p-6 lg:col-span-2 space-y-4">
        <h3 class="text-sm font-semibold text-white">📋 Quantitative Rule Specification</h3>
        <div class="grid sm:grid-cols-2 gap-4 text-xs">
          <div class="p-3 rounded-lg bg-surface-900/60 border border-surface-800">
            <div class="text-surface-500 uppercase tracking-wider text-[10px] mb-1">Entry Logic</div>
            <p class="text-surface-200 leading-relaxed">${s.entry_logic || 'Specified in quantitative module.'}</p>
          </div>
          <div class="p-3 rounded-lg bg-surface-900/60 border border-surface-800">
            <div class="text-surface-500 uppercase tracking-wider text-[10px] mb-1">Exit Logic</div>
            <p class="text-surface-200 leading-relaxed">${s.exit_logic || 'Specified in quantitative module.'}</p>
          </div>
          <div class="p-3 rounded-lg bg-surface-900/60 border border-surface-800">
            <div class="text-surface-500 uppercase tracking-wider text-[10px] mb-1">Stop-Loss Methodology</div>
            <p class="text-surface-200 leading-relaxed">${s.stop_loss_methodology || 'Structural + ATR invalidation'}</p>
          </div>
          <div class="p-3 rounded-lg bg-surface-900/60 border border-surface-800">
            <div class="text-surface-500 uppercase tracking-wider text-[10px] mb-1">Take-Profit Methodology</div>
            <p class="text-surface-200 leading-relaxed">${s.take_profit_methodology || 'Dynamic structural targets'}</p>
          </div>
        </div>
        <div class="text-xs text-surface-400">
          Supported Brokers: <span class="text-white font-mono">${(s.supported_brokers || ['MT5 Demo']).join(', ')}</span>
        </div>
      </div>
    </div>

    <!-- Risk-Normalized Copy / Mandate Modal -->
    <div id="copy-modal" class="fixed inset-0 bg-black/70 z-50 hidden flex items-center justify-center p-4">
      <div class="glass rounded-2xl max-w-md w-full p-6 border border-surface-700 shadow-2xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-white">Risk-Normalized Allocation</h3>
          <button id="close-copy-modal" class="text-surface-400 hover:text-white text-xl">&times;</button>
        </div>
        ${s.lifecycle_status === 'RESEARCH' ? `
          <div class="mb-4 p-3 rounded-lg bg-warn-bg border border-warn/30 text-xs text-warn">
            This strategy is in <strong>RESEARCH</strong> stage. Mandates are saved in watch-only mode; automated execution stays blocked until backtest validation passes.
          </div>` : ''}
        <form id="copy-form" onsubmit="return false;" class="space-y-4">
          <div>
            <label class="text-xs text-surface-400 block mb-1">Capital Allocation USD (Min $${s.min_capital})</label>
            <input type="number" name="allocation" min="${s.min_capital}" value="${Math.max(1000, s.min_capital)}" required
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-surface-400 block mb-1">Risk / Trade (%)</label>
              <input type="number" name="riskPerTradePct" step="0.05" min="0.05" max="2.0" value="${s.risk_per_trade_pct ?? 0.5}"
                     class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
            </div>
            <div>
              <label class="text-xs text-surface-400 block mb-1">Max Drawdown Limit (%)</label>
              <input type="number" name="maxDrawdownPct" min="1" max="25" value="10"
                     class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
            </div>
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Allocation Method</label>
            <select name="allocationMethod" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="RISK_NORMALIZED">Risk-Normalized Sizing</option>
              <option value="VOLATILITY_ADJUSTED">Volatility-Adjusted</option>
              <option value="EQUAL_RISK_CONTRIBUTION">Equal Risk Contribution</option>
              <option value="FIXED">Fixed Capital Fraction</option>
            </select>
          </div>
          <div class="flex justify-end gap-3 pt-2">
            <button type="button" id="cancel-copy-modal" class="btn-outline px-4 py-2 rounded-lg text-sm text-white">Cancel</button>
            <button type="submit" class="btn-primary px-5 py-2 rounded-lg text-sm font-semibold text-white">Save Allocation</button>
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
          <div class="text-5xl mb-4">🔍</div>
          <h2 class="text-2xl font-bold text-white mb-2">Strategy Not Found</h2>
          <a href="#/marketplace" class="btn-primary px-6 py-2.5 rounded-lg text-white font-medium inline-block mt-4">Browse Registry</a>
        </div>
      </div>`;
    return;
  }

  // Fetch any completed research/backtest runs for honest Due Diligence display
  const btData = await api.getBacktests(s.id).catch(() => ({ backtests: [] }));
  const latestBt = btData.backtests?.[0] || null;
  if (latestBt && latestBt.data_origin === 'REAL_MARKET' && s.total_return == null) {
    const m = latestBt.metrics || latestBt;
    s.total_return = m.total_return_pct ?? s.total_return;
    s.cagr = m.cagr_pct ?? s.cagr;
    s.sharpe_ratio = m.sharpe_ratio ?? s.sharpe_ratio;
    s.sortino_ratio = m.sortino_ratio ?? s.sortino_ratio;
    s.max_drawdown = m.max_drawdown_pct ?? s.max_drawdown;
    s.profit_factor = m.profit_factor ?? s.profit_factor;
    s.win_rate = m.win_rate_pct ?? s.win_rate;
    s.expectancy = m.expectancy_r ?? s.expectancy;
    s.total_trades = m.total_trades ?? s.total_trades;
    s.risk_of_ruin = m.risk_of_ruin_pct ?? s.risk_of_ruin;
    s.equity_curve = latestBt.equity_curve || s.equity_curve;
    s.drawdown = latestBt.drawdown_series || s.drawdown;
  }

  root.innerHTML = renderStrategyHTML(s);

  if (Array.isArray(s.equity_curve) && s.equity_curve.length > 0) {
    const eqLabels = s.equity_curve.map((_, i) => i === 0 ? 'Start' : `T${i}`);
    setTimeout(() => {
      createEquityCurve('chart-equity', eqLabels, s.equity_curve);
      if (s.drawdown?.length) createDrawdownChart('chart-drawdown', eqLabels, s.drawdown);
    }, 50);
  }

  const modal = document.getElementById('copy-modal');
  const closeModal = () => modal?.classList.add('hidden');
  document.getElementById('open-copy-modal')?.addEventListener('click', () => modal?.classList.remove('hidden'));
  document.getElementById('close-copy-modal')?.addEventListener('click', closeModal);
  document.getElementById('cancel-copy-modal')?.addEventListener('click', closeModal);

  document.getElementById('copy-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      const res = await api.subscribe({
        strategyId: s.id,
        allocation: Number(form.allocation.value),
        riskPerTradePct: Number(form.riskPerTradePct.value),
        maxDrawdownPct: Number(form.maxDrawdownPct.value),
        allocationMethod: form.allocationMethod.value
      });
      closeModal();
      showToast(res.warning || `Saved allocation for ${s.name}.`, res.warning ? 'warning' : 'success');
      location.hash = '#/overview';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  return () => destroyAllCharts();
}
