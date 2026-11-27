// Institutional Workspace Views for Remaining Sections:
// /portfolio, /ai, /markets, /risk, /copy-trading, /execution, /research, /reports, /settings
import { api } from '../api.js';
import { state } from '../state.js';
import { showToast } from '../app.js';

const SECTION_META = {
  '/portfolio':    { title: 'Portfolio & Capital Allocation', badge: 'PAPER_SANDBOX / DEMO', desc: 'Track multi-strategy allocations, exposure limits, and capital utilization.' },
  '/ai':           { title: 'UltraLOB AI (Advisory Architecture)', badge: 'PHASE 5 ROADMAP', desc: '7-engine deterministic + LLM advisory pipeline. Cannot bypass hard risk limits or invent prices.' },
  '/markets':      { title: 'Market Intelligence & Feeds', badge: 'REAL_MARKET / AWAITING XAUUSD', desc: 'Monitor live Kraken BTC/USD, Twelve Data US equities, and XAUUSD feed status.' },
  '/risk':         { title: 'Risk Engine & Kill Switches', badge: 'INDEPENDENT GOVERNANCE', desc: 'Configure hard loss/drawdown limits and trigger account-wide execution halts.' },
  '/copy-trading': { title: 'Risk-Normalized Copy Trading', badge: 'DEMO_ONLY', desc: 'Copy trading mandates sized strictly by equity risk budget and stop distance.' },
  '/execution':    { title: 'MT5 Execution Monitor', badge: 'POSTGRESQL BRIDGE', desc: 'Inspect `/api/execution` demo connector health, command leases, and broker retcodes.' },
  '/research':     { title: 'Quantitative Research & Backtesting', badge: 'PHASE 2 ENGINE', desc: 'Python OHLCV backtester, out-of-sample validation, walk-forward tests, and Monte Carlo risk.' },
  '/reports':      { title: 'Institutional Statements & Audit', badge: 'AUDIT LOGS', desc: 'Verify data-origin separated reporting and immutable system audit history.' },
  '/settings':     { title: 'Workspace & Mandate Settings', badge: 'RBAC & SESSION', desc: 'Inspect active user role, permissions, organization profile, and security tokens.' },
};

export function render(route) {
  const meta = SECTION_META[route.path] || { title: 'Workspace', badge: 'ULTRALOB', desc: '' };
  return `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" id="workspace-root">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <h1 class="text-2xl font-bold text-white">${meta.title}</h1>
          <span class="chip chip-blue text-[10px] font-mono">${meta.badge}</span>
        </div>
        <p class="text-xs text-surface-400">${meta.desc}</p>
      </div>
      <a href="#/overview" class="btn-outline px-3.5 py-2 rounded-lg text-xs text-surface-200">← Back to Overview</a>
    </div>
    <div id="workspace-body" class="text-sm text-surface-400">Loading module telemetry...</div>
  </div>`;
}

