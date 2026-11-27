// Execution Monitor Screen — Order Routing, Reconciliation, Slippage & Connector Event Telemetry
import { api } from "../api.js";
import {
  isBrowser, esc, fmtUsd, fmtNum, fmtPrice, fmtTs,
  metricTile, originBadge, statusBadge, stateBanner, dataTable, wireTableInteractions, openDrawer
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Execution & Order Reconciliation Monitor</h1>
          <p class="text-xs text-[#94a3b8]">End-to-end order audit across MT5 Demo Execution Bridge commands and Paper Sandbox fills. Strictly separates broker-confirmed demo executions from simulated sandbox fills.</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="ex-refresh-btn" class="btn-secondary font-mono text-[11px]">Refresh Feed</button>
          <a href="#/broker" class="btn-primary font-mono text-[11px]">Manage Connectors</a>
        </div>
      </div>

      <div id="ex-db-banner"></div>

      <div id="ex-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

      <!-- Filter Bar -->
      <div class="panel p-3 flex flex-wrap items-center gap-2.5">
        <select id="ex-origin-filter" class="input-term font-mono text-[11px]">
          <option value="ALL">All Execution Origins</option>
          <option value="DEMO_BROKER">MT5 Demo Bridge</option>
          <option value="PAPER_SANDBOX">Paper Sandbox</option>
        </select>
        <select id="ex-status-filter" class="input-term font-mono text-[11px]">
          <option value="ALL">All States</option>
          <option value="FILLED">FILLED / ACK OK</option>
          <option value="QUEUED">QUEUED / OPEN</option>
          <option value="REJECTED">REJECTED / ERROR</option>
        </select>
        <input id="ex-search" type="text" placeholder="Filter symbol, strategy ID, or order ID..." class="input-term flex-1 min-w-[200px]" />
      </div>

      <!-- Execution Blotter -->
      <div class="panel overflow-hidden">
        <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
          <div>
            <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Order & Fill Blotter</h2>
            <p class="text-[11px] text-[#64748b]">Click any row to inspect broker retcode, reconciliation details, and full payload.</p>
          </div>
          <span id="ex-count-lbl" class="text-[11px] font-mono text-[#64748b]">Loading...</span>
        </div>
        <div id="ex-blotter-table"></div>
      </div>

      <!-- Execution Bridge Event Log -->
      <div class="panel overflow-hidden">
        <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">MT5 Bridge Reconciliation & Error Events</h2>
          ${originBadge("DEMO_BROKER")}
        </div>
        <div id="ex-events-table"></div>
      </div>
    </div>
  `;
}

export async function init() {
  if (!isBrowser()) return;
  let allRows = [];

  function renderBlotter() {
    const originF = document.getElementById("ex-origin-filter")?.value || "ALL";
    const statusF = document.getElementById("ex-status-filter")?.value || "ALL";
    const q = (document.getElementById("ex-search")?.value || "").trim().toLowerCase();

    const filtered = allRows.filter((r) => {
      if (originF !== "ALL" && r.origin !== originF) return false;
      if (statusF === "FILLED" && !["FILLED", "ACK_OK", "CLOSED", "DISPATCHED"].includes(r.state)) return false;
      if (statusF === "QUEUED" && !["QUEUED", "OPEN", "PENDING", "LEASED"].includes(r.state)) return false;
      if (statusF === "REJECTED" && !["REJECTED", "FAILED", "ERROR", "EXPIRED"].includes(r.state)) return false;
      if (q) {
        const hay = `${r.orderId} ${r.execId} ${r.symbol} ${r.strategyId} ${r.account}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const lbl = document.getElementById("ex-count-lbl");
    if (lbl) lbl.textContent = `${filtered.length} records`;

    const tblEl = document.getElementById("ex-blotter-table");
    if (!tblEl) return;

    tblEl.innerHTML = dataTable({
      id: "ex-tbl-blotter",
      emptyTitle: "No Matching Execution Records",
      emptyMessage: "Pair an MT5 Demo connector or execute a Paper Sandbox order in Market Terminal.",
      columns: [
        { key: "account", label: "Broker / Account", render: (r) => `<div class="font-medium text-[#e6edf6]">${esc(r.account)}</div><div class="text-[10px]">${originBadge(r.origin)}</div>` },
        { key: "strategyId", label: "Strategy / Inst", render: (r) => `<div class="font-mono text-[#93c5fd]">${esc(r.strategyId)}</div><div class="font-mono text-[10px] text-[#e6edf6]">${esc(r.symbol)} (${esc(r.side)})</div>` },
        { key: "orderId", label: "Order / Exec ID", mono: true, render: (r) => `<div>O: ${esc(r.orderId)}</div><div class="text-[10px] text-[#64748b]">E: ${esc(r.execId)}</div>` },
        { key: "vol", label: "Req / Fill Vol", align: "right", mono: true, render: (r) => `${fmtNum(r.reqVol, 3)} / ${fmtNum(r.fillVol, 3)}` },
        { key: "px", label: "Req / Actual Px", align: "right", mono: true, render: (r) => `${fmtPrice(r.reqPrice, r.symbol)} / ${fmtPrice(r.fillPrice, r.symbol)}` },
        { key: "sltp", label: "SL / TP", align: "right", mono: true, render: (r) => `${r.sl ? fmtPrice(r.sl, r.symbol) : "—"} / ${r.tp ? fmtPrice(r.tp, r.symbol) : "—"}` },
        { key: "costs", label: "Comm / Swap / Slip", align: "right", mono: true, render: (r) => `${fmtUsd(r.commission)} / ${fmtUsd(r.swap)} / ${r.slippagePts != null ? r.slippagePts + "pt" : "—"}` },
        { key: "state", label: "State", render: (r) => `${statusBadge(r.state)}${r.errSummary ? `<div class="text-[10px] text-[#fca5a5] mt-0.5 truncate max-w-[140px]">${esc(r.errSummary)}</div>` : ""}` },
        { key: "ts", label: "Timestamp", mono: true, render: (r) => fmtTs(r.ts).slice(5, 19) }
      ],
      rows: filtered.map((r, i) => ({ ...r, _rowId: String(i), _clickable: true }))
    });

    wireTableInteractions("ex-tbl-blotter", (idxStr) => {
      const row = filtered[Number(idxStr)];
      if (!row) return;
      openDrawer({
        title: `${row.symbol} ${row.side} — ${row.state}`,
        subtitle: `Order: ${row.orderId} | Execution: ${row.execId}`,
        badgeHtml: `${originBadge(row.origin)} ${statusBadge(row.state)}`,
        bodyHtml: `
          <div class="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">BROKER / ACCOUNT</div><div class="text-[#e6edf6]">${esc(row.account)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">RETCODE / RECON</div><div class="text-[#e6edf6]">${esc(row.retcode || "OK")}</div></div>
          </div>
          ${row.errSummary ? `<div class="panel-elevated p-3 border border-[#ef4444]/40 text-[#fca5a5] text-xs">${esc(row.errSummary)}</div>` : ""}
          <pre class="p-3 rounded bg-[#0b0e13] border border-[#232a37] text-[11px] font-mono text-[#cbd5e1] overflow-x-auto">${esc(JSON.stringify(row._raw, null, 2))}</pre>
        `
      });
    });
  }

  async function refresh() {
    let execAuthDenied = false;
    const [execRes, portRes, brokerRes] = await Promise.all([
      api.getExecutionMonitor().catch((err) => {
        if (String(err.message || "").toLowerCase().includes("authentication") || String(err.message || "").includes("401")) {
          execAuthDenied = true;
        }
        return { configured: false, connectors: [], commands: [], events: [] };
      }),
      api.getPortfolio().catch(() => ({ trades: [] })),
      api.getBrokerStatus().catch(() => ({ connected: false }))
    ]);
    if (execAuthDenied) {
      const tblEl = document.getElementById("ex-blotter-table");
      if (tblEl) tblEl.innerHTML = stateBanner({
        kind: "disconnected",
        title: "Authentication Required",
        message: "Sign in to inspect your account's MT5 execution connectors, commands, and fills.",
        actionHtml: `<a href="#/auth" class="btn-primary font-mono text-[11px]">Sign In</a>`
      });
    }

    const connectors = execRes.connectors || [];
    const commands = execRes.commands || [];
    const events = execRes.events || [];
    const connMap = new Map(connectors.map((c) => [c.id, c]));

    const cmdRows = commands.map((c) => {
      const conn = connMap.get(c.connector_id);
      return {
        origin: "DEMO_BROKER",
        account: conn ? `${conn.label} (${conn.account_login || "EA"})` : (brokerRes?.broker?.name || "MT5 Demo Bridge"),
        strategyId: c.strategy_id || "manual",
        symbol: c.symbol,
        side: c.side,
        orderId: c.broker_order_id || String(c.id || "").slice(0, 10),
        execId: c.broker_deal_id || String(c.signal_id || "").slice(0, 12),
        reqVol: c.volume ?? c.risk_pct,
        fillVol: c.status === "FILLED" || c.status === "ACK_OK" ? c.volume : 0,
        reqPrice: c.entry_reference,
        fillPrice: c.entry_reference,
        sl: c.stop_loss,
        tp: c.take_profit,
        commission: 0,
        swap: 0,
        slippagePts: c.spread_points,
        state: String(c.status || "QUEUED").toUpperCase(),
        retcode: c.broker_retcode || c.broker_comment || c.status,
        errSummary: c.error_message || c.error_code || null,
        ts: c.updated_at || c.created_at,
        _raw: c
      };
    });

    const paperRows = (portRes.trades || []).map((t) => ({
      origin: "PAPER_SANDBOX",
      account: "Paper Sandbox Engine",
      strategyId: t.strategyId || "terminal",
      symbol: t.symbol,
      side: t.side,
      orderId: t.id,
      execId: t.status === "closed" ? `cls-${t.id}` : `opn-${t.id}`,
      reqVol: t.qty,
      fillVol: t.qty,
      reqPrice: t.price,
      fillPrice: t.closePrice ?? t.price,
      sl: t.stopPrice || null,
      tp: t.targetPrice || null,
      commission: t.commission ?? 0,
      swap: t.swap ?? 0,
      slippagePts: t.slippagePoints ?? 0,
      state: t.status === "open" ? "OPEN" : "FILLED",
      retcode: "PAPER_SANDBOX_FILL",
      errSummary: null,
      ts: t.closedAt || t.timestamp,
      _raw: t
    }));

    allRows = [...cmdRows, ...paperRows];
    const nowIso = new Date().toISOString();
    const errCount = allRows.filter((r) => ["REJECTED", "FAILED", "ERROR"].includes(r.state)).length;

    const exDbBanner = document.getElementById("ex-db-banner");
    if (exDbBanner) {
      exDbBanner.innerHTML = (!execAuthDenied && execRes.configured === false)
        ? stateBanner({
            kind: "empty",
            title: "MT5 Execution Bridge Storage Not Configured",
            message: "The MT5 bridge requires persistent PostgreSQL storage (DATABASE_URL). Below shows only ephemeral Paper Sandbox fills when DATABASE_URL is unset.",
            actionHtml: `<a href="#/broker" class="btn-secondary font-mono text-[11px]">Inspect Broker Setup</a>`
          })
        : "";
    }

    document.getElementById("ex-kpi-grid").innerHTML = [
      metricTile({ label: "Total Recorded Orders", value: String(allRows.length), subtext: `MT5: ${cmdRows.length} | Sandbox: ${paperRows.length}`, origin: "DEMO", updatedAt: nowIso }),
      metricTile({ label: "MT5 Active Connectors", value: String(connectors.filter((c) => c.status === "ACTIVE").length), subtext: `Storage: ${execRes.storage || "not-configured"}`, origin: "DEMO_BROKER", updatedAt: nowIso }),
      metricTile({ label: "Queued / Open State", value: String(allRows.filter((r) => ["QUEUED", "OPEN", "PENDING"].includes(r.state)).length), origin: "DEMO", updatedAt: nowIso }),
      metricTile({ label: "Execution Errors / Rejects", value: String(errCount), tone: errCount > 0 ? "loss" : "gain", origin: "DEMO", updatedAt: nowIso })
    ].join("");

    renderBlotter();

    const evEl = document.getElementById("ex-events-table");
    if (evEl) {
      evEl.innerHTML = dataTable({
        id: "ex-tbl-events",
        emptyTitle: "No Bridge Events Logged",
        emptyMessage: "MT5 Expert Advisor heartbeats, rejections, and OrderCheck diagnostics appear here once connected.",
        columns: [
          { key: "created_at", label: "Time", mono: true, render: (r) => fmtTs(r.created_at) },
          { key: "event_type", label: "Event", render: (r) => statusBadge(r.event_type) },
          { key: "connector_id", label: "Connector", mono: true, render: (r) => esc(String(r.connector_id || "").slice(0, 10)) },
          { key: "payload", label: "Payload", mono: true, render: (r) => `<span class="text-[#94a3b8]">${esc(JSON.stringify(r.payload || {})).slice(0, 110)}</span>` }
        ],
        rows: events
      });
    }
  }

  document.getElementById("ex-origin-filter")?.addEventListener("change", renderBlotter);
  document.getElementById("ex-status-filter")?.addEventListener("change", renderBlotter);
  document.getElementById("ex-search")?.addEventListener("input", renderBlotter);
  document.getElementById("ex-refresh-btn")?.addEventListener("click", refresh);

  await refresh();
}
