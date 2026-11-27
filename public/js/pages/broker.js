// Accounts & Brokers Screen — MT5 / Exness Demo Connections, EA Health, Heartbeat & Pairing Setup
import { api } from "../api.js";
import {
  isBrowser, esc, fmtUsd, fmtNum, fmtTs,
  metricTile, originBadge, statusBadge, stateBanner, dataTable
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Accounts & Broker Connections</h1>
          <p class="text-xs text-[#94a3b8]">Manage MetaTrader 5 / Exness Demo terminal links, Expert Advisor heartbeat health, and execution bridge credentials.</p>
        </div>
        <div class="flex items-center gap-2">
          <a href="/api/broker/mt5/ea" download="UltraLOB_Bridge_EA.mq5" class="btn-secondary font-mono text-[11px]">Download MQL5 EA</a>
          <a href="#/execution" class="btn-primary font-mono text-[11px]">Execution Monitor</a>
        </div>
      </div>

      <!-- Safety Lock Notice -->
      <div class="rounded border border-[#eab308]/40 bg-[#eab308]/5 px-4 py-2.5 text-xs text-[#fde047] flex flex-wrap items-center justify-between gap-2">
        <span><strong>DEMO-ONLY EXECUTION BUILD:</strong> Live real-money broker routing is locked at architecture level. Only Demo MT5 &amp; Paper Sandbox accounts can be paired.</span>
        ${originBadge("DEMO_ONLY")}
      </div>

      <div id="bk-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

      <!-- Paired Account Telemetry & New Connection Workflow -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-5 panel p-4 space-y-3">
          <div class="border-b border-[#232a37] pb-2 flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Broker Pairing Setup</h2>
              <p class="text-[11px] text-[#64748b]">Supports Direct MT5 Demo Bridge &amp; Exness MT5 Demo</p>
            </div>
            ${originBadge("DEMO_BROKER")}
          </div>

          <form id="bk-connect-form" class="space-y-2.5">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Broker Infrastructure</label>
                <select id="bk-type" name="type" class="input-term w-full font-mono text-[11px]">
                  <option value="mt5">MetaTrader 5 (Demo)</option>
                  <option value="exness">Exness MT5 (Demo)</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Environment</label>
                <select name="environment" class="input-term w-full font-mono text-[11px]">
                  <option value="DEMO">DEMO (Permitted)</option>
                  <option value="LIVE" disabled>LIVE (Locked)</option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Account / Login ID</label>
                <input name="login" required placeholder="e.g. 12345678" class="input-term w-full font-mono text-[11px]" />
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Broker Trade Server</label>
                <input name="server" value="Exness-MT5Trial" required class="input-term w-full font-mono text-[11px]" />
              </div>
            </div>

            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Investor Password / API Key (Never Stored in Cleartext)</label>
              <input name="password" type="password" required placeholder="••••••••••••" class="input-term w-full font-mono text-[11px]" />
            </div>

            <button type="submit" class="btn-primary w-full font-mono">Pair Demo Account &amp; Issue EA Token</button>
          </form>

          <div id="bk-token-banner"></div>
        </div>

        <div class="lg:col-span-7 space-y-3">
          <div class="panel p-4 space-y-3">
            <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Active Session Broker Connection</h2>
              <button id="bk-disconnect-btn" class="hidden btn-danger px-2 py-0.5 text-[10px] font-mono">Disconnect</button>
            </div>
            <div id="bk-active-card"></div>
          </div>

          <div class="panel overflow-hidden">
            <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
              <div>
                <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">MT5 Execution Connectors &amp; EA Heartbeats</h2>
                <p class="text-[11px] text-[#64748b]">PostgreSQL-backed connector telemetry, balance, equity, and terminal trade flags</p>
              </div>
              <button id="bk-refresh-btn" class="btn-secondary px-2 py-1 text-[10px] font-mono">Sync</button>
            </div>
            <div id="bk-connectors-table"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function init({ showToast }) {
  if (!isBrowser()) return;

  function maskLogin(val) {
    const s = String(val || "");
    if (!s) return "—";
    if (s.length <= 4) return "••••";
    return "••••" + s.slice(-4);
  }

  async function refresh() {
    const [statusRes, monitorRes, healthRes] = await Promise.all([
      api.getBrokerStatus().catch(() => null),
      api.getExecutionMonitor().catch(() => ({ connectors: [] })),
      api.getExecutionHealth().catch(() => null)
    ]);

    const broker = statusRes?.broker || null;
    const connected = Boolean(statusRes?.connected && broker);
    const connectors = monitorRes?.connectors || [];
    const latestConn = connectors[0] || null;
    const nowIso = new Date().toISOString();

    let eaHealth = "DISCONNECTED";
    if (latestConn?.last_heartbeat_at) {
      const ageSec = (Date.now() - Date.parse(latestConn.last_heartbeat_at)) / 1000;
      eaHealth = ageSec <= 90 && latestConn.terminal_connected ? "ONLINE" : "STALE";
    } else if (connected) {
      eaHealth = "AWAITING EA POLL";
    }

    document.getElementById("bk-kpi-grid").innerHTML = [
      metricTile({ label: "Session Bridge", value: connected ? "PAIRED (DEMO)" : "DISCONNECTED", tone: connected ? "gain" : "warn", origin: "DEMO_BROKER", updatedAt: nowIso }),
      metricTile({ label: "EA Heartbeat Health", value: eaHealth, subtext: latestConn?.last_heartbeat_at ? `Last: ${fmtTs(latestConn.last_heartbeat_at).slice(11, 19)}Z` : "Attach UltraLOB_Bridge_EA.mq5", tone: eaHealth === "ONLINE" ? "gain" : "neutral", origin: "DEMO_BROKER", updatedAt: nowIso }),
      metricTile({ label: "Broker Account Balance", value: latestConn?.balance != null ? fmtUsd(latestConn.balance) : "—", subtext: latestConn ? `Equity: ${fmtUsd(latestConn.equity)}` : "Reported upon EA heartbeat", origin: latestConn ? "DEMO_BROKER" : "AWAITING_DATA", updatedAt: nowIso }),
      metricTile({ label: "Execution Storage", value: String(healthRes?.storage || monitorRes?.storage || "not-configured").toUpperCase(), subtext: `EA Min v${healthRes?.ea_min_version || "0.2.0"}`, origin: "DEMO", updatedAt: nowIso })
    ].join("");

    const disBtn = document.getElementById("bk-disconnect-btn");
    if (disBtn) disBtn.classList.toggle("hidden", !connected);

    const cardEl = document.getElementById("bk-active-card");
    if (cardEl) {
      cardEl.innerHTML = connected
        ? `
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">PROVIDER</div><div class="text-[#e6edf6]">${esc(broker.name)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">MASKED ACCOUNT</div><div class="text-[#e6edf6]">${esc(maskLogin(broker.account))}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">SERVER</div><div class="text-[#e6edf6]">${esc(broker.server)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">CREDENTIAL HINT</div><div class="text-[#94a3b8]">${esc(broker.credentialHint || "••••")}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">BRIDGE TOKEN</div><div class="text-[#93c5fd] truncate">${esc(broker.bridgeToken || "—")}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">PENDING SIGNALS</div><div class="text-[#e6edf6]">${esc(String(broker.pendingSignals ?? 0))}</div></div>
          </div>
          <div class="text-xs text-[#94a3b8]">${esc(broker.note)}</div>
        `
        : stateBanner({
            kind: "disconnected",
            title: "No Active Session Broker Paired",
            message: "Complete the pairing workflow on the left or execute inside the Paper Sandbox Engine."
          });
    }

    const connEl = document.getElementById("bk-connectors-table");
    if (connEl) {
      connEl.innerHTML = dataTable({
        id: "bk-tbl-conn",
        emptyTitle: "No EA Connectors Registered",
        emptyMessage: "Pair a demo broker account to provision an MT5 Execution Bridge connector and download the MQL5 EA.",
        columns: [
          { key: "label", label: "Connector", render: (r) => `<div class="font-medium text-[#e6edf6]">${esc(r.label)}</div><div class="text-[10px] font-mono text-[#64748b]">${esc(maskLogin(r.account_login))} • ${esc(r.account_server || "MT5")}</div>` },
          { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
          { key: "balance", label: "Balance", align: "right", mono: true, render: (r) => fmtUsd(r.balance) },
          { key: "equity", label: "Equity", align: "right", mono: true, render: (r) => fmtUsd(r.equity) },
          { key: "terminal", label: "EA Flags", render: (r) => r.terminal_connected ? statusBadge("ONLINE") : statusBadge("AWAITING") },
          { key: "last_heartbeat_at", label: "Heartbeat", mono: true, render: (r) => r.last_heartbeat_at ? fmtTs(r.last_heartbeat_at).slice(11, 19) + "Z" : "Never" }
        ],
        rows: connectors
      });
    }
  }

  document.getElementById("bk-connect-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const type = fd.get("type") || "mt5";
    const login = fd.get("login");
    const server = fd.get("server");
    const password = fd.get("password");

    const payload = type === "exness"
      ? { type, account_id: login, server, api_key: password, environment: "DEMO", mode: "mt5_bridge" }
      : { type, login, server, password, environment: "DEMO" };

    try {
      const res = await api.connectBroker(payload);
      showToast(`Paired ${res.broker?.name || type.toUpperCase()} Demo account`, "success");
      const tokenBox = document.getElementById("bk-token-banner");
      if (tokenBox && res.execution_connector?.access_token) {
        tokenBox.innerHTML = `
          <div class="panel-elevated p-3 border border-[#3b82f6]/40 space-y-1 text-xs">
            <div class="font-semibold text-[#93c5fd]">One-Time EA Execution Token Generated</div>
            <div class="font-mono text-[11px] text-[#e6edf6] break-all select-all bg-[#0b0e13] p-2 rounded border border-[#232a37]">${esc(res.execution_connector.access_token)}</div>
            <div class="text-[10px] text-[#94a3b8]">Connector ID: <span class="font-mono">${esc(res.execution_connector.id)}</span> — paste into UltraLOB_Bridge_EA.mq5</div>
          </div>
        `;
      }
      refresh();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("bk-disconnect-btn")?.addEventListener("click", async () => {
    try {
      await api.disconnectBroker();
      showToast("Session broker disconnected", "info");
      refresh();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("bk-refresh-btn")?.addEventListener("click", refresh);

  await refresh();
}
