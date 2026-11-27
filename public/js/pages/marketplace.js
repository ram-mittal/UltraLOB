// Quantitative Strategy Registry (Zero Fabricated Metrics • Explicit Lifecycle Gates)
import { renderStrategyCard, renderStrategyCardSkeleton } from '../components/strategy-card.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { showToast } from '../app.js';

const CATEGORIES = [
  { id: 'all', label: 'All Strategies', icon: '📋' },
  { id: 'trend', label: 'Trend Following', icon: '📈' },
  { id: 'market-structure', label: 'Liquidity / Structure', icon: '💧' },
  { id: 'mean-reversion', label: 'Mean Reversion / VP', icon: '📊' },
  { id: 'scalping', label: 'Momentum Scalping', icon: '⚡' },
  { id: 'multi-regime', label: 'Adaptive Multi-Regime', icon: '🧭' },
];

export function render() {
  return `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <h1 class="text-2xl font-bold text-white">Quantitative Strategy Registry</h1>
          <span class="chip chip-yellow text-[11px]">Phase 1 • XAUUSD Core Focus</span>
        </div>
        <p class="text-sm text-surface-400">
          Strategies advance strictly through gated stages: <span class="text-surface-200 font-mono text-xs">RESEARCH → BACKTESTED → FORWARD TESTING → LIVE PILOT → VERIFIED LIVE</span>.
        </p>
      </div>
      <button id="open-publish-modal" class="btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold text-white flex-shrink-0">
        + Submit Strategy Spec
      </button>
    </div>

    <!-- Integrity Notice -->
    <div class="mb-6 p-4 rounded-xl bg-warn-bg border border-warn/20 flex items-start gap-3">
      <span class="text-lg">🔍</span>
      <div class="text-xs text-surface-300 leading-relaxed">
        <strong class="text-warn">Data Integrity Standard:</strong> No synthetic backtests or invented win rates are shown.
        All 5 core XAUUSD models (UL-01 through UL-05) are registered in <span class="font-mono text-warn">RESEARCH</span> status with empirical fields set to <span class="font-mono">Pending</span> until Phase 2 backtesting completes.
      </div>
    </div>

    <!-- Summary Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-400 mb-1">Registered Models</div>
        <div class="text-xl font-bold text-white" id="mkt-total">—</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-400 mb-1">In Research Stage</div>
        <div class="text-xl font-bold text-warn" id="mkt-research">—</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-400 mb-1">Backtested / Demo Verified</div>
        <div class="text-xl font-bold text-brand-400" id="mkt-validated">—</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-400 mb-1">Primary Instrument</div>
        <div class="text-xl font-bold text-white font-mono">XAUUSD</div>
      </div>
    </div>

    <!-- Category Filters -->
    <div class="flex flex-wrap gap-2 mb-6" id="category-filters">
      ${CATEGORIES.map(c => `
        <button data-category="${c.id}"
                class="category-btn flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors
                       ${c.id === 'all' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30' : 'bg-surface-800/50 text-surface-400 border border-surface-700/50 hover:text-white'}">
          <span>${c.icon}</span><span>${c.label}</span>
        </button>
      `).join('')}
    </div>

    <!-- Search & Lifecycle Filter -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div class="flex items-center gap-3 flex-1 max-w-md">
        <input id="search-input" type="text" placeholder="Search UL-01, XAUUSD, author, or rule logic..."
               class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-2 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500">
        <span class="text-xs text-surface-400 whitespace-nowrap" id="result-count">Loading...</span>
      </div>
      <div class="flex gap-2">
        <select id="lifecycle-select" class="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-xs text-white">
          <option value="ALL">All Lifecycle Stages</option>
          <option value="RESEARCH">RESEARCH</option>
          <option value="BACKTESTED">BACKTESTED</option>
          <option value="FORWARD_TESTING">FORWARD TESTING</option>
          <option value="LIVE_PILOT">LIVE PILOT</option>
          <option value="VERIFIED_LIVE">VERIFIED LIVE</option>
        </select>
        <select id="sort-select" class="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-xs text-white">
          <option value="code">Code (UL-01..UL-05)</option>
          <option value="risk-low">Risk: Low → High</option>
          <option value="return">Verified Return</option>
          <option value="sharpe">Verified Sharpe</option>
        </select>
      </div>
    </div>

    <!-- Strategy Grid -->
    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6" id="strategy-grid">
      ${Array(5).fill(0).map(() => renderStrategyCardSkeleton()).join('')}
    </div>
  </div>

  <!-- Submit Strategy Specification Modal (Zero Fake Stats) -->
  <div id="publish-modal" class="fixed inset-0 bg-black/70 z-50 hidden flex items-center justify-center p-4">
    <div class="glass rounded-2xl max-w-lg w-full p-6 border border-surface-700 shadow-2xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="text-lg font-bold text-white">Submit Strategy Specification</h2>
          <p class="text-xs text-surface-400">Requires Strategy Provider or Researcher role. Registered in RESEARCH stage.</p>
        </div>
        <button id="close-publish-modal" class="text-surface-400 hover:text-white text-xl">&times;</button>
      </div>
      <form id="publish-form" onsubmit="return false;" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-surface-400 block mb-1">Strategy Name</label>
            <input name="name" required placeholder="e.g., UL-06: London Open Sweep"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Strategy Code</label>
            <input name="code" placeholder="e.g., UL-06"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs text-surface-400 block mb-1">Category</label>
            <select name="category" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="trend">Trend Following</option>
              <option value="market-structure">Market Structure</option>
              <option value="mean-reversion">Mean Reversion</option>
              <option value="scalping">Scalping</option>
              <option value="multi-regime">Multi-Regime</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Instrument</label>
            <input name="instrument" value="XAUUSD"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Risk / Trade %</label>
            <input name="risk_per_trade_pct" type="number" step="0.05" min="0.05" max="2.0" value="0.5"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-surface-400 block mb-1">Timeframes</label>
            <input name="timeframe" value="H4 / H1 / M15"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Min Capital ($)</label>
            <input name="min_capital" type="number" min="100" value="1000"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white font-mono">
          </div>
        </div>
        <div>
          <label class="text-xs text-surface-400 block mb-1">Objective & Methodology Description</label>
          <textarea name="description" rows="2" required placeholder="Strategy thesis, regime conditions, and execution constraints..."
                    class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white"></textarea>
        </div>
        <div>
          <label class="text-xs text-surface-400 block mb-1">Entry & Stop-Loss Logic</label>
          <textarea name="entry_logic" rows="2" required placeholder="Explicit entry trigger, invalidation point, and spread filter..."
                    class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white"></textarea>
        </div>
        <div class="flex justify-end gap-3 pt-2">
          <button type="button" id="cancel-publish-modal" class="btn-outline px-4 py-2 rounded-lg text-sm text-white">Cancel</button>
          <button type="submit" class="btn-primary px-5 py-2 rounded-lg text-sm font-semibold text-white">Submit as RESEARCH</button>
        </div>
      </form>
    </div>
  </div>`;
}

export function init() {
  const grid = document.getElementById('strategy-grid');
  const sortSelect = document.getElementById('sort-select');
  const lifecycleSelect = document.getElementById('lifecycle-select');
  const searchInput = document.getElementById('search-input');
  const resultCount = document.getElementById('result-count');
  let activeCategory = 'all';
  let allStrategies = [];

  async function loadStrategies() {
    try {
      const res = await api.getStrategies();
      allStrategies = res.strategies || [];
      window.__strategies = allStrategies;
      updateSummaryStats();
      renderGrid();
    } catch (err) {
      showToast('Failed to load strategies: ' + err.message, 'error');
    }
  }

  function updateSummaryStats() {
    document.getElementById('mkt-total').textContent = allStrategies.length;
    const inResearch = allStrategies.filter(s => s.lifecycle_status === 'RESEARCH').length;
    const validated = allStrategies.filter(s => s.lifecycle_status !== 'RESEARCH').length;
    document.getElementById('mkt-research').textContent = inResearch;
    document.getElementById('mkt-validated').textContent = validated;
  }

  function renderGrid() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const lc = lifecycleSelect?.value || 'ALL';
    let filtered = activeCategory === 'all' ? [...allStrategies] : allStrategies.filter(s => s.category === activeCategory);
    if (lc !== 'ALL') filtered = filtered.filter(s => s.lifecycle_status === lc);
    if (q) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.code || '').toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q) ||
        s.instrument.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    }

    const sort = sortSelect?.value || 'code';
    const riskOrder = { low: 0, medium: 1, high: 2 };
    const sorters = {
      'code': (a, b) => String(a.code || a.id).localeCompare(String(b.code || b.id)),
      'return': (a, b) => (b.total_return ?? -Infinity) - (a.total_return ?? -Infinity),
      'sharpe': (a, b) => (b.sharpe_ratio ?? -Infinity) - (a.sharpe_ratio ?? -Infinity),
      'risk-low': (a, b) => (riskOrder[a.risk_level] ?? 1) - (riskOrder[b.risk_level] ?? 1),
    };
    filtered.sort(sorters[sort] || sorters['code']);

    if (grid) {
      grid.innerHTML = filtered.length
        ? filtered.map(s => renderStrategyCard(s)).join('')
        : '<div class="col-span-full text-center py-12 text-surface-400">No strategies match your filters.</div>';
    }
    if (resultCount) resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'strategy' : 'strategies'}`;
  }

  document.getElementById('category-filters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    activeCategory = btn.dataset.category;
    document.querySelectorAll('.category-btn').forEach(b => {
      if (b.dataset.category === activeCategory) {
        b.classList.add('bg-brand-500/20', 'text-brand-300', 'border-brand-500/30');
        b.classList.remove('bg-surface-800/50', 'text-surface-400');
      } else {
        b.classList.remove('bg-brand-500/20', 'text-brand-300', 'border-brand-500/30');
        b.classList.add('bg-surface-800/50', 'text-surface-400');
      }
    });
    renderGrid();
  });

  sortSelect?.addEventListener('change', renderGrid);
  lifecycleSelect?.addEventListener('change', renderGrid);
  searchInput?.addEventListener('input', renderGrid);

  const modal = document.getElementById('publish-modal');
  const closeModal = () => modal?.classList.add('hidden');
  document.getElementById('open-publish-modal')?.addEventListener('click', () => {
    if (!state.isAuthenticated) {
      showToast('Sign in with a Strategy Provider or Researcher account to submit a strategy.', 'warning');
      location.hash = '#/auth?tab=signup';
      return;
    }
    modal?.classList.remove('hidden');
  });
  document.getElementById('close-publish-modal')?.addEventListener('click', closeModal);
  document.getElementById('cancel-publish-modal')?.addEventListener('click', closeModal);

  document.getElementById('publish-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const res = await api.createStrategy(data);
      allStrategies.unshift(res.strategy);
      updateSummaryStats();
      renderGrid();
      closeModal();
      e.target.reset();
      showToast(`Registered "${res.strategy.name}" in RESEARCH stage.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadStrategies();
  return null;
}
