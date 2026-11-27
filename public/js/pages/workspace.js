// Institutional Workspace Views for Remaining Sections:
// /portfolio, /ai, /markets, /risk, /copy-trading, /execution, /research, /reports, /settings
import { api } from '../api.js';
import { state } from '../state.js';
import { showToast } from '../app.js';
import { createEquityCurve, createDrawdownChart, destroyAllCharts } from '../components/charts.js';

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

    if (route.path === '/portfolio') {
      const ps = await api.getPortfolioSummary();
      const renderPlan = (plan) => {
        if (!plan) return '<div class="text-xs text-surface-500 py-4 text-center">Click "Compute Optimal Allocation" to preview weights across allocation methods and caps.</div>';
        return `
          <div class="space-y-4">
            <div class="flex flex-wrap justify-between gap-2 text-xs">
              <span class="text-surface-400">Method: <strong class="text-white font-mono">${plan.method}</strong> • Investable: <strong class="text-profit font-mono">$${plan.investable_capital.toLocaleString()}</strong> • Cash Reserve: <strong class="text-white font-mono">$${plan.cash_reserve_usd.toLocaleString()}</strong></span>
            </div>
            ${plan.warnings?.length ? `<div class="p-3 rounded bg-warn-bg border border-warn/30 text-xs text-warn">${plan.warnings.join(' • ')}</div>` : ''}
            <table class="w-full text-xs">
              <thead><tr class="border-b border-surface-800 text-surface-500">
                <th class="text-left pb-2">Strategy</th><th class="text-left pb-2">Instrument</th><th class="text-left pb-2">Stage</th>
                <th class="text-right pb-2">Weight %</th><th class="text-right pb-2">Allocated USD</th><th class="text-right pb-2">Vol Source</th>
              </tr></thead>
              <tbody>
                ${plan.allocations.map(a => `
                  <tr class="border-b border-surface-800/50">
                    <td class="py-2 text-white font-medium">${a.name}</td>
                    <td class="py-2 font-mono text-surface-300">${a.instrument}</td>
                    <td class="py-2"><span class="chip chip-yellow text-[10px]">${a.lifecycle_status}</span></td>
                    <td class="py-2 text-right font-mono text-brand-300">${a.weight_pct}%</td>
                    <td class="py-2 text-right font-mono text-white">$${a.allocated_usd.toLocaleString()}</td>
                    <td class="py-2 text-right font-mono text-surface-400">${a.vol_source}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      };

      const exp = ps.exposure || { gross_notional: 0, portfolio_leverage: 0, instruments: [] };
      const corr = ps.correlations || { has_empirical_data: false, data_origin: 'AWAITING_BACKTEST_OVERLAP' };

      body.innerHTML = `
        <div class="grid sm:grid-cols-4 gap-4 mb-6 text-xs">
          <div class="glass-card rounded-xl p-4"><span class="text-surface-500 block">Portfolio Equity (${ps.data_origin})</span><strong class="text-white font-mono text-base">$${ps.equity.toLocaleString()}</strong></div>
          <div class="glass-card rounded-xl p-4"><span class="text-surface-500 block">Gross Notional Exposure</span><strong class="text-white font-mono text-base">$${exp.gross_notional.toLocaleString()}</strong></div>
          <div class="glass-card rounded-xl p-4"><span class="text-surface-500 block">Portfolio Leverage</span><strong class="text-brand-400 font-mono text-base">${exp.portfolio_leverage}x</strong></div>
          <div class="glass-card rounded-xl p-4"><span class="text-surface-500 block">Correlation Matrix Status</span><strong class="text-warn font-mono text-xs">${corr.data_origin}</strong></div>
        </div>

        <div class="glass-card rounded-xl p-6 mb-6">
          <h3 class="text-sm font-semibold text-white mb-4">Institutional Capital Allocation Optimizer</h3>
          <form id="rebalance-form" onsubmit="return false;" class="space-y-4 text-xs mb-6">
            <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label class="text-surface-400 block mb-1">Allocation Method</label>
                <select name="method" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white">
                  <option value="RISK_WEIGHTED">Risk-Weighted</option>
                  <option value="VOLATILITY_ADJUSTED">Volatility-Adjusted (1/σ)</option>
                  <option value="EQUAL_RISK_CONTRIBUTION">Equal Risk Contribution (ERC)</option>
                  <option value="FIXED">Fixed Weight</option>
                  <option value="FRACTIONAL">Fractional Equal</option>
                </select>
              </div>
              <div><label class="text-surface-400 block mb-1">Capital Base ($)</label><input name="total_capital" type="number" value="${ps.equity > 0 ? ps.equity : 25000}" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono"></div>
              <div><label class="text-surface-400 block mb-1">Max Strategy %</label><input name="max_allocation_per_strategy_pct" type="number" value="35" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono"></div>
              <div><label class="text-surface-400 block mb-1">Max Instrument %</label><input name="max_instrument_exposure_pct" type="number" value="60" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono"></div>
              <div><label class="text-surface-400 block mb-1">Cash Reserve Floor %</label><input name="cash_reserve_floor_pct" type="number" value="10" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono"></div>
            </div>
            <div class="flex items-center justify-between gap-3">
              <label class="flex items-center gap-2 text-surface-300"><input type="checkbox" name="apply" class="rounded bg-surface-800 border-surface-700"> Apply allocation plan to portfolio mandates</label>
              <button type="submit" class="btn-primary px-4 py-2 rounded-lg text-white font-semibold">Compute Optimal Allocation</button>
            </div>
          </form>
          <div id="rebalance-out">${renderPlan(null)}</div>
        </div>

        <div class="grid md:grid-cols-2 gap-6 text-xs">
          <div class="glass-card rounded-xl p-6">
            <h3 class="text-sm font-semibold text-white mb-3">Instrument Exposure Breakdown</h3>
            ${exp.instruments.length ? `
              <table class="w-full">
                <thead><tr class="border-b border-surface-800 text-surface-500"><th class="text-left pb-2">Instrument</th><th class="text-right pb-2">Net Notional</th><th class="text-right pb-2">Mandate $</th><th class="text-right pb-2">% Equity</th></tr></thead>
                <tbody>
                  ${exp.instruments.map(i => `<tr class="border-b border-surface-800/50"><td class="py-2 font-mono text-white">${i.symbol}</td><td class="py-2 text-right font-mono">$${i.net_notional.toLocaleString()}</td><td class="py-2 text-right font-mono">$${i.allocated_mandate_usd.toLocaleString()}</td><td class="py-2 text-right font-mono">${i.exposure_pct_of_equity}%</td></tr>`).join('')}
                </tbody>
              </table>` : '<div class="text-surface-500 py-4">No active positions or strategy mandates yet.</div>'}
          </div>
          <div class="glass-card rounded-xl p-6">
            <h3 class="text-sm font-semibold text-white mb-3">Pairwise Strategy Correlation Matrix</h3>
            ${corr.has_empirical_data
              ? `<div class="text-profit">Empirical overlap computed from backtest return vectors.</div>`
              : `<div class="p-4 rounded border border-dashed border-surface-700 text-surface-400">Awaiting empirical return series overlap across 2+ backtested strategies. UltraLOB never fabricates assumed correlations.</div>`}
          </div>
        </div>`;

      document.getElementById('rebalance-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const res = await api.rebalancePortfolio({
          method: f.method,
          total_capital: Number(f.total_capital),
          apply: Boolean(e.target.apply?.checked),
          constraints: {
            max_allocation_per_strategy_pct: Number(f.max_allocation_per_strategy_pct),
            max_instrument_exposure_pct: Number(f.max_instrument_exposure_pct),
            cash_reserve_floor_pct: Number(f.cash_reserve_floor_pct)
          }
        });
        document.getElementById('rebalance-out').innerHTML = renderPlan(res.plan);
        showToast(res.applied ? 'Portfolio mandates rebalanced.' : 'Preview computed.', 'success');
      });
      return;
    }

    if (route.path === '/risk') {
      const riskData = await api.getPortfolioRisk();
      const l = riskData.limits || {};
      const ks = riskData.kill_switches || { global_active: false, strategies: {}, instruments: {} };
      const audits = riskData.audit_history || [];

      body.innerHTML = `
        <div class="mb-6 p-4 rounded-xl bg-brand-500/10 border border-brand-500/30 text-xs text-surface-200">
          <strong class="text-white">Independent Risk Authority:</strong> ${riskData.governance_note}
        </div>
        <div class="grid lg:grid-cols-3 gap-6 mb-6">
          <div class="glass-card rounded-xl p-6 lg:col-span-2">
            <h3 class="text-sm font-semibold text-white mb-4">Multi-Horizon Hard Risk Limits</h3>
            <form id="risk-form" onsubmit="return false;" class="space-y-4 text-xs">
              <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div><label class="text-surface-400 block mb-1">Risk / Trade %</label><input name="max_risk_per_trade_pct" type="number" step="0.05" value="${l.max_risk_per_trade_pct}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Daily Loss %</label><input name="max_daily_loss_pct" type="number" step="0.25" value="${l.max_daily_loss_pct}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Weekly Loss %</label><input name="max_weekly_loss_pct" type="number" step="0.5" value="${l.max_weekly_loss_pct}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Monthly Loss %</label><input name="max_monthly_loss_pct" type="number" step="0.5" value="${l.max_monthly_loss_pct}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Max Drawdown %</label><input name="max_drawdown_pct" type="number" step="0.5" value="${l.max_drawdown_pct}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Max Positions</label><input name="max_open_positions" type="number" value="${l.max_open_positions}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Max Leverage (x)</label><input name="max_leverage" type="number" step="1" value="${l.max_leverage}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Max Margin %</label><input name="max_margin_usage_pct" type="number" step="5" value="${l.max_margin_usage_pct}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Max Spread (pts)</label><input name="max_spread_points" type="number" value="${l.max_spread_points}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Max Slippage (pts)</label><input name="max_slippage_points" type="number" value="${l.max_slippage_points}" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-2 text-white font-mono"></div>
              </div>
              <button type="submit" class="btn-primary px-5 py-2 rounded-lg text-white font-semibold">Save & Audit Hard Limits</button>
            </form>
          </div>

          <div class="glass-card rounded-xl p-6 space-y-4">
            <h3 class="text-sm font-semibold text-white">Hierarchical Kill Switches</h3>
            <p class="text-[11px] text-surface-400">Blocks ALL new order execution cleanly without silently liquidating existing positions.</p>
            <button id="ws-kill-btn" class="w-full py-2.5 rounded-lg text-xs font-semibold border ${ks.global_active ? 'bg-loss text-white border-loss' : 'bg-loss-bg text-loss border-loss/40'}">
              ${ks.global_active ? '🛑 GLOBAL HALT ACTIVE — Click to Clear' : '⚠️ Activate Global Kill Switch'}
            </button>
            <form id="scope-ks-form" onsubmit="return false;" class="space-y-2 text-xs pt-2 border-t border-surface-800">
              <div class="flex gap-2">
                <select name="scope" class="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-white">
                  <option value="STRATEGY">Strategy Halt</option>
                  <option value="INSTRUMENT">Instrument Halt</option>
                </select>
                <input name="target" placeholder="ul-01-gold-trend / XAUUSD" required class="flex-1 bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-white font-mono">
              </div>
              <div class="flex gap-2">
                <button type="submit" data-active="true" class="flex-1 py-1.5 rounded bg-loss/20 border border-loss/40 text-loss font-semibold">Halt Scope</button>
                <button type="button" id="clear-scope-ks" class="flex-1 py-1.5 rounded bg-surface-800 border border-surface-700 text-surface-300">Clear Scope</button>
              </div>
            </form>
            <div class="text-[11px] text-surface-400">
              Halted Strategies: <span class="text-loss font-mono">${Object.keys(ks.strategies || {}).join(', ') || 'None'}</span><br>
              Halted Instruments: <span class="text-loss font-mono">${Object.keys(ks.instruments || {}).join(', ') || 'None'}</span>
            </div>
          </div>
        </div>

        <div class="grid lg:grid-cols-3 gap-6">
          <div class="glass-card rounded-xl p-6">
            <h3 class="text-sm font-semibold text-white mb-2">Bounded Kelly Research Calculator</h3>
            <p class="text-[11px] text-warn mb-3">Research input only — hard-capped by Max Risk/Trade (${l.max_risk_per_trade_pct}%).</p>
            <form id="kelly-form" onsubmit="return false;" class="space-y-2.5 text-xs">
              <div class="grid grid-cols-3 gap-2">
                <div><label class="text-surface-400 block mb-1">Win Prob</label><input name="win_probability" type="number" step="0.01" value="0.55" class="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Payoff (R)</label><input name="payoff_ratio" type="number" step="0.1" value="1.8" class="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Mult</label><input name="kelly_fraction" type="number" step="0.1" value="0.5" class="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-white font-mono"></div>
              </div>
              <button type="submit" class="btn-outline w-full py-2 rounded-lg text-brand-300 font-semibold">Compute Bounded Kelly</button>
              <div id="kelly-out" class="p-2.5 rounded bg-surface-900/70 border border-surface-800 font-mono text-surface-400">Awaiting research inputs.</div>
            </form>
          </div>
          <div class="glass-card rounded-xl p-6 lg:col-span-2">
            <h3 class="text-sm font-semibold text-white mb-3">Immutable Risk Configuration Audit Log</h3>
            ${audits.length ? `
              <div class="space-y-2 max-h-56 overflow-y-auto text-xs font-mono">
                ${audits.map(a => `<div class="p-2 rounded bg-surface-900/70 border border-surface-800 text-surface-300">[${new Date(a.createdAt).toLocaleTimeString()}] <strong class="text-brand-300">${a.action}</strong> (${a.actor}) • ${JSON.stringify(a.details)}</div>`).join('')}
              </div>` : '<div class="text-xs text-surface-500">No risk limit changes or kill switch events audited yet.</div>'}
          </div>
        </div>`;

      document.getElementById('risk-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        await api.updateRiskLimits(data);
        showToast('Hard risk limits updated & audited.', 'success');
        location.reload();
      });
      document.getElementById('ws-kill-btn')?.addEventListener('click', async () => {
        await api.toggleKillSwitch({ scope: 'GLOBAL', active: !ks.global_active, reason: 'Toggled in Risk Governance UI' });
        showToast('Global kill switch toggled.', 'warning');
        location.reload();
      });
      document.getElementById('scope-ks-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        await api.toggleKillSwitch({ scope: f.scope, target: f.target, active: true, reason: 'Targeted risk halt' });
        showToast(`${f.scope} kill switch halted.`, 'warning');
        location.reload();
      });
      document.getElementById('clear-scope-ks')?.addEventListener('click', async () => {
        const form = document.getElementById('scope-ks-form');
        const f = Object.fromEntries(new FormData(form));
        if (!f.target) return;
        await api.toggleKillSwitch({ scope: f.scope, target: f.target, active: false, reason: 'Cleared by operator' });
        showToast(`${f.scope} kill switch cleared.`, 'info');
        location.reload();
      });
      document.getElementById('kelly-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const res = await api.computeKellyResearch(f);
        document.getElementById('kelly-out').innerHTML = `Full Kelly: ${res.full_kelly_pct}% • Half: ${res.fractional_kelly_pct}% • <strong class="text-profit">Hard Capped: ${res.hard_capped_risk_pct}%</strong>`;
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
      const mon = await api.getExecutionMonitor().catch(() => ({
        configured: false,
        storage: execHealth.storage,
        environment: 'DEMO_ONLY',
        connectors: [],
        commands: [],
        events: []
      }));
      const connectors = mon.connectors || [];
      const commands = mon.commands || [];
      const events = mon.events || [];
      const sandboxTrades = portfolio.trades || [];

      const renderCmdRows = (list) => list.length
        ? list.map(c => `
            <tr class="border-b border-surface-800/50 hover:bg-surface-800/30">
              <td class="py-2 font-mono text-surface-400">${c.strategy_id} <span class="text-surface-500">v${c.strategy_version}</span></td>
              <td class="py-2 text-white font-semibold">${c.symbol}</td>
              <td class="py-2 text-center"><span class="chip ${c.side === 'BUY' ? 'chip-green' : 'chip-red'}">${c.side}</span></td>
              <td class="py-2 text-right font-mono">${c.volume ?? '—'} lots</td>
              <td class="py-2 text-right font-mono text-surface-300">${c.entry_reference ?? '—'}</td>
              <td class="py-2 text-right font-mono text-surface-400">${c.stop_loss} / ${c.take_profit}</td>
              <td class="py-2 text-right font-mono text-surface-300">${c.broker_order_id || '—'}</td>
              <td class="py-2 text-right font-mono text-surface-400">${c.broker_retcode || '—'}</td>
              <td class="py-2 text-center"><span class="chip ${c.status === 'FILLED' ? 'chip-green' : c.status === 'REJECTED' ? 'chip-red' : 'chip-blue'}">${c.status}</span></td>
              <td class="py-2 text-xs text-loss">${c.error_message || '—'}</td>
            </tr>`).join('')
        : `<tr><td colspan="10" class="py-6 text-center text-surface-500">No MT5 execution commands recorded yet.</td></tr>`;

      body.innerHTML = `
        <div class="grid sm:grid-cols-4 gap-4 mb-6 text-xs">
          <div class="glass-card rounded-xl p-4"><span class="text-surface-500 block">Execution Storage</span><strong class="text-white font-mono">${mon.storage}</strong></div>
          <div class="glass-card rounded-xl p-4"><span class="text-surface-500 block">Demo Connectors</span><strong class="text-brand-400 font-mono">${connectors.length}</strong></div>
          <div class="glass-card rounded-xl p-4"><span class="text-surface-500 block">Dispatched Commands</span><strong class="text-white font-mono">${commands.length}</strong></div>
          <div class="glass-card rounded-xl p-4"><span class="text-surface-500 block">Live Real-Money Mode</span><strong class="text-loss font-mono">LOCKED (DEMO ONLY)</strong></div>
        </div>

        ${!mon.configured ? `
          <div class="mb-6 p-4 rounded-xl bg-warn-bg border border-warn/30 text-xs text-warn">
            PostgreSQL execution storage (<code class="text-white">DATABASE_URL</code>) is not configured on this host, so <code class="text-white">/api/execution</code> bridge persistence is inactive. Showing sandbox queue fallback (${sandboxTrades.length} sandbox trades).
          </div>` : ''}

        <div class="glass-card rounded-xl p-6 mb-6">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 class="text-sm font-semibold text-white">MT5 Execution Commands</h3>
            <div class="flex gap-2">
              <input id="exec-filter-sym" placeholder="Filter symbol (XAUUSD)..." class="bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-xs text-white">
              <select id="exec-filter-status" class="bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-xs text-white">
                <option value="ALL">All Statuses</option>
                <option value="QUEUED">QUEUED</option>
                <option value="DISPATCHED">DISPATCHED</option>
                <option value="ACCEPTED">ACCEPTED</option>
                <option value="FILLED">FILLED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-surface-800 text-surface-500">
                  <th class="text-left pb-2">Strategy</th><th class="text-left pb-2">Symbol</th><th class="text-center pb-2">Side</th>
                  <th class="text-right pb-2">Volume</th><th class="text-right pb-2">Fill/Ref</th><th class="text-right pb-2">SL / TP</th>
                  <th class="text-right pb-2">Order ID</th><th class="text-right pb-2">Retcode</th><th class="text-center pb-2">Status</th><th class="text-left pb-2">Error</th>
                </tr>
              </thead>
              <tbody id="exec-cmd-tbody">${renderCmdRows(commands)}</tbody>
            </table>
          </div>
        </div>

        <div class="glass-card rounded-xl p-6">
          <h3 class="text-sm font-semibold text-white mb-3">Execution Audit Events</h3>
          ${events.length ? `
            <div class="space-y-2 max-h-56 overflow-y-auto text-xs font-mono">
              ${events.map(e => `<div class="p-2 rounded bg-surface-900/70 border border-surface-800 text-surface-300">[${new Date(e.created_at).toLocaleTimeString()}] <strong class="text-brand-300">${e.event_type}</strong> • ${JSON.stringify(e.payload || {})}</div>`).join('')}
            </div>` : '<div class="text-xs text-surface-500">No execution bridge events yet. Pair a Demo Connector on the Brokers page.</div>'}
        </div>`;

      const applyFilter = () => {
        const symQ = (document.getElementById('exec-filter-sym')?.value || '').trim().toUpperCase();
        const stQ = document.getElementById('exec-filter-status')?.value || 'ALL';
        const filtered = commands.filter(c =>
          (!symQ || c.symbol.includes(symQ)) && (stQ === 'ALL' || c.status === stQ)
        );
        const tbody = document.getElementById('exec-cmd-tbody');
        if (tbody) tbody.innerHTML = renderCmdRows(filtered);
      };
      document.getElementById('exec-filter-sym')?.addEventListener('input', applyFilter);
      document.getElementById('exec-filter-status')?.addEventListener('change', applyFilter);
      return;
    }

    if (route.path === '/copy-trading') {
      const subs = portfolio.subscriptions || [];
      body.innerHTML = `
        <div class="grid lg:grid-cols-3 gap-6 mb-6">
          <div class="glass-card rounded-xl p-6 lg:col-span-2">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-semibold text-white">Active Copy Mandates & Lifecycle Gate Status</h3>
              <a href="#/marketplace" class="text-xs text-brand-400 hover:underline">+ Select Strategy</a>
            </div>
            ${subs.length ? `
              <table class="w-full text-xs">
                <thead><tr class="border-b border-surface-800 text-surface-500">
                  <th class="text-left pb-2">Strategy</th><th class="text-left pb-2">Stage</th><th class="text-right pb-2">Allocation</th><th class="text-right pb-2">Risk/Trade</th><th class="text-center pb-2">State</th>
                </tr></thead>
                <tbody>
                  ${subs.map(s => `
                    <tr class="border-b border-surface-800/50">
                      <td class="py-2.5 text-white font-medium">${s.strategyName}</td>
                      <td class="py-2.5"><span class="chip chip-yellow text-[10px]">${s.lifecycle_status}</span></td>
                      <td class="py-2.5 text-right font-mono">$${Number(s.allocation).toLocaleString()}</td>
                      <td class="py-2.5 text-right font-mono">${s.riskPerTradePct}%</td>
                      <td class="py-2.5 text-center"><span class="chip ${s.status === 'active' ? 'chip-green' : 'chip-yellow'}">${s.status}</span></td>
                    </tr>`).join('')}
                </tbody>
              </table>` : '<div class="text-xs text-surface-500 py-4">No copy mandates configured. Visit Strategies to allocate capital.</div>'}
          </div>
          <div class="glass-card rounded-xl p-6">
            <h3 class="text-sm font-semibold text-white mb-3">Risk-Normalized Lot Calculator</h3>
            <form id="size-calc-form" onsubmit="return false;" class="space-y-3 text-xs">
              <div class="grid grid-cols-2 gap-2">
                <div><label class="text-surface-400 block mb-1">Equity ($)</label><input name="equity" type="number" value="10000" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Risk %</label><input name="risk_pct" type="number" step="0.05" value="0.5" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Stop Dist ($)</label><input name="stop_distance" type="number" step="0.1" value="5.0" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-white font-mono"></div>
                <div><label class="text-surface-400 block mb-1">Tick Value ($)</label><input name="tick_value" type="number" step="0.01" value="1.0" class="w-full bg-surface-800 border border-surface-700 rounded px-2.5 py-1.5 text-white font-mono"></div>
              </div>
              <button type="submit" class="btn-primary w-full py-2 rounded-lg text-white font-semibold">Compute Exact Lot Size</button>
              <div id="size-calc-out" class="p-3 rounded bg-surface-900/70 border border-surface-800 font-mono text-surface-300">Calculates volume = floor((Equity × Risk%) / LossPerLot)</div>
            </form>
          </div>
        </div>`;

      document.getElementById('size-calc-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const out = document.getElementById('size-calc-out');
        try {
          const r = await api.previewPositionSize(f);
          out.innerHTML = `<strong class="text-profit">${r.volume} lots</strong> • Budget: $${r.risk_budget.toFixed(2)} • Actual Risk: ${r.actual_risk_pct.toFixed(3)}%`;
        } catch (err) {
          out.innerHTML = `<span class="text-loss">${err.message}</span>`;
        }
      });
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

    if (route.path === '/research') {
      const existing = await api.getBacktests().catch(() => ({ backtests: [] }));
      const renderReport = (bt) => {
        if (!bt) return '<div class="text-xs text-surface-500 p-6 border border-dashed border-surface-700 rounded-xl text-center">No backtests recorded yet. Configure parameters above and run validation.</div>';
        const m = bt.metrics || bt;
        const oos = bt.out_of_sample || bt.oos_metrics?.out_of_sample || {};
        const ins = bt.in_sample || bt.oos_metrics?.in_sample || {};
        const wf = bt.walk_forward || bt.walk_forward_metrics || [];
        const mc = bt.monte_carlo || {};
        const origin = bt.data_origin || 'SIMULATED_RESEARCH';
        return `
          <div class="glass-card rounded-xl p-6 space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-base font-bold text-white">${bt.strategy_id} (${bt.symbol || 'XAUUSD'})</h3>
                  <span class="chip ${origin === 'REAL_MARKET' ? 'chip-green' : 'chip-yellow'} font-mono text-[10px]">DATA ORIGIN: ${origin}</span>
                  ${bt.can_promote_to_backtested ? '<span class="chip chip-blue text-[10px]">PROMOTED → BACKTESTED</span>' : '<span class="chip chip-yellow text-[10px]">RESEARCH CALIBRATION ONLY</span>'}
                </div>
                <p class="text-xs text-surface-400 mt-1">Volume Source: ${bt.volume_source || 'TICK_VOLUME'} • Bars: ${bt.bars || '—'} • Spread: ${bt.cost_model?.spread_points ?? 25} pts • Slippage: ${bt.cost_model?.slippage_points ?? 5} pts</p>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Total Return</span><strong class="${(m.total_return_pct || 0) >= 0 ? 'text-profit' : 'text-loss'} font-mono">${m.total_return_pct ?? 0}%</strong></div>
              <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Sharpe Ratio</span><strong class="text-white font-mono">${m.sharpe_ratio ?? '—'}</strong></div>
              <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Max Drawdown</span><strong class="text-loss font-mono">${m.max_drawdown_pct ?? 0}%</strong></div>
              <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Profit Factor</span><strong class="text-white font-mono">${m.profit_factor ?? '—'}</strong></div>
              <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Win Rate / Trades</span><strong class="text-white font-mono">${m.win_rate_pct ?? 0}% (${m.total_trades ?? 0})</strong></div>
              <div class="p-3 rounded bg-surface-900/70 border border-surface-800"><span class="text-surface-500 block">Risk of Ruin</span><strong class="text-warn font-mono">${m.risk_of_ruin_pct ?? '—'}%</strong></div>
            </div>

            <div class="grid lg:grid-cols-2 gap-6">
              <div><div class="text-xs text-surface-400 mb-2">Equity Curve (${origin})</div><div class="h-52"><canvas id="bt-equity-chart"></canvas></div></div>
              <div><div class="text-xs text-surface-400 mb-2">Drawdown Curve (%)</div><div class="h-52"><canvas id="bt-dd-chart"></canvas></div></div>
            </div>

            <div class="grid md:grid-cols-2 gap-4 text-xs">
              <div class="p-4 rounded-xl bg-surface-900/60 border border-surface-800 space-y-2">
                <div class="font-semibold text-white">In-Sample (70%) vs Out-of-Sample (30%)</div>
                <div class="flex justify-between"><span class="text-surface-400">IS Return / Trades</span><span class="font-mono text-white">${ins.total_return_pct ?? '—'}% (${ins.total_trades ?? 0})</span></div>
                <div class="flex justify-between"><span class="text-surface-400">OOS Return / Trades</span><span class="font-mono text-white">${oos.total_return_pct ?? '—'}% (${oos.total_trades ?? 0})</span></div>
                <div class="flex justify-between"><span class="text-surface-400">OOS Sharpe / Max DD</span><span class="font-mono text-white">${oos.sharpe_ratio ?? '—'} / ${oos.max_drawdown_pct ?? '—'}%</span></div>
              </div>
              <div class="p-4 rounded-xl bg-surface-900/60 border border-surface-800 space-y-2">
                <div class="font-semibold text-white">Monte Carlo Trade Resampling (${mc.simulations || 0} paths • SIMULATED_RESEARCH)</div>
                <div class="flex justify-between"><span class="text-surface-400">Terminal Equity P05 / P50 / P95</span><span class="font-mono text-white">$${mc.terminal_equity_p05 ?? '—'} / $${mc.terminal_equity_p50 ?? '—'} / $${mc.terminal_equity_p95 ?? '—'}</span></div>
                <div class="flex justify-between"><span class="text-surface-400">MC Max Drawdown P95 / P99</span><span class="font-mono text-loss">${mc.max_drawdown_p95_pct ?? '—'}% / ${mc.max_drawdown_p99_pct ?? '—'}%</span></div>
                <div class="flex justify-between"><span class="text-surface-400">Prob. Breach ${mc.ruin_threshold_pct ?? 20}% Drawdown</span><span class="font-mono text-warn">${mc.prob_breach_ruin_pct ?? '—'}%</span></div>
              </div>
            </div>

            ${wf.length ? `
              <div>
                <div class="text-xs font-semibold text-white mb-2">Walk-Forward Windows</div>
                <div class="grid sm:grid-cols-3 gap-3 text-xs">
                  ${wf.map(w => `<div class="p-3 rounded bg-surface-900/60 border border-surface-800">Window ${w.window}: <strong class="font-mono text-white">${w.total_return_pct}%</strong> (${w.total_trades} trades, DD ${w.max_drawdown_pct}%)</div>`).join('')}
                </div>
              </div>` : ''}
          </div>`;
      };

      body.innerHTML = `
        <div class="glass-card rounded-xl p-6 mb-6">
          <h3 class="text-sm font-semibold text-white mb-4">Run Python Backtest + Walk-Forward + Monte Carlo Validation</h3>
          <form id="bt-form" onsubmit="return false;" class="space-y-4 text-xs">
            <div class="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label class="text-surface-400 block mb-1">Strategy</label>
                <select name="strategy_id" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white">
                  <option value="ul-01-gold-trend">UL-01 Gold Trend</option>
                  <option value="ul-02-liquidity-sweep">UL-02 Liquidity Sweep</option>
                  <option value="ul-03-volume-profile">UL-03 Volume Profile</option>
                </select>
              </div>
              <div>
                <label class="text-surface-400 block mb-1">Data Source</label>
                <select name="data_source" id="bt-source" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white">
                  <option value="TWELVE_DATA">Twelve Data XAU/USD (Real)</option>
                  <option value="BROKER_EXPORT_CSV">MT5 Broker CSV Upload (Real)</option>
                  <option value="SIMULATED_RESEARCH" selected>Synthetic Regime (Calibration Only)</option>
                </select>
              </div>
              <div>
                <label class="text-surface-400 block mb-1">Interval</label>
                <select name="interval" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white">
                  <option value="15m" selected>15m</option>
                  <option value="1h">1h</option>
                </select>
              </div>
              <div>
                <label class="text-surface-400 block mb-1">Capital ($)</label>
                <input name="initial_capital" type="number" value="10000" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono">
              </div>
              <div>
                <label class="text-surface-400 block mb-1">Spread (pts)</label>
                <input name="spread_points" type="number" value="25" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono">
              </div>
              <div>
                <label class="text-surface-400 block mb-1">Slippage (pts)</label>
                <input name="slippage_points" type="number" value="5" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono">
              </div>
            </div>
            <div id="bt-csv-box" class="hidden">
              <label class="text-surface-400 block mb-1">Paste MT5 Exported XAUUSD OHLCV CSV (Tab or Comma Separated)</label>
              <textarea name="csv_text" rows="4" placeholder="<DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL>" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-white font-mono"></textarea>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-surface-500">Requires Researcher, Strategy Provider, or Admin role. Synthetic runs stay tagged SIMULATED_RESEARCH.</span>
              <button type="submit" id="bt-run-btn" class="btn-primary px-5 py-2.5 rounded-lg text-white font-semibold">Run Validation Suite</button>
            </div>
          </form>
        </div>
        <div id="bt-output">${renderReport(existing.backtests?.[0])}</div>`;

      const srcSelect = document.getElementById('bt-source');
      srcSelect?.addEventListener('change', () => {
        document.getElementById('bt-csv-box')?.classList.toggle('hidden', srcSelect.value !== 'BROKER_EXPORT_CSV');
      });

      const drawCharts = (bt) => {
        if (!bt?.equity_curve?.length) return;
        destroyAllCharts();
        const labels = bt.equity_curve.map((_, i) => `B${i}`);
        setTimeout(() => {
          createEquityCurve('bt-equity-chart', labels, bt.equity_curve);
          if (bt.drawdown_series?.length) createDrawdownChart('bt-dd-chart', labels, bt.drawdown_series);
        }, 40);
      };
      if (existing.backtests?.[0]) drawCharts(existing.backtests[0]);

      document.getElementById('bt-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const btn = document.getElementById('bt-run-btn');
        btn.disabled = true; btn.textContent = 'Running Python Engine...';
        try {
          const res = await api.runBacktest({
            strategy_id: f.strategy_id,
            data_source: f.data_source,
            interval: f.interval,
            initial_capital: Number(f.initial_capital),
            csv_text: f.csv_text || null,
            cost_model: {
              spread_points: Number(f.spread_points),
              slippage_points: Number(f.slippage_points),
              commission_per_lot_round_turn: 7.0
            }
          });
          document.getElementById('bt-output').innerHTML = renderReport(res.backtest);
          drawCharts(res.backtest);
          showToast('Backtest validation complete.', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          btn.disabled = false; btn.textContent = 'Run Validation Suite';
        }
      });

      return () => destroyAllCharts();
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