export async function init(route) {
  const body = document.getElementById('workspace-body');
  if (!body) return;

  try {
    const [portfolio, sys, execHealth] = await Promise.all([
      api.getPortfolio(),
      api.getSystemStatus(),
      api.getExecutionHealth().catch(() => ({ status: 'disabled', storage: 'not-configured', environment: 'DEMO_ONLY' }))
    ]);

    if (route.path === '/risk') {
      const r = portfolio.riskConfig || {};
      body.innerHTML = `
        <div class="grid md:grid-cols-2 gap-6">
          <div class="glass-card rounded-xl p-6">
            <h3 class="text-sm font-semibold text-white mb-4">Hard Risk Limits (Enforced Independent of AI)</h3>
            <form id="risk-form" onsubmit="return false;" class="space-y-3 text-xs">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="text-surface-400 block mb-1">Max Risk / Trade (%)</label>
                  <input name="max_risk_per_trade_pct" type="number" step="0.05" value="${r.max_risk_per_trade_pct ?? 0.5}" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono">
                </div>
                <div>
                  <label class="text-surface-400 block mb-1">Max Daily Loss (%)</label>
                  <input name="max_daily_loss_pct" type="number" step="0.25" value="${r.max_daily_loss_pct ?? 2.0}" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono">
                </div>
                <div>
                  <label class="text-surface-400 block mb-1">Max Drawdown (%)</label>
                  <input name="max_drawdown_pct" type="number" step="0.5" value="${r.max_drawdown_pct ?? 12.0}" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono">
                </div>
                <div>
                  <label class="text-surface-400 block mb-1">Max Open Positions</label>
                  <input name="max_open_positions" type="number" value="${r.max_open_positions ?? 5}" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono">
                </div>
              </div>
              <button type="submit" class="btn-primary px-4 py-2 rounded-lg text-white font-semibold">Update Hard Limits</button>
            </form>
          </div>
          <div class="glass-card rounded-xl p-6">
            <h3 class="text-sm font-semibold text-white mb-3">Execution Kill Switch & Stress Tools</h3>
            <p class="text-xs text-surface-400 mb-4">When active, all outbound signals, Monte Carlo auto-trades, and copy executions are rejected immediately.</p>
            <button id="ws-kill-btn" class="px-4 py-2.5 rounded-lg text-xs font-semibold border ${r.kill_switch_active ? 'bg-loss text-white border-loss' : 'bg-loss-bg text-loss border-loss/40'}">
              ${r.kill_switch_active ? '🛑 KILL SWITCH ACTIVE — Click to Disarm' : '⚠️ Activate Global Kill Switch'}
            </button>
            <div class="mt-5 pt-4 border-t border-surface-800 flex gap-3">
              <a href="#/terminal" class="btn-outline px-3 py-2 rounded-lg text-xs text-brand-300">Open Monte Carlo Simulator</a>
            </div>
          </div>
        </div>`;

      document.getElementById('risk-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        await api.saveRiskConfig(data);
        showToast('Hard risk limits updated.', 'success');
      });
      document.getElementById('ws-kill-btn')?.addEventListener('click', async () => {
        await api.saveRiskConfig({ kill_switch_active: !r.kill_switch_active });
        showToast('Kill switch state toggled.', 'warning');
        location.reload();
      });
      return;
    }

    if (route.path === '/markets') {
      const f = sys.market_feeds || {};
      body.innerHTML = `
        <div class="grid md:grid-cols-3 gap-4 mb-6">
          <div class="glass-card rounded-xl p-5">
            <div class="flex justify-between mb-2"><span class="text-white font-semibold">BTC/USD</span><span class="chip chip-green text-[10px]">${f.btc_usd?.origin || 'REAL_MARKET'}</span></div>
            <p class="text-xs text-surface-400">Provider: ${f.btc_usd?.provider || 'Kraken Spot'} • Status: <strong class="text-profit">${f.btc_usd?.status || 'LIVE'}</strong></p>
          </div>
          <div class="glass-card rounded-xl p-5">
            <div class="flex justify-between mb-2"><span class="text-white font-semibold">US Equities</span><span class="chip chip-blue text-[10px]">REAL_MARKET</span></div>
            <p class="text-xs text-surface-400">Provider: Twelve Data • Configured: <strong class="text-white">${f.us_equities?.configured ? 'Yes' : 'Awaiting TWELVE_DATA_API_KEY'}</strong></p>
          </div>
          <div class="glass-card rounded-xl p-5">
            <div class="flex justify-between mb-2"><span class="text-white font-semibold">XAUUSD (Gold)</span><span class="chip chip-yellow text-[10px]">AWAITING_DATA</span></div>
            <p class="text-xs text-surface-400">Status: <strong class="text-warn">${f.xauusd?.status || 'Awaiting Phase 2 MT5 / Licensed Feed'}</strong></p>
          </div>
        </div>
        <a href="#/terminal" class="btn-primary px-5 py-2.5 rounded-xl text-xs font-semibold text-white inline-block">Open Live Terminal & Candle Feed →</a>`;
      return;
    }

    if (route.path === '/ai') {
      const engines = [
        '1. Market Intelligence Engine (Regime, Volatility, Session)',
        '2. Quantitative Research Engine (Backtest & Walk-Forward Analysis)',
        '3. Risk Engine (Drawdown & Exposure Guard — Independent Authority)',
        '4. Portfolio Engine (Capital Weighting & Correlation)',
        '5. Execution Engine (Spread, Slippage & Broker Health)',
        '6. Event Intelligence Engine (High-Impact Economic Calendar)',
        '7. Decision Engine (Advisory Synthesis — Never Bypasses Hard Limits)'
      ];
      body.innerHTML = `
        <div class="glass-card rounded-xl p-6 mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-white">UltraLOB AI — Advisory Mode Pipeline</h3>
            <span class="chip chip-yellow text-[11px]">${sys.ai_engine?.mode || 'ADVISORY_PENDING_PHASE_5'}</span>
          </div>
          <p class="text-xs text-surface-400 mb-4">UltraLOB AI operates strictly in read-only advisory mode. Deterministic quantitative engines compute all numbers; the AI cannot fabricate prices, performance figures, or override hard risk limits.</p>
          <div class="grid sm:grid-cols-2 gap-3">
            ${engines.map(e => `<div class="p-3 rounded-lg bg-surface-900/70 border border-surface-800 text-xs text-surface-200">${e}</div>`).join('')}
          </div>
        </div>`;
      return;
    }

    if (route.path === '/execution') {
      body.innerHTML = `
        <div class="glass-card rounded-xl p-6 mb-6">
          <h3 class="text-sm font-semibold text-white mb-4">PostgreSQL MT5 Demo Execution Bridge (/api/execution)</h3>
          <div class="grid sm:grid-cols-4 gap-4 text-xs mb-4">
            <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Bridge Status</span><strong class="text-white font-mono">${execHealth.status}</strong></div>
            <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Storage</span><strong class="text-white font-mono">${execHealth.storage}</strong></div>
            <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Environment</span><strong class="text-warn font-mono">${execHealth.environment}</strong></div>
            <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Live Real-Money</span><strong class="text-loss font-mono">DISABLED</strong></div>
          </div>
          <p class="text-xs text-surface-400">Pair MT5 Demo connectors under <a href="#/broker" class="text-brand-400 underline">Brokers</a> using <code class="text-surface-200">mt5/Experts/UltraLOB_Bridge_EA.mq5</code> and set <code class="text-surface-200">DATABASE_URL</code> + <code class="text-surface-200">ULTRALOB_EXECUTION_ADMIN_KEY</code> to unlock full command/event auditing.</p>
        </div>`;
      return;
    }

    if (route.path === '/settings') {
      const u = state.user;
      body.innerHTML = `
        <div class="glass-card rounded-xl p-6 text-xs space-y-3">
          <h3 class="text-sm font-semibold text-white">Active Session & Role Permissions</h3>
          ${u ? `
            <div>Name: <strong class="text-white">${u.name}</strong></div>
            <div>Email: <strong class="text-white">${u.email}</strong></div>
            <div>Role: <span class="chip chip-blue font-mono">${u.role}</span></div>
            <div>Organization: <strong class="text-white">${u.org_name || 'Individual'}</strong></div>
            <div>Permissions: <code class="text-brand-300">${(u.permissions || []).join(', ')}</code></div>
          ` : `<div>Viewing in unauthenticated Guest Sandbox. <a href="#/auth" class="text-brand-400 underline">Sign in or register with a role →</a></div>`}
        </div>`;
      return;
    }

    // Default clean structured summary for /portfolio, /copy-trading, /research, /reports
    body.innerHTML = `
      <div class="glass-card rounded-xl p-6 space-y-4 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-white font-semibold">Portfolio & Allocation Summary</span>
          <span class="chip chip-yellow font-mono">${portfolio.summary.data_origin}</span>
        </div>
        <div class="grid sm:grid-cols-4 gap-4">
          <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Balance</span><strong class="text-white font-mono">$${portfolio.summary.balance.toLocaleString()}</strong></div>
          <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Allocated</span><strong class="text-brand-400 font-mono">$${(portfolio.summary.allocated_capital || 0).toLocaleString()}</strong></div>
          <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Active Mandates</span><strong class="text-white font-mono">${portfolio.subscriptions.length}</strong></div>
          <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">PostgreSQL DB</span><strong class="text-white font-mono">${sys.database?.ready ? 'Connected' : 'Awaiting DATABASE_URL'}</strong></div>
        </div>
        <p class="text-surface-400 leading-relaxed">
          Full historical backtesting (<code class="text-surface-200">research/</code>), risk-normalized multi-strategy attribution, and institutional PDF/CSV statements activate progressively across Phases 2–6 without altering or fabricating baseline metrics.
        </p>
      </div>`;
  } catch (err) {
    body.innerHTML = `<div class="p-6 text-loss text-xs">Error loading section: ${err.message}</div>`;
  }
}
