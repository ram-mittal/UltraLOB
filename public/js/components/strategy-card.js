// Institutional Strategy Card Component (Honest Lifecycle & Provenance Labeling)

export function getLifecycleBadge(status) {
  const map = {
    RESEARCH: { cls: 'chip-yellow', label: 'RESEARCH • Pending Backtest' },
    BACKTESTED: { cls: 'chip-blue', label: 'BACKTESTED' },
    FORWARD_TESTING: { cls: 'chip-blue', label: 'FORWARD TESTING (Demo)' },
    LIVE_PILOT: { cls: 'chip-green', label: 'LIVE PILOT' },
    VERIFIED_LIVE: { cls: 'chip-green', label: '● VERIFIED LIVE' },
    PAUSED: { cls: 'chip-yellow', label: '⏸ PAUSED' },
    RETIRED: { cls: 'chip-red', label: 'RETIRED' }
  };
  return map[status] || { cls: 'chip-yellow', label: status || 'RESEARCH' };
}

function fmtMetric(val, suffix = '%', digits = 1, signed = false) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) {
    return '<span class="text-surface-500 text-xs font-normal">Pending</span>';
  }
  const n = Number(val);
  const prefix = signed && n > 0 ? '+' : '';
  return `${prefix}${n.toFixed(digits)}${suffix}`;
}

export function renderStrategyCard(strategy) {
  const lifecycle = getLifecycleBadge(strategy.lifecycle_status);
  const riskColors = { low: 'chip-green', medium: 'chip-yellow', high: 'chip-red' };
  const riskChip = riskColors[strategy.risk_level] || 'chip-blue';
  const hasBacktest = Array.isArray(strategy.monthly_returns) && strategy.monthly_returns.length > 0;
  const pnlPositive = Number(strategy.total_return || 0) >= 0;
  const sparkSvg = hasBacktest
    ? renderSparkline(strategy.monthly_returns, pnlPositive)
    : `<div class="w-full h-full rounded-lg bg-surface-900/70 border border-dashed border-surface-700/70 flex items-center justify-center text-[11px] text-surface-500">
         Awaiting historical backtest run (Phase 2)
       </div>`;

  return `
  <a href="#/strategy/${strategy.id}" class="glass-card rounded-xl p-5 block group cursor-pointer">
    <div class="flex items-start justify-between gap-2 mb-3">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br ${strategy.gradient || 'from-brand-500 to-brand-700'} flex items-center justify-center text-white font-bold text-sm shadow-lg flex-shrink-0">
          ${strategy.icon || strategy.code || '📐'}
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-mono text-brand-300 font-semibold">${strategy.code || 'STRAT'}</span>
            <span class="text-[11px] font-mono text-surface-500">v${strategy.version || '1.0.0'}</span>
          </div>
          <h3 class="text-sm font-semibold text-white group-hover:text-brand-300 transition-colors truncate">${strategy.name}</h3>
          <p class="text-xs text-surface-400 truncate">${strategy.instrument} • ${strategy.timeframe}</p>
        </div>
      </div>
      <span class="chip ${lifecycle.cls} text-[10px] whitespace-nowrap">${lifecycle.label}</span>
    </div>

    <p class="text-xs text-surface-400 mb-4 line-clamp-2 leading-relaxed">${strategy.description}</p>

    <div class="mb-4 h-10 flex items-center">
      ${sparkSvg}
    </div>

    <div class="grid grid-cols-3 gap-3 mb-4">
      <div>
        <span class="text-[11px] text-surface-500 block">Return</span>
        <span class="text-sm font-semibold ${strategy.total_return == null ? 'text-surface-400' : pnlPositive ? 'text-profit' : 'text-loss'}">
          ${fmtMetric(strategy.total_return, '%', 1, true)}
        </span>
      </div>
      <div>
        <span class="text-[11px] text-surface-500 block">Win Rate</span>
        <span class="text-sm font-semibold text-white">${fmtMetric(strategy.win_rate, '%', 1)}</span>
      </div>
      <div>
        <span class="text-[11px] text-surface-500 block">Sharpe</span>
        <span class="text-sm font-semibold text-white">${fmtMetric(strategy.sharpe_ratio, '', 2)}</span>
      </div>
    </div>

    <div class="flex items-center justify-between pt-3 border-t border-surface-800/50 text-xs">
      <div class="flex items-center gap-2">
        <span class="chip ${riskChip}">${strategy.risk_level} risk</span>
        <span class="text-surface-500 font-mono">${strategy.risk_per_trade_pct ?? 0.5}%/trade</span>
      </div>
      <span class="text-surface-500">Min $${Number(strategy.min_capital || 1000).toLocaleString()}</span>
    </div>
  </a>`;
}

function renderSparkline(data, positive) {
  if (!data.length) return '';
  const w = 200, h = 36;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = positive ? '#10b981' : '#ef4444';
  const fill = positive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full h-full" preserveAspectRatio="none">
    <polygon points="0,${h} ${points} ${w},${h}" fill="${fill}" />
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

export function renderStrategyCardSkeleton() {
  return `
  <div class="glass-card rounded-xl p-5 animate-pulse">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-10 h-10 rounded-lg bg-surface-700"></div>
      <div class="flex-1">
        <div class="h-4 bg-surface-700 rounded w-32 mb-2"></div>
        <div class="h-3 bg-surface-800 rounded w-24"></div>
      </div>
    </div>
    <div class="h-3 bg-surface-800 rounded w-full mb-2"></div>
    <div class="h-3 bg-surface-800 rounded w-3/4 mb-4"></div>
    <div class="h-10 bg-surface-800 rounded mb-4"></div>
    <div class="grid grid-cols-3 gap-3">
      <div class="h-8 bg-surface-800 rounded"></div>
      <div class="h-8 bg-surface-800 rounded"></div>
      <div class="h-8 bg-surface-800 rounded"></div>
    </div>
  </div>`;
}
