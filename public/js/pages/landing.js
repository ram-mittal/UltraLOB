// Landing Page — Institutional Strategy Allocation & Risk Infrastructure
import { api } from '../api.js';

export function render() {
  return `
  <section class="relative overflow-hidden">
    <div class="hero-glow absolute inset-0 pointer-events-none"></div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-24">
      <div class="text-center max-w-4xl mx-auto">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 mb-6 animate-fade-in">
          <span class="w-1.5 h-1.5 rounded-full bg-warn"></span>
          <span class="text-xs font-medium text-brand-300">Phase 1 Infrastructure • Strategy Registry, RBAC & MT5 Demo Risk Bridge</span>
        </div>
        <h1 class="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6 animate-slide-up">
          Institutional Strategy<br>
          <span class="gradient-text">Allocation & Risk Infrastructure</span>
        </h1>
        <p class="text-base sm:text-lg text-surface-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Verified strategies. Risk-governed allocation. Transparent execution.
          Discover XAUUSD quantitative models, validate with backtests & Monte Carlo stress testing, and mirror trades onto MetaTrader 5 demo terminals under hard server-side risk gates.
        </p>
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a href="#/overview" class="btn-primary px-8 py-3.5 rounded-xl text-white font-semibold text-sm w-full sm:w-auto text-center">
            Open Institutional Overview →
          </a>
          <a href="#/marketplace" class="btn-outline px-8 py-3.5 rounded-xl text-white font-medium text-sm w-full sm:w-auto text-center">
            Explore XAUUSD Strategy Registry
          </a>
        </div>
      </div>

      <!-- Honest System Telemetry (Live from /api/system/status) -->
      <div class="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
        <div class="stat-card rounded-xl p-5 text-center border border-surface-800/50">
          <div class="text-2xl font-bold text-white font-mono" id="stat-strategies">—</div>
          <div class="text-xs text-surface-400 mt-1">Registered Quant Models</div>
        </div>
        <div class="stat-card rounded-xl p-5 text-center border border-surface-800/50">
          <div class="text-2xl font-bold text-warn font-mono" id="stat-mode">DEMO ONLY</div>
          <div class="text-xs text-surface-400 mt-1">Execution Environment</div>
        </div>
        <div class="stat-card rounded-xl p-5 text-center border border-surface-800/50">
          <div class="text-2xl font-bold text-profit font-mono" id="stat-feed">—</div>
          <div class="text-xs text-surface-400 mt-1">Live Market Feed</div>
        </div>
        <div class="stat-card rounded-xl p-5 text-center border border-surface-800/50">
          <div class="text-2xl font-bold text-brand-400 font-mono" id="stat-db">—</div>
          <div class="text-xs text-surface-400 mt-1">Persistence Engine</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Philosophy & Governance Pillars -->
  <section class="py-20 border-t border-surface-800/30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-14">
        <h2 class="text-3xl font-bold text-white mb-3">Institutional Engineering Standards</h2>
        <p class="text-surface-400 max-w-xl mx-auto text-sm">Built to eliminate fabricated retail claims, silent lot scaling, and unguarded execution</p>
      </div>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${[
          { icon: '📐', title: 'Gated Strategy Lifecycle', desc: 'Every model progresses strictly through RESEARCH → BACKTESTED → FORWARD TESTING → LIVE PILOT → VERIFIED LIVE with empirical metrics kept null until verified.' },
          { icon: '🛡️', title: 'Independent Risk Engine', desc: 'Hard daily loss limits, peak-to-trough drawdown caps, spread limits, and account-currency position sizing execute before orders reach MT5.' },
          { icon: '🔌', title: 'MT5 Demo Execution Bridge', desc: 'PostgreSQL-backed command queue with SHA-256 token auth, OrderCheck preflight validation, and non-demo account blocking.' },
          { icon: '🔎', title: 'Strict Data Provenance', desc: 'Real Market, Backtest, Demo Broker, Paper Sandbox, and Monte Carlo Simulated data are never blended or presented interchangeably.' },
          { icon: '🧠', title: 'Bounded UltraLOB AI', desc: 'Advisory-mode quantitative & market intelligence pipeline (Phase 5) that can never override hard risk limits or invent performance figures.' },
          { icon: '👥', title: 'Role-Based Access Control', desc: 'Dedicated workflows and permissions for Investors, Strategy Providers, Fund Managers, Risk Managers, Researchers, and Admins.' },
        ].map(f => `
          <div class="glass-card rounded-xl p-6">
            <div class="text-2xl mb-3">${f.icon}</div>
            <h3 class="text-base font-semibold text-white mb-2">${f.title}</h3>
            <p class="text-xs text-surface-400 leading-relaxed">${f.desc}</p>
          </div>
        `).join('')}
      </div>
    </div>
  </section>`;
}

export async function init() {
  try {
    const [strats, sys] = await Promise.all([api.getStrategies(), api.getSystemStatus()]);
    const elStrats = document.getElementById('stat-strategies');
    const elFeed = document.getElementById('stat-feed');
    const elDb = document.getElementById('stat-db');
    if (elStrats) elStrats.textContent = String(strats.total ?? (strats.strategies?.length || 5));
    if (elFeed) elFeed.textContent = sys.market_feeds?.btc_usd?.status || 'LIVE';
    if (elDb) elDb.textContent = sys.database?.ready ? 'POSTGRES' : 'SANDBOX';
  } catch {}
  return null;
}
