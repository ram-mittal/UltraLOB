// Administration Screen — Investor Mandates, Organization Desk Roles, Enterprise API Keys & RBAC Profile
import { api } from "../api.js";
import { state } from "../state.js";
import {
  isBrowser, esc, fmtTs,
  statusBadge, originBadge, stateBanner, dataTable
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Administration &amp; Institutional Governance</h1>
          <p class="text-xs text-[#94a3b8]">Configure Investor Mandates, organization desk permissions, SHA-256 enterprise API keys, and inspect infrastructure telemetry.</p>
        </div>
        <a href="#/auth" class="btn-secondary font-mono text-[11px]">Switch Operator / Auth</a>
      </div>

      <!-- Mandate + Profile -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <form id="ad-mandate-form" class="lg:col-span-7 panel p-4 space-y-3">
          <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Investor Mandate Configuration</h2>
              <p class="text-[11px] text-[#64748b]">Enforced automatically prior to allocating capital to any strategy</p>
            </div>
            <button type="submit" class="btn-primary font-mono text-[11px]">Save Mandate</button>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Risk Tolerance Tier</label>
              <select id="ad-m-tier" name="risk_tolerance" class="input-term w-full font-mono text-[11px]">
                <option value="CONSERVATIVE">CONSERVATIVE</option>
                <option value="MODERATE">MODERATE</option>
                <option value="AGGRESSIVE">AGGRESSIVE</option>
                <option value="INSTITUTIONAL_MANDATE">INSTITUTIONAL_MANDATE</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Base Currency</label>
              <input id="ad-m-ccy" name="base_currency" value="USD" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Permitted Instruments</label>
              <input id="ad-m-inst" name="permitted_instruments" value="XAUUSD, BTC/USD" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Max Drawdown (%)</label>
              <input id="ad-m-dd" name="max_portfolio_drawdown_pct" type="number" step="0.5" min="1" max="35" value="10" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Max Daily Loss (%)</label>
              <input id="ad-m-dl" name="max_daily_loss_pct" type="number" step="0.25" min="0.25" max="10" value="2" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Mandate Notes</label>
              <input id="ad-m-notes" name="mandate_notes" class="input-term w-full text-[11px]" />
            </div>
          </div>
        </form>

        <div class="lg:col-span-5 panel p-4 space-y-3">
          <div class="border-b border-[#232a37] pb-2 flex items-center justify-between">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Operator Session &amp; Infrastructure</h2>
            ${originBadge("DEMO")}
          </div>
          <div id="ad-sys-box" class="space-y-2 text-xs text-[#94a3b8]">Loading system status...</div>
        </div>
      </div>

      <!-- Organization Members + Enterprise API Keys -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-6 panel p-4 space-y-3">
          <div class="border-b border-[#232a37] pb-2 flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Organization Desk &amp; Team Roles</h2>
              <p class="text-[11px] text-[#64748b]">Manage institutional analysts, risk officers, and managers</p>
            </div>
            <span id="ad-org-role"></span>
          </div>
          <form id="ad-member-form" class="flex flex-wrap gap-2">
            <input name="email" type="email" required placeholder="analyst@desk.com" class="input-term flex-1 min-w-[160px] text-[11px]" />
            <select name="org_role" class="input-term font-mono text-[11px]">
              <option value="ANALYST">ANALYST</option>
              <option value="RISK_OFFICER">RISK_OFFICER</option>
              <option value="MANAGER">MANAGER</option>
              <option value="MEMBER">MEMBER</option>
            </select>
            <button type="submit" class="btn-secondary font-mono text-[11px]">Invite Member</button>
          </form>
          <div id="ad-members-table"></div>
        </div>

        <div class="lg:col-span-6 panel p-4 space-y-3">
          <div class="border-b border-[#232a37] pb-2 flex items-center justify-between">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Enterprise API Keys (x-api-key)</h2>
              <p class="text-[11px] text-[#64748b]">Read-only programmatic access hashed with SHA-256</p>
            </div>
          </div>
          <form id="ad-key-form" class="flex flex-wrap gap-2">
            <input name="label" required minlength="3" placeholder="Key label (e.g. Risk Dashboard Reader)" class="input-term flex-1 min-w-[180px] text-[11px]" />
            <button type="submit" class="btn-primary font-mono text-[11px]">Generate Key</button>
          </form>
          <div id="ad-key-secret-box"></div>
          <div id="ad-keys-table"></div>
        </div>
      </div>
    </div>
  `;
}

export async function init({ showToast }) {
  if (!isBrowser()) return;

  async function refresh() {
    const [mandRes, orgRes, keysRes, sysRes] = await Promise.all([
      api.getMandate().catch(() => null),
      api.getOrganization().catch(() => null),
      api.getApiKeys().catch((e) => ({ _unauth: e.message, keys: [] })),
      api.getSystemStatus().catch(() => null)
    ]);

    if (mandRes?.mandate) {
      const m = mandRes.mandate;
      document.getElementById("ad-m-tier").value = m.risk_tolerance || "CONSERVATIVE";
      document.getElementById("ad-m-ccy").value = m.base_currency || "USD";
      document.getElementById("ad-m-inst").value = Array.isArray(m.permitted_instruments) ? m.permitted_instruments.join(", ") : "XAUUSD";
      document.getElementById("ad-m-dd").value = m.max_portfolio_drawdown_pct ?? 10;
      document.getElementById("ad-m-dl").value = m.max_daily_loss_pct ?? 2;
      document.getElementById("ad-m-notes").value = m.mandate_notes || "";
    }

    const sysEl = document.getElementById("ad-sys-box");
    if (sysEl) {
      const u = state.user;
      const pgReady = Boolean(sysRes?.database?.ready);
      const fallbackList = sysRes?.persistence?.in_memory_fallback_components || [];
      sysEl.innerHTML = `
        <div class="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div class="panel-elevated p-2"><div class="text-[10px] text-[#64748b]">OPERATOR</div><div class="text-[#e6edf6] truncate">${esc(u ? (u.name || u.email) : "Anonymous Sandbox")}</div></div>
          <div class="panel-elevated p-2"><div class="text-[10px] text-[#64748b]">RBAC ROLE</div><div class="text-[#93c5fd]">${esc((u?.role || "guest").toUpperCase())}</div></div>
          <div class="panel-elevated p-2"><div class="text-[10px] text-[#64748b]">POSTGRESQL</div><div>${statusBadge(pgReady ? "READY" : "IN_MEMORY_FALLBACK")}</div></div>
          <div class="panel-elevated p-2"><div class="text-[10px] text-[#64748b]">MT5 BRIDGE</div><div>${statusBadge(sysRes?.execution?.postgres_configured ? "CONFIGURED" : "DB_REQUIRED")}</div></div>
        </div>
        <div class="panel-elevated p-2.5 text-[11px] space-y-1">
          <div class="font-mono text-[#e6edf6]">${pgReady ? "Persistent Storage: PostgreSQL active across all modules." : "In-Memory Fallback Active (DATABASE_URL not set):"}</div>
          ${!pgReady && fallbackList.length ? `<div class="text-[10px] font-mono text-[#fde047]">Ephemeral components: ${esc(fallbackList.join(", "))}</div>` : ""}
          <div class="text-[10px] text-[#94a3b8]">${esc(sysRes?.runtimes?.cpp_matching_engine?.note || "C++ matching engine is a separate runtime; /legacy FIX ticket is simulated in-browser.")}</div>
        </div>
        <div class="text-[11px] text-[#64748b]">${esc(sysRes?.platform || "UltraLOB Infrastructure")}</div>
      `;
    }

    const orgRole = document.getElementById("ad-org-role");
    if (orgRole && orgRes?.organization) orgRole.innerHTML = statusBadge(orgRes.organization.role || "GUEST");

    const memEl = document.getElementById("ad-members-table");
    if (memEl) {
      memEl.innerHTML = dataTable({
        id: "ad-tbl-members",
        emptyTitle: "No Invited Desk Members",
        emptyMessage: "Fund Managers and Admins can invite Analysts and Risk Officers.",
        columns: [
          { key: "email", label: "Member Email", mono: true },
          { key: "org_role", label: "Desk Role", render: (r) => statusBadge(r.org_role) },
          { key: "status", label: "Status", render: (r) => statusBadge(r.status) }
        ],
        rows: orgRes?.organization?.members || []
      });
    }

    const keyEl = document.getElementById("ad-keys-table");
    if (keyEl) {
      if (keysRes?._unauth) {
        keyEl.innerHTML = stateBanner({
          kind: "empty",
          title: "Authentication Required for API Keys",
          message: "Sign in to issue and revoke SHA-256 enterprise API keys.",
          actionHtml: `<a href="#/auth" class="btn-secondary font-mono text-[11px]">Sign In</a>`
        });
      } else {
        keyEl.innerHTML = dataTable({
          id: "ad-tbl-keys",
          emptyTitle: "No Enterprise API Keys",
          emptyMessage: "Create a scoped read-only API key above.",
          columns: [
            { key: "label", label: "Label" },
            { key: "key_prefix", label: "Prefix", mono: true },
            { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
            { key: "created_at", label: "Created", mono: true, render: (r) => fmtTs(r.created_at).slice(0, 10) },
            {
              key: "rev",
              label: "",
              align: "right",
              render: (r) => r.status === "ACTIVE" ? `<button data-revoke-key="${esc(r.id)}" class="btn-danger px-2 py-0.5 text-[10px] font-mono">Revoke</button>` : ""
            }
          ],
          rows: keysRes?.keys || []
        });
        keyEl.querySelectorAll("[data-revoke-key]").forEach((b) => {
          b.addEventListener("click", async () => {
            try {
              await api.revokeApiKey(b.dataset.revokeKey);
              showToast("API Key revoked", "info");
              refresh();
            } catch (err) { showToast(err.message, "error"); }
          });
        });
      }
    }
  }

  document.getElementById("ad-mandate-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.updateMandate({
        risk_tolerance: fd.get("risk_tolerance"),
        base_currency: fd.get("base_currency"),
        permitted_instruments: fd.get("permitted_instruments"),
        max_portfolio_drawdown_pct: Number(fd.get("max_portfolio_drawdown_pct")),
        max_daily_loss_pct: Number(fd.get("max_daily_loss_pct")),
        mandate_notes: fd.get("mandate_notes")
      });
      showToast("Investor mandate saved", "success");
      refresh();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("ad-member-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.addOrgMember({ email: fd.get("email"), org_role: fd.get("org_role") });
      e.target.reset();
      showToast("Organization member invited", "success");
      refresh();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("ad-key-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api.createApiKey({ label: fd.get("label") });
      e.target.reset();
      showToast("Enterprise API key created", "success");
      const box = document.getElementById("ad-key-secret-box");
      if (box && res.secret_key) {
        box.innerHTML = `
          <div class="panel-elevated p-2.5 border border-[#22c55e]/40 text-xs space-y-1">
            <div class="text-[#86efac] font-semibold">One-Time Secret Key (Copy Now):</div>
            <div class="font-mono text-[11px] text-[#e6edf6] break-all select-all bg-[#0b0e13] p-1.5 rounded border border-[#232a37]">${esc(res.secret_key)}</div>
          </div>
        `;
      }
      refresh();
    } catch (err) { showToast(err.message, "error"); }
  });

  await refresh();
}
