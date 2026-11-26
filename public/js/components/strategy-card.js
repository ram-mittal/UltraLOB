// Strategy Card Component
export function renderStrategyCard(strategy) {
  const pnlPositive = strategy.total_return >= 0;
  const pnlClass = pnlPositive ? 'text-profit' : 'text-loss';
  const pnlBg = pnlPositive ? 'chip-green' : 'chip-red';
  const riskColors = { low: 'chip-green', medium: 'chip-yellow', high: 'chip-red' };
  const riskChip = riskColors[strategy.risk_level] || 'chip-blue';

  // Mini sparkline from monthly returns
  const sparkSvg = renderSparkline(strategy.monthly_returns || [], pnlPositive);

  return `
  <a href="#/strategy/${strategy.id}" class="glass-card rounded-xl p-5 block group cursor-pointer">
    <!-- Header -->
    <div class="flex items-start justify-between mb-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br ${strategy.gradient || 'from-brand-500 to-brand-700'} flex items-center justify-center text-white font-bold text-sm shadow-lg">
          ${strategy.icon || strategy.name.charAt(0)}
        </div>
        <div>
          <h3 class="text-sm font-semibold text-white group-hover:text-brand-300 transition-colors">${strategy.name}</h3>
          <p class="text-xs text-surface-400">${strategy.author} • ${strategy.instrument}</p>
        </div>
      </div>
      <span class="chip ${strategy.status === 'active' ? 'chip-green' : 'chip-yellow'}">${strategy.status === 'active' ? '● Live' : '⏸ Paused'}</span>
    </div>

    <!-- Description -->
    <p class="text-xs text-surface-400 mb-4 line-clamp-2 leading-relaxed">${strategy.description}</p>

    <!-- Sparkline -->
    <div class="mb-4 h-10 flex items-center">
      ${sparkSvg}
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-3 gap-3 mb-4">
      <div>
        <span class="text-xs text-surface-500 block">Return</span>
        <span class="text-sm font-semibold ${pnlClass}">${pnlPositive ? '+' : ''}${strategy.total_return?.toFixed(1)}%</span>
      </div>
      <div>
        <span class="text-xs text-surface-500 block">Win Rate</span>
        <span class="text-sm font-semibold text-white">${strategy.win_rate?.toFixed(0)}%</span>
      </div>
      <div>
        <span class="text-xs text-surface-500 block">Sharpe</span>
        <span class="text-sm font-semibold text-white">${strategy.sharpe_ratio?.toFixed(2)}</span>
      </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between pt-3 border-t border-surface-800/50">
      <div class="flex items-center gap-3">
        <span class="chip ${riskChip}">${strategy.risk_level}</span>
        <span class="text-xs text-surface-500">${strategy.subscribers || 0} copiers</span>
      </div>
      <span class="text-xs text-surface-500">${strategy.timeframe}</span>
    </div>
  </a>`;
}

function renderSparkline(data, positive) {
  if (!data.length) return '<span class="text-xs text-surface-600">No data</span>';
  const w = 200, h = 36;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = positive ? '#10b981' : '#ef4444';
  const fill = positive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full h-full" preserveAspectRatio="none">
    <polygon points="${areaPoints}" fill="${fill}" />
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

export function renderStrategyCardSkeleton() {
  return `
  <div class="glass-card rounded-xl p-5 animate-pulse">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-10 h-10 rounded-lg bg-surface-700"></div>
      <div class="flex-1">
        <div class="h-4 bg-surface-700 rounded w-24 mb-2"></div>
        <div class="h-3 bg-surface-800 rounded w-32"></div>
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
