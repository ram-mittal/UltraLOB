// Strategy Marketplace Page (API-backed with search, filter & Publish EA modal)
import { renderStrategyCard, renderStrategyCardSkeleton } from '../components/strategy-card.js';
import { api } from '../api.js';
import { showToast } from '../app.js';

const CATEGORIES = [
  { id: 'all', label: 'All Strategies', icon: '📋' },
  { id: 'trend', label: 'Trend Following', icon: '📈' },
  { id: 'mean-reversion', label: 'Mean Reversion', icon: '🔄' },
  { id: 'scalping', label: 'Scalping', icon: '⚡' },
  { id: 'volatility', label: 'Volatility', icon: '💥' },
  { id: 'hedge', label: 'Hedging', icon: '🛡️' },
  { id: 'grid', label: 'Grid Trading', icon: '🔲' },
  { id: 'arbitrage', label: 'Arbitrage', icon: '⚡' },
];

export function render() {
  return `
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
      <div>
        <h1 class="text-3xl font-bold text-white mb-2">Strategy & EA Marketplace</h1>
        <p class="text-surface-400">Browse Monte Carlo-validated Expert Advisors. Copy directly to your MT5 or Exness account.</p>
      </div>
      <button id="open-publish-modal" class="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex-shrink-0">
        + Add Strategy / EA
      </button>
    </div>

    <!-- Summary Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-400 mb-1">Total Strategies</div>
        <div class="text-xl font-bold text-white" id="mkt-total">—</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-400 mb-1">Active Copiers</div>
        <div class="text-xl font-bold text-profit" id="mkt-copiers">—</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-400 mb-1">Best Sharpe</div>
        <div class="text-xl font-bold text-brand-400" id="mkt-sharpe">—</div>
      </div>
      <div class="glass-card rounded-xl p-4">
        <div class="text-xs text-surface-400 mb-1">Avg Win Rate</div>
        <div class="text-xl font-bold text-white" id="mkt-winrate">—</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap gap-2 mb-6" id="category-filters">
      ${CATEGORIES.map(c => `
        <button data-category="${c.id}"
                class="category-btn flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       ${c.id === 'all' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30' : 'bg-surface-800/50 text-surface-400 border border-surface-700/50 hover:text-white hover:border-surface-600'}">
          <span>${c.icon}</span>
          <span>${c.label}</span>
        </button>
      `).join('')}
    </div>

    <!-- Search & Sort -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div class="flex items-center gap-3 flex-1 max-w-md">
        <input id="search-input" type="text" placeholder="Search strategy, instrument, or author..."
               class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-2 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500">
        <span class="text-sm text-surface-400 whitespace-nowrap" id="result-count">Loading...</span>
      </div>
      <select id="sort-select" class="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
        <option value="return">Highest Return</option>
        <option value="sharpe">Best Sharpe Ratio</option>
        <option value="winrate">Highest Win Rate</option>
        <option value="drawdown">Lowest Drawdown</option>
        <option value="subscribers">Most Popular</option>
        <option value="risk-low">Risk: Low → High</option>
      </select>
    </div>

    <!-- Strategy Grid -->
    <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6" id="strategy-grid">
      ${Array(6).fill(0).map(() => renderStrategyCardSkeleton()).join('')}
    </div>
  </div>

  <!-- Publish Strategy Modal -->
  <div id="publish-modal" class="fixed inset-0 bg-black/70 z-50 hidden flex items-center justify-center p-4">
    <div class="glass rounded-2xl max-w-lg w-full p-6 border border-surface-700 shadow-2xl">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-white">Add Strategy / Expert Advisor</h2>
        <button id="close-publish-modal" class="text-surface-400 hover:text-white text-xl">&times;</button>
      </div>
      <form id="publish-form" onsubmit="return false;" class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-surface-400 block mb-1">Strategy / EA Name</label>
            <input name="name" required placeholder="e.g., Exness Gold MC EA"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Author</label>
            <input name="author" value="Ram Mittal"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs text-surface-400 block mb-1">Category</label>
            <select name="category" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="trend">Trend</option>
              <option value="mean-reversion">Mean Reversion</option>
              <option value="scalping">Scalping</option>
              <option value="volatility">Volatility</option>
              <option value="hedge">Hedging</option>
              <option value="grid">Grid</option>
              <option value="arbitrage">Arbitrage</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Instrument</label>
            <input name="instrument" value="BTC/USD"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Risk Level</label>
            <select name="risk_level" class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-3">
          <div>
            <label class="text-xs text-surface-400 block mb-1">Return %</label>
            <input name="total_return" type="number" step="0.1" value="42.5"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Win Rate %</label>
            <input name="win_rate" type="number" step="0.1" value="64.0"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Sharpe</label>
            <input name="sharpe_ratio" type="number" step="0.01" value="2.05"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
          </div>
          <div>
            <label class="text-xs text-surface-400 block mb-1">Min Capital $</label>
            <input name="min_capital" type="number" value="500"
                   class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white">
          </div>
        </div>
        <div>
          <label class="text-xs text-surface-400 block mb-1">Description</label>
          <textarea name="description" rows="3" required placeholder="Describe logic, Monte Carlo validation criteria, and target instruments..."
                    class="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white"></textarea>
        </div>
        <div class="flex justify-end gap-3 pt-2">
          <button type="button" id="cancel-publish-modal" class="btn-outline px-4 py-2 rounded-lg text-sm text-white">Cancel</button>
          <button type="submit" class="btn-primary px-5 py-2 rounded-lg text-sm font-semibold text-white">Publish to Catalogue</button>
        </div>
      </form>
    </div>
  </div>`;
}

