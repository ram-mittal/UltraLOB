// Institutional Overview Dashboard (Data-Origin Separated • Honest Zero-Mock State)
import { createEquityCurve, createDonutChart, destroyAllCharts } from '../components/charts.js';
import { api } from '../api.js';
import { showToast } from '../app.js';

export function render() {
  return `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" id="dashboard-root">
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
  const risk = data.riskConfig || {};
  const alerts = data.riskAlerts || [];
  const dbReady = data.systemStatus?.database?.ready;

  return `
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <div>
        <div class="flex flex-wrap items-center gap-2 mb-1">
          <h1 class="text-2xl font-bold text-white">Institutional Overview</h1>
          <span class="chip ${broker ? 'chip-blue' : 'chip-yellow'} text-[11px] font-mono">
            DATA ORIGIN: ${broker ? 'DEMO_BROKER' : p.data_origin || 'PAPER_SANDBOX'}
          </span>
          <span class="chip ${dbReady ? 'chip-green' : 'chip-yellow'} text-[11px] font-mono">
            DB: ${dbReady ? 'POSTGRESQL' : 'SANDBOX MEMORY'}
          </span>
        </div>
        <p class="text-xs text-surface-400">
          ${broker
            ? `Broker Connected: <span class="text-profit font-medium">${broker.name} (${broker.account} • ${broker.server})</span>`
            : `No MT5 Demo broker paired yet. Operating in <span class="text-surface-200 font-medium">Paper Sandbox</span> • <a href="#/broker" class="underline hover:text-white">Connect MT5 Demo EA</a>`}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button id="fund-sandbox-btn" class="btn-outline px-3.5 py-2 rounded-lg text-xs font-medium text-white">
          + Fund Paper Sandbox
        </button>
        <button id="kill-switch-btn" class="px-3.5 py-2 rounded-lg text-xs font-semibold border ${risk.kill_switch_active ? 'bg-loss text-white border-loss' : 'bg-loss-bg text-loss border-loss/40 hover:bg-loss/20'}">
          ${risk.kill_switch_active ? '🛑 KILL SWITCH ACTIVE (Click to Reset)' : '⚠️ Activate Kill Switch'}
        </button>
        <a href="#/marketplace" class="btn-primary px-4 py-2 rounded-lg text-xs font-semibold text-white">Browse Strategies</a>
      </div>
    </div>

    ${p.balance <= 0 && !broker ? `
      <div class="mb-6 p-4 rounded-xl bg-brand-500/10 border border-brand-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="text-xs text-surface-300">
          <strong class="text-white">Zero Initial Balance:</strong> UltraLOB never pre-fills fake profits or synthetic portfolio balances.
          Fund a Paper Sandbox allocation or connect an MT5 Demo terminal to record real demo execution data.
        </div>
        <button id="quick-fund-10k" class="btn-primary px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white whitespace-nowrap">
          Initialize $10,000 Paper Sandbox
        </button>
      </div>` : ''}

    <!-- Capital & Risk KPIs -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-8">
      <div class="glass-card rounded-xl p-4">
        <div class="text-[11px] text-surface-500 mb-1">Total Capital</div>
        <div class="text-base font-bold text-white font-mono">$${p.balance.toLocaleString()}</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-[11px] text-surface-500 mb-1">Equity</div>
        <div class="text-base font-bold text-white font-mono">$${p.equity.toLocaleString()}</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-[11px] text-surface-500 mb-1">Allocated</div>
        <div class="text-base font-bold text-brand-400 font-mono">$${(p.allocated_capital || 0).toLocaleString()}</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-[11px] text-surface-500 mb-1">Available</div>
        <div class="text-base font-bold text-white font-mono">$${(p.available_capital || 0).toLocaleString()}</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-[11px] text-surface-500 mb-1">Total P&L</div>
        <div class="text-base font-bold font-mono ${p.total_pnl >= 0 ? 'text-profit' : 'text-loss'}">
          ${p.total_pnl >= 0 ? '+' : ''}$${p.total_pnl.toLocaleString()}
        </div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-[11px] text-surface-500 mb-1">Drawdown</div>
        <div class="text-base font-bold text-loss font-mono">${(p.drawdown_pct || 0).toFixed(2)}%</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-[11px] text-surface-500 mb-1">Open Positions</div>
        <div class="text-base font-bold text-white font-mono">${p.open_positions_count || 0} / ${risk.max_open_positions || 5}</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-[11px] text-surface-500 mb-1">Win Rate</div>
        <div class="text-base font-bold text-white font-mono">${p.win_rate_today == null ? '—' : p.win_rate_today + '%'}</div>
      </div>
    </div>

    <!-- Charts + Risk Alerts -->
    <div class="grid lg:grid-cols-3 gap-6 mb-8">
      <div class="glass-card rounded-xl p-6 lg:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold text-white">📈 Portfolio Equity Curve (${p.data_origin || 'SANDBOX'})</h3>
          <span class="text-xs text-surface-500">Updates from actual closed/open ledger entries</span>
        </div>
        ${(data.equityHistory || []).length >= 2
          ? '<div class="h-60"><canvas id="dash-equity"></canvas></div>'
          : '<div class="h-52 rounded-xl border border-dashed border-surface-700 flex items-center justify-center text-xs text-surface-500 text-center p-6">Equity history will plot as sandbox or broker-confirmed trades settle.</div>'}
      </div>
      <div class="glass-card rounded-xl p-6">
        <h3 class="text-sm font-semibold text-white mb-4">🛡️ Risk Engine & Alerts</h3>
        <div class="space-y-2 text-xs mb-4">
          <div class="flex justify-between"><span class="text-surface-400">Max Risk / Trade</span><span class="text-white font-mono">${risk.max_risk_per_trade_pct || 0.5}%</span></div>
          <div class="flex justify-between"><span class="text-surface-400">Daily Loss Limit</span><span class="text-white font-mono">${risk.max_daily_loss_pct || 2.0}%</span></div>
          <div class="flex justify-between"><span class="text-surface-400">Max Drawdown Cap</span><span class="text-white font-mono">${risk.max_drawdown_pct || 12.0}%</span></div>
          <div class="flex justify-between"><span class="text-surface-400">Execution Mode</span><span class="text-warn font-mono">DEMO ONLY</span></div>
        </div>
        <div class="border-t border-surface-800 pt-3 space-y-2 max-h-36 overflow-y-auto">
          ${alerts.length
            ? alerts.map(a => `<div class="p-2 rounded bg-surface-900/80 border border-surface-800 text-[11px] text-surface-300">${a.message}</div>`).join('')
            : '<div class="text-[11px] text-surface-500">No risk breaches recorded.</div>'}
        </div>
      </div>
    </div>

    <!-- Active Mandates / Strategy Allocations -->
    <div class="glass-card rounded-xl p-6 mb-8">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold text-white">📐 Strategy Allocation Mandates</h3>
        <a href="#/marketplace" class="text-xs text-brand-400 hover:text-brand-300">+ Allocate Strategy</a>
      </div>
      ${subs.length ? `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-800 text-xs text-surface-500">
              <th class="text-left pb-3 font-medium">Strategy</th>
              <th class="text-left pb-3 font-medium">Lifecycle</th>
              <th class="text-right pb-3 font-medium">Allocation</th>
              <th class="text-right pb-3 font-medium">Risk/Trade</th>
              <th class="text-center pb-3 font-medium">State</th>
              <th class="text-right pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${subs.map(c => `
              <tr class="border-b border-surface-800/50">
                <td class="py-3"><a href="#/strategy/${c.strategyId}" class="text-white font-medium hover:text-brand-300">${c.strategyName}</a></td>
                <td class="py-3"><span class="chip chip-yellow text-[10px]">${c.lifecycle_status || 'RESEARCH'}</span></td>
                <td class="py-3 text-right font-mono text-surface-200">$${Number(c.allocation).toLocaleString()}</td>
                <td class="py-3 text-right font-mono text-surface-300">${c.riskPerTradePct ?? 0.5}%</td>
                <td class="py-3 text-center"><span class="chip ${c.status === 'active' ? 'chip-green' : 'chip-yellow'} text-[10px]">${c.status}</span></td>
                <td class="py-3 text-right space-x-2">
                  <button onclick="window.__toggleCopy?.('${c.strategyId}')" class="text-xs text-surface-300 hover:text-white px-2 py-1 rounded border border-surface-700">Toggle</button>
                  <button onclick="window.__stopCopy?.('${c.strategyId}')" class="text-xs text-surface-400 hover:text-loss px-2 py-1 rounded border border-surface-700">Remove</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : `<div class="text-xs text-surface-500 py-6 text-center">No strategy allocations configured yet.</div>`}
    </div>

    <!-- Execution & Trade Ledger -->
    <div class="glass-card rounded-xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold text-white">📋 Execution Ledger</h3>
        <span class="text-xs text-surface-500">${trades.length} recorded orders</span>
      </div>
      ${trades.length ? `
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-surface-800 text-surface-500">
              <th class="text-left pb-2">Time</th><th class="text-left pb-2">Origin</th>
              <th class="text-left pb-2">Symbol</th><th class="text-center pb-2">Side</th>
              <th class="text-right pb-2">Qty</th><th class="text-right pb-2">Price</th>
              <th class="text-right pb-2">P&L</th><th class="text-center pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            ${trades.map(t => `
              <tr class="border-b border-surface-800/50">
                <td class="py-2 font-mono text-surface-400">${t.time}</td>
                <td class="py-2"><span class="chip chip-blue text-[10px]">${t.data_origin || t.broker}</span></td>
                <td class="py-2 text-white font-medium">${t.symbol}</td>
                <td class="py-2 text-center"><span class="chip ${t.side === 'BUY' ? 'chip-green' : 'chip-red'}">${t.side}</span></td>
                <td class="py-2 text-right font-mono">${t.qty}</td>
                <td class="py-2 text-right font-mono text-white">$${Number(t.price).toLocaleString()}</td>
                <td class="py-2 text-right font-mono ${t.pnl >= 0 ? 'text-profit' : 'text-loss'}">${t.pnl == null ? '—' : '$' + Number(t.pnl).toFixed(2)}</td>
                <td class="py-2 text-center">
                  ${t.status === 'open' ? `<button onclick="window.__closeTrade?.('${t.id}', ${t.price})" class="chip chip-blue">Close</button>` : '<span class="chip chip-green">closed</span>'}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="text-xs text-surface-500 py-6 text-center">No trades executed in this session.</div>'}
    </div>`;
}

export async function init() {
  const root = document.getElementById('dashboard-root');
  if (!root) return;

  let currentRisk = {};

  async function refresh() {
    try {
      const data = await api.getPortfolio();
      currentRisk = data.riskConfig || {};
      root.innerHTML = renderDashboardHTML(data);

      const eq = data.equityHistory || [];
      if (eq.length >= 2) {
        setTimeout(() => {
          createEquityCurve('dash-equity', eq.map(p => p.label), eq.map(p => p.value));
        }, 50);
      }

      document.getElementById('quick-fund-10k')?.addEventListener('click', async () => {
        await api.fundSandboxCapital(10000);
        showToast('Initialized $10,000 Paper Sandbox capital.', 'success');
        await refresh();
      });

      document.getElementById('fund-sandbox-btn')?.addEventListener('click', async () => {
        const val = prompt('Enter Paper Sandbox capital USD (100 – 10,000,000):', '10000');
        if (!val) return;
        try {
          await api.fundSandboxCapital(Number(val));
          showToast('Paper Sandbox balance updated.', 'success');
          await refresh();
        } catch (e) { showToast(e.message, 'error'); }
      });

      document.getElementById('kill-switch-btn')?.addEventListener('click', async () => {
        const next = !currentRisk.kill_switch_active;
        await api.saveRiskConfig({ kill_switch_active: next });
        showToast(next ? 'Kill switch ACTIVATED.' : 'Kill switch reset.', next ? 'warning' : 'info');
        await refresh();
      });
    } catch (err) {
      root.innerHTML = `<div class="p-8 text-center text-loss">Failed to load overview: ${err.message}</div>`;
    }
  }

  window.__toggleCopy = async (strategyId) => {
    try { await api.toggleCopy(strategyId); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  window.__stopCopy = async (strategyId) => {
    try { await api.unsubscribe(strategyId); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  window.__closeTrade = async (tradeId, fallbackPrice) => {
    try { await api.closeTrade(tradeId, fallbackPrice); showToast('Position closed.', 'success'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  await refresh();

  return () => {
    destroyAllCharts();
    delete window.__toggleCopy;
    delete window.__stopCopy;
    delete window.__closeTrade;
  };
}
