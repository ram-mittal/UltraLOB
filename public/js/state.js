// Reactive state management with role & session persistence
const _state = {
  user: null,          // { id, name, email, role, permissions, org_id, org_name }
  token: null,
  refreshToken: null,
  isAuthenticated: false,
  broker: null,
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
    listeners.forEach(fn => { try { fn(prop, value); } catch (e) { console.warn(e); } });
    return true;
  }
});

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() { return { ..._state }; }

export function saveAuth(user, token = null, refreshToken = null) {
  state.user = user;
  state.isAuthenticated = true;
  try {
    localStorage.setItem('ultralob_user', JSON.stringify(user));
    if (token) {
      state.token = token;
      localStorage.setItem('ultralob_token', token);
    }
    if (refreshToken) {
      state.refreshToken = refreshToken;
      localStorage.setItem('ultralob_refresh_token', refreshToken);
    }
  } catch {}
}

export function loadAuth() {
  try {
    const saved = localStorage.getItem('ultralob_user');
    const token = localStorage.getItem('ultralob_token');
    const refreshToken = localStorage.getItem('ultralob_refresh_token');
    if (saved) {
      state.user = JSON.parse(saved);
      state.token = token || null;
      state.refreshToken = refreshToken || null;
      state.isAuthenticated = true;
    }
  } catch {}
}

export function logout() {
  state.user = null;
  state.token = null;
  state.refreshToken = null;
  state.isAuthenticated = false;
  try {
    localStorage.removeItem('ultralob_user');
    localStorage.removeItem('ultralob_token');
    localStorage.removeItem('ultralob_refresh_token');
  } catch {}
  location.hash = '#/';
}

loadAuth();
