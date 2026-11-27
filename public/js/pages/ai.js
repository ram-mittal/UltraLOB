// UltraLOB AI — Three-Panel Institutional Quantitative Decision Workspace (Non-Chatbot)
import { api } from "../api.js";
import {
  isBrowser, esc, fmtUsd, fmtPct, fmtNum, fmtPrice, fmtTs,
  originBadge, statusBadge, stateBanner, dataTable
} from "../components/ui.js";

export function render({ params } = {}) {
  const preStrat = params?.get("strategy") || "ul-01-gold-trend";
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">UltraLOB AI Decision Engine</h1>
          <p class="text-xs text-[#94a3b8]">Structured 7-engine quantitative evaluation workspace. Strictly advisory — separates recommendation from human authorization and never bypasses Independent Risk Engine gates.</p>
        </div>
        <div class="flex items-center gap-2">
          ${originBadge("DEMO", { period: "Advisory Pipeline" })}
        </div>
      </div>

      <!-- 3-Panel Institutional Analytical Workspace -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">

        <!-- LEFT PANEL: Historical Analyses, Macro Alerts & Decision History -->
        <div class="lg:col-span-3 space-y-3">
          <div class="panel p-3 space-y-2.5">
            <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-[#e6edf6]">Macro Event Windows</span>
              <span id="ai-macro-status"></span>
            </div>
            <div id="ai-macro-list" class="space-y-1.5 max-h-40 overflow-y-auto text-[11px]"></div>
            <form id="ai-macro-form" class="pt-2 border-t border-[#232a37] space-y-1.5">
              <input name="title" required placeholder="Declare blackout (e.g. FOMC / CPI)" class="input-term w-full text-[11px]" />
              <div class="flex gap-1.5">
                <select name="impact" class="input-term text-[11px] font-mono">
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MED</option>
                </select>
                <button type="submit" class="btn-secondary flex-1 text-[11px] font-mono">+ Add (+10m UTC)</button>
              </div>
            </form>
          </div>

          <div class="panel overflow-hidden">
            <div class="px-3 py-2.5 border-b border-[#232a37] flex items-center justify-between">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-[#e6edf6]">Decision Audit History</span>
              <button id="ai-refresh-hist" class="text-[10px] font-mono text-[#3b82f6] hover:underline">Refresh</button>
            </div>
            <div id="ai-history-list" class="divide-y divide-[#232a37] max-h-[460px] overflow-y-auto">
              <div class="p-3 text-xs text-[#64748b]">Loading history...</div>
            </div>
          </div>
        </div>

        <!-- CENTRE PANEL: Market Analysis, Strategy Evaluation & Structured Decision -->
        <div class="lg:col-span-5 space-y-3">
          <form id="ai-eval-form" class="panel p-4 space-y-3">
            <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Evaluation Proposal Specification</span>
              <span class="text-[10px] font-mono text-[#64748b]">FEEDS LIVE OHLCV WHEN AVAILABLE</span>
            </div>
            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Strategy ID</label>
                <select id="ai-strat-select" name="strategy_id" class="input-term w-full font-mono text-[11px]" data-preselect="${esc(preStrat)}"></select>
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Instrument</label>
                <select id="ai-sym-select" name="symbol" class="input-term w-full font-mono text-[11px]">
                  <option value="XAUUSD">XAUUSD (Gold)</option>
                  <option value="BTCUSD">BTCUSD</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Directional Side</label>
                <select name="side" class="input-term w-full font-mono text-[11px]">
                  <option value="BUY">BUY (LONG)</option>
                  <option value="SELL">SELL (SHORT)</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Proposed Risk (% Equity)</label>
                <input name="proposed_risk_pct" type="number" step="0.05" min="0.05" max="2.0" value="0.50" class="input-term w-full font-mono text-[11px]" />
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Proposed Allocation ($)</label>
                <input name="proposed_allocation_usd" type="number" step="100" min="100" value="1000" class="input-term w-full font-mono text-[11px]" />
              </div>
              <div>
                <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Observed Spread (pts, opt)</label>
                <input name="spread_points" type="number" step="1" min="0" placeholder="Auto / Empty" class="input-term w-full font-mono text-[11px]" />
              </div>
            </div>
            <button type="submit" id="ai-eval-btn" class="btn-primary w-full font-mono">Run 7-Engine Quantitative Evaluation</button>
          </form>

          <!-- Structured Decision Output -->
          <div id="ai-decision-card" class="panel p-4">
            ${stateBanner({
              kind: "empty",
              title: "No Active Advisory Decision Selected",
              message: "Select a historical record on the left or run a structured 7-engine evaluation above."
            })}
          </div>
        </div>

        <!-- RIGHT PANEL: Supporting Market Data, Portfolio Context, Risk Checks & Evidence -->
        <div class="lg:col-span-4 space-y-3" id="ai-right-panel">
          <div class="panel p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6] mb-2">Supporting Context & Risk Checks</div>
            <div id="ai-context-box" class="space-y-3 text-xs text-[#94a3b8]">
              Loading live market regime, portfolio balance, and Risk Engine rules...
            </div>
          </div>
          <div class="panel p-4" id="ai-evidence-panel">
            <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6] mb-2">Pipeline Evidence Breakdown</div>
            <div class="text-xs text-[#64748b]">Run or select an evaluation to inspect per-engine evidence and verification status.</div>
          </div>
        </div>

      </div>
    </div>
  `;
}

export async function init({ showToast }) {
  if (!isBrowser()) return;
  let decisions = [];
  let activeDecision = null;

  function renderDecisionCenter(dec) {
    activeDecision = dec;
    const card = document.getElementById("ai-decision-card");
    const evPanel = document.getElementById("ai-evidence-panel");
    if (!card) return;

    if (!dec) return;

    const decState = String(dec.decision || "WAIT").toUpperCase();
    const headerBorder = decState === "TRADE"
      ? "border-[#22c55e]/50 bg-[#22c55e]/5"
      : decState === "HALT"
        ? "border-[#ef4444]/50 bg-[#ef4444]/5"
        : "border-[#eab308]/50 bg-[#eab308]/5";

    const pi = dec.portfolio_impact || {};

    card.innerHTML = `
      <div class="space-y-3">
        <!-- Decision State Banner -->
        <div class="rounded border p-3 ${headerBorder} flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            ${statusBadge(decState)}
            <span class="font-mono text-xs font-semibold text-[#e6edf6]">${esc(dec.instrument || dec.proposal?.symbol || "XAUUSD")}</span>
            <span class="font-mono text-[11px] text-[#94a3b8]">${esc(dec.strategy_code || dec.strategy_id)}</span>
          </div>
          <div class="text-right font-mono text-[11px]">
            <span class="text-[#94a3b8]">Confidence:</span>
            <strong class="text-[#e6edf6]">${Math.round((Number(dec.confidence) || 0) * 100)}%</strong>
          </div>
        </div>

        <!-- Recommendation vs Authorization Separation Banner -->
        <div class="panel-elevated px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
          <span>STAGE 1: <strong class="text-[#93c5fd]">ADVISORY RECOMMENDATION</strong></span>
          <span>STAGE 2: ${statusBadge(dec.human_approval_status || "PENDING")}</span>
        </div>

        <!-- Structured Field Grid -->
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="panel-elevated p-2.5">
            <div class="text-[10px] uppercase text-[#64748b]">Market Regime</div>
            <div class="font-mono text-[#e6edf6] mt-0.5">${esc(dec.market_regime || dec.pipeline_stages?.["1_market_intelligence"]?.regime || "AWAITING_DATA")}</div>
          </div>
          <div class="panel-elevated p-2.5">
            <div class="text-[10px] uppercase text-[#64748b]">Directional Bias</div>
            <div class="font-mono text-[#e6edf6] mt-0.5">${esc(dec.directional_bias || dec.proposal?.side || "—")}</div>
          </div>
          <div class="panel-elevated p-2.5">
            <div class="text-[10px] uppercase text-[#64748b]">Signal Quality</div>
            <div class="font-mono text-[#e6edf6] mt-0.5">${esc(dec.signal_quality || "—")}</div>
          </div>
          <div class="panel-elevated p-2.5">
            <div class="text-[10px] uppercase text-[#64748b]">Estimated Net R / Risk ($)</div>
            <div class="font-mono text-[#e6edf6] mt-0.5">${dec.estimated_net_r != null ? `${fmtNum(dec.estimated_net_r, 2)}R` : "Unverified"} / ${dec.monetary_risk_usd != null ? fmtUsd(dec.monetary_risk_usd) : "—"}</div>
          </div>
        </div>

        <div class="space-y-2 text-xs">
          <div class="panel-elevated p-2.5">
            <div class="text-[10px] uppercase text-[#64748b] mb-0.5">Entry Conditions</div>
            <div class="text-[#cbd5e1]">${esc(dec.entry_conditions || dec.rationale)}</div>
          </div>
          <div class="panel-elevated p-2.5">
            <div class="text-[10px] uppercase text-[#64748b] mb-0.5">Invalidation & Hard Stop Rule</div>
            <div class="text-[#fca5a5]/90">${esc(dec.invalidation || "Governed by Independent Risk Engine stop-loss cap.")}</div>
          </div>
          <div class="panel-elevated p-2.5">
            <div class="text-[10px] uppercase text-[#64748b] mb-0.5">Portfolio Impact & Expiry</div>
            <div class="font-mono text-[11px] text-[#cbd5e1] flex flex-wrap justify-between gap-2">
              <span>Alloc ${fmtUsd(pi.proposed_allocation_usd ?? dec.proposal?.proposed_allocation_usd ?? 0)} (${fmtPct(pi.allocation_pct_of_equity ?? 0)} Eq)</span>
              <span>Symbol Exp: ${fmtPct(pi.symbol_exposure_after_pct ?? 0)}</span>
              <span>Expires: ${esc(fmtTs(dec.expires_at))}</span>
            </div>
          </div>
          <div class="panel-elevated p-2.5">
            <div class="text-[10px] uppercase text-[#64748b] mb-0.5">Synthesis Rationale</div>
            <div class="text-[#94a3b8]">${esc(dec.rationale)}</div>
          </div>
        </div>

        <!-- Separate Human Authorization Controls -->
        <div class="border-t border-[#232a37] pt-3 flex flex-wrap items-center justify-between gap-2">
          <div class="text-[10px] font-mono text-[#64748b]">Requires Human Auth + Independent Risk Re-Check</div>
          <div class="flex items-center gap-2">
            <button data-ai-auth="false" class="btn-danger font-mono text-[11px]">Reject Decision</button>
            <button data-ai-auth="true" class="btn-primary font-mono text-[11px]">Authorize Execution</button>
          </div>
        </div>
      </div>
    `;

    card.querySelectorAll("[data-ai-auth]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const approve = btn.dataset.aiAuth === "true";
        try {
          const res = await api.authorizeAiDecision(dec.id, approve);
          showToast(approve ? "Decision authorized by operator" : "Decision rejected", approve ? "success" : "info");
          renderDecisionCenter(res.decision);
          await loadHistoryAndContext();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });

    // Evidence panel in Right column
    if (evPanel) {
      const evRows = Array.isArray(dec.supporting_evidence) ? dec.supporting_evidence : [];
      evPanel.innerHTML = `
        <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6] mb-2">Pipeline Evidence & Audit</div>
        ${evRows.length ? dataTable({
          id: "ai-ev-tbl",
          columns: [
            { key: "stage", label: "Engine" },
            { key: "status", label: "Gate", render: (r) => statusBadge(r.status) },
            { key: "summary", label: "Finding" }
          ],
          rows: evRows
        }) : `<div class="text-xs text-[#64748b]">No itemized stage log attached.</div>`}
      `;
    }
  }

  async function loadHistoryAndContext() {
    const sym = document.getElementById("ai-sym-select")?.value || "XAUUSD";
    const [decRes, evRes, portRes, riskRes, strats] = await Promise.all([
      api.getAiDecisions().catch(() => ({ decisions: [] })),
      api.getMacroEvents(sym).catch(() => null),
      api.getPortfolio().catch(() => null),
      api.getPortfolioRisk().catch(() => null),
      api.getStrategies().catch(() => [])
    ]);

    // Populate strategy selector once
    const sSel = document.getElementById("ai-strat-select");
    if (sSel && !sSel.options.length && Array.isArray(strats)) {
      const pre = sSel.dataset.preselect;
      sSel.innerHTML = strats.map((s) => `<option value="${esc(s.id)}" ${s.id === pre ? "selected" : ""}>${esc(s.code)} — ${esc(s.name)}</option>`).join("");
    }

    // Left: Macro list
    const mStatus = document.getElementById("ai-macro-status");
    const mList = document.getElementById("ai-macro-list");
    if (evRes && mStatus && mList) {
      mStatus.innerHTML = statusBadge(evRes.restriction?.status || "CLEAR");
      const allEv = [...(evRes.restriction?.active_restrictions || []), ...(evRes.custom_blackout_windows || [])];
      mList.innerHTML = allEv.length
        ? allEv.map((ev) => `
            <div class="panel-elevated px-2.5 py-1.5 flex items-center justify-between gap-2">
              <span class="truncate text-[#e6edf6]">${esc(ev.title)}</span>
              <span class="font-mono text-[10px] text-[#eab308] shrink-0">${esc(ev.impact || "HIGH")}</span>
            </div>`).join("")
        : `<div class="text-[11px] text-[#64748b]">No active blackouts on ${esc(sym)}.</div>`;
    }

    // Left: Decision History
    decisions = decRes?.decisions || [];
    const histEl = document.getElementById("ai-history-list");
    if (histEl) {
      histEl.innerHTML = decisions.length
        ? decisions.map((d, idx) => `
            <button data-ai-hist-idx="${idx}" class="w-full text-left px-3 py-2.5 hover:bg-[#161b25] transition-colors space-y-1">
              <div class="flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5">${statusBadge(d.decision)} <span class="font-mono text-[11px] text-[#e6edf6]">${esc(d.instrument || d.proposal?.symbol || "XAUUSD")}</span></span>
                <span class="font-mono text-[10px] text-[#64748b]">${esc(d.strategy_code || d.strategy_id || "").slice(0, 12)}</span>
              </div>
              <div class="text-[10px] font-mono text-[#64748b] flex justify-between">
                <span>Auth: ${esc(d.human_approval_status || "PENDING")}</span>
                <span>${esc(fmtTs(d.evaluated_at).slice(5, 19))}</span>
              </div>
            </button>`).join("")
        : `<div class="p-3 text-xs text-[#64748b]">No historical evaluations recorded yet.</div>`;

      histEl.querySelectorAll("[data-ai-hist-idx]").forEach((b) => {
        b.addEventListener("click", () => {
          const item = decisions[Number(b.dataset.aiHistIdx)];
          if (item) renderDecisionCenter(item);
        });
      });

      if (!activeDecision && decisions.length) {
        renderDecisionCenter(decisions[0]);
      }
    }

    // Right: Portfolio & Risk context
    const ctxBox = document.getElementById("ai-context-box");
    if (ctxBox) {
      const m = portRes?.metrics || {};
      const lim = riskRes?.limits || {};
      const ks = riskRes?.kill_switches || {};
      ctxBox.innerHTML = `
        <div class="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div class="panel-elevated p-2"><div class="text-[10px] text-[#64748b]">EQUITY</div><div class="text-[#e6edf6]">${fmtUsd(m.equity ?? 0)}</div></div>
          <div class="panel-elevated p-2"><div class="text-[10px] text-[#64748b]">DRAWDOWN</div><div class="${(m.drawdown_pct || 0) > 8 ? "text-[#ef4444]" : "text-[#e6edf6]"}">${fmtPct(m.drawdown_pct ?? 0)}</div></div>
          <div class="panel-elevated p-2"><div class="text-[10px] text-[#64748b]">OPEN POS</div><div class="text-[#e6edf6]">${m.open_positions_count ?? 0} / ${lim.max_open_positions ?? 5}</div></div>
          <div class="panel-elevated p-2"><div class="text-[10px] text-[#64748b]">RISK CAP/TRADE</div><div class="text-[#e6edf6]">${fmtPct(lim.max_risk_per_trade_pct ?? 1)}</div></div>
        </div>
        <div class="panel-elevated p-2.5 space-y-1 text-[11px]">
          <div class="flex items-center justify-between"><span class="text-[#94a3b8]">Global Kill Switch</span>${statusBadge(ks.global_active ? "HALT" : "CLEAR")}</div>
          <div class="flex items-center justify-between"><span class="text-[#94a3b8]">${esc(sym)} Blackout Window</span>${statusBadge(evRes?.restriction?.status || "CLEAR")}</div>
        </div>
      `;
    }
  }

  document.getElementById("ai-eval-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("ai-eval-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Running 7-Engine Pipeline..."; }
    const fd = new FormData(e.target);
    const symbol = fd.get("symbol") || "XAUUSD";

    // Attempt loading live OHLCV candles from backend feed without fabricating if absent
    let candles = [];
    try {
      const mkt = await api.getMarketHistory({ symbol, interval: "1h", limit: 60 });
      if (Array.isArray(mkt?.candles)) candles = mkt.candles;
    } catch {
      candles = [];
    }

    try {
      const spRaw = fd.get("spread_points");
      const res = await api.evaluateAiAdvisory({
        strategy_id: fd.get("strategy_id"),
        symbol,
        side: fd.get("side"),
        proposed_risk_pct: Number(fd.get("proposed_risk_pct") || 0.5),
        proposed_allocation_usd: Number(fd.get("proposed_allocation_usd") || 1000),
        spread_points: spRaw ? Number(spRaw) : null,
        candles
      });
      showToast(`AI Decision: ${res.decision.decision}`, res.decision.decision === "HALT" ? "error" : "info");
      renderDecisionCenter(res.decision);
      await loadHistoryAndContext();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Run 7-Engine Quantitative Evaluation"; }
    }
  });

  document.getElementById("ai-macro-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.addMacroBlackout({
        title: fd.get("title"),
        currency: "USD",
        impact: fd.get("impact") || "HIGH",
        timestamp_utc: new Date(Date.now() + 10 * 60_000).toISOString()
      });
      e.target.reset();
      showToast("Declared macro blackout window", "warning");
      loadHistoryAndContext();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("ai-refresh-hist")?.addEventListener("click", loadHistoryAndContext);
  document.getElementById("ai-sym-select")?.addEventListener("change", loadHistoryAndContext);

  await loadHistoryAndContext();
}
