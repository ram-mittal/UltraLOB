// Shared Institutional UI Helpers, Provenance Badges, Sortable Tables & Detail Drawer

export function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtNum(val, decimals = 2) {
  if (val === null || val === undefined || val === "" || Number.isNaN(Number(val))) return "—";
  return Number(val).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function fmtUsd(val, opts = {}) {
  const { sign = false, decimals = 2 } = opts;
  if (val === null || val === undefined || val === "" || Number.isNaN(Number(val))) return "—";
  const num = Number(val);
  const absFormatted = Math.abs(num).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  if (num < 0) return `-$${absFormatted}`;
  if (sign && num > 0) return `+$${absFormatted}`;
  return `$${absFormatted}`;
}

export function fmtPct(val, opts = {}) {
  const { sign = false, decimals = 2 } = opts;
  if (val === null || val === undefined || val === "" || Number.isNaN(Number(val))) return "—";
  const num = Number(val);
  const absFormatted = Math.abs(num).toFixed(decimals);
  if (num < 0) return `-${absFormatted}%`;
  if (sign && num > 0) return `+${absFormatted}%`;
  return `${num.toFixed(decimals)}%`;
}

export function fmtPrice(val, symbol = "XAUUSD") {
  if (val === null || val === undefined || val === "" || Number.isNaN(Number(val))) return "—";
  const s = String(symbol || "").toUpperCase();
  const decimals = s.includes("USD") && !s.startsWith("XAU") && !s.startsWith("BTC") && !s.startsWith("ETH") ? 5 : 2;
  return Number(val).toFixed(decimals);
}

export function fmtTs(iso) {
  if (!iso) return "Awaiting timestamp";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

export function originBadge(origin, meta = {}) {
  const key = String(origin || "AWAITING_DATA").toUpperCase();
  const map = {
    REAL_MARKET: { label: "LIVE FEED", cls: "border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#93c5fd]" },
    BACKTEST: { label: "BACKTEST", cls: "border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#93c5fd]" },
    OUT_OF_SAMPLE: { label: "OOS BACKTEST", cls: "border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#93c5fd]" },
    WALK_FORWARD: { label: "WALK-FORWARD", cls: "border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#93c5fd]" },
    EMPIRICAL_TRADES: { label: "EMPIRICAL", cls: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#86efac]" },
    EQUITY_SNAPSHOTS: { label: "EQUITY SERIES", cls: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#86efac]" },
    DEMO: { label: "DEMO", cls: "border-[#eab308]/40 bg-[#eab308]/10 text-[#fde047]" },
    DEMO_ONLY: { label: "DEMO ONLY", cls: "border-[#eab308]/40 bg-[#eab308]/10 text-[#fde047]" },
    DEMO_BROKER: { label: "MT5 DEMO", cls: "border-[#eab308]/40 bg-[#eab308]/10 text-[#fde047]" },
    PAPER_SANDBOX: { label: "DEMO / PAPER", cls: "border-[#eab308]/40 bg-[#eab308]/10 text-[#fde047]" },
    LIVE: { label: "LIVE", cls: "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#86efac]" },
    SIMULATED: { label: "SIMULATED", cls: "border-[#64748b]/40 bg-[#1c2330] text-[#cbd5e1]" },
    SIMULATED_RESEARCH: { label: "SIMULATED", cls: "border-[#64748b]/40 bg-[#1c2330] text-[#cbd5e1]" },
    SIMULATED_STRESS_TEST: { label: "SIMULATED", cls: "border-[#64748b]/40 bg-[#1c2330] text-[#cbd5e1]" },
    AWAITING_VALIDATION: { label: "AWAITING VALIDATION", cls: "border-[#2e3748] bg-[#161b25] text-[#94a3b8]" },
    AWAITING_SAMPLE: { label: "AWAITING SAMPLE", cls: "border-[#2e3748] bg-[#161b25] text-[#94a3b8]" },
    AWAITING_DATA: { label: "AWAITING DATA", cls: "border-[#2e3748] bg-[#161b25] text-[#94a3b8]" },
    RESEARCH: { label: "RESEARCH", cls: "border-[#2e3748] bg-[#161b25] text-[#94a3b8]" }
  };
  const cfg = map[key] || { label: key.replace(/_/g, " "), cls: "border-[#2e3748] bg-[#161b25] text-[#94a3b8]" };
  const details = [meta.period, meta.source, meta.updatedAt ? fmtTs(meta.updatedAt) : null].filter(Boolean).join(" • ");
  return `<span title="${esc(details || cfg.label)}" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider border ${cfg.cls}">${esc(cfg.label)}</span>`;
}

export function statusBadge(status) {
  const s = String(status || "UNKNOWN").toUpperCase();
  let cls = "border-[#2e3748] bg-[#161b25] text-[#94a3b8]";
  if (["TRADE", "VALIDATED_BACKTEST", "DEMO_VERIFIED", "ACK_OK", "FILLED", "APPROVED", "ACTIVE", "PASS", "OK", "CLEAR", "READY"].includes(s)) {
    cls = "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#86efac]";
  } else if (["HALT", "REJECTED", "FAILED", "ERROR", "VETO", "DISCONNECTED", "REVOKED"].includes(s)) {
    cls = "border-[#ef4444]/40 bg-[#ef4444]/10 text-[#fca5a5]";
  } else if (["WAIT", "REDUCE EXPOSURE", "PAPER_ACTIVE", "RESTRICTED", "WARNING", "PENDING", "QUEUED", "CONDITIONAL"].includes(s)) {
    cls = "border-[#eab308]/40 bg-[#eab308]/10 text-[#fde047]";
  } else if (["RESEARCH", "AWAITING", "AWAITING_DATA"].includes(s)) {
    cls = "border-[#3b82f6]/35 bg-[#3b82f6]/10 text-[#93c5fd]";
  }
  return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider border ${cls}">${esc(s.replace(/_/g, " "))}</span>`;
}

export function metricTile({
  label,
  value,
  subtext = "",
  tone = "neutral",
  origin = "DEMO",
  period = "",
  source = "",
  updatedAt = null,
  tooltip = ""
}) {
  const toneCls =
    tone === "gain" ? "text-[#22c55e]" :
    tone === "loss" ? "text-[#ef4444]" :
    tone === "warn" ? "text-[#eab308]" :
    tone === "accent" ? "text-[#3b82f6]" :
    "text-[#e6edf6]";

  return `
    <div class="panel p-3.5 flex flex-col justify-between gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-[11px] font-medium uppercase tracking-wider text-[#94a3b8] truncate">${esc(label)}</span>
          ${tooltip ? `<span title="${esc(tooltip)}" class="cursor-help text-[10px] font-mono text-[#64748b] border border-[#232a37] rounded px-1 leading-tight">?</span>` : ""}
        </div>
        ${origin ? originBadge(origin, { period, source, updatedAt }) : ""}
      </div>
      <div class="font-mono text-xl font-semibold tracking-tight ${toneCls}">${value}</div>
      <div class="flex items-center justify-between gap-2 text-[10px] text-[#64748b] border-t border-[#232a37]/70 pt-1.5">
        <span class="truncate">${esc(subtext || source || "UltraLOB Engine")}</span>
        <span class="font-mono shrink-0">${esc(period || (updatedAt ? fmtTs(updatedAt).slice(11, 19) + "Z" : ""))}</span>
      </div>
    </div>
  `;
}

export function stateBanner({ kind = "empty", title, message, actionHtml = "" }) {
  const styles = {
    loading: "border-[#232a37] bg-[#11151d] text-[#94a3b8]",
    empty: "border-[#232a37] bg-[#11151d] text-[#94a3b8]",
    error: "border-[#ef4444]/40 bg-[#ef4444]/5 text-[#fca5a5]",
    stale: "border-[#eab308]/40 bg-[#eab308]/5 text-[#fde047]",
    disconnected: "border-[#2e3748] bg-[#161b25] text-[#cbd5e1]"
  };
  return `
    <div class="rounded-md border p-4 ${styles[kind] || styles.empty} flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-xs font-semibold uppercase tracking-wider">${esc(title)}</div>
        <div class="text-xs text-[#94a3b8] mt-1">${esc(message)}</div>
      </div>
      ${actionHtml ? `<div class="shrink-0">${actionHtml}</div>` : ""}
    </div>
  `;
}

export function dataTable({ id, columns = [], rows = [], emptyTitle = "No Records", emptyMessage = "No matching records are available for the selected scope." }) {
  if (!rows.length) {
    return stateBanner({ kind: "empty", title: emptyTitle, message: emptyMessage });
  }
  const headHtml = columns.map((col, idx) => {
    const align = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";
    const sortAttr = col.sortKey ? `data-sort-col="${idx}" data-sort-type="${col.sortType || "text"}"` : "";
    return `<th class="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] border-b border-[#232a37] whitespace-nowrap ${align} ${col.sortKey ? "table-sort-btn" : ""}" ${sortAttr}>${esc(col.label)}${col.sortKey ? ' <span class="text-[#64748b]">↕</span>' : ""}</th>`;
  }).join("");

  const bodyHtml = rows.map((row, rIdx) => {
    const rowIdAttr = row._rowId ? `data-row-id="${esc(row._rowId)}"` : `data-row-idx="${rIdx}"`;
    const clickable = row._clickable ? "cursor-pointer hover:bg-[#161b25]" : "hover:bg-[#161b25]/60";
    const cells = columns.map((col) => {
      const align = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";
      const mono = col.mono ? "font-mono" : "";
      const rawSort = col.sortVal ? col.sortVal(row) : (row[col.key] ?? "");
      const valHtml = col.render ? col.render(row) : esc(row[col.key] ?? "—");
      return `<td class="px-3 py-2 border-b border-[#232a37]/70 text-xs whitespace-nowrap ${align} ${mono}" data-val="${esc(rawSort)}">${valHtml}</td>`;
    }).join("");
    return `<tr class="${clickable} transition-colors" ${rowIdAttr}>${cells}</tr>`;
  }).join("");

  return `
    <div class="overflow-x-auto">
      <table id="${esc(id)}" class="w-full border-collapse">
        <thead class="bg-[#0b0e13]/70"><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;
}

export function wireTableInteractions(tableId, onRowClick = null) {
  if (!isBrowser()) return;
  const table = document.getElementById(tableId);
  if (!table) return;

  let sortDir = {};
  table.querySelectorAll("th[data-sort-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const colIdx = Number(th.dataset.sortCol);
      const sortType = th.dataset.sortType || "text";
      const asc = !sortDir[colIdx];
      sortDir = { [colIdx]: asc };
      const tbody = table.querySelector("tbody");
      if (!tbody) return;
      const trs = Array.from(tbody.querySelectorAll("tr"));
      trs.sort((a, b) => {
        const av = a.children[colIdx]?.dataset?.val ?? "";
        const bv = b.children[colIdx]?.dataset?.val ?? "";
        if (sortType === "number") {
          const an = Number.parseFloat(av);
          const bn = Number.parseFloat(bv);
          const va = Number.isFinite(an) ? an : -Infinity;
          const vb = Number.isFinite(bn) ? bn : -Infinity;
          return asc ? va - vb : vb - va;
        }
        return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
      trs.forEach((tr) => tbody.appendChild(tr));
    });
  });

  if (typeof onRowClick === "function") {
    table.querySelectorAll("tbody tr").forEach((tr) => {
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button, a, input, select")) return;
        onRowClick(tr.dataset.rowId || tr.dataset.rowIdx, tr);
      });
    });
  }
}

export function openDrawer({ title, subtitle = "", badgeHtml = "", bodyHtml = "", footerHtml = "" }) {
  if (!isBrowser()) return;
  const root = document.getElementById("drawer-root");
  if (!root) return;
  root.innerHTML = `
    <div id="drawer-overlay" class="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div class="w-full max-w-lg bg-[#11151d] border-l border-[#232a37] h-full flex flex-col shadow-2xl">
        <div class="px-4 py-3 border-b border-[#232a37] flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-sm font-semibold text-[#e6edf6] truncate">${esc(title)}</h3>
              ${badgeHtml}
            </div>
            ${subtitle ? `<p class="text-[11px] font-mono text-[#94a3b8] mt-0.5 truncate">${esc(subtitle)}</p>` : ""}
          </div>
          <button id="drawer-close-btn" class="btn-secondary px-2 py-1 text-xs font-mono">ESC</button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-4 text-xs">${bodyHtml}</div>
        ${footerHtml ? `<div class="px-4 py-3 border-t border-[#232a37] bg-[#0b0e13]/60 flex items-center justify-end gap-2">${footerHtml}</div>` : ""}
      </div>
    </div>
  `;
  const close = () => closeDrawer();
  document.getElementById("drawer-close-btn")?.addEventListener("click", close);
  document.getElementById("drawer-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "drawer-overlay") close();
  });
}

export function closeDrawer() {
  if (!isBrowser()) return;
  const root = document.getElementById("drawer-root");
  if (root) root.innerHTML = "";
}

// Shared session terminal context for Topbar / Pages
export const terminalContext = {
  selectedOrgName: "UltraLOB Institutional Desk",
  selectedAccountId: "paper-sandbox",
  environment: "DEMO",
  marketStatus: null,
  notifications: []
};
