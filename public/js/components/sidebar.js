// Collapsible Institutional Left Sidebar (10 Required Sections)
import { isBrowser, esc } from "./ui.js";

export const NAV_GROUPS = [
  {
    title: "DESK",
    items: [
      { id: "overview", label: "Overview", route: "#/overview", aliases: ["/", "/overview", "/dashboard"], icon: "grid" },
      { id: "marketplace", label: "Strategy Marketplace", route: "#/marketplace", aliases: ["/marketplace", "/strategy"], icon: "layers" },
      { id: "portfolio", label: "Portfolio", route: "#/portfolio", aliases: ["/portfolio", "/copy-trading"], icon: "briefcase" },
      { id: "ai", label: "UltraLOB AI", route: "#/ai", aliases: ["/ai"], icon: "cpu" }
    ]
  },
  {
    title: "GOVERNANCE & OPS",
    items: [
      { id: "risk", label: "Risk & Analytics", route: "#/risk", aliases: ["/risk"], icon: "shield" },
      { id: "execution", label: "Execution Monitor", route: "#/execution", aliases: ["/execution"], icon: "activity" },
      { id: "broker", label: "Accounts & Brokers", route: "#/broker", aliases: ["/broker"], icon: "server" }
    ]
  },
  {
    title: "QUANT & ADMIN",
    items: [
      { id: "research", label: "Research Lab", route: "#/research", aliases: ["/research"], icon: "flask" },
      { id: "reports", label: "Reports", route: "#/reports", aliases: ["/reports"], icon: "file" },
      { id: "admin", label: "Administration", route: "#/admin", aliases: ["/admin", "/settings"], icon: "sliders" }
    ]
  }
];

function svgIcon(name) {
  const icons = {
    grid: `<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>`,
    layers: `<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>`,
    briefcase: `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>`,
    cpu: `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>`,
    shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
    activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
    server: `<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>`,
    flask: `<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/>`,
    file: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
    sliders: `<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>`,
    terminal: `<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`
  };
  return `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.grid}</svg>`;
}

export function render(currentPath = "/overview") {
  const path = currentPath || "/overview";
  const isActive = (item) => item.aliases.some((a) => (a === "/" ? path === "/" : path.startsWith(a)));

  const groupsHtml = NAV_GROUPS.map((g) => `
    <div class="mb-4">
      <div class="sidebar-group-title px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">${esc(g.title)}</div>
      <div class="space-y-0.5">
        ${g.items.map((item) => {
          const active = isActive(item);
          return `
            <a href="${item.route}" title="${esc(item.label)}" class="flex items-center gap-2.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${active ? "bg-[#1c2330] text-[#e6edf6] border-l-2 border-[#3b82f6]" : "text-[#94a3b8] hover:text-[#e6edf6] hover:bg-[#161b25] border-l-2 border-transparent"}">
              <span class="${active ? "text-[#3b82f6]" : "text-[#64748b]"}">${svgIcon(item.icon)}</span>
              <span class="sidebar-label truncate">${esc(item.label)}</span>
            </a>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");

  const terminalActive = path.startsWith("/terminal") || path.startsWith("/markets");

  return `
    <div id="sidebar-rail" class="hidden lg:flex flex-col w-[232px] h-screen sticky top-0 bg-[#11151d] border-r border-[#232a37] select-none transition-[width] duration-150">
      <div class="h-12 px-3 flex items-center justify-between border-b border-[#232a37] shrink-0">
        <a href="#/overview" class="flex items-center gap-2.5 min-w-0">
          <div class="w-7 h-7 rounded bg-[#1c2330] border border-[#2e3748] flex items-center justify-center shrink-0">
            <span class="font-mono text-xs font-semibold text-[#3b82f6]">UL</span>
          </div>
          <div class="sidebar-brand-text min-w-0">
            <div class="text-xs font-semibold tracking-tight text-[#e6edf6] leading-none">UltraLOB</div>
            <div class="text-[9px] font-mono text-[#64748b] mt-0.5 tracking-wider">INSTITUTIONAL</div>
          </div>
        </a>
        <button id="sidebar-collapse-btn" title="Toggle sidebar" class="p-1 rounded text-[#64748b] hover:text-[#e6edf6] hover:bg-[#161b25]">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/></svg>
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto px-2 py-3">
        ${groupsHtml}
      </nav>

      <div class="border-t border-[#232a37] p-2 space-y-1 shrink-0">
        <a href="#/terminal" title="FIX & Live Market Terminal" class="flex items-center gap-2.5 px-3 py-1.5 rounded text-xs font-medium ${terminalActive ? "bg-[#1c2330] text-[#e6edf6] border-l-2 border-[#3b82f6]" : "text-[#94a3b8] hover:text-[#e6edf6] hover:bg-[#161b25] border-l-2 border-transparent"}">
          <span class="text-[#3b82f6]">${svgIcon("terminal")}</span>
          <span class="sidebar-label truncate">Market Terminal</span>
        </a>
      </div>
    </div>

    <!-- Mobile slide-out drawer -->
    <div id="mobile-sidebar-rail" class="hidden fixed inset-y-0 left-0 z-50 w-64 bg-[#11151d] border-r border-[#232a37] flex-col lg:hidden">
      <div class="h-12 px-3 flex items-center justify-between border-b border-[#232a37]">
        <span class="text-xs font-semibold text-[#e6edf6]">UltraLOB Institutional</span>
        <button id="mobile-sidebar-close" class="btn-secondary px-2 py-1 text-xs">Close</button>
      </div>
      <nav class="flex-1 overflow-y-auto px-2 py-3">${groupsHtml}</nav>
      <div class="border-t border-[#232a37] p-2">
        <a href="#/terminal" class="flex items-center gap-2 px-3 py-2 text-xs text-[#94a3b8] hover:text-[#e6edf6]">Market Terminal</a>
      </div>
    </div>
  `;
}

export function init(onNavigate) {
  if (!isBrowser()) return;

  try {
    if (localStorage.getItem("ul_sidebar_collapsed") === "1") {
      document.body.classList.add("sidebar-collapsed");
    }
  } catch {}

  document.getElementById("sidebar-collapse-btn")?.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    try { localStorage.setItem("ul_sidebar_collapsed", collapsed ? "1" : "0"); } catch {}
  });

  const closeMobile = () => {
    document.getElementById("mobile-sidebar-rail")?.classList.add("hidden");
    document.getElementById("mobile-sidebar-rail")?.classList.remove("flex");
    document.getElementById("sidebar-backdrop")?.classList.add("hidden");
  };

  document.getElementById("mobile-sidebar-close")?.addEventListener("click", closeMobile);
  document.getElementById("sidebar-backdrop")?.addEventListener("click", closeMobile);

  document.querySelectorAll("#sidebar-container a[href^='#']").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      closeMobile();
      const target = a.getAttribute("href").slice(1);
      if (typeof onNavigate === "function") onNavigate(target);
      else window.location.hash = "#" + target;
    });
  });
}
