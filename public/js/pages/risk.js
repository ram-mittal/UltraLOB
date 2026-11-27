// Risk & Analytics Screen — Historical VaR, Expected Shortfall, Drawdown Distribution, Stress Testing, Monte Carlo, Risk Limits & Kill Switches
import { api } from "../api.js";
import { createDrawdownDistributionChart } from "../components/charts.js";
import {
  isBrowser, esc, fmtUsd, fmtPct, fmtNum, fmtTs,
  metricTile, originBadge, statusBadge, stateBanner, dataTable
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Risk & Tail Analytics</h1>
          <p class="text-xs text-[#94a3b8]">Independent Hard Risk Governance, Empirical Historical VaR / Expected Shortfall, Adverse Shock Stress Testing, and Hierarchical Kill Switches.</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="rk-stress-btn" class="btn-secondary font-mono text-[11px]">Run Portfolio Stress Test</button>
        </div>
      </div>

      <!-- Tail Risk KPI Grid -->
      <div id="rk-kpi-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

      <!-- Drawdown Distribution + Portfolio Stress Test -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-5 panel p-4">
          <div class="flex items-center justify-between mb-2">
            <div>
              <div class="text-xs font-semibold text-[#e6edf6]">Drawdown Distribution</div>
              <div class="text-[11px] text-[#64748b]">Historical snapshot frequency across drawdown severity tiers</div>
            </div>
            ${originBadge("PAPER_SANDBOX", { period: "Inception" })}
          </div>
          <div id="rk-dd-dist-wrap" class="h-56"></div>
        </div>

        <div class="lg:col-span-7 panel p-4 space-y-3">
          <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
            <div>
              <div class="text-xs font-semibold text-[#e6edf6]">Deterministic Adverse Market Stress Scenarios</div>
              <div class="text-[11px] text-[#64748b]">Shocks evaluated against live open directional exposure & gross notional</div>
            </div>
            ${originBadge("SIMULATED_STRESS_TEST")}
          </div>
          <div id="rk-stress-table"></div>
        </div>
      </div>

      <!-- Monte Carlo Engine (CPU / CUDA Option & Portfolio Tail Pricing) + Bounded Kelly Research -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-7 panel p-4 space-y-3">
          <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
            <div>
              <div class="text-xs font-semibold text-[#e6edf6]">Antithetic Monte Carlo Simulation Engine</div>
              <div class="text-[11px] text-[#64748b]">Executes genuine Monte Carlo path simulation on CPU fallback or CUDA GPU pricing cluster</div>
            </div>
            ${originBadge("SIMULATED_RESEARCH")}
          </div>
          <form id="rk-mc-form" class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Spot / Equity ($)</label>
              <input name="spot" type="number" step="0.01" value="2650" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Barrier / Strike ($)</label>
              <input name="strike" type="number" step="0.01" value="2500" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Annual Vol (σ)</label>
              <input name="volatility" type="number" step="0.01" min="0.01" max="2" value="0.18" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">MC Paths (even)</label>
              <input name="paths" type="number" step="1000" min="100" max="1000000" value="50000" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div class="col-span-full flex items-center justify-between gap-2 pt-1">
              <div id="rk-mc-meta" class="text-[11px] font-mono text-[#94a3b8]">Awaiting Monte Carlo execution</div>
              <button type="submit" id="rk-mc-btn" class="btn-primary font-mono text-[11px]">Run Monte Carlo Engine</button>
            </div>
          </form>
          <div id="rk-mc-result"></div>
        </div>

        <div class="lg:col-span-5 panel p-4 space-y-3">
          <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
            <div>
              <div class="text-xs font-semibold text-[#e6edf6]">Bounded Kelly Sizing Calculator</div>
              <div class="text-[11px] text-[#64748b]">Research sizing strictly clamped below Independent Hard Risk Cap</div>
            </div>
            ${originBadge("SIMULATED_RESEARCH")}
          </div>
          <form id="rk-kelly-form" class="grid grid-cols-3 gap-2">
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Win Prob (0–1)</label>
              <input name="win_probability" type="number" step="0.01" min="0.05" max="0.95" value="0.54" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Payoff Ratio (R)</label>
              <input name="payoff_ratio" type="number" step="0.1" min="0.2" max="10" value="1.8" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Fraction</label>
              <input name="kelly_fraction" type="number" step="0.05" min="0.1" max="1.0" value="0.25" class="input-term w-full font-mono text-[11px]" />
            </div>
            <button type="submit" class="col-span-full btn-secondary font-mono text-[11px]">Compute Bounded Kelly Input</button>
          </form>
          <div id="rk-kelly-out" class="text-xs text-[#94a3b8]">Submit win probability & payoff ratio to compute hard-capped sizing.</div>
        </div>
      </div>

      <!-- Risk Limits Management & Hierarchical Kill Switches -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <form id="rk-limits-form" class="xl:col-span-7 panel p-4 space-y-3">
          <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Independent Hard Risk Limits</h2>
              <p class="text-[11px] text-[#64748b]">Enforced deterministically on every trade, portfolio rebalance, and AI authorization</p>
            </div>
            <button type="submit" class="btn-primary font-mono text-[11px]">Save Hard Caps</button>
          </div>
          <div id="rk-limits-inputs" class="grid grid-cols-2 sm:grid-cols-5 gap-2.5"></div>
        </form>

        <div class="xl:col-span-5 panel p-4 space-y-3">
          <div class="border-b border-[#232a37] pb-2">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Hierarchical Kill Switches</h2>
            <p class="text-[11px] text-[#64748b]">Blocks new order entry by scope without silently liquidating existing positions</p>
          </div>
          <div id="rk-ks-panel" class="space-y-2.5"></div>
        </div>
      </div>

      <!-- Audit Log -->
      <div class="panel overflow-hidden">
        <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Governance Audit Trail</h2>
          <span class="text-[10px] font-mono text-[#64748b]">IMMUTABLE RISK ENGINE EVENTS</span>
        </div>
        <div id="rk-audit-table"></div>
      </div>
    </div>
  `;
}

export async function init({ showToast }) {
  if (!isBrowser()) return;

  async function refresh() {
    const [riskRes, sumRes] = await Promise.all([
      api.getPortfolioRisk().catch((e) => ({ _err: e.message })),
      api.getPortfolioSummary().catch(() => null)
    ]);

    if (riskRes?._err) {
      document.getElementById("rk-kpi-grid").innerHTML = `<div class="col-span-full">${stateBanner({ kind: "error", title: "Risk Telemetry Unavailable", message: riskRes._err })}</div>`;
      return;
    }

    const analytics = riskRes.analytics || {};
    const stress = riskRes.stress_preview || {};
    const limits = riskRes.limits || {};
    const ks = riskRes.kill_switches || {};
    const nowIso = riskRes.updated_at || new Date().toISOString();

    const varOrigin = analytics.status === "READY" ? analytics.data_origin : "AWAITING_SAMPLE";
    document.getElementById("rk-kpi-grid").innerHTML = [
      metricTile({
        label: "Historical VaR (95%)",
        value: analytics.var_95_pct != null ? fmtPct(analytics.var_95_pct) : "Awaiting Sample",
        subtext: analytics.sample_size ? `Sample: ${analytics.sample_size} obs` : `Requires >= ${analytics.min_required_sample || 5} closed trades`,
        tone: analytics.var_95_pct != null ? "warn" : "neutral",
        origin: varOrigin,
        period: "Per-Trade Empirical",
        updatedAt: nowIso
      }),
      metricTile({
        label: "Historical VaR (99%)",
        value: analytics.var_99_pct != null ? fmtPct(analytics.var_99_pct) : "Awaiting Sample",
        subtext: `1% Left-Tail Percentile`,
        tone: analytics.var_99_pct != null ? "loss" : "neutral",
        origin: varOrigin,
        period: "Per-Trade Empirical",
        updatedAt: nowIso
      }),
      metricTile({
        label: "Expected Shortfall (CVaR 95%)",
        value: analytics.cvar_95_pct != null ? fmtPct(analytics.cvar_95_pct) : "Awaiting Sample",
        subtext: `CVaR 99%: ${analytics.cvar_99_pct != null ? fmtPct(analytics.cvar_99_pct) : "—"}`,
        tone: analytics.cvar_95_pct != null ? "loss" : "neutral",
        origin: varOrigin,
        period: "Tail Mean",
        updatedAt: nowIso,
        tooltip: "Average loss in the worst 5% of empirical trade/snapshot observations."
      }),
      metricTile({
        label: "Global Governance Gate",
        value: ks.global_active ? "HALTED" : "ARMED",
        subtext: `Lev ${fmtNum(sumRes?.exposure?.portfolio_leverage || 0, 2)}x / Max ${fmtNum(limits.max_leverage || 20, 1)}x`,
        tone: ks.global_active ? "loss" : "gain",
        origin: "DEMO",
        period: "Real-Time Gate",
        updatedAt: nowIso
      })
    ].join("");

    // Drawdown Distribution Chart
    const ddWrap = document.getElementById("rk-dd-dist-wrap");
    if (ddWrap) {
      const buckets = analytics.drawdown_distribution || [];
      const hasCount = buckets.some((b) => b.count > 0);
      if (hasCount) {
        ddWrap.innerHTML = `<canvas id="rk-dd-dist-chart"></canvas>`;
        createDrawdownDistributionChart("rk-dd-dist-chart", buckets);
      } else {
        ddWrap.innerHTML = stateBanner({ kind: "empty", title: "No Drawdown Observations", message: "Awaiting portfolio equity series to populate drawdown histogram." });
      }
    }

    renderStressTable(stress);
    renderLimitsForm(limits);
    renderKillSwitches(ks);
    renderAuditTable(riskRes.audit_history || []);
  }

  function renderStressTable(stress) {
    const el = document.getElementById("rk-stress-table");
    if (!el) return;
    el.innerHTML = dataTable({
      id: "rk-tbl-stress",
      emptyTitle: "No Stress Output",
      emptyMessage: "Click Run Portfolio Stress Test to evaluate shocks.",
      columns: [
        { key: "name", label: "Stress Scenario" },
        { key: "price_shock_pct", label: "Price Shock", align: "right", mono: true, render: (r) => fmtPct(r.price_shock_pct, { sign: true }) },
        { key: "estimated_pnl_impact_usd", label: "Est Impact", align: "right", mono: true, render: (r) => `<span class="text-[#ef4444]">${fmtUsd(r.estimated_pnl_impact_usd, { sign: true })}</span>` },
        { key: "post_shock_equity_usd", label: "Post-Shock Eq", align: "right", mono: true, render: (r) => fmtUsd(r.post_shock_equity_usd) },
        { key: "breaches_drawdown_limit", label: "Cap Breach", render: (r) => r.breaches_drawdown_limit ? statusBadge("HALT") : statusBadge("PASS") }
      ],
      rows: stress?.scenarios || []
    });
  }

  function renderLimitsForm(limits) {
    const el = document.getElementById("rk-limits-inputs");
    if (!el) return;
    const fields = [
      ["max_risk_per_trade_pct", "Risk/Trade %", 0.05, 2.0, 0.05],
      ["max_daily_loss_pct", "Daily Loss %", 0.25, 10.0, 0.25],
      ["max_weekly_loss_pct", "Weekly Loss %", 0.5, 20.0, 0.5],
      ["max_monthly_loss_pct", "Monthly Loss %", 1.0, 35.0, 0.5],
      ["max_drawdown_pct", "Max DD %", 1.0, 30.0, 0.5],
      ["max_open_positions", "Max Positions", 1, 25, 1],
      ["max_leverage", "Max Leverage", 1, 50, 1],
      ["max_margin_usage_pct", "Max Margin %", 10, 90, 5],
      ["max_spread_points", "Max Spread pts", 5, 500, 5],
      ["max_slippage_points", "Max Slippage pts", 1, 200, 1]
    ];
    el.innerHTML = fields.map(([key, label, min, max, step]) => `
      <div>
        <label class="block text-[10px] uppercase text-[#94a3b8] mb-1 truncate">${esc(label)}</label>
        <input name="${esc(key)}" type="number" min="${min}" max="${max}" step="${step}" value="${esc(limits[key] ?? "")}" class="input-term w-full font-mono text-[11px]" />
      </div>
    `).join("");
  }

  function renderKillSwitches(ks) {
    const el = document.getElementById("rk-ks-panel");
    if (!el) return;
    const active = Boolean(ks.global_active);
    const stratKeys = Object.keys(ks.strategies || {});
    const instKeys = Object.keys(ks.instruments || {});
    el.innerHTML = `
      <div class="panel-elevated p-3 flex items-center justify-between gap-2">
        <div>
          <div class="text-xs font-semibold text-[#e6edf6]">GLOBAL PORTFOLIO KILL SWITCH</div>
          <div class="text-[10px] text-[#94a3b8]">${esc(ks.global_reason || "Normal governance operation")}</div>
        </div>
        <button id="rk-global-ks-btn" class="${active ? "btn-primary" : "btn-danger"} font-mono text-[11px]">${active ? "CLEAR GLOBAL HALT" : "ACTIVATE GLOBAL HALT"}</button>
      </div>

      <form id="rk-scope-ks-form" class="grid grid-cols-3 gap-2 pt-1">
        <select name="scope" class="input-term font-mono text-[11px]">
          <option value="INSTRUMENT">INSTRUMENT</option>
          <option value="STRATEGY">STRATEGY</option>
        </select>
        <input name="target" required placeholder="e.g. XAUUSD / ul-01" class="input-term font-mono text-[11px]" />
        <button type="submit" class="btn-danger font-mono text-[11px]">Halt Target</button>
      </form>

      <div class="space-y-1 text-[11px]">
        ${[...instKeys.map((k) => ({ scope: "INSTRUMENT", target: k, ...ks.instruments[k] })), ...stratKeys.map((k) => ({ scope: "STRATEGY", target: k, ...ks.strategies[k] }))].map((row) => `
          <div class="panel-elevated px-2.5 py-1.5 flex items-center justify-between gap-2">
            <span class="font-mono text-[#fca5a5]">${esc(row.scope)}: ${esc(row.target)}</span>
            <button data-clear-scope="${esc(row.scope)}" data-clear-target="${esc(row.target)}" class="btn-secondary px-2 py-0.5 text-[10px] font-mono">Clear</button>
          </div>
        `).join("") || `<div class="text-[11px] text-[#64748b]">No strategy or instrument-scoped halts active.</div>`}
      </div>
    `;

    document.getElementById("rk-global-ks-btn")?.addEventListener("click", async () => {
      try {
        await api.toggleKillSwitch({ scope: "GLOBAL", active: !active, reason: active ? "Operator manual resume" : "Operator emergency risk halt" });
        showToast(active ? "Global kill switch cleared" : "GLOBAL KILL SWITCH ACTIVATED", active ? "info" : "warning");
        refresh();
      } catch (err) { showToast(err.message, "error"); }
    });

    document.getElementById("rk-scope-ks-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api.toggleKillSwitch({ scope: fd.get("scope"), target: fd.get("target"), active: true, reason: "Scoped operator halt" });
        showToast("Scoped kill switch activated", "warning");
        refresh();
      } catch (err) { showToast(err.message, "error"); }
    });

    el.querySelectorAll("[data-clear-target]").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          await api.toggleKillSwitch({ scope: b.dataset.clearScope, target: b.dataset.clearTarget, active: false });
          showToast("Cleared scoped halt", "info");
          refresh();
        } catch (err) { showToast(err.message, "error"); }
      });
    });
  }

  function renderAuditTable(audit) {
    const el = document.getElementById("rk-audit-table");
    if (!el) return;
    el.innerHTML = dataTable({
      id: "rk-tbl-audit",
      emptyTitle: "No Audit Entries",
      emptyMessage: "Configuration changes and kill switch toggles are logged here.",
      columns: [
        { key: "createdAt", label: "Timestamp", mono: true, render: (r) => fmtTs(r.createdAt) },
        { key: "actor", label: "Operator", mono: true },
        { key: "action", label: "Action", render: (r) => statusBadge(r.action) },
        { key: "details", label: "Details", mono: true, render: (r) => `<span class="text-[#94a3b8]">${esc(JSON.stringify(r.details || {})).slice(0, 90)}</span>` }
      ],
      rows: audit
    });
  }

  document.getElementById("rk-stress-btn")?.addEventListener("click", async () => {
    try {
      const res = await api.runStressTest({});
      renderStressTable(res.stress);
      showToast("Portfolio stress scenarios recalculated", "info");
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("rk-limits-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, v] of fd.entries()) payload[k] = Number(v);
    try {
      await api.updateRiskLimits(payload);
      showToast("Hard risk governance limits saved", "success");
      refresh();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("rk-kelly-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api.computeKellyResearch({
        win_probability: Number(fd.get("win_probability")),
        payoff_ratio: Number(fd.get("payoff_ratio")),
        kelly_fraction: Number(fd.get("kelly_fraction"))
      });
      document.getElementById("rk-kelly-out").innerHTML = `
        <div class="panel-elevated p-3 font-mono text-[11px] space-y-1">
          <div class="flex justify-between"><span>Uncapped Full Kelly:</span><span class="text-[#e6edf6]">${fmtPct(res.full_kelly_pct)}</span></div>
          <div class="flex justify-between"><span>Fractional Kelly:</span><span class="text-[#93c5fd]">${fmtPct(res.fractional_kelly_pct)}</span></div>
          <div class="flex justify-between"><span>Hard-Capped Risk/Trade:</span><span class="text-[#22c55e] font-semibold">${fmtPct(res.hard_capped_risk_pct)}</span></div>
          <div class="text-[10px] text-[#eab308] pt-1">${esc(res.warning)}</div>
        </div>
      `;
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("rk-mc-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("rk-mc-btn");
    const fd = new FormData(e.target);
    if (btn) { btn.disabled = true; btn.textContent = "Running Paths..."; }
    try {
      const res = await api.runMonteCarlo({
        spot: Number(fd.get("spot")),
        strike: Number(fd.get("strike")),
        volatility: Number(fd.get("volatility")),
        paths: Number(fd.get("paths")),
        maturity_years: 1.0,
        backend: "auto"
      });
      document.getElementById("rk-mc-meta").textContent = `${res.backend} (${res.execution_engine}) • ${Number(res.paths).toLocaleString()} paths in ${Number(res.elapsed_ms).toFixed(1)} ms`;
      document.getElementById("rk-mc-result").innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
          <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">UPSIDE CALL MC</div><div class="text-[#22c55e]">${fmtUsd(res.call?.price)}</div><div class="text-[9px] text-[#64748b]">BS Analytic: ${fmtUsd(res.call?.black_scholes)}</div></div>
          <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">DOWNSIDE TAIL PUT MC</div><div class="text-[#ef4444]">${fmtUsd(res.put?.price)}</div><div class="text-[9px] text-[#64748b]">BS Analytic: ${fmtUsd(res.put?.black_scholes)}</div></div>
          <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">STD ERROR (CALL)</div><div class="text-[#e6edf6]">${fmtNum(res.call?.standard_error, 4)}</div><div class="text-[9px] text-[#64748b]">Antithetic Variates</div></div>
          <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">THROUGHPUT</div><div class="text-[#93c5fd]">${Math.round(res.paths_per_second || 0).toLocaleString()}/s</div><div class="text-[9px] text-[#64748b]">Seed ${esc(res.seed)}</div></div>
        </div>
      `;
    } catch (err) { showToast(err.message, "error"); }
    finally { if (btn) { btn.disabled = false; btn.textContent = "Run Monte Carlo Engine"; } }
  });

  await refresh();
}
