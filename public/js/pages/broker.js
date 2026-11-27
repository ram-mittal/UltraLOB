// Broker Connection Page (MT5 & Exness + MQL5 Copy Bridge EA)
import { api } from '../api.js';
import { state } from '../state.js';
import { showToast } from '../app.js';

const BROKERS = [
  {
    id: 'mt5',
    name: 'MetaTrader 5',
    icon: '📊',
    gradient: 'from-blue-500 to-indigo-600',
    description: 'Connect your MT5 account via the UltraLOB Copy Bridge EA or MetaApi Cloud for direct trade mirroring.',
    features: ['Real-time trade & Monte Carlo signal mirroring', 'Includes downloadable UltraLOB_CopyBridge.mq5 EA', 'Supports any MT5 broker server worldwide', 'Optional MetaApi Cloud token verification'],
    fields: [
      { name: 'server', label: 'MT5 Server', type: 'text', placeholder: 'e.g., MetaQuotes-Demo or ICMarketsSC-MT5', required: true },
      { name: 'login', label: 'Account Number', type: 'text', placeholder: 'e.g., 12345678', required: true },
      { name: 'password', label: 'Investor / Trade Password', type: 'password', placeholder: 'Your MT5 password', required: true },
      { name: 'metaapi_token', label: 'MetaApi Token (Optional)', type: 'password', placeholder: 'Leave blank to use MT5 Bridge EA', required: false },
    ]
  },
  {
    id: 'exness',
    name: 'Exness',
    icon: '🏦',
    gradient: 'from-amber-500 to-orange-600',
    description: 'Connect your Exness MT5 Real/Trial or API account for copy trading with raw spreads and instant signal routing.',
    features: ['Exness MT5 Real & Trial servers supported', 'Raw Spread & Zero Spread account routing', 'Downloadable Exness-compatible .mq5 Bridge EA', 'Auto lot-sizing & drawdown guardrails'],
    fields: [
      { name: 'server', label: 'Exness Server', type: 'text', placeholder: 'e.g., Exness-MT5Real or Exness-MT5Trial8', required: true },
      { name: 'account_id', label: 'Exness Account ID', type: 'text', placeholder: 'e.g., 192837465', required: true },
      { name: 'api_key', label: 'API Key / Login Token', type: 'text', placeholder: 'Your Exness API key or MT5 login', required: true },
      { name: 'api_secret', label: 'API Secret / Password', type: 'password', placeholder: 'Your Exness API secret or password', required: true },
    ]
  }
];