export function init() {
  const grid = document.getElementById('strategy-grid');
  const sortSelect = document.getElementById('sort-select');
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
    if (!allStrategies.length) return;
    document.getElementById('mkt-total').textContent = allStrategies.length;
    document.getElementById('mkt-copiers').textContent = allStrategies.reduce((s, st) => s + (st.subscribers || 0), 0).toLocaleString();
    document.getElementById('mkt-sharpe').textContent = Math.max(...allStrategies.map(s => s.sharpe_ratio || 0)).toFixed(2);
    document.getElementById('mkt-winrate').textContent = (allStrategies.reduce((s, st) => s + (st.win_rate || 0), 0) / allStrategies.length).toFixed(1) + '%';
  }

  function renderGrid() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    let filtered = activeCategory === 'all' ? [...allStrategies] : allStrategies.filter(s => s.category === activeCategory);
    if (q) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q) ||
        s.instrument.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    }

    const sort = sortSelect?.value || 'return';
    const riskOrder = { low: 0, medium: 1, high: 2 };
    const sorters = {
      'return': (a, b) => b.total_return - a.total_return,
      'sharpe': (a, b) => b.sharpe_ratio - a.sharpe_ratio,
      'winrate': (a, b) => b.win_rate - a.win_rate,
      'drawdown': (a, b) => b.max_drawdown - a.max_drawdown,
      'subscribers': (a, b) => b.subscribers - a.subscribers,
      'risk-low': (a, b) => (riskOrder[a.risk_level] ?? 1) - (riskOrder[b.risk_level] ?? 1),
    };
    filtered.sort(sorters[sort] || sorters['return']);
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
        b.className = b.className.replace(/bg-surface-800\/50 text-surface-400 border border-surface-700\/50 hover:text-white hover:border-surface-600/, 'bg-brand-500/20 text-brand-300 border border-brand-500/30');
      } else {
        b.className = b.className.replace(/bg-brand-500\/20 text-brand-300 border border-brand-500\/30/, 'bg-surface-800/50 text-surface-400 border border-surface-700/50 hover:text-white hover:border-surface-600');
      }
    });
    renderGrid();
  });

  sortSelect?.addEventListener('change', renderGrid);
  searchInput?.addEventListener('input', renderGrid);

  // Modal controls
  const modal = document.getElementById('publish-modal');
  const closeModal = () => modal?.classList.add('hidden');
  document.getElementById('open-publish-modal')?.addEventListener('click', () => modal?.classList.remove('hidden'));
  document.getElementById('close-publish-modal')?.addEventListener('click', closeModal);
  document.getElementById('cancel-publish-modal')?.addEventListener('click', closeModal);

  document.getElementById('publish-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    try {
      const res = await api.createStrategy(data);
      allStrategies.unshift(res.strategy);
      updateSummaryStats();
      renderGrid();
      closeModal();
      form.reset();
      showToast(`Published "${res.strategy.name}" to the marketplace!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadStrategies();
  return null;
}
