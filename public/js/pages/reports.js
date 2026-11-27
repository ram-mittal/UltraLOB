// Reports Screen — Institutional Portfolio Statements, CSV/JSON Export & HWM Fee Schedule Preview
import { api } from "../api.js";
import { state } from "../state.js";
import {
  isBrowser, esc, fmtUsd, fmtPct, fmtTs,
  metricTile, originBadge, statusBadge, stateBanner, dataTable
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Institutional Statements &amp; Fee Accounting</h1>
          <p class="text-xs text-[#94a3b8]">Origin-separated portfolio accounting statements, strategy attribution, and non-billing High-Water-Mark fee schedule preview.</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="rp-export-csv" class="btn-secondary font-mono text-[11px]">Export CSV Statement</button>
          <button id="rp-export-json" class="btn-primary font-mono text-[11px]">Export JSON Statement</button>
        </div>
      </div>

      <div id="rp-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

      <!-- Attribution & Statement Header -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-7 panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Strategy Performance Attribution</h2>
              <p class="text-[11px] text-[#64748b]">Closed trade P&amp;L separated by strategy ID and execution data origin</p>
            </div>
            <span id="rp-stmt-id" class="font-mono text-[10px] text-[#64748b]"></span>
          </div>
          <div id="rp-attr-table"></div>
        </div>

        <div class="lg:col-span-5 panel p-4 space-y-3">
          <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">HWM Fee Schedule Calculator</h2>
              <p class="text-[11px] text-[#64748b]">Accounting preview only — zero automated billing active</p>
            </div>
            ${statusBadge("NO BILLING")}
          </div>
          <form id="rp-fee-form" class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Beginning Equity ($)</label>
              <input name="beginningEquity" type="number" step="100" min="0" value="10000" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Ending Equity ($)</label>
              <input name="endingEquity" type="number" step="100" min="0" value="11250" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Prior High-Water Mark ($)</label>
              <input name="highWaterMarkEquity" type="number" step="100" min="0" value="10500" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Period Days</label>
              <input name="periodDays" type="number" min="1" max="366" value="30" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Annual Mgmt Fee (%)</label>
              <input name="annualMgmtFeePct" type="number" step="0.1" min="0" max="5" value="1.0" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Performance Fee (% HWM)</label>
              <input name="performanceFeePct" type="number" step="1" min="0" max="50" value="15" class="input-term w-full font-mono text-[11px]" />
            </div>
            <button type="submit" class="col-span-full btn-primary font-mono text-[11px]">Compute HWM Fee Preview</button>
          </form>
          <div id="rp-fee-output" class="text-xs text-[#94a3b8]">Run preview to inspect High-Water-Mark accrual math.</div>
        </div>
      </div>

      <!-- Raw Statement Envelope Preview -->
      <div class="panel p-4 space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Mandate &amp; Statement Snapshot</h2>
          <span id="rp-stmt-origin"></span>
        </div>
        <pre id="rp-raw-json" class="p-3 rounded bg-[#0b0e13] border border-[#232a37] text-[11px] font-mono text-[#cbd5e1] max-h-64 overflow-y-auto"></pre>
      </div>
    </div>
  `;
}

export async function init({ showToast }) {
  if (!isBrowser()) return;
  let lastStatement = null;

  async function refresh() {
    try {
      const res = await api.getInstitutionalStatement();
      const stmt = res?.statement;
      lastStatement = stmt;
      if (!stmt) return;

      const s = stmt.summary || {};
      const origin = stmt.data_origin || "PAPER_SANDBOX";
      const ts = stmt.generated_at;

      const idEl = document.getElementById("rp-stmt-id");
      if (idEl) idEl.textContent = stmt.statement_id;
      const origEl = document.getElementById("rp-stmt-origin");
      if (origEl) origEl.innerHTML = originBadge(origin, { updatedAt: ts });

      document.getElementById("rp-kpi-grid").innerHTML = [
        metricTile({ label: "Ending Equity", value: fmtUsd(s.equity_usd), subtext: `Cash Balance: ${fmtUsd(s.balance_usd)}`, origin, updatedAt: ts }),
        metricTile({ label: "High-Water Mark", value: fmtUsd(s.high_water_mark_usd), subtext: `Drawdown: ${fmtPct(s.current_drawdown_pct)}`, origin, updatedAt: ts }),
        metricTile({ label: "Realized P&L", value: fmtUsd(s.realized_pnl_usd, { sign: true }), tone: (s.realized_pnl_usd || 0) >= 0 ? "gain" : "loss", origin, subtext: `Closed Trades: ${s.closed_trades_count ?? 0}`, updatedAt: ts }),
        metricTile({ label: "Active Mandates / Open Pos", value: `${s.active_mandates_count ?? 0} / ${s.open_positions_count ?? 0}`, subtext: `Environment: ${stmt.execution_environment}`, origin, updatedAt: ts })
      ].join("");

      const attrEl = document.getElementById("rp-attr-table");
      if (attrEl) {
        attrEl.innerHTML = dataTable({
          id: "rp-tbl-attr",
          emptyTitle: "No Closed Trade Attribution",
          emptyMessage: "Close Paper Sandbox or MT5 Demo trades to compute per-strategy realized attribution.",
          columns: [
            { key: "strategy_id", label: "Strategy", mono: true },
            { key: "data_origin", label: "Origin", render: (r) => originBadge(r.data_origin) },
            { key: "trades_closed", label: "Trades", align: "right", mono: true },
            { key: "win_rate_pct", label: "Win %", align: "right", mono: true, render: (r) => r.win_rate_pct != null ? fmtPct(r.win_rate_pct) : "—" },
            { key: "realized_pnl_usd", label: "Realized P&L", align: "right", mono: true, render: (r) => `<span class="${(r.realized_pnl_usd || 0) >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}">${fmtUsd(r.realized_pnl_usd, { sign: true })}</span>` }
          ],
          rows: stmt.strategy_attribution || []
        });
      }

      const rawEl = document.getElementById("rp-raw-json");
      if (rawEl) rawEl.textContent = JSON.stringify({ account_holder: stmt.account_holder, mandate: stmt.mandate, summary: stmt.summary }, null, 2);
    } catch (err) {
      document.getElementById("rp-kpi-grid").innerHTML = `<div class="col-span-full">${stateBanner({ kind: "error", title: "Statement Unavailable", message: err.message })}</div>`;
    }
  }

  document.getElementById("rp-fee-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, v] of fd.entries()) payload[k] = Number(v);
    try {
      const res = await api.previewFeeSchedule(payload);
      document.getElementById("rp-fee-output").innerHTML = `
        <div class="panel-elevated p-3 font-mono text-[11px] space-y-1">
          <div class="flex justify-between"><span>Management Fee Accrued:</span><span class="text-[#e6edf6]">${fmtUsd(res.management_fee_usd)}</span></div>
          <div class="flex justify-between"><span>Profit Above HWM:</span><span class="text-[#93c5fd]">${fmtUsd(res.profit_above_hwm_usd)}</span></div>
          <div class="flex justify-between"><span>Performance Fee (${res.period_days}d):</span><span class="text-[#eab308]">${fmtUsd(res.performance_fee_usd)}</span></div>
          <div class="flex justify-between border-t border-[#232a37] pt-1 font-semibold"><span>Net Ending Equity:</span><span class="text-[#22c55e]">${fmtUsd(res.net_ending_equity)}</span></div>
          <div class="flex justify-between"><span>New High-Water Mark:</span><span class="text-[#e6edf6]">${fmtUsd(res.new_high_water_mark)}</span></div>
          <div class="text-[10px] text-[#64748b] pt-1">${esc(res.disclosure)}</div>
        </div>
      `;
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("rp-export-csv")?.addEventListener("click", async () => {
    try {
      const headers = state.token ? { Authorization: `Bearer ${state.token}` } : {};
      const resp = await fetch("/api/institutional/statement?format=csv", { headers, credentials: "same-origin" });
      if (!resp.ok) throw new Error("Failed exporting CSV");
      const csv = await resp.text();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ultralob-statement-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("CSV statement downloaded", "success");
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("rp-export-json")?.addEventListener("click", () => {
    if (!lastStatement) return showToast("Statement not loaded yet", "warning");
    const blob = new Blob([JSON.stringify(lastStatement, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lastStatement.statement_id || "ultralob-statement"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("JSON statement downloaded", "success");
  });

  await refresh();
}