export function render() {
  return `
  <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
    <!-- Header -->
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-white mb-2">Connect Your Broker (MT5 / Exness)</h1>
      <p class="text-surface-400">Link your MetaTrader 5 or Exness trading account so copy strategies and Monte Carlo signals execute directly on your terminal.</p>
    </div>

    <!-- Security Notice -->
    <div class="glass-card rounded-xl p-5 mb-6 border-brand-500/20">
      <div class="flex items-start gap-3">
        <span class="text-xl flex-shrink-0">🔒</span>
        <div>
          <h3 class="text-sm font-semibold text-white mb-1">Zero Custody & DEMO-Only Safeguard</h3>
          <p class="text-xs text-surface-400 leading-relaxed">
            Raw broker passwords and API secrets are never saved to disk. Live real-money accounts are blocked by design in this build.
            Once paired, download <code class="text-brand-300">UltraLOB_Bridge_EA.mq5</code> (v0.2.0) for MT5 Demo OrderCheck validation & heartbeat telemetry.
          </p>
        </div>
      </div>
    </div>

    <!-- Broker Status Banner -->
    <div class="glass-card rounded-xl p-5 mb-8" id="broker-status">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="w-3 h-3 rounded-full bg-surface-600" id="broker-status-dot"></div>
          <div>
            <span class="text-sm text-surface-400 block" id="broker-status-text">Checking broker connection...</span>
            <span class="text-xs text-surface-500" id="broker-status-sub"></span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <a href="/api/broker/mt5/ea" id="download-ea-btn" class="hidden btn-outline px-3 py-1.5 rounded-lg text-xs text-brand-300 font-medium">
            ⬇️ Download .mq5 EA
          </a>
          <button id="disconnect-btn" class="hidden text-xs text-loss hover:text-loss-light border border-loss/30 px-3 py-1.5 rounded-lg transition-colors">
            Disconnect
          </button>
        </div>
      </div>
      <div id="bridge-token-box" class="hidden mt-4 pt-4 border-t border-surface-800/60 flex flex-wrap items-center justify-between gap-3">
        <div class="text-xs text-surface-400">
          EA Bridge Token: <code class="text-brand-300 font-mono bg-surface-900 px-2 py-1 rounded" id="bridge-token-val"></code>
        </div>
        <div class="text-xs text-surface-500">
          Signal Endpoint: <code class="text-surface-300 font-mono">/api/broker/mt5/signals</code>
        </div>
      </div>
    </div>

    <!-- Broker Cards -->
    <div class="grid md:grid-cols-2 gap-6 mb-8">
      ${BROKERS.map(b => `
        <div class="glass-card rounded-xl overflow-hidden" id="broker-card-${b.id}">
          <div class="bg-gradient-to-r ${b.gradient} p-6">
            <div class="flex items-center gap-3 mb-2">
              <span class="text-3xl">${b.icon}</span>
              <h2 class="text-xl font-bold text-white">${b.name}</h2>
            </div>
            <p class="text-sm text-white/80">${b.description}</p>
          </div>

          <div class="p-6 border-b border-surface-800/50">
            <h4 class="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Capabilities</h4>
            <ul class="space-y-2">
              ${b.features.map(f => `
                <li class="flex items-center gap-2 text-sm text-surface-300">
                  <svg class="w-4 h-4 text-profit flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                  </svg>
                  ${f}
                </li>
              `).join('')}
            </ul>
          </div>

          <form class="p-6 space-y-4" id="form-${b.id}" onsubmit="return false;">
            ${b.fields.map(f => `
              <div>
                <label class="block text-xs font-medium text-surface-400 mb-1.5">${f.label}</label>
                <input type="${f.type}" name="${f.name}" placeholder="${f.placeholder}" ${f.required ? 'required' : ''}
                       class="w-full bg-surface-800 border border-surface-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-surface-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20 transition-colors">
              </div>
            `).join('')}
            <button type="submit" class="btn-primary w-full py-3 rounded-xl text-white font-semibold text-sm" data-broker="${b.id}">
              Connect ${b.name}
            </button>
          </form>
        </div>
      `).join('')}
    </div>

    <!-- Pending EA Signal Queue -->
    <div class="glass-card rounded-xl p-6 mb-8">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="text-sm font-semibold text-white">📡 Outbound MT5 / Exness Signal Queue</h3>
          <p class="text-xs text-surface-400">Signals emitted by the Monte Carlo Auto-Trader and Copy EAs waiting for your terminal</p>
        </div>
        <button id="refresh-signals-btn" class="text-xs btn-outline px-3 py-1.5 rounded-lg text-brand-300">Refresh</button>
      </div>
      <div id="signals-queue" class="text-xs text-surface-500">Connect a broker to view outbound execution signals.</div>
    </div>

    <!-- Setup Guide -->
    <div class="glass-card rounded-xl p-6">
      <h3 class="text-sm font-semibold text-white mb-4">🛠️ Linking MetaTrader 5 / Exness Desktop</h3>
      <div class="grid md:grid-cols-2 gap-6 text-sm">
        <div>
          <h4 class="font-medium text-surface-300 mb-2">1. Connect & Download EA:</h4>
          <ol class="list-decimal list-inside space-y-1 text-surface-400 text-xs leading-relaxed">
            <li>Submit your MT5 or Exness account credentials above</li>
            <li>Click <strong>Download .mq5 EA</strong> in the status bar</li>
            <li>Place <code class="text-surface-200">UltraLOB_CopyBridge.mq5</code> in <code class="text-surface-200">MQL5/Experts/</code></li>
            <li>Compile in MetaEditor (F7) and attach to any chart</li>
          </ol>
        </div>
        <div>
          <h4 class="font-medium text-surface-300 mb-2">2. Enable WebRequest in MT5:</h4>
          <ol class="list-decimal list-inside space-y-1 text-surface-400 text-xs leading-relaxed">
            <li>In MT5/Exness Terminal go to <strong>Tools → Options → Expert Advisors</strong></li>
            <li>Check <strong>Allow WebRequest for listed URL</strong></li>
            <li>Add <code class="text-surface-200">${globalThis.location?.origin || 'https://ultralob.onrender.com'}</code></li>
            <li>Enable Algo Trading so Monte Carlo signals mirror automatically</li>
          </ol>
        </div>
      </div>
    </div>
  </div>`;
}

