// Overview Screen — Institutional Portfolio Intelligence & Execution Summary
import { api } from "../api.js";
import { createEquityCurve, createDrawdownChart, createDonutChart } from "../components/charts.js";
import {
  isBrowser, esc, fmtUsd, fmtPct, fmtNum, fmtPrice, fmtTs,
  metricTile, originBadge, statusBadge, stateBanner, dataTable, wireTableInteractions, openDrawer
} from "../components/ui.js";

export function render() {
  return `
    <div id="overview-root" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Institutional Portfolio Overview</h1>
          <p class="text-xs text-[#94a3b8]">Consolidated equity, risk utilization, allocated strategies, and broker execution state.</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button id="ov-fund-btn" class="btn-secondary font-mono text-[11px]">+ Fund Paper Sandbox</button>
          <a href="#/portfolio" class="btn-secondary font-mono text-[11px]">Manage Allocations</a>
          <a href="#/ai" class="btn-primary font-mono text-[11px]">UltraLOB AI Workspace</a>
        </div>
      </div>

      <div id="ov-alerts-strip"></div>

      <!-- KPI Metric Strip -->
      <div id="ov-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${Array.from({ length: 8 }).map(() => `<div class="panel p-3.5 h-24 animate-pulse bg-[#11151d]"></div>`).join("")}
      </div>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-5 panel p-4">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div>
              <div class="text-xs font-semibold text-[#e6edf6]">Portfolio Equity Curve</div>
              <div class="text-[11px] text-[#64748b]" id="ov-eq-meta">Account balance + unrealized MTM</div>
            </div>
            <span id="ov-eq-badge"></span>
          </div>
          <div id="ov-eq-wrap" class="h-56 relative"><canvas id="ov-eq-chart"></canvas></div>
        </div>

        <div class="lg:col-span-4 panel p-4">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div>
              <div class="text-xs font-semibold text-[#e6edf6]">Underwater Drawdown</div>
              <div class="text-[11px] text-[#64748b]">Peak-to-trough decline series</div>
            </div>
            ${originBadge("PAPER_SANDBOX", { period: "Inception" })}
          </div>
          <div id="ov-dd-wrap" class="h-56 relative"><canvas id="ov-dd-chart"></canvas></div>
        </div>

        <div class="lg:col-span-3 panel p-4">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div>
              <div class="text-xs font-semibold text-[#e6edf6]">Capital Allocation</div>
              <div class="text-[11px] text-[#64748b]">Strategy weight vs reserve cash</div>
            </div>
            ${originBadge("DEMO", { period: "Current" })}
          </div>
          <div id="ov-alloc-wrap" class="h-56 relative"><canvas id="ov-alloc-chart"></canvas></div>
        </div>
      </div>

      <!-- Tables Row -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div class="xl:col-span-7 panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Active Strategy Allocations</h2>
              <p class="text-[11px] text-[#64748b]">Mandate-checked subscriptions active in copy engine</p>
            </div>
            <a href="#/marketplace" class="text-[11px] font-mono text-[#3b82f6] hover:underline">Browse Catalog →</a>
          </div>
          <div id="ov-strategies-table"></div>
        </div>

        <div class="xl:col-span-5 panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Risk Alerts & Governance Events</h2>
              <p class="text-[11px] text-[#64748b]">Independent Risk Engine & execution audit stream</p>
            </div>
            <a href="#/risk" class="text-[11px] font-mono text-[#3b82f6] hover:underline">Risk Controls →</a>
          </div>
          <div id="ov-risk-events" class="divide-y divide-[#232a37] max-h-72 overflow-y-auto"></div>
        </div>
      </div>

      <!-- Open Positions & Recent Executions -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div class="xl:col-span-6 panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Open Positions</h2>
              <p class="text-[11px] text-[#64748b]">Live Paper Sandbox & Demo positions with SL/TP governance</p>
            </div>
            <a href="#/terminal" class="text-[11px] font-mono text-[#3b82f6] hover:underline">Open Order Ticket →</a>
          </div>
          <div id="ov-positions-table"></div>
        </div>

        <div class="xl:col-span-6 panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Recent Executions</h2>
              <p class="text-[11px] text-[#64748b]">MT5 Bridge commands & closed execution records (click row to inspect)</p>
            </div>
            <a href="#/execution" class="text-[11px] font-mono text-[#3b82f6] hover:underline">Execution Monitor →</a>
          </div>
          <div id="ov-executions-table"></div>
        </div>
      </div>
    </div>
  `;
}

