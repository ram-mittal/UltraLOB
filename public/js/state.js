// Simple reactive state management
const _state = {
  user: null,          // { id, name, email }
  token: null,
  isAuthenticated: false,
  broker: null,        // { type: 'mt5'|'exness', account, server, bridgeToken, status }
  portfolio: {
    balance: 0,
    equity: 0,
    pnl: 0,
    activeCopies: 0
  },
  strategies: [],
  subscribedStrategies: new Set(),
  theme: 'dark'
};

const listeners = new Set();

export const state = new Proxy(_state, {
  set(target, prop, value) {
    target[prop] = value;
    listeners.forEach(fn => { try { fn(prop, value); } catch(e) { console.warn(e); } });
    return true;
  }
});

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() { return { ..._state }; }

export function saveAuth(user, token = null) {
  state.user = user;
  state.isAuthenticated = true;
  try {
    localStorage.setItem('ultralob_user', JSON.stringify(user));
    if (token) {
      state.token = token;
      localStorage.setItem('ultralob_token', token);
    }
  } catch {}
}

export function loadAuth() {
  try {
    const saved = localStorage.getItem('ultralob_user');
    const token = localStorage.getItem('ultralob_token');
    if (saved) {
      state.user = JSON.parse(saved);
      state.token = token || null;
      state.isAuthenticated = true;
    }
  } catch {}
}

export function logout() {
  state.user = null;
  state.token = null;
  state.isAuthenticated = false;
  try {
    localStorage.removeItem('ultralob_user');
    localStorage.removeItem('ultralob_token');
  } catch {}
  location.hash = '#/';
}

loadAuth();
