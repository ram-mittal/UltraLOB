// Landing Page
export function render() {
  return `
  <!-- Hero Section -->
  <section class="relative overflow-hidden">
    <div class="hero-glow absolute inset-0 pointer-events-none"></div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-28">
      <div class="text-center max-w-4xl mx-auto">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 mb-6 animate-fade-in">
          <span class="w-1.5 h-1.5 rounded-full bg-profit animate-pulse"></span>
          <span class="text-xs font-medium text-brand-300">Live Trading • 24/7 Market Coverage</span>
        </div>
        <h1 class="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6 animate-slide-up">
          Copy Trade with<br>
          <span class="gradient-text">Institutional Edge</span>
        </h1>
        <p class="text-lg sm:text-xl text-surface-400 max-w-2xl mx-auto mb-10 animate-slide-up leading-relaxed" style="animation-delay:0.1s">
          Ultra-low-latency execution powered by Monte Carlo simulations.
          Connect your MT5 or Exness account and copy proven strategies in real-time.
        </p>
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up" style="animation-delay:0.2s">
          <a href="#/marketplace" class="btn-primary px-8 py-3.5 rounded-xl text-white font-semibold text-base w-full sm:w-auto text-center">
            Browse Strategies →
          </a>
          <a href="#/terminal" class="btn-outline px-8 py-3.5 rounded-xl text-white font-medium text-base w-full sm:w-auto text-center">
            Open Terminal
          </a>
        </div>
      </div>

      <!-- Live Stats Bar -->
      <div class="mt-20 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto animate-slide-up" style="animation-delay:0.3s">
        <div class="stat-card rounded-xl p-5 text-center border border-surface-800/50">
          <div class="text-2xl font-bold text-white" id="stat-strategies">12</div>
          <div class="text-xs text-surface-400 mt-1">Active Strategies</div>
        </div>
        <div class="stat-card rounded-xl p-5 text-center border border-surface-800/50">
          <div class="text-2xl font-bold text-profit" id="stat-return">+47.3%</div>
          <div class="text-xs text-surface-400 mt-1">Avg. Annual Return</div>
        </div>
        <div class="stat-card rounded-xl p-5 text-center border border-surface-800/50">
          <div class="text-2xl font-bold text-white" id="stat-latency">&lt;50μs</div>
          <div class="text-xs text-surface-400 mt-1">Order Latency</div>
        </div>
        <div class="stat-card rounded-xl p-5 text-center border border-surface-800/50">
          <div class="text-2xl font-bold text-white" id="stat-copiers">1,240</div>
          <div class="text-xs text-surface-400 mt-1">Active Copiers</div>
        </div>
      </div>
    </div>
  </section>

  <!-- How It Works -->
  <section class="py-24 border-t border-surface-800/30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-16">
        <h2 class="text-3xl font-bold text-white mb-4">How It Works</h2>
        <p class="text-surface-400 max-w-xl mx-auto">Three steps to institutional-grade copy trading</p>
      </div>
      <div class="grid md:grid-cols-3 gap-8">
        <div class="text-center group">
          <div class="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mx-auto mb-5 group-hover:bg-brand-500/20 transition-colors">
            <span class="text-2xl">🔗</span>
          </div>
          <div class="chip chip-blue mx-auto mb-3">Step 1</div>
          <h3 class="text-lg font-semibold text-white mb-2">Connect Your Broker</h3>
          <p class="text-sm text-surface-400 leading-relaxed">Link your MT5 or Exness account securely. We never store your credentials — all trades execute through your broker's API.</p>
        </div>
        <div class="text-center group">
          <div class="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mx-auto mb-5 group-hover:bg-brand-500/20 transition-colors">
            <span class="text-2xl">📊</span>
          </div>
          <div class="chip chip-blue mx-auto mb-3">Step 2</div>
          <h3 class="text-lg font-semibold text-white mb-2">Choose a Strategy</h3>
          <p class="text-sm text-surface-400 leading-relaxed">Browse our marketplace of Monte Carlo-validated strategies. Each comes with detailed performance metrics, drawdown analysis, and risk ratings.</p>
        </div>
        <div class="text-center group">
          <div class="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mx-auto mb-5 group-hover:bg-brand-500/20 transition-colors">
            <span class="text-2xl">🚀</span>
          </div>
          <div class="chip chip-blue mx-auto mb-3">Step 3</div>
          <h3 class="text-lg font-semibold text-white mb-2">Auto-Copy Trades</h3>
          <p class="text-sm text-surface-400 leading-relaxed">Set your risk level and capital allocation. Our engine mirrors every trade in real-time with sub-millisecond execution on your account.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Features Grid -->
  <section class="py-24 border-t border-surface-800/30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-16">
        <h2 class="text-3xl font-bold text-white mb-4">Built for Serious Traders</h2>
        <p class="text-surface-400 max-w-xl mx-auto">Every component engineered for performance and reliability</p>
      </div>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${[
          { icon: '⚡', title: 'Ultra-Low Latency', desc: 'C++20 matching engine processes orders in under 50 microseconds. Zero-allocation hot path with AVX2/FMA SIMD.' },
          { icon: '📈', title: 'Monte Carlo Engine', desc: '10M+ path simulations validate every strategy. GPU-accelerated (CUDA) pricing for real-time risk assessment.' },
          { icon: '🏛️', title: 'FIX 4.4 Protocol', desc: 'Full institutional FIX 4.4 session engine with heartbeat, sequence management, and persistent message store.' },
          { icon: '🤖', title: 'Expert Advisors', desc: 'Browse and deploy proven EAs. Each strategy runs through rigorous backtesting and Monte Carlo stress testing.' },
          { icon: '🔒', title: 'Risk Management', desc: 'Per-strategy position limits, drawdown circuit breakers, and real-time margin monitoring protect your capital.' },
          { icon: '📡', title: 'Live Market Data', desc: 'Real-time Kraken BTC/USD, Twelve Data US equities. WebSocket feeds with automatic reconnection and failover.' },
        ].map(f => `
          <div class="glass-card rounded-xl p-6">
            <div class="text-2xl mb-3">${f.icon}</div>
            <h3 class="text-base font-semibold text-white mb-2">${f.title}</h3>
            <p class="text-sm text-surface-400 leading-relaxed">${f.desc}</p>
          </div>
        `).join('')}
      </div>
    </div>
  </section>

  <!-- Architecture -->
  <section class="py-24 border-t border-surface-800/30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center mb-16">
        <h2 class="text-3xl font-bold text-white mb-4">System Architecture</h2>
        <p class="text-surface-400">From market data to trade execution — end-to-end in microseconds</p>
      </div>
      <div class="glass-card rounded-xl p-8 font-mono text-sm">
        <pre class="text-surface-300 overflow-x-auto leading-relaxed"><code>┌─────────────────────────────────────────────────────────────────────────┐
│                        UltraLOB Platform                                │
├───────────────────┬─────────────────┬───────────────────────────────────┤
│   Market Data     │  Copy Trading   │        Broker Gateway             │
│  ┌─────────────┐  │  ┌───────────┐  │  ┌────────────┐ ┌─────────────┐  │
│  │ Kraken WS   │  │  │ Strategy  │  │  │  MT5 API   │ │ Exness API  │  │
│  │ BTC/USD     │──│──│ Engine    │──│──│  WebSocket  │ │ REST/WS     │  │
│  └─────────────┘  │  └───────────┘  │  └────────────┘ └─────────────┘  │
│  ┌─────────────┐  │  ┌───────────┐  │                                   │
│  │ Twelve Data │  │  │ Monte     │  │  ┌──────────────────────────────┐ │
│  │ US Equities │──│──│ Carlo Sim │  │  │  C++20 Matching Engine       │ │
│  └─────────────┘  │  │ 10M paths │  │  │  FIX 4.4 · &lt;50μs latency    │ │
│                   │  └───────────┘  │  │  Lock-free MPSC · AVX2+FMA   │ │
├───────────────────┴─────────────────┤  └──────────────────────────────┘ │
│          Web Dashboard (SPA)        │                                   │
│  Landing · Marketplace · Terminal   │                                   │
│  Dashboard · Broker · Performance   │                                   │
└─────────────────────────────────────┴───────────────────────────────────┘</code></pre>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="py-24 border-t border-surface-800/30">
    <div class="max-w-3xl mx-auto px-4 text-center">
      <h2 class="text-3xl font-bold text-white mb-4">Ready to Trade Smarter?</h2>
      <p class="text-surface-400 mb-8 max-w-xl mx-auto">Join traders using Monte Carlo-validated strategies with institutional-grade execution.</p>
      <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
        <a href="#/auth" class="btn-primary px-8 py-3.5 rounded-xl text-white font-semibold w-full sm:w-auto text-center">
          Create Free Account
        </a>
        <a href="https://github.com/ram-mittal/UltraLOB" target="_blank" class="btn-outline px-8 py-3.5 rounded-xl text-white font-medium w-full sm:w-auto text-center">
          ⭐ Star on GitHub
        </a>
      </div>
    </div>
  </section>`;
}

export function init() {
  // Landing page doesn't need dynamic init
  return null;
}
