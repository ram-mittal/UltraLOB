// Institutional Top Bar: Org/Portfolio Selector, Account Selector, Environment Badge, Market Status, Notifications & Profile
import { state, logout } from "../state.js";
import { api } from "../api.js";
import { isBrowser, esc, openDrawer, fmtTs, statusBadge, terminalContext } from "./ui.js";

const ROUTE_TITLES = [
  { prefix: "/strategy/", title: "Strategy Specification" },
  { prefix: "/marketplace", title: "Strategy Marketplace" },
  { prefix: "/portfolio", title: "Portfolio & Allocation" },
  { prefix: "/copy-trading", title: "Portfolio & Copy Allocation" },
  { prefix: "/ai", title: "UltraLOB AI Decision Engine" },
  { prefix: "/risk", title: "Risk & Tail Analytics" },
  { prefix: "/execution", title: "Execution & Reconciliation Monitor" },
  { prefix: "/broker", title: "Accounts & Broker Infrastructure" },
  { prefix: "/research", title: "Quantitative Research Lab" },
  { prefix: "/reports", title: "Institutional Statements & Fees" },
  { prefix: "/admin", title: "Administration & Governance" },
  { prefix: "/settings", title: "Administration & Governance" },
  { prefix: "/terminal", title: "FIX & Live Market Terminal" },
  { prefix: "/markets", title: "Live Market Feed" },
  { prefix: "/auth", title: "Institutional Operator Authentication" }
];

function titleForPath(path) {
  const clean = path || "/overview";
  const match = ROUTE_TITLES.find((r) => clean.startsWith(r.prefix));
  return match ? match.title : "Portfolio Overview";
}

export function render(currentPath = "/overview") {
  const user = state.user;
  const auth = state.isAuthenticated && user;
  const envIsLive = terminalContext.environment === "LIVE";
  const envCls = envIsLive
    ? "border-[#22c55e]/50 bg-[#22c55e]/15 text-[#86efac]"
    : "border-[#eab308]/50 bg-[#eab308]/15 text-[#fde047]";
  const notifCount = terminalContext.notifications.length;

  return `
    <div class="h-12 bg-[#11151d] border-b border-[#232a37] px-3 lg:px-5 flex items-center justify-between gap-3">
      <!-- Left: Mobile trigger + Screen title + Context Selectors -->
      <div class="flex items-center gap-2.5 min-w-0">
        <button id="topbar-mobile-menu" class="lg:hidden btn-secondary px-2 py-1 text-xs">Menu</button>
        <div class="hidden sm:block text-xs font-semibold text-[#e6edf6] truncate mr-1">${esc(titleForPath(currentPath))}</div>

        <div class="flex items-center gap-1.5">
          <select id="topbar-org-select" aria-label="Organization and Portfolio Selector" class="input-term py-1 px-2 text-[11px] font-mono max-w-[165px]">
            <option value="default">${esc(terminalContext.selectedOrgName)} (Core)</option>
          </select>
          <select id="topbar-account-select" aria-label="Execution Account Selector" class="input-term py-1 px-2 text-[11px] font-mono max-w-[160px]">
            <option value="paper-sandbox">Paper Sandbox (DEMO)</option>
          </select>
        </div>
      </div>

      <!-- Right: Env Indicator, Market Status, Notifications, Profile -->
      <div class="flex items-center gap-2 shrink-0">
        <span id="topbar-env-badge" title="Environment Execution Mode" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-mono font-semibold uppercase tracking-wider ${envCls}">
          <span class="w-1.5 h-1.5 rounded-full ${envIsLive ? "bg-[#22c55e]" : "bg-[#eab308]"}"></span>
          ${envIsLive ? "LIVE" : "DEMO"}
        </span>

        <a href="#/terminal" id="topbar-market-pill" class="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-[#232a37] bg-[#0b0e13] text-[10px] font-mono text-[#94a3b8] hover:border-[#2e3748]" title="Live Market Infrastructure Status">
          <span id="topbar-market-dot" class="w-1.5 h-1.5 rounded-full bg-[#64748b]"></span>
          <span id="topbar-market-text">MARKET: CHECKING</span>
        </a>

        <button id="topbar-notif-btn" title="Risk & Advisory Alerts" class="relative btn-secondary px-2 py-1 text-[11px] font-mono flex items-center gap-1">
          <span>ALERTS</span>
          <span id="topbar-notif-count" class="px-1 rounded bg-[#1c2330] text-[#93c5fd] text-[10px]">${notifCount}</span>
        </button>

        ${auth ? `
          <div class="flex items-center gap-1.5 pl-1 border-l border-[#232a37]">
            <a href="#/admin" class="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[#161b25] text-xs">
              <span class="font-medium text-[#e6edf6] truncate max-w-[110px]">${esc(user.name || user.email)}</span>
              <span class="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded border border-[#2e3748] text-[#94a3b8]">${esc(user.role || "TRADER")}</span>
            </a>
            <button id="topbar-logout-btn" class="btn-secondary px-2 py-1 text-[11px]">Sign Out</button>
          </div>
        ` : `
          <a href="#/auth" class="btn-primary px-2.5 py-1 text-[11px] font-mono">Sign In</a>
        `}
      </div>
    </div>
  `;
}

