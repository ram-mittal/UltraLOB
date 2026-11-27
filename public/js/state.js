// Reactive In-Memory Auth State (Zero localStorage/sessionStorage token persistence; refresh handled via HttpOnly cookie)
const _state = {
  user: null,
  token: null,        // Short-lived (5m) access JWT held strictly in JS memory
  csrfToken: null,    // Double-submit CSRF token synced with non-HttpOnly ultralob_csrf cookie
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
  theme: "dark"
};

const listeners = new Set();

export const state = new Proxy(_state, {
  set(target, prop, value) {
    target[prop] = value;
    listeners.forEach((fn) => { try { fn(prop, value); } catch (e) { console.warn(e); } });
    return true;
  }
});

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return { ..._state };
}

export function purgeLegacyAuthStorage() {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem("ultralob_token");
      localStorage.removeItem("ultralob_refresh_token");
      localStorage.removeItem("ultralob_user");
    } catch {}
  }
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem("ultralob_token");
      sessionStorage.removeItem("ultralob_refresh_token");
      sessionStorage.removeItem("ultralob_user");
    } catch {}
  }
}

export function readCsrfCookie() {
  if (typeof document === "undefined") return null;
  const parts = String(document.cookie || "").split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === "ultralob_csrf") {
      try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return part.slice(idx + 1).trim(); }
    }
  }
  return null;
}

export function saveAuth(user, token = null, csrfToken = null) {
  state.user = user || null;
  state.isAuthenticated = Boolean(user);
  if (token) state.token = token;
  if (csrfToken) state.csrfToken = csrfToken;
  purgeLegacyAuthStorage();
}

export function loadAuth() {
  purgeLegacyAuthStorage();
  const cookieCsrf = readCsrfCookie();
  if (cookieCsrf) state.csrfToken = cookieCsrf;
}

export function logout() {
  state.user = null;
  state.token = null;
  state.isAuthenticated = false;
  purgeLegacyAuthStorage();
  if (typeof location !== "undefined") location.hash = "#/overview";
}
