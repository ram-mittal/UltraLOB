// Strategy Marketplace — Compact Institutional Quantitative Catalogue
import { api } from "../api.js";
import {
  isBrowser, esc, fmtUsd, fmtPct, fmtNum,
  statusBadge, originBadge, stateBanner, dataTable, wireTableInteractions, openDrawer
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Strategy Marketplace</h1>
          <p class="text-xs text-[#94a3b8]">Quantitative strategies with strict separation between Research, Real-Market Backtests, and Demo Verification.</p>
        </div>
        <div class="flex items-center gap-2">
          <a href="#/research" class="btn-secondary font-mono text-[11px]">Open Research Lab</a>
          <button id="mkt-register-btn" class="btn-primary font-mono text-[11px]">+ Submit Strategy Spec</button>
        </div>
      </div>

      <!-- Filter Strip -->
      <div class="panel p-3 flex flex-wrap items-center gap-2.5">
        <input id="mkt-search" type="text" placeholder="Search code, name, or instrument..." class="input-term flex-1 min-w-[200px]" />
        <select id="mkt-status-filter" class="input-term font-mono text-[11px]">
          <option value="ALL">All Lifecycles</option>
          <option value="VALIDATED_BACKTEST">VALIDATED BACKTEST</option>
          <option value="DEMO_VERIFIED">DEMO VERIFIED</option>
          <option value="PAPER_ACTIVE">PAPER ACTIVE</option>
          <option value="RESEARCH">RESEARCH</option>
        </select>
        <select id="mkt-inst-filter" class="input-term font-mono text-[11px]">
          <option value="ALL">All Instruments</option>
          <option value="XAUUSD">XAUUSD</option>
          <option value="BTCUSD">BTCUSD</option>
        </select>
        <span id="mkt-count-label" class="text-[11px] font-mono text-[#64748b] ml-auto">Loading...</span>
      </div>

      <!-- Honest Data Notice -->
      <div class="text-[11px] text-[#94a3b8] px-1 flex flex-wrap items-center gap-2">
        ${originBadge("BACKTEST")}
        <span>Performance metrics remain <span class="font-mono text-[#e6edf6]">Awaiting Backtest</span> (—) until empirically computed in Research Lab on verified OHLCV data.</span>
      </div>

      <div id="mkt-table-container" class="panel overflow-hidden">
        <div class="p-6 text-xs text-[#94a3b8]">Loading quantitative strategy catalogue...</div>
      </div>
    </div>
  `;
}

export async function init({ showToast, navigate }) {
  if (!isBrowser()) return;
  let allStrategies = [];

  function renderTable() {
    const q = (document.getElementById("mkt-search")?.value || "").trim().toLowerCase();
    const statusF = document.getElementById("mkt-status-filter")?.value || "ALL";
    const instF = document.getElementById("mkt-inst-filter")?.value || "ALL";

    const filtered = allStrategies.filter((s) => {
      if (statusF !== "ALL" && String(s.lifecycle_status).toUpperCase() !== statusF) return false;
      if (instF !== "ALL" && !String(s.instrument || "").toUpperCase().includes(instF)) return false;
      if (q) {
        const hay = `${s.code} ${s.name} ${s.instrument} ${s.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).map((s) => ({ ...s, _rowId: s.id, _clickable: true }));

    const lbl = document.getElementById("mkt-count-label");
    if (lbl) lbl.textContent = `${filtered.length} / ${allStrategies.length} strategies`;

    const wrap = document.getElementById("mkt-table-container");
    if (!wrap) return;

    wrap.innerHTML = dataTable({
      id: "mkt-tbl",
      emptyTitle: "No Matching Strategies",
      emptyMessage: "Adjust search filters or register a new quantitative specification.",
      columns: [
        {
          key: "code",
          label: "ID / Strategy",
          sortKey: true,
          render: (r) => `
            <div class="flex flex-col">
              <div class="font-medium text-[#e6edf6]"><span class="font-mono text-[#3b82f6] mr-1.5">${esc(r.code)}</span>${esc(r.name)}</div>
              <div class="text-[10px] text-[#64748b]">${esc(r.category || r.category_label || "Quantitative")}</div>
            </div>`
        },
        {
          key: "lifecycle_status",
          label: "Status & Ver",
          sortKey: true,
          render: (r) => `<div class="flex items-center gap-1.5">${statusBadge(r.lifecycle_status)}<span class="font-mono text-[10px] text-[#64748b]">v${esc(r.version || "1.0.0")}</span></div>`
        },
        {
          key: "instrument",
          label: "Inst / TF",
          sortKey: true,
          render: (r) => `<span class="font-mono text-[#e6edf6]">${esc(r.instrument)}</span> <span class="text-[10px] font-mono text-[#64748b]">${esc(r.timeframe || (r.timeframes || []).join("/"))}</span>`
        },
        {
          key: "total_return",
          label: "Return",
          align: "right",
          mono: true,
          sortKey: true,
          sortType: "number",
          sortVal: (r) => r.total_return ?? "",
          render: (r) => r.total_return == null
            ? originBadge("AWAITING_VALIDATION")
            : `<span class="${r.total_return >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}">${fmtPct(r.total_return, { sign: true })}</span>`
        },
        {
          key: "max_drawdown",
          label: "Max DD",
          align: "right",
          mono: true,
          sortKey: true,
          sortType: "number",
          sortVal: (r) => r.max_drawdown ?? "",
          render: (r) => r.max_drawdown == null ? `<span class="text-[#64748b]">—</span>` : `<span class="text-[#ef4444]">${fmtPct(r.max_drawdown)}</span>`
        },
        {
          key: "sharpe_ratio",
          label: "Sharpe",
          align: "right",
          mono: true,
          sortKey: true,
          sortType: "number",
          sortVal: (r) => r.sharpe_ratio ?? "",
          render: (r) => fmtNum(r.sharpe_ratio, 2)
        },
        {
          key: "profit_factor",
          label: "PF",
          align: "right",
          mono: true,
          sortKey: true,
          sortType: "number",
          sortVal: (r) => r.profit_factor ?? "",
          render: (r) => fmtNum(r.profit_factor, 2)
        },
        {
          key: "total_trades",
          label: "Trades",
          align: "right",
          mono: true,
          sortKey: true,
          sortType: "number",
          render: (r) => r.total_trades ? String(r.total_trades) : "0"
        },
        {
          key: "min_capital",
          label: "Min / Cap",
          align: "right",
          mono: true,
          sortKey: true,
          sortType: "number",
          render: (r) => `<span class="text-[#e6edf6]">${fmtUsd(r.min_capital, { decimals: 0 })}</span><span class="text-[#64748b]"> / ${r.capacity_limit_usd ? fmtUsd(r.capacity_limit_usd, { decimals: 0 }) : "TBD"}</span>`
        },
        {
          key: "actions",
          label: "Action",
          align: "right",
          render: (r) => `
            <div class="inline-flex items-center gap-1.5">
              <a href="#/strategy/${esc(r.id)}" class="btn-secondary px-2 py-0.5 text-[10px] font-mono">Inspect</a>
              <button data-alloc-strat="${esc(r.id)}" class="btn-primary px-2 py-0.5 text-[10px] font-mono">Allocate</button>
            </div>
          `
        }
      ],
      rows: filtered
    });

    wireTableInteractions("mkt-tbl", (rowId) => navigate(`/strategy/${rowId}`));

    wrap.querySelectorAll("[data-alloc-strat]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const strat = allStrategies.find((x) => x.id === btn.dataset.allocStrat);
        if (!strat) return;
        openDrawer({
          title: `Allocate to ${strat.code}: ${strat.name}`,
          subtitle: `Mandate & Independent Risk Engine validation enforced`,
          badgeHtml: statusBadge(strat.lifecycle_status),
          bodyHtml: `
            <div class="space-y-3">
              <div class="panel-elevated p-3 text-xs text-[#94a3b8] space-y-1">
                <div>Instrument: <span class="font-mono text-[#e6edf6]">${esc(strat.instrument)}</span> | TF: <span class="font-mono text-[#e6edf6]">${esc(strat.timeframe)}</span></div>
                <div>Minimum Capital: <span class="font-mono text-[#e6edf6]">${fmtUsd(strat.min_capital)}</span></div>
              </div>
              <div>
                <label class="block text-[11px] uppercase tracking-wider text-[#94a3b8] mb-1">Allocation Amount (USD)</label>
                <input id="alloc-amt-inp" type="number" min="100" step="100" value="${Math.max(1000, Number(strat.min_capital || 1000))}" class="input-term w-full font-mono" />
              </div>
              <div>
                <label class="block text-[11px] uppercase tracking-wider text-[#94a3b8] mb-1">Strategy Max Drawdown Cap (%)</label>
                <input id="alloc-dd-inp" type="number" min="1" max="25" step="0.5" value="8" class="input-term w-full font-mono" />
              </div>
              <button id="alloc-submit-btn" class="btn-primary w-full font-mono">Confirm Mandate & Allocate</button>
            </div>
          `
        });
        document.getElementById("alloc-submit-btn")?.addEventListener("click", async () => {
          const allocation = Number(document.getElementById("alloc-amt-inp")?.value || 1000);
          const maxDrawdownPct = Number(document.getElementById("alloc-dd-inp")?.value || 8);
          try {
            await api.subscribe({ strategyId: strat.id, allocation, maxDrawdownPct });
            showToast(`Allocated ${fmtUsd(allocation)} to ${strat.code}`, "success");
            document.getElementById("drawer-root").innerHTML = "";
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });
    });
  }

  try {
    allStrategies = await api.getStrategies();
    renderTable();
  } catch (err) {
    const wrap = document.getElementById("mkt-table-container");
    if (wrap) wrap.innerHTML = stateBanner({ kind: "error", title: "Failed Loading Strategies", message: err.message });
  }

  document.getElementById("mkt-search")?.addEventListener("input", renderTable);
  document.getElementById("mkt-status-filter")?.addEventListener("change", renderTable);
  document.getElementById("mkt-inst-filter")?.addEventListener("change", renderTable);

  document.getElementById("mkt-register-btn")?.addEventListener("click", () => {
    openDrawer({
      title: "Submit Quantitative Strategy Spec",
      subtitle: "Requires Admin or Quant Researcher RBAC role",
      badgeHtml: statusBadge("RESEARCH"),
      bodyHtml: `
        <form id="new-strat-form" class="space-y-3">
          <div>
            <label class="block text-[11px] uppercase text-[#94a3b8] mb-1">Strategy Code (e.g. UL-06)</label>
            <input name="code" required placeholder="UL-06" class="input-term w-full font-mono" />
          </div>
          <div>
            <label class="block text-[11px] uppercase text-[#94a3b8] mb-1">Strategy Name</label>
            <input name="name" required placeholder="Gold London Opening Range Breakout" class="input-term w-full" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[11px] uppercase text-[#94a3b8] mb-1">Instrument</label>
              <input name="instrument" value="XAUUSD" class="input-term w-full font-mono" />
            </div>
            <div>
              <label class="block text-[11px] uppercase text-[#94a3b8] mb-1">Category</label>
              <input name="category" value="Breakout" class="input-term w-full" />
            </div>
          </div>
          <div>
            <label class="block text-[11px] uppercase text-[#94a3b8] mb-1">Entry Logic</label>
            <textarea name="entry_logic" rows="2" required class="input-term w-full" placeholder="Systematic entry rule..."></textarea>
          </div>
          <div>
            <label class="block text-[11px] uppercase text-[#94a3b8] mb-1">Stop-Loss Methodology</label>
            <input name="stop_loss_methodology" required value="ATR(14) * 1.5 structure stop" class="input-term w-full" />
          </div>
          <button type="submit" class="btn-primary w-full font-mono">Register Specification (RESEARCH)</button>
        </form>
      `
    });
    document.getElementById("new-strat-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api.createStrategy({
          code: fd.get("code"),
          name: fd.get("name"),
          instrument: fd.get("instrument"),
          category: fd.get("category"),
          entry_logic: fd.get("entry_logic"),
          stop_loss_methodology: fd.get("stop_loss_methodology")
        });
        showToast("Strategy specification registered cleanly", "success");
        document.getElementById("drawer-root").innerHTML = "";
        allStrategies = await api.getStrategies();
        renderTable();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}
