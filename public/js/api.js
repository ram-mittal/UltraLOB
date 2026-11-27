// API Client for UltraLOB Institutional Platform
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
  // System Status & Provenance
  getSystemStatus: () => request('/api/system/status'),

  // Strategies
  getStrategies: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/strategies${qs ? '?' + qs : ''}`);
  },
  getStrategy: (id) => request(`/api/strategies/${id}`),
  createStrategy: (data) => request('/api/strategies', { method: 'POST', body: JSON.stringify(data) }),

  // Quantitative Research & Backtesting (Phase 2)
  runBacktest: (payload) => request('/api/research/backtest', { method: 'POST', body: JSON.stringify(payload) }),
  getBacktests: (strategyId = '') => request(`/api/research/backtests${strategyId ? '?strategy_id=' + encodeURIComponent(strategyId) : ''}`),
  getBacktest: (id) => request(`/api/research/backtests/${id}`),

  // UltraLOB AI Advisory & Event Intelligence (Phase 5)
  evaluateAiAdvisory: (payload) => request('/api/ai/evaluate', { method: 'POST', body: JSON.stringify(payload) }),
  authorizeAiDecision: (id, approve = true) => request(`/api/ai/decisions/${id}/authorize`, { method: 'POST', body: JSON.stringify({ approve }) }),
  getAiDecisions: () => request('/api/ai/decisions'),
  getMacroEvents: (symbol = 'XAUUSD') => request(`/api/ai/events?symbol=${encodeURIComponent(symbol)}`),
  addMacroBlackout: (payload) => request('/api/ai/events', { method: 'POST', body: JSON.stringify(payload) }),

  // Portfolio, Risk Engine & Copy Trading
  getPortfolio: () => request('/api/copy-trading/portfolio'),
  getPortfolioSummary: () => request('/api/portfolio/summary'),
  rebalancePortfolio: (payload) => request('/api/portfolio/rebalance', { method: 'POST', body: JSON.stringify(payload) }),
  getPortfolioRisk: () => request('/api/portfolio/risk'),
  updateRiskLimits: (limits) => request('/api/portfolio/risk/limits', { method: 'POST', body: JSON.stringify(limits) }),
  toggleKillSwitch: (payload) => request('/api/portfolio/risk/kill-switch', { method: 'POST', body: JSON.stringify(payload) }),
  computeKellyResearch: (payload) => request('/api/portfolio/risk/kelly-research', { method: 'POST', body: JSON.stringify(payload) }),
  fundSandboxCapital: (amount) => request('/api/copy-trading/sandbox-capital', { method: 'POST', body: JSON.stringify({ amount }) }),
  previewPositionSize: (payload) => request('/api/copy-trading/size-preview', { method: 'POST', body: JSON.stringify(payload) }),
  saveRiskConfig: (cfg) => request('/api/copy-trading/risk-config', { method: 'POST', body: JSON.stringify(cfg) }),
  subscribe: (payload) => request('/api/copy-trading/subscribe', { method: 'POST', body: JSON.stringify(typeof payload === 'string' ? { strategyId: payload } : payload) }),
  unsubscribe: (strategyId) => request('/api/copy-trading/unsubscribe', { method: 'POST', body: JSON.stringify({ strategyId }) }),
  toggleCopy: (strategyId) => request('/api/copy-trading/toggle', { method: 'POST', body: JSON.stringify({ strategyId }) }),
  saveMcConfig: (cfg) => request('/api/copy-trading/mc-config', { method: 'POST', body: JSON.stringify(cfg) }),
  evaluateMcSignal: (payload) => request('/api/copy-trading/mc-signal', { method: 'POST', body: JSON.stringify(payload) }),
  executeOrder: (payload) => request('/api/copy-trading/execute', { method: 'POST', body: JSON.stringify(payload) }),
  closeTrade: (tradeId, closePrice) => request('/api/copy-trading/close-trade', { method: 'POST', body: JSON.stringify({ tradeId, closePrice }) }),

  // Auth & RBAC
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  refreshSession: (refreshToken) => request('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  logoutSession: (refreshToken) => request('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  me: () => request('/api/auth/me'),

  // Broker & Execution Bridge
  connectBroker: (data) => request('/api/broker/connect', { method: 'POST', body: JSON.stringify(data) }),
  disconnectBroker: () => request('/api/broker/disconnect', { method: 'POST' }),
  getBrokerStatus: () => request('/api/broker/status'),
  getMt5Signals: (token) => request(`/api/broker/mt5/signals?token=${encodeURIComponent(token)}`),
  getExecutionHealth: () => request('/api/execution/health'),
  getExecutionMonitor: () => request('/api/execution/monitor'),

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
