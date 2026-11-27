// API Client for UltraLOB Institutional Platform
// Uses strictly in-memory short-lived access JWT + HttpOnly refresh cookies + CSRF headers.
import { state, readCsrfCookie, saveAuth, logout } from './state.js';

const BASE = '';
let refreshInFlight = null;

function buildCsrfHeader(method) {
  const m = String(method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(m)) return {};
  const csrf = state.csrfToken || readCsrfCookie();
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

async function performRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-UltraLOB-Client': 'browser',
        ...buildCsrfHeader('POST')
      },
      body: JSON.stringify({})
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Session expired');
        const data = await res.json();
        if (data?.user && data?.token) {
          saveAuth(data.user, data.token, data.csrfToken || null);
        }
        return data;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request(path, options = {}, retried = false) {
  const url = `${BASE}${path}`;
  const method = options.method || 'GET';
  const headers = {
    'Content-Type': 'application/json',
    'X-UltraLOB-Client': 'browser',
    ...buildCsrfHeader(method),
    ...options.headers
  };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const res = await fetch(url, { ...options, method, headers, credentials: 'same-origin' });
  if (res.status === 401 && !retried && !path.startsWith('/api/auth/') && state.isAuthenticated) {
    try {
      await performRefresh();
      return request(path, options, true);
    } catch {
      logout();
    }
  }
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

  // Institutional Reports, Mandates, Orgs, Fees & Enterprise Keys (Phase 6)
  getInstitutionalStatement: () => request('/api/institutional/statement'),
  getMandate: () => request('/api/institutional/mandate'),
  updateMandate: (payload) => request('/api/institutional/mandate', { method: 'PUT', body: JSON.stringify(payload) }),
  previewFeeSchedule: (payload) => request('/api/institutional/fees/preview', { method: 'POST', body: JSON.stringify(payload) }),
  getApiKeys: () => request('/api/institutional/api-keys'),
  createApiKey: (payload) => request('/api/institutional/api-keys', { method: 'POST', body: JSON.stringify(payload) }),
  revokeApiKey: (id) => request(`/api/institutional/api-keys/${id}`, { method: 'DELETE' }),
  getOrganization: () => request('/api/institutional/organization'),
  addOrgMember: (payload) => request('/api/institutional/organization/members', { method: 'POST', body: JSON.stringify(payload) }),

  // Portfolio, Risk Engine & Copy Trading
  getPortfolio: () => request('/api/copy-trading/portfolio'),
  getPortfolioSummary: () => request('/api/portfolio/summary'),
  rebalancePortfolio: (payload) => request('/api/portfolio/rebalance', { method: 'POST', body: JSON.stringify(payload) }),
  getPortfolioRisk: () => request('/api/portfolio/risk'),
  runStressTest: (payload) => request('/api/portfolio/risk/stress-test', { method: 'POST', body: JSON.stringify(payload || {}) }),
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

  // Auth & RBAC (HttpOnly refresh cookies + CSRF + short-lived in-memory JWT)
  getCsrfStatus: () => request('/api/auth/csrf'),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  refreshSession: () => performRefresh(),
  logoutSession: () => request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }),
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
