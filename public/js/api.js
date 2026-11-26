// API Client for UltraLOB Platform
const BASE = '';

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = localStorage.getItem('ultralob_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Strategies
  getStrategies: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/strategies${qs ? '?' + qs : ''}`);
  },
  getStrategy: (id) => request(`/api/strategies/${id}`),
  createStrategy: (data) => request('/api/strategies', { method: 'POST', body: JSON.stringify(data) }),

  // Copy Trading & Monte Carlo Auto-Trader
  subscribe: (payload) => request('/api/copy-trading/subscribe', { method: 'POST', body: JSON.stringify(typeof payload === 'string' ? { strategyId: payload } : payload) }),
  unsubscribe: (strategyId) => request('/api/copy-trading/unsubscribe', { method: 'POST', body: JSON.stringify({ strategyId }) }),
  toggleCopy: (strategyId) => request('/api/copy-trading/toggle', { method: 'POST', body: JSON.stringify({ strategyId }) }),
  getPortfolio: () => request('/api/copy-trading/portfolio'),
  saveMcConfig: (cfg) => request('/api/copy-trading/mc-config', { method: 'POST', body: JSON.stringify(cfg) }),
  evaluateMcSignal: (payload) => request('/api/copy-trading/mc-signal', { method: 'POST', body: JSON.stringify(payload) }),
  executeOrder: (payload) => request('/api/copy-trading/execute', { method: 'POST', body: JSON.stringify(payload) }),
  closeTrade: (tradeId, closePrice) => request('/api/copy-trading/close-trade', { method: 'POST', body: JSON.stringify({ tradeId, closePrice }) }),

  // Auth
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/api/auth/me'),

  // Broker (MT5 / Exness)
  connectBroker: (data) => request('/api/broker/connect', { method: 'POST', body: JSON.stringify(data) }),
  disconnectBroker: () => request('/api/broker/disconnect', { method: 'POST' }),
  getBrokerStatus: () => request('/api/broker/status'),
  getMt5Signals: (token) => request(`/api/broker/mt5/signals?token=${encodeURIComponent(token)}`),

  // Market data
  getMarketData: () => request('/api/market-data'),
  getMarketHistory: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/market-history${qs ? '?' + qs : ''}`);
  },

  // Monte Carlo Pricing
  runMonteCarlo: (params = {}) => request('/api/pricing', {
    method: 'POST',
    body: JSON.stringify(params)
  }),
};
