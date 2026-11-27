// Accounts & Brokers Screen — Honest MT5 EA Bridge Pairing, MetaApi Verification & Live Heartbeat Status
import { api } from "../api.js";
import {
  isBrowser, esc, fmtUsd, fmtTs,
  metricTile, originBadge, statusBadge, stateBanner, dataTable
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Accounts &amp; Broker Connections</h1>
          <p class="text-xs text-[#94a3b8]">Provision zero-password MT5 Demo EA Bridges or verify MetaApi Demo accounts. UltraLOB never collects raw MT5 passwords or unimplemented broker API keys, and only reports Connected once upstream telemetry is verified.</p>
        </div>
        <div class="flex items-center gap-2">
          <a href="/api/broker/mt5/ea" download="UltraLOB_Bridge_EA.mq5" class="btn-secondary font-mono text-[11px]">Download MQL5 EA</a>
          <a href="#/execution" class="btn-primary font-mono text-[11px]">Execution Monitor</a>
        </div>
      </div>

      <!-- Safety Lock Notice -->
      <div class="rounded border border-[#eab308]/40 bg-[#eab308]/5 px-4 py-2.5 text-xs text-[#fde047] flex flex-wrap items-center justify-between gap-2">
        <span><strong>DEMO-ONLY EXECUTION BUILD:</strong> Live real-money broker routing is locked. The MT5 EA Bridge requires persistent PostgreSQL storage (<code class="font-mono">DATABASE_URL</code>); direct MT5 passwords and Exness REST API credentials are rejected unless verified through an implemented adapter.</span>
        ${originBadge("DEMO_ONLY")}
      </div>

      <div id="bk-db-banner"></div>

      <div id="bk-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <!-- Honest Pairing Form -->
        <div class="lg:col-span-5 panel p-4 space-y-3">
          <div class="border-b border-[#232a37] pb-2 flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Broker Pairing &amp; Verification</h2>
              <p class="text-[11px] text-[#64748b]">EA Bridge provisions a non-custodial connector awaiting live MT5 heartbeat</p>
            </div>
            ${originBadge("DEMO_BROKER")}
          </div>

          <form id="bk-connect-form" class="space-y-2.5">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Verification Method</label>
                <select id="bk-mode" name="mode" class="input-term w-full font-mono text-[11px]">
                  <option value="ea_bridge">MT5 EA Bridge (Zero Password)</option>
                  <option value="metaapi_demo">MetaApi Cloud Demo Verify</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Terminal Platform</label>
                <select id="bk-type" name="type" class="input-term w-full font-mono text-[11px]">
                  <option value="mt5">MetaTrader 5 (Demo)</option>
                  <option value="exness">Exness MT5 (Demo Terminal)</option>
                </select>
              </div>
            </div>

            <div id="bk-ea-fields" class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Demo Account ID / Label</label>
                <input name="account_id" placeholder="e.g. 12345678" class="input-term w-full font-mono text-[11px]" />
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Trade Server Label</label>
                <input name="server" value="Exness-MT5Trial" class="input-term w-full font-mono text-[11px]" />
              </div>
            </div>

            <div id="bk-metaapi-fields" class="hidden space-y-2">
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">MetaApi Account UUID</label>
                <input name="metaapi_account_id" placeholder="MetaApi Demo Account ID" class="input-term w-full font-mono text-[11px]" />
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">MetaApi Auth Token</label>
                <input name="metaapi_token" type="password" placeholder="Verified against MetaApi upstream" class="input-term w-full font-mono text-[11px]" />
              </div>
            </div>

            <div class="text-[10px] text-[#64748b]">Requires operator Sign In. Environment is locked to <span class="font-mono text-[#e6edf6]">DEMO</span>.</div>
            <button type="submit" id="bk-submit-btn" class="btn-primary w-full font-mono">Provision EA Bridge Connector</button>
          </form>

          <div id="bk-token-banner"></div>
        </div>

        <!-- Telemetry & Active Connectors -->
        <div class="lg:col-span-7 space-y-3">
          <div class="panel p-4 space-y-3">
            <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Verification &amp; Bridge State</h2>
              <button id="bk-disconnect-btn" class="hidden btn-danger px-2 py-0.5 text-[10px] font-mono">Revoke &amp; Disconnect</button>
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

  const modeSel = document.getElementById("bk-mode");
  const eaBox = document.getElementById("bk-ea-fields");
  const maBox = document.getElementById("bk-metaapi-fields");
  const subBtn = document.getElementById("bk-submit-btn");

  let pgExecutionReady = true;

  function syncModeButtonState() {
    const isMeta = modeSel?.value === "metaapi_demo";
    eaBox?.classList.toggle("hidden", isMeta);
    maBox?.classList.toggle("hidden", !isMeta);
    if (subBtn) {
      if (!isMeta && !pgExecutionReady) {
        subBtn.disabled = true;
        subBtn.className = "btn-secondary opacity-60 cursor-not-allowed w-full font-mono";
        subBtn.textContent = "EA Bridge Requires PostgreSQL (DATABASE_URL)";
      } else {
        subBtn.disabled = false;
        subBtn.className = "btn-primary w-full font-mono";
        subBtn.textContent = isMeta ? "Verify MetaApi Demo Upstream" : "Provision EA Bridge Connector";
      }
    }
  }

  modeSel?.addEventListener("change", syncModeButtonState);

  async function refresh() {
    const [statusRes, monitorRes, healthRes] = await Promise.all([
      api.getBrokerStatus().catch(() => null),
      api.getExecutionMonitor().catch(() => ({ connectors: [] })),
      api.getExecutionHealth().catch(() => null)
    ]);

    pgExecutionReady = Boolean(
      healthRes?.storage === "postgresql" || statusRes?.execution_bridge?.postgres_configured
    );
    const dbBanner = document.getElementById("bk-db-banner");
    if (dbBanner) {
      dbBanner.innerHTML = pgExecutionReady
        ? ""
        : stateBanner({
            kind: "error",
            title: "MT5 Bridge Requires Persistent PostgreSQL Storage",
            message: "DATABASE_URL is not configured in deployment environment variables. MT5 EA Bridge provisioning and /api/execution routes return HTTP 503 until PostgreSQL is attached."
          });
    }
    syncModeButtonState();

    const broker = statusRes?.broker || null;
    const verifiedConnected = Boolean(statusRes?.connected && statusRes?.upstreamVerified);
    const pairedPending = Boolean(statusRes?.paired && !verifiedConnected);
    const connectors = monitorRes?.connectors || [];
    const latestConn = connectors[0] || null;
    const nowIso = new Date().toISOString();

    let eaHealth = "DISCONNECTED";
    if (verifiedConnected) eaHealth = "VERIFIED ONLINE";
    else if (pairedPending) eaHealth = statusRes?.verification_status || "PENDING EA HEARTBEAT";

    const bal = broker?.account_snapshot?.balance ?? latestConn?.balance;
    const eq = broker?.account_snapshot?.equity ?? latestConn?.equity;

    document.getElementById("bk-kpi-grid").innerHTML = [
      metricTile({
        label: "Verified Broker Status",
        value: verifiedConnected ? "VERIFIED (DEMO)" : pairedPending ? "PENDING EA" : "DISCONNECTED",
        tone: verifiedConnected ? "gain" : pairedPending ? "warn" : "neutral",
        origin: verifiedConnected ? "DEMO_BROKER" : "AWAITING_DATA",
        updatedAt: nowIso
      }),
      metricTile({
        label: "Upstream Verification",
        value: eaHealth,
        subtext: latestConn?.last_heartbeat_at ? `Last: ${fmtTs(latestConn.last_heartbeat_at).slice(11, 19)}Z` : "Attach UltraLOB_Bridge_EA.mq5",
        tone: verifiedConnected ? "gain" : "warn",
        origin: verifiedConnected ? "DEMO_BROKER" : "AWAITING_DATA",
        updatedAt: nowIso
      }),
      metricTile({
        label: "Verified Broker Balance",
        value: bal != null ? fmtUsd(bal) : "—",
        subtext: eq != null ? `Equity: ${fmtUsd(eq)}` : "Unverified until heartbeat / MetaApi check",
        origin: verifiedConnected ? "DEMO_BROKER" : "AWAITING_DATA",
        updatedAt: nowIso
      }),
      metricTile({
        label: "Execution Storage",
        value: String(healthRes?.storage || monitorRes?.storage || "not-configured").toUpperCase(),
        subtext: `EA Min v${healthRes?.ea_min_version || "0.2.0"}`,
        origin: "DEMO",
        updatedAt: nowIso
      })
    ].join("");

    const disBtn = document.getElementById("bk-disconnect-btn");
    if (disBtn) disBtn.classList.toggle("hidden", !statusRes?.paired && !verifiedConnected);

    const cardEl = document.getElementById("bk-active-card");
    if (cardEl) {
      cardEl.innerHTML = broker
        ? `
          <div class="flex items-center justify-between gap-2 pb-1">
            ${statusBadge(verifiedConnected ? "ACTIVE" : "PENDING")}
            <span class="font-mono text-[10px] text-[#94a3b8]">VERIFICATION: ${esc(statusRes?.verification_status || broker.verification_status)}</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">PROVIDER / MODE</div><div class="text-[#e6edf6]">${esc(broker.name)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">ACCOUNT LABEL</div><div class="text-[#e6edf6]">${esc(maskLogin(broker.account))}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">SERVER</div><div class="text-[#e6edf6]">${esc(broker.server)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">UPSTREAM VERIFIED</div><div class="${verifiedConnected ? "text-[#22c55e]" : "text-[#eab308]"}">${verifiedConnected ? "TRUE" : "FALSE (PENDING)"}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">BRIDGE TOKEN</div><div class="text-[#93c5fd] truncate">${esc(broker.bridgeToken || "—")}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">PENDING SIGNALS</div><div class="text-[#e6edf6]">${esc(String(broker.pendingSignals ?? 0))}</div></div>
          </div>
          <div class="text-xs text-[#94a3b8]">${esc(broker.note)}</div>
        `
        : stateBanner({
            kind: "disconnected",
            title: "No Broker Bridge Paired or Verified",
            message: "Provision an EA Bridge connector (no password required) or verify a MetaApi Demo account on the left."
          });
    }

    const connEl = document.getElementById("bk-connectors-table");
    if (connEl) {
      connEl.innerHTML = dataTable({
        id: "bk-tbl-conn",
        emptyTitle: "No EA Connectors Registered",
        emptyMessage: "Provision an EA Bridge connector to obtain a connector token for UltraLOB_Bridge_EA.mq5.",
        columns: [
          { key: "label", label: "Connector", render: (r) => `<div class="font-medium text-[#e6edf6]">${esc(r.label)}</div><div class="text-[10px] font-mono text-[#64748b]">${esc(maskLogin(r.account_login))} • ${esc(r.account_server || "MT5")}</div>` },
          { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
          { key: "balance", label: "Balance", align: "right", mono: true, render: (r) => fmtUsd(r.balance) },
          { key: "equity", label: "Equity", align: "right", mono: true, render: (r) => fmtUsd(r.equity) },
          { key: "terminal", label: "EA Heartbeat", render: (r) => r.terminal_connected ? statusBadge("ONLINE") : statusBadge("AWAITING") },
          { key: "last_heartbeat_at", label: "Last Seen", mono: true, render: (r) => r.last_heartbeat_at ? fmtTs(r.last_heartbeat_at).slice(11, 19) + "Z" : "Never" }
        ],
        rows: connectors
      });
    }
  }

  document.getElementById("bk-connect-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mode = fd.get("mode") || "ea_bridge";
    const type = fd.get("type") || "mt5";

    const payload = mode === "metaapi_demo"
      ? {
          type,
          mode: "metaapi_demo",
          environment: "DEMO",
          metaapi_account_id: fd.get("metaapi_account_id"),
          metaapi_token: fd.get("metaapi_token")
        }
      : {
          type,
          mode: "ea_bridge",
          environment: "DEMO",
          account_id: fd.get("account_id"),
          server: fd.get("server")
        };

    try {
      const res = await api.connectBroker(payload);
      showToast(
        res.upstreamVerified
          ? `Upstream-verified ${res.broker?.name} connected`
          : `EA Bridge provisioned — awaiting live MT5 EA heartbeat before Verified status`,
        res.upstreamVerified ? "success" : "info"
      );
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
      showToast("Broker bridge revoked and disconnected", "info");
      refresh();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("bk-refresh-btn")?.addEventListener("click", refresh);

  await refresh();
}
