// Portfolio Screen — Capital Allocation, Equity, Exposure, Correlation, Risk Contribution & Optimizer
import { api } from "../api.js";
import { createEquityCurve, createDonutChart } from "../components/charts.js";
import {
  isBrowser, esc, fmtUsd, fmtPct, fmtNum, fmtPrice,
  metricTile, originBadge, statusBadge, stateBanner, dataTable, wireTableInteractions
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Portfolio & Capital Allocation</h1>
          <p class="text-xs text-[#94a3b8]">Cross-strategy allocation weights, risk contribution, instrument exposure, correlation matrix, and rebalancing controls.</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="pf-fund-btn" class="btn-secondary font-mono text-[11px]">Fund Paper Sandbox</button>
          <a href="#/marketplace" class="btn-primary font-mono text-[11px]">+ Add Strategy</a>
        </div>
      </div>

      <div id="pf-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

      <!-- Equity + Allocation Donut -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-7 panel p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs font-semibold text-[#e6edf6]">Portfolio Equity Progression</div>
            ${originBadge("PAPER_SANDBOX", { period: "Inception" })}
          </div>
          <div id="pf-eq-wrap" class="h-56"></div>
        </div>
        <div class="lg:col-span-5 panel p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs font-semibold text-[#e6edf6]">Instrument Exposure Share</div>
            ${originBadge("DEMO", { period: "Live Positions" })}
          </div>
          <div id="pf-exp-wrap" class="h-56"></div>
        </div>
      </div>

      <!-- Allocation Optimizer & Controls -->
      <div class="panel p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#232a37] pb-3">
          <div>
            <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Capital Allocation & Rebalancing Engine</h2>
            <p class="text-[11px] text-[#64748b]">Compute risk-weighted, volatility-adjusted, or equal-weight capital schedules under single-strategy & portfolio hard caps.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select id="pf-opt-method" class="input-term font-mono text-[11px]">
              <option value="RISK_WEIGHTED">RISK_WEIGHTED</option>
              <option value="VOLATILITY_ADJUSTED">VOLATILITY_ADJUSTED</option>
              <option value="EQUAL_WEIGHT">EQUAL_WEIGHT</option>
            </select>
            <input id="pf-opt-cap" type="number" min="100" step="500" placeholder="Auto Equity ($)" class="input-term w-32 font-mono text-[11px]" />
            <button id="pf-opt-preview" class="btn-secondary font-mono text-[11px]">Preview Allocation</button>
            <button id="pf-opt-apply" class="btn-primary font-mono text-[11px]">Apply Rebalance</button>
          </div>
        </div>
        <div id="pf-opt-table"></div>
      </div>

      <!-- Subscribed Strategies & Exposure Breakdown -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div class="xl:col-span-7 panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Subscribed Strategy Capital</h2>
            <span class="text-[10px] font-mono text-[#64748b]">PAUSE / RESUME / UNALLOCATE</span>
          </div>
          <div id="pf-subs-table"></div>
        </div>

        <div class="xl:col-span-5 panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Instrument Exposure Breakdown</h2>
            <span id="pf-lev-badge" class="text-[11px] font-mono text-[#94a3b8]"></span>
          </div>
          <div id="pf-inst-table"></div>
        </div>
      </div>

      <!-- Correlation Matrix & Open Positions -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div class="xl:col-span-6 panel p-4 space-y-2 overflow-hidden">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Cross-Strategy Correlation Matrix</h2>
              <p class="text-[11px] text-[#64748b]">Pearson correlation on overlapping empirical monthly returns (never fabricated).</p>
            </div>
            ${originBadge("BACKTEST")}
          </div>
          <div id="pf-corr-grid" class="overflow-x-auto"></div>
        </div>

        <div class="xl:col-span-6 panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Open Portfolio Positions</h2>
            <a href="#/terminal" class="text-[11px] font-mono text-[#3b82f6] hover:underline">New Order →</a>
          </div>
          <div id="pf-open-pos-table"></div>
        </div>
      </div>
    </div>
  `;
}

export async function init({ showToast }) {
  if (!isBrowser()) return;

  async function refresh() {
    const [portRes, sumRes] = await Promise.all([
      api.getPortfolio().catch((e) => ({ _err: e.message })),
      api.getPortfolioSummary().catch(() => null)
    ]);

    if (portRes?._err) {
      document.getElementById("pf-kpi-grid").innerHTML = `<div class="col-span-full">${stateBanner({ kind: "error", title: "Portfolio Load Failed", message: portRes._err })}</div>`;
      return;
    }

    const metrics = portRes.metrics || {};
    const subs = portRes.subscriptions || [];
    const trades = portRes.trades || [];
    const openTrades = trades.filter((t) => t.status === "open");
    const eqHistory = portRes.equityHistory || [];
    const exposure = sumRes?.exposure || { instruments: [], portfolio_leverage: metrics.portfolio_leverage || 0 };
    const correlations = sumRes?.correlations || { pairs: [] };
    const origin = portRes.data_origin || metrics.data_origin || "PAPER_SANDBOX";
    const nowIso = new Date().toISOString();

    document.getElementById("pf-kpi-grid").innerHTML = [
      metricTile({ label: "Total Equity", value: fmtUsd(metrics.equity), subtext: `Balance: ${fmtUsd(metrics.balance)}`, origin, period: "Current", updatedAt: nowIso }),
      metricTile({ label: "Allocated Capital", value: fmtUsd(metrics.allocated_capital), subtext: `Free Cash: ${fmtUsd(metrics.available_capital)}`, origin, period: "Current", updatedAt: nowIso }),
      metricTile({ label: "Realized P&L", value: fmtUsd(metrics.realized_pnl, { sign: true }), tone: (metrics.realized_pnl || 0) >= 0 ? "gain" : "loss", origin, period: "Cumulative", updatedAt: nowIso }),
      metricTile({ label: "Unrealized P&L / Margin", value: `${fmtUsd(metrics.unrealized_pnl, { sign: true })} / ${fmtPct(metrics.margin_utilization_pct)}`, subtext: `Used ${fmtUsd(metrics.margin_used)} | Lev ${fmtNum(metrics.portfolio_leverage, 2)}x`, tone: (metrics.unrealized_pnl || 0) >= 0 ? "gain" : "loss", origin, period: "Open MTM", updatedAt: nowIso })
    ].join("");

    const eqWrap = document.getElementById("pf-eq-wrap");
    if (eqWrap) {
      if (eqHistory.length >= 2) {
        eqWrap.innerHTML = `<canvas id="pf-eq-chart"></canvas>`;
        createEquityCurve("pf-eq-chart", eqHistory, "Portfolio Equity");
      } else {
        eqWrap.innerHTML = stateBanner({ kind: "empty", title: "Awaiting Equity Curve", message: "Execute paper trades or fund capital snapshots to plot equity growth." });
      }
    }

    const expWrap = document.getElementById("pf-exp-wrap");
    const insts = exposure.instruments || [];
    if (expWrap) {
      if (insts.length > 0) {
        expWrap.innerHTML = `<canvas id="pf-exp-chart"></canvas>`;
        createDonutChart("pf-exp-chart", insts.map((i) => i.symbol), insts.map((i) => Math.max(1, Number(i.allocated_usd || i.gross_notional_usd || 0))));
      } else {
        expWrap.innerHTML = stateBanner({ kind: "empty", title: "Zero Active Exposure", message: "No instrument allocations or open positions active." });
      }
    }

    const levBadge = document.getElementById("pf-lev-badge");
    if (levBadge) levBadge.textContent = `Gross Notional ${fmtUsd(exposure.gross_notional || 0)} (${fmtNum(exposure.portfolio_leverage || 0, 2)}x)`;

    // Subscribed Strategies
    const subsEl = document.getElementById("pf-subs-table");
    if (subsEl) {
      subsEl.innerHTML = dataTable({
        id: "pf-tbl-subs",
        emptyTitle: "No Subscribed Strategies",
        emptyMessage: "Use Strategy Marketplace or the Allocation Optimizer above to assign capital.",
        columns: [
          { key: "strategyName", label: "Strategy", render: (r) => `<a href="#/strategy/${esc(r.strategyId)}" class="hover:text-[#3b82f6] font-medium"><span class="font-mono text-[#3b82f6] mr-1">${esc(r.code || "STR")}</span>${esc(r.strategyName)}</a>` },
          { key: "instrument", label: "Inst", mono: true },
          { key: "allocation", label: "Allocation", align: "right", mono: true, render: (r) => fmtUsd(r.allocation) },
          { key: "riskPerTradePct", label: "Risk/Tr", align: "right", mono: true, render: (r) => fmtPct(r.riskPerTradePct ?? 0.5) },
          { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
          {
            key: "ctl",
            label: "Controls",
            align: "right",
            render: (r) => `
              <div class="inline-flex gap-1">
                <button data-pf-toggle="${esc(r.strategyId)}" class="btn-secondary px-2 py-0.5 text-[10px] font-mono">${r.status === "active" ? "Pause" : "Resume"}</button>
                <button data-pf-rem="${esc(r.strategyId)}" class="btn-danger px-2 py-0.5 text-[10px] font-mono">Remove</button>
              </div>`
          }
        ],
        rows: subs
      });
      subsEl.querySelectorAll("[data-pf-toggle]").forEach((b) => b.addEventListener("click", async () => {
        try { await api.toggleCopy(b.dataset.pfToggle); showToast("Updated", "success"); refresh(); } catch (e) { showToast(e.message, "error"); }
      }));
      subsEl.querySelectorAll("[data-pf-rem]").forEach((b) => b.addEventListener("click", async () => {
        try { await api.unsubscribe(b.dataset.pfRem); showToast("Removed strategy", "info"); refresh(); } catch (e) { showToast(e.message, "error"); }
      }));
    }

    // Instrument Exposure Table
    const instEl = document.getElementById("pf-inst-table");
    if (instEl) {
      instEl.innerHTML = dataTable({
        id: "pf-tbl-inst",
        emptyTitle: "No Instrument Exposure",
        emptyMessage: "Flat exposure across all instruments.",
        columns: [
          { key: "symbol", label: "Symbol", mono: true },
          { key: "allocated_usd", label: "Allocated", align: "right", mono: true, render: (r) => fmtUsd(r.allocated_usd) },
          { key: "gross_notional_usd", label: "Notional", align: "right", mono: true, render: (r) => fmtUsd(r.gross_notional_usd) },
          { key: "allocation_pct_of_equity", label: "% Equity", align: "right", mono: true, render: (r) => fmtPct(r.allocation_pct_of_equity) }
        ],
        rows: insts
      });
    }

    // Correlation Table
    const corrEl = document.getElementById("pf-corr-grid");
    if (corrEl) {
      const pairs = correlations.pairs || [];
      if (!pairs.length) {
        corrEl.innerHTML = stateBanner({ kind: "empty", title: "Awaiting Return Overlap", message: "Minimum strategy return overlap required before computing Pearson correlations." });
      } else {
        corrEl.innerHTML = dataTable({
          id: "pf-tbl-corr",
          columns: [
            { key: "pair", label: "Strategy Pair", mono: true, render: (r) => `${esc(r.a)} × ${esc(r.b)}` },
            { key: "correlation", label: "Correlation", align: "right", mono: true, render: (r) => r.correlation == null ? originBadge("AWAITING_SAMPLE") : fmtNum(r.correlation, 3) },
            { key: "status", label: "Basis", mono: true, render: (r) => esc(r.status || (r.correlation == null ? "INSUFFICIENT_OVERLAP" : "EMPIRICAL_OVERLAP")) }
          ],
          rows: pairs
        });
      }
    }

    // Open Positions
    const posEl = document.getElementById("pf-open-pos-table");
    if (posEl) {
      posEl.innerHTML = dataTable({
        id: "pf-tbl-pos",
        emptyTitle: "0 Open Positions",
        emptyMessage: "No open paper or demo positions.",
        columns: [
          { key: "symbol", label: "Inst", mono: true },
          { key: "side", label: "Side", mono: true },
          { key: "qty", label: "Size", align: "right", mono: true, render: (r) => fmtNum(r.qty, 3) },
          { key: "price", label: "Entry", align: "right", mono: true, render: (r) => fmtPrice(r.price, r.symbol) },
          { key: "pnl", label: "Unrealized", align: "right", mono: true, render: (r) => `<span class="${(r.pnl || 0) >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}">${fmtUsd(r.pnl || 0, { sign: true })}</span>` },
          { key: "act", label: "", align: "right", render: (r) => `<button data-pf-close="${esc(r.id)}" data-pf-px="${esc(r.price)}" class="btn-secondary px-2 py-0.5 text-[10px] font-mono">Close</button>` }
        ],
        rows: openTrades
      });
      posEl.querySelectorAll("[data-pf-close]").forEach((b) => b.addEventListener("click", async () => {
        try { await api.closeTrade(b.dataset.pfClose, Number(b.dataset.pfPx)); showToast("Closed position", "success"); refresh(); } catch (e) { showToast(e.message, "error"); }
      }));
    }
  }

  async function runOptimizer(apply) {
    const method = document.getElementById("pf-opt-method")?.value || "RISK_WEIGHTED";
    const capVal = document.getElementById("pf-opt-cap")?.value;
    const payload = { method, apply };
    if (capVal && Number(capVal) > 0) payload.total_capital = Number(capVal);

    try {
      const res = await api.rebalancePortfolio(payload);
      const plan = res.plan;
      const optEl = document.getElementById("pf-opt-table");
      if (optEl && plan?.allocations) {
        optEl.innerHTML = `
          <div class="mb-2 text-[11px] font-mono text-[#94a3b8] flex flex-wrap items-center justify-between gap-2">
            <span>Method: <strong class="text-[#e6edf6]">${esc(plan.method)}</strong> | Capital Base: <strong class="text-[#e6edf6]">${fmtUsd(plan.total_capital)}</strong> | Reserved Reserve: <strong class="text-[#e6edf6]">${fmtUsd(plan.unallocated_cash)}</strong></span>
            ${res.applied ? statusBadge("ACTIVE") : originBadge("SIMULATED_RESEARCH")}
          </div>
          ${dataTable({
            id: "pf-tbl-opt",
            columns: [
              { key: "code", label: "Strategy", mono: true, render: (r) => `<span class="text-[#3b82f6]">${esc(r.code)}</span> ${esc(r.name)}` },
              { key: "lifecycle_status", label: "Lifecycle", render: (r) => statusBadge(r.lifecycle_status) },
              { key: "weight_pct", label: "Weight %", align: "right", mono: true, render: (r) => fmtPct(r.weight_pct) },
              { key: "risk_contribution_pct", label: "Risk Contrib %", align: "right", mono: true, render: (r) => fmtPct(r.risk_contribution_pct) },
              { key: "allocated_usd", label: "Target Capital", align: "right", mono: true, render: (r) => fmtUsd(r.allocated_usd) }
            ],
            rows: plan.allocations
          })}
        `;
      }
      if (apply) {
        showToast("Portfolio rebalanced successfully", "success");
        await refresh();
      } else {
        showToast("Computed allocation schedule preview", "info");
      }
    } catch (err) {
      const optEl = document.getElementById("pf-opt-table");
      if (optEl) optEl.innerHTML = stateBanner({ kind: "warning", title: "Allocation Preview Unavailable", message: err.message });
    }
  }

  document.getElementById("pf-opt-preview")?.addEventListener("click", () => runOptimizer(false));
  document.getElementById("pf-opt-apply")?.addEventListener("click", () => runOptimizer(true));
  document.getElementById("pf-fund-btn")?.addEventListener("click", async () => {
    try {
      await api.fundSandboxCapital(10000);
      showToast("Deposited $10,000 Paper Sandbox capital", "success");
      refresh();
    } catch (err) { showToast(err.message, "error"); }
  });

  await refresh();
}