export async function init({ showToast, navigate }) {
  if (!isBrowser()) return;

  async function refresh() {
    const [portRes, sumRes, riskRes, execRes] = await Promise.all([
      api.getPortfolio().catch((e) => ({ _err: e.message })),
      api.getPortfolioSummary().catch(() => null),
      api.getPortfolioRisk().catch(() => null),
      api.getExecutionMonitor().catch(() => null)
    ]);

    if (portRes?._err) {
      const grid = document.getElementById("ov-kpi-grid");
      if (grid) {
        grid.innerHTML = `<div class="col-span-full">${stateBanner({ kind: "error", title: "Portfolio Data Unavailable", message: portRes._err })}</div>`;
      }
      return;
    }

    const metrics = portRes.metrics || {};
    const subs = portRes.subscriptions || [];
    const trades = portRes.trades || [];
    const openTrades = trades.filter((t) => t.status === "open");
    const closedTrades = trades.filter((t) => t.status === "closed");
    const eqHistory = portRes.equityHistory || [];
    const riskLimits = riskRes?.limits || sumRes?.risk_limits || {};
    const killSwitches = riskRes?.kill_switches || sumRes?.kill_switches || {};
    const events = riskRes?.events || [];
    const origin = portRes.data_origin || metrics.data_origin || "PAPER_SANDBOX";
    const nowIso = new Date().toISOString();

    // Kill switch / unfunded alert banner
    const alertStrip = document.getElementById("ov-alerts-strip");
    if (alertStrip) {
      const banners = [];
      if (killSwitches.global_active) {
        banners.push(stateBanner({
          kind: "error",
          title: "GLOBAL RISK KILL SWITCH ACTIVE",
          message: killSwitches.global_reason || "All new order execution halted by Independent Risk Engine.",
          actionHtml: `<a href="#/risk" class="btn-danger">Manage Kill Switch</a>`
        }));
      } else if ((metrics.balance || 0) <= 0) {
        banners.push(stateBanner({
          kind: "empty",
          title: "Paper Sandbox Unfunded ($0.00)",
          message: "Allocate virtual Paper Sandbox capital to test copy-trading allocations, drawdown controls, and risk sizing without simulated P&L fabrication.",
          actionHtml: `<button id="ov-quick-fund-banner" class="btn-primary font-mono text-[11px]">Initialize $10,000 Sandbox</button>`
        }));
      }
      alertStrip.innerHTML = banners.join("");
      document.getElementById("ov-quick-fund-banner")?.addEventListener("click", async () => {
        try {
          await api.fundSandboxCapital(10000);
          showToast("Funded Paper Sandbox with $10,000.00", "success");
          refresh();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }

    // 8 KPI tiles
    const kpiGrid = document.getElementById("ov-kpi-grid");
    if (kpiGrid) {
      kpiGrid.innerHTML = [
        metricTile({
          label: "Total Portfolio Equity",
          value: fmtUsd(metrics.equity),
          subtext: `Cash ${fmtUsd(metrics.balance)} | Unrealized ${fmtUsd(metrics.unrealized_pnl, { sign: true })}`,
          origin,
          period: "Current",
          updatedAt: nowIso,
          tooltip: "Account balance plus mark-to-market unrealized P&L on open positions."
        }),
        metricTile({
          label: "Allocated Capital",
          value: fmtUsd(metrics.allocated_capital),
          subtext: `Available Reserve: ${fmtUsd(metrics.available_capital)}`,
          origin,
          period: "Current",
          updatedAt: nowIso,
          tooltip: "Sum of capital actively committed across enabled copy strategies."
        }),
        metricTile({
          label: "Daily P&L",
          value: fmtUsd(metrics.daily_pnl, { sign: true }),
          subtext: `Realized: ${fmtUsd(metrics.realized_pnl, { sign: true })}`,
          tone: (metrics.daily_pnl || 0) > 0 ? "gain" : (metrics.daily_pnl || 0) < 0 ? "loss" : "neutral",
          origin,
          period: "24H Rolling",
          updatedAt: nowIso
        }),
        metricTile({
          label: "Weekly P&L",
          value: fmtUsd(metrics.weekly_pnl, { sign: true }),
          subtext: `30D P&L: ${fmtUsd(metrics.monthly_pnl, { sign: true })}`,
          tone: (metrics.weekly_pnl || 0) > 0 ? "gain" : (metrics.weekly_pnl || 0) < 0 ? "loss" : "neutral",
          origin,
          period: "7D Rolling",
          updatedAt: nowIso
        }),
        metricTile({
          label: "Monthly P&L",
          value: fmtUsd(metrics.monthly_pnl, { sign: true }),
          subtext: `Return: ${fmtPct(metrics.pnl_percent, { sign: true })}`,
          tone: (metrics.monthly_pnl || 0) > 0 ? "gain" : (metrics.monthly_pnl || 0) < 0 ? "loss" : "neutral",
          origin,
          period: "30D Rolling",
          updatedAt: nowIso
        }),
        metricTile({
          label: "Current Drawdown",
          value: fmtPct(metrics.drawdown_pct),
          subtext: `Hard Cap: ${fmtPct(riskLimits.max_drawdown_pct ?? 15)}`,
          tone: (metrics.drawdown_pct || 0) > (riskLimits.max_drawdown_pct || 15) * 0.7 ? "loss" : "neutral",
          origin,
          period: "Peak-to-Trough",
          updatedAt: nowIso
        }),
        metricTile({
          label: "Margin Utilization",
          value: fmtPct(metrics.margin_utilization_pct),
          subtext: `Used ${fmtUsd(metrics.margin_used)} | Lev ${fmtNum(metrics.portfolio_leverage, 2)}x`,
          tone: (metrics.margin_utilization_pct || 0) > 50 ? "warn" : "neutral",
          origin,
          period: "Live Margin",
          updatedAt: nowIso
        }),
        metricTile({
          label: "Active Strategies",
          value: `${metrics.active_copies || 0} <span class="text-xs font-normal text-[#94a3b8]">(${metrics.open_positions_count || 0} pos)</span>`,
          subtext: `Closed Trades: ${closedTrades.length}`,
          tone: "accent",
          origin,
          period: "Active Scope",
          updatedAt: nowIso
        })
      ].join("");
    }

    // Charts
    const eqBadge = document.getElementById("ov-eq-badge");
    if (eqBadge) eqBadge.innerHTML = originBadge(origin, { period: "Inception", updatedAt: nowIso });

    const eqWrap = document.getElementById("ov-eq-wrap");
    const ddWrap = document.getElementById("ov-dd-wrap");
    if (eqHistory.length >= 2) {
      if (eqWrap && !eqWrap.querySelector("canvas")) eqWrap.innerHTML = `<canvas id="ov-eq-chart"></canvas>`;
      if (ddWrap && !ddWrap.querySelector("canvas")) ddWrap.innerHTML = `<canvas id="ov-dd-chart"></canvas>`;
      createEquityCurve("ov-eq-chart", eqHistory, "Portfolio Equity");
      let peak = 0;
      const ddSeries = eqHistory.map((pt) => {
        const v = Number(pt.value ?? pt.equity ?? 0);
        peak = Math.max(peak, v);
        return { timestamp: pt.timestamp, drawdown: peak > 0 ? ((peak - v) / peak) * 100 : 0 };
      });
      createDrawdownChart("ov-dd-chart", ddSeries);
    } else {
      const msg = eqHistory.length === 0
        ? "No equity snapshots yet. Fund Paper Sandbox or execute trades to record empirical history."
        : "At least 2 equity snapshots are required to plot equity progression and peak-to-trough drawdown.";
      if (eqWrap) eqWrap.innerHTML = stateBanner({ kind: "empty", title: "Awaiting Equity Curve", message: msg });
      if (ddWrap) ddWrap.innerHTML = stateBanner({ kind: "empty", title: "Awaiting Drawdown Series", message: msg });
    }

    const allocWrap = document.getElementById("ov-alloc-wrap");
    const activeSubs = subs.filter((s) => s.status === "active" && Number(s.allocation) > 0);
    if (allocWrap && (activeSubs.length > 0 || (metrics.available_capital || 0) > 0)) {
      if (!allocWrap.querySelector("canvas")) allocWrap.innerHTML = `<canvas id="ov-alloc-chart"></canvas>`;
      const labels = [...activeSubs.map((s) => s.code || s.strategyName), "Unallocated Cash"];
      const values = [...activeSubs.map((s) => Number(s.allocation)), Math.max(0, Number(metrics.available_capital || 0))];
      createDonutChart("ov-alloc-chart", labels, values);
    } else if (allocWrap) {
      allocWrap.innerHTML = stateBanner({ kind: "empty", title: "No Capital Allocated", message: "Zero allocated or funded capital." });
    }

    // Active Strategies Table
    const stratEl = document.getElementById("ov-strategies-table");
    if (stratEl) {
      stratEl.innerHTML = dataTable({
        id: "ov-tbl-strategies",
        emptyTitle: "No Subscribed Strategies",
        emptyMessage: "Allocate capital to validated XAUUSD strategies from Strategy Marketplace.",
        columns: [
          { key: "code", label: "Strategy", sortKey: true, render: (r) => `<a href="#/strategy/${esc(r.strategyId)}" class="font-medium text-[#e6edf6] hover:text-[#3b82f6]"><span class="font-mono text-[#3b82f6] mr-1.5">${esc(r.code || "STRAT")}</span>${esc(r.strategyName)}</a>` },
          { key: "instrument", label: "Inst", sortKey: true, mono: true },
          { key: "allocation", label: "Allocated", align: "right", mono: true, sortKey: true, sortType: "number", render: (r) => fmtUsd(r.allocation) },
          { key: "riskPerTradePct", label: "Risk/Tr", align: "right", mono: true, render: (r) => fmtPct(r.riskPerTradePct ?? 0.5) },
          { key: "status", label: "State", render: (r) => statusBadge(r.status) },
          {
            key: "actions",
            label: "Controls",
            align: "right",
            render: (r) => `
              <div class="inline-flex items-center gap-1.5">
                <button data-toggle-strat="${esc(r.strategyId)}" class="btn-secondary px-2 py-0.5 text-[10px] font-mono">${r.status === "active" ? "Pause" : "Resume"}</button>
                <button data-unsub-strat="${esc(r.strategyId)}" class="btn-danger px-2 py-0.5 text-[10px] font-mono">Remove</button>
              </div>
            `
          }
        ],
        rows: subs
      });
      wireTableInteractions("ov-tbl-strategies");
      stratEl.querySelectorAll("[data-toggle-strat]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api.toggleCopy(btn.dataset.toggleStrat);
            showToast("Strategy status updated", "success");
            refresh();
          } catch (err) { showToast(err.message, "error"); }
        });
      });
      stratEl.querySelectorAll("[data-unsub-strat]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api.unsubscribe(btn.dataset.unsubStrat);
            showToast("Capital unallocated cleanly", "info");
            refresh();
          } catch (err) { showToast(err.message, "error"); }
        });
      });
    }

    // Risk Alerts List
    const evEl = document.getElementById("ov-risk-events");
    if (evEl) {
      evEl.innerHTML = events.length
        ? events.slice(0, 12).map((ev) => `
            <div class="px-4 py-2.5 flex items-start justify-between gap-3 hover:bg-[#161b25]/60">
              <div class="space-y-1 min-w-0">
                <div class="flex items-center gap-2">${statusBadge(ev.severity || "INFO")}<span class="text-xs text-[#e6edf6] truncate">${esc(ev.message)}</span></div>
                <div class="text-[10px] font-mono text-[#64748b]">${esc(fmtTs(ev.createdAt || ev.timestamp))}</div>
              </div>
            </div>
          `).join("")
        : `<div class="p-4">${stateBanner({ kind: "empty", title: "No Risk Events", message: "Hard governance gates active. No breaches recorded." })}</div>`;
    }

    // Open Positions Table
    const posEl = document.getElementById("ov-positions-table");
    if (posEl) {
      posEl.innerHTML = dataTable({
        id: "ov-tbl-positions",
        emptyTitle: "Flat Exposure (0 Open Positions)",
        emptyMessage: "No open paper or demo positions currently active.",
        columns: [
          { key: "symbol", label: "Symbol", mono: true, sortKey: true },
          { key: "side", label: "Side", render: (r) => `<span class="font-mono font-semibold ${r.side === "BUY" ? "text-[#22c55e]" : "text-[#ef4444]"}">${esc(r.side)}</span>` },
          { key: "qty", label: "Size", align: "right", mono: true, sortKey: true, sortType: "number", render: (r) => fmtNum(r.qty, 3) },
          { key: "price", label: "Entry", align: "right", mono: true, render: (r) => fmtPrice(r.price, r.symbol) },
          { key: "pnl", label: "Unrealized", align: "right", mono: true, render: (r) => `<span class="${(r.pnl || 0) >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}">${fmtUsd(r.pnl || 0, { sign: true })}</span>` },
          {
            key: "close",
            label: "",
            align: "right",
            render: (r) => `<button data-close-pos="${esc(r.id)}" data-close-px="${esc(r.price)}" class="btn-secondary px-2 py-0.5 text-[10px] font-mono">Close</button>`
          }
        ],
        rows: openTrades
      });
      wireTableInteractions("ov-tbl-positions");
      posEl.querySelectorAll("[data-close-pos]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api.closeTrade(btn.dataset.closePos, Number(btn.dataset.closePx));
            showToast("Position closed cleanly", "success");
            refresh();
          } catch (err) { showToast(err.message, "error"); }
        });
      });
    }

    // Recent Executions (MT5 bridge commands combined with sandbox trades, labeled by origin)
    const execEl = document.getElementById("ov-executions-table");
    if (execEl) {
      const mt5Rows = (execRes?.commands || []).map((c) => ({
        _rowId: c.id,
        _clickable: true,
        _raw: c,
        origin: "DEMO_BROKER",
        idShort: String(c.id || "").slice(0, 8),
        symbol: c.symbol,
        side: c.side,
        qty: c.volume,
        price: c.executed_price ?? c.requested_price,
        status: c.status,
        ts: c.executed_at || c.created_at
      }));
      const paperRows = trades.slice(0, 10).map((t) => ({
        _rowId: t.id,
        _clickable: true,
        _raw: t,
        origin: "PAPER_SANDBOX",
        idShort: String(t.id || "").slice(0, 10),
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        price: t.closePrice ?? t.price,
        status: t.status === "open" ? "OPEN" : "FILLED",
        ts: t.closedAt || t.timestamp
      }));
      const combined = [...mt5Rows, ...paperRows].slice(0, 10);

      execEl.innerHTML = dataTable({
        id: "ov-tbl-exec",
        emptyTitle: "No Execution History",
        emptyMessage: "Submit an order or pair MT5 Demo bridge to inspect live execution records.",
        columns: [
          { key: "idShort", label: "Exec ID", mono: true },
          { key: "origin", label: "Origin", render: (r) => originBadge(r.origin) },
          { key: "symbol", label: "Inst", mono: true },
          { key: "side", label: "Side", mono: true },
          { key: "qty", label: "Vol", align: "right", mono: true, render: (r) => fmtNum(r.qty, 2) },
          { key: "price", label: "Price", align: "right", mono: true, render: (r) => fmtPrice(r.price, r.symbol) },
          { key: "status", label: "State", render: (r) => statusBadge(r.status) }
        ],
        rows: combined
      });
      wireTableInteractions("ov-tbl-exec", (rowId) => {
        const found = combined.find((x) => x._rowId === rowId);
        if (!found) return;
        openDrawer({
          title: `Execution Detail: ${found.symbol} ${found.side}`,
          subtitle: `ID: ${found._rowId}`,
          badgeHtml: `${originBadge(found.origin)} ${statusBadge(found.status)}`,
          bodyHtml: `<pre class="p-3 rounded bg-[#0b0e13] border border-[#232a37] text-[11px] font-mono text-[#cbd5e1] overflow-x-auto">${esc(JSON.stringify(found._raw, null, 2))}</pre>`,
          footerHtml: `<button class="btn-secondary" onclick="window.location.hash='#/execution'">Open Execution Monitor</button>`
        });
      });
    }
  }

  document.getElementById("ov-fund-btn")?.addEventListener("click", () => {
    openDrawer({
      title: "Fund Paper Sandbox Account",
      subtitle: "Simulated DEMO evaluation capital — distinct from live broker custody",
      badgeHtml: originBadge("PAPER_SANDBOX"),
      bodyHtml: `
        <div class="space-y-3">
          <label class="block text-[11px] uppercase tracking-wider text-[#94a3b8]">Virtual Deposit Amount (USD)</label>
          <input id="drawer-fund-amt" type="number" min="100" step="500" value="10000" class="input-term w-full font-mono" />
          <div class="flex gap-2">
            <button data-preset="5000" class="btn-secondary font-mono text-[11px]">$5,000</button>
            <button data-preset="10000" class="btn-secondary font-mono text-[11px]">$10,000</button>
            <button data-preset="50000" class="btn-secondary font-mono text-[11px]">$50,000</button>
            <button data-preset="100000" class="btn-secondary font-mono text-[11px]">$100,000</button>
          </div>
          <button id="drawer-fund-submit" class="btn-primary w-full font-mono">Deposit to Paper Sandbox</button>
        </div>
      `
    });
    document.querySelectorAll("[data-preset]").forEach((b) => {
      b.addEventListener("click", () => {
        const inp = document.getElementById("drawer-fund-amt");
        if (inp) inp.value = b.dataset.preset;
      });
    });
    document.getElementById("drawer-fund-submit")?.addEventListener("click", async () => {
      const val = Number(document.getElementById("drawer-fund-amt")?.value || 10000);
      try {
        await api.fundSandboxCapital(val);
        showToast(`Funded Paper Sandbox with ${fmtUsd(val)}`, "success");
        document.getElementById("drawer-root").innerHTML = "";
        refresh();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  await refresh();
}