async function hydrateTopbarStatus() {
  if (!isBrowser()) return;
  try {
    const [sys, brokerRes, orgRes, riskRes] = await Promise.all([
      api.getSystemStatus().catch(() => null),
      api.getBrokerStatus().catch(() => null),
      api.getOrganization().catch(() => null),
      api.getPortfolioRisk().catch(() => null)
    ]);

    const orgSel = document.getElementById("topbar-org-select");
    if (orgSel && orgRes?.organization?.name) {
      terminalContext.selectedOrgName = orgRes.organization.name;
      orgSel.innerHTML = `<option value="${esc(orgRes.organization.id || "org")}">${esc(orgRes.organization.name)} (${esc(orgRes.organization.mandate_tier || "INSTITUTIONAL")})</option>`;
    }

    const accSel = document.getElementById("topbar-account-select");
    const envBadge = document.getElementById("topbar-env-badge");
    const isVerifiedDemo = Boolean(brokerRes?.connected && brokerRes?.upstreamVerified);
    const isPairedPending = Boolean(brokerRes?.paired && !isVerifiedDemo);
    if (accSel) {
      const opts = [`<option value="paper-sandbox">Paper Sandbox (DEMO)</option>`];
      if (isVerifiedDemo || isPairedPending) {
        const b = brokerRes.broker || {};
        const tag = isVerifiedDemo ? "VERIFIED DEMO" : "PENDING EA";
        opts.unshift(`<option value="mt5-demo">${esc(b.name || "MT5 Demo")} ••••${esc(String(b.account || "").slice(-4))} (${tag})</option>`);
      }
      accSel.innerHTML = opts.join("");
      if ((isVerifiedDemo || isPairedPending) && terminalContext.selectedAccountId === "paper-sandbox") {
        accSel.value = terminalContext.selectedAccountId;
      }
    }
    if (envBadge) {
      // System enforces demo-only MT5 bridges unless explicitly verified live
      const liveActive = Boolean(sys?.execution?.live_trading_enabled);
      terminalContext.environment = liveActive ? "LIVE" : "DEMO";
      envBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${liveActive ? "bg-[#22c55e]" : "bg-[#eab308]"}"></span>${liveActive ? "LIVE" : "DEMO"}`;
    }

    const mDot = document.getElementById("topbar-market-dot");
    const mText = document.getElementById("topbar-market-text");
    if (sys && mDot && mText) {
      const td = sys.market_feeds?.xauusd?.status === "CONFIGURED" || sys.market_feeds?.us_equities?.configured;
      mDot.className = `w-1.5 h-1.5 rounded-full ${td ? "bg-[#22c55e]" : "bg-[#eab308]"}`;
      mText.textContent = td ? "FEED: XAUUSD + BTC LIVE" : "FEED: KRAKEN BTC / DEMO";
    }

    const events = Array.isArray(riskRes?.events) ? riskRes.events : [];
    terminalContext.notifications = events.slice(0, 15);
    const badge = document.getElementById("topbar-notif-count");
    if (badge) badge.textContent = String(terminalContext.notifications.length);
  } catch {
    // non-fatal header hydration
  }
}

export function init(onNavigate) {
  if (!isBrowser()) return;

  document.getElementById("topbar-mobile-menu")?.addEventListener("click", () => {
    const mobile = document.getElementById("mobile-sidebar-rail");
    const backdrop = document.getElementById("sidebar-backdrop");
    mobile?.classList.remove("hidden");
    mobile?.classList.add("flex");
    backdrop?.classList.remove("hidden");
  });

  document.getElementById("topbar-account-select")?.addEventListener("change", (e) => {
    terminalContext.selectedAccountId = e.target.value;
  });

  document.getElementById("topbar-logout-btn")?.addEventListener("click", () => {
    logout();
    if (typeof onNavigate === "function") onNavigate("/overview");
    else window.location.hash = "#/overview";
  });

  document.getElementById("topbar-notif-btn")?.addEventListener("click", () => {
    const items = terminalContext.notifications;
    openDrawer({
      title: "Risk & Governance Alerts",
      subtitle: "Real-time notifications from Independent Risk Engine & Execution Router",
      badgeHtml: statusBadge("ACTIVE"),
      bodyHtml: items.length
        ? `<div class="space-y-2">${items.map((ev) => `
            <div class="panel-elevated p-3 space-y-1">
              <div class="flex items-center justify-between gap-2">
                ${statusBadge(ev.type || ev.severity || "INFO")}
                <span class="font-mono text-[10px] text-[#64748b]">${esc(fmtTs(ev.timestamp || ev.created_at))}</span>
              </div>
              <div class="text-xs text-[#e6edf6]">${esc(ev.message || ev.title || "System notification")}</div>
            </div>
          `).join("")}</div>`
        : `<div class="text-xs text-[#94a3b8]">No risk alerts or governance events recorded for the current session.</div>`,
      footerHtml: `<a href="#/risk" class="btn-secondary">Open Risk & Analytics</a>`
    });
  });

  hydrateTopbarStatus();
}
