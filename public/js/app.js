// UltraLOB Institutional Quantitative Terminal — Hash Router & Shell Controller
import { state, loadAuth, saveAuth, logout } from "./state.js";
import { api } from "./api.js";
import * as sidebar from "./components/sidebar.js";
import * as topbar from "./components/topbar.js";
import { destroyAllCharts } from "./components/charts.js";
import { closeDrawer, esc } from "./components/ui.js";

const pageLoaders = {
  landing: () => import("./pages/dashboard.js"),
  overview: () => import("./pages/dashboard.js"),
  dashboard: () => import("./pages/dashboard.js"),
  marketplace: () => import("./pages/marketplace.js"),
  strategy: () => import("./pages/strategy-detail.js"),
  portfolio: () => import("./pages/portfolio.js"),
  "copy-trading": () => import("./pages/portfolio.js"),
  ai: () => import("./pages/ai.js"),
  risk: () => import("./pages/risk.js"),
  execution: () => import("./pages/execution.js"),
  broker: () => import("./pages/broker.js"),
  research: () => import("./pages/research.js"),
  reports: () => import("./pages/reports.js"),
  admin: () => import("./pages/admin.js"),
  settings: () => import("./pages/admin.js"),
  terminal: () => import("./pages/terminal.js"),
  markets: () => import("./pages/terminal.js"),
  auth: () => import("./pages/auth.js")
};

function parseHash() {
  const hash = (typeof window !== "undefined" ? window.location.hash.slice(1) : "") || "/overview";
  const [pathPart, queryPart] = hash.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  const page = parts[0] || "overview";
  const id = parts[1] || null;
  const params = new URLSearchParams(queryPart || "");
  return { path: pathPart, page, id, params };
}

export function navigate(path) {
  if (typeof window === "undefined") return;
  closeDrawer();
  window.location.hash = "#" + path;
}

export function showToast(message, type = "info") {
  if (typeof document === "undefined") return;
  const container = document.getElementById("toast-container");
  if (!container) return;

  const colors = {
    success: "bg-[#11151d] border-[#22c55e]/50 text-[#86efac]",
    error: "bg-[#11151d] border-[#ef4444]/50 text-[#fca5a5]",
    warning: "bg-[#11151d] border-[#eab308]/50 text-[#fde047]",
    info: "bg-[#11151d] border-[#3b82f6]/50 text-[#93c5fd]"
  };

  const toast = document.createElement("div");
  toast.className = `px-3.5 py-2.5 rounded border shadow-xl text-xs font-medium flex items-center gap-2 ${colors[type] || colors.info}`;
  toast.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-current shrink-0"></span><span>${esc(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 180ms ease";
    setTimeout(() => toast.remove(), 200);
  }, 3600);
}

let currentCleanup = null;

async function renderCurrentRoute() {
  if (typeof document === "undefined") return;
  const { path, page, id, params } = parseHash();

  if (typeof currentCleanup === "function") {
    try { currentCleanup(); } catch {}
    currentCleanup = null;
  }
  destroyAllCharts();
  closeDrawer();

  const sbEl = document.getElementById("sidebar-container");
  const tbEl = document.getElementById("topbar-container");
  if (sbEl) {
    sbEl.innerHTML = sidebar.render(path);
    sidebar.init(navigate);
  }
  if (tbEl) {
    tbEl.innerHTML = topbar.render(path);
    topbar.init(navigate);
  }

  const pageEl = document.getElementById("page-content");
  if (!pageEl) return;

  const loader = pageLoaders[page] || pageLoaders.overview;
  try {
    const mod = await loader();
    pageEl.innerHTML = mod.render({ path, id, params });
    if (typeof mod.init === "function") {
      currentCleanup = await mod.init({ path, id, params, navigate, showToast });
    }
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  } catch (err) {
    console.error("[router] Failed rendering route", path, err);
    pageEl.innerHTML = `
      <div class="panel p-6 border-[#ef4444]/40 max-w-xl mx-auto my-8">
        <div class="text-xs font-mono uppercase text-[#ef4444] mb-1">MODULE LOAD ERROR</div>
        <div class="text-sm text-[#e6edf6] mb-3">${esc(err?.message || "Failed loading module.")}</div>
        <a href="#/overview" class="btn-secondary">Return to Overview</a>
      </div>
    `;
  }
}

async function initApp() {
  if (typeof window === "undefined") return;
  loadAuth();

  if (!window.location.hash && window.location.pathname && window.location.pathname !== "/") {
    const p = window.location.pathname;
    if (pageLoaders[p.split("/").filter(Boolean)[0]]) {
      window.history.replaceState(null, "", "/#" + p + window.location.search);
    }
  }

  if (state.token) {
    try {
      const me = await api.me();
      if (me?.user) saveAuth(me.user, state.token, state.refreshToken);
    } catch {
      if (state.refreshToken) {
        try {
          const ref = await api.refreshSession(state.refreshToken);
          if (ref?.user && ref?.token) {
            saveAuth(ref.user, ref.token, ref.refreshToken || state.refreshToken);
          } else {
            logout();
          }
        } catch {
          logout();
        }
      } else {
        logout();
      }
    }
  }

  window.addEventListener("hashchange", renderCurrentRoute);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
  await renderCurrentRoute();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
}