export function init() {
  async function loadStatus() {
    try {
      const res = await api.getBrokerStatus();
      updateStatusUI(res.connected ? res.broker : null);
    } catch {
      updateStatusUI(null);
    }
  }

  async function updateStatusUI(broker) {
    const dot = document.getElementById('broker-status-dot');
    const text = document.getElementById('broker-status-text');
    const sub = document.getElementById('broker-status-sub');
    const disc = document.getElementById('disconnect-btn');
    const dl = document.getElementById('download-ea-btn');
    const tokenBox = document.getElementById('bridge-token-box');
    const tokenVal = document.getElementById('bridge-token-val');
    const queueEl = document.getElementById('signals-queue');

    state.broker = broker;
    if (broker) {
      if (dot) dot.className = 'w-3 h-3 rounded-full bg-profit animate-pulse';
      if (text) { text.className = 'text-sm text-profit font-medium'; text.textContent = `${broker.name} connected — Account ${broker.account} (${broker.server})`; }
      if (sub) sub.textContent = broker.note || '';
      disc?.classList.remove('hidden');
      dl?.classList.remove('hidden');
      tokenBox?.classList.remove('hidden');
      if (tokenVal) tokenVal.textContent = broker.bridgeToken;

      try {
        const sigRes = await api.getMt5Signals(broker.bridgeToken);
        if (queueEl) {
          if (!sigRes.signals?.length) {
            queueEl.innerHTML = '<div class="text-surface-500 py-3">No pending signals in queue. Trigger a trade or run the Monte Carlo Auto-Trader in the Terminal.</div>';
          } else {
            queueEl.innerHTML = `
              <table class="w-full text-xs font-mono">
                <thead><tr class="border-b border-surface-800 text-surface-500">
                  <th class="text-left pb-2">Signal ID</th><th class="text-left pb-2">Symbol</th>
                  <th class="text-center pb-2">Side</th><th class="text-right pb-2">Lot/Qty</th>
                  <th class="text-right pb-2">Entry</th><th class="text-right pb-2">SL / TP</th>
                </tr></thead>
                <tbody>
                  ${sigRes.signals.map(s => `
                    <tr class="border-b border-surface-800/40">
                      <td class="py-2 text-surface-400">${s.id}</td>
                      <td class="py-2 text-white">${s.symbol}</td>
                      <td class="py-2 text-center"><span class="chip ${s.side === 'BUY' ? 'chip-green' : 'chip-red'}">${s.side}</span></td>
                      <td class="py-2 text-right text-surface-300">${s.volume}</td>
                      <td class="py-2 text-right text-white">$${s.entryPrice}</td>
                      <td class="py-2 text-right text-surface-400">${s.stopLoss || '—'} / ${s.takeProfit || '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>`;
          }
        }
      } catch {}
    } else {
      if (dot) dot.className = 'w-3 h-3 rounded-full bg-surface-600';
      if (text) { text.className = 'text-sm text-surface-400'; text.textContent = 'No broker connected (Paper Demo Engine active)'; }
      if (sub) sub.textContent = '';
      disc?.classList.add('hidden');
      dl?.classList.add('hidden');
      tokenBox?.classList.add('hidden');
      if (queueEl) queueEl.textContent = 'Connect MT5 or Exness above to inspect queued execution signals.';
    }
  }

  BROKERS.forEach(b => {
    const form = document.getElementById(`form-${b.id}`);
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type="submit"]');
      btn.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span>Connecting...';
      btn.disabled = true;

      try {
        const res = await api.connectBroker({ type: b.id, ...data });
        showToast(`${b.name} connected successfully!`, 'success');
        await updateStatusUI(res.broker);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.textContent = `Connect ${b.name}`;
        btn.disabled = false;
      }
    });
  });

  document.getElementById('disconnect-btn')?.addEventListener('click', async () => {
    try {
      await api.disconnectBroker();
      showToast('Broker disconnected.', 'info');
      await updateStatusUI(null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('refresh-signals-btn')?.addEventListener('click', loadStatus);

  loadStatus();
  return null;
}
