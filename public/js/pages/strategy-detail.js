// Strategy Detail Screen — Performance, Risk, Methodology, Execution & Validation Tabs
import { api } from "../api.js";
import { createEquityCurve, createDrawdownChart, createMonthlyReturnsBar } from "../components/charts.js";
import {
  isBrowser, esc, fmtUsd, fmtPct, fmtNum, fmtTs,
  metricTile, originBadge, statusBadge, stateBanner, dataTable
} from "../components/ui.js";

const TABS = [
  { id: "performance", label: "Performance" },
  { id: "risk", label: "Risk" },
  { id: "methodology", label: "Methodology" },
  { id: "execution", label: "Execution" },
  { id: "validation", label: "Validation" }
];

export function render({ id } = {}) {
  return `
    <div id="strat-detail-root" class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <a href="#/marketplace" class="btn-secondary font-mono text-[11px]">← Back to Marketplace</a>
        <div class="font-mono text-[11px] text-[#64748b]">ID: ${esc(id || "loading")}</div>
      </div>

      <div id="sd-header" class="panel p-4">
        <div class="text-xs text-[#94a3b8]">Loading strategy specification...</div>
      </div>

      <!-- 5 Institutional Tabs -->
      <div class="border-b border-[#232a37] flex items-center gap-1 overflow-x-auto" id="sd-tabs">
        ${TABS.map((t, idx) => `
          <button data-sd-tab="${t.id}" class="px-3.5 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${idx === 0 ? "border-[#3b82f6] text-[#e6edf6]" : "border-transparent text-[#94a3b8] hover:text-[#e6edf6]"}">${t.label}</button>
        `).join("")}
      </div>

      <div id="sd-tab-panel" class="space-y-4"></div>
    </div>
  `;
}

export async function init({ id, showToast, params }) {
  if (!isBrowser()) return;
  let activeTab = params?.get("tab") || "performance";
  let strategy = null;
  let backtests = [];

  try {
    const [s, btRes] = await Promise.all([
      api.getStrategy(id || "ul-01-gold-trend"),
      api.getBacktests(id || "ul-01-gold-trend").catch(() => ({ backtests: [] }))
    ]);
    strategy = s;
    backtests = btRes?.backtests || [];
  } catch (err) {
    const hdr = document.getElementById("sd-header");
    if (hdr) hdr.innerHTML = stateBanner({ kind: "error", title: "Strategy Not Found", message: err.message });
    return;
  }

  const latestRealBt = backtests.find((b) => b.data_origin === "REAL_MARKET" || b.data_source === "REAL_MARKET") || backtests[0] || null;
  const perfOrigin = strategy.total_return != null ? "BACKTEST" : "AWAITING_VALIDATION";

  // Header
  const hdr = document.getElementById("sd-header");
  if (hdr) {
    hdr.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-1.5">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#1c2330] border border-[#2e3748] text-[#3b82f6]">${esc(strategy.code)}</span>
            <h1 class="text-base font-semibold text-[#e6edf6]">${esc(strategy.name)}</h1>
            ${statusBadge(strategy.lifecycle_status)}
            ${originBadge(perfOrigin)}
            <span class="font-mono text-[11px] text-[#64748b]">v${esc(strategy.version || "1.0.0")}</span>
          </div>
          <p class="text-xs text-[#94a3b8] max-w-3xl">${esc(strategy.description || strategy.status_note || "")}</p>
          <div class="flex flex-wrap items-center gap-3 text-[11px] font-mono text-[#64748b] pt-1">
            <span>Instrument: <strong class="text-[#e6edf6]">${esc(strategy.instrument)}</strong></span>
            <span>Timeframes: <strong class="text-[#e6edf6]">${esc(strategy.timeframe || (strategy.timeframes || []).join(", "))}</strong></span>
            <span>Category: <strong class="text-[#e6edf6]">${esc(strategy.category || "Quantitative")}</strong></span>
            <span>Risk Budget/Trade: <strong class="text-[#e6edf6]">${strategy.risk_per_trade_pct != null ? fmtPct(strategy.risk_per_trade_pct) : "Governance Cap"}</strong></span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <a href="#/research?strategy=${encodeURIComponent(strategy.id)}" class="btn-secondary font-mono text-[11px]">Run in Research Lab</a>
          <a href="#/ai?strategy=${encodeURIComponent(strategy.id)}" class="btn-primary font-mono text-[11px]">Evaluate in AI</a>
        </div>
      </div>
    `;
  }

  function renderTab() {
    document.querySelectorAll("[data-sd-tab]").forEach((btn) => {
      const act = btn.dataset.sdTab === activeTab;
      btn.className = `px-3.5 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${act ? "border-[#3b82f6] text-[#e6edf6]" : "border-transparent text-[#94a3b8] hover:text-[#e6edf6]"}`;
    });

    const panel = document.getElementById("sd-tab-panel");
    if (!panel) return;

    const eq = strategy.equity_curve?.length ? strategy.equity_curve : (latestRealBt?.equity_curve || []);
    const mRet = strategy.monthly_returns?.length ? strategy.monthly_returns : (latestRealBt?.monthly_returns || []);

    if (activeTab === "performance") {
      panel.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${metricTile({ label: "Total Return", value: strategy.total_return != null ? fmtPct(strategy.total_return, { sign: true }) : "—", tone: (strategy.total_return || 0) > 0 ? "gain" : "neutral", origin: perfOrigin, period: "Historical Test", subtext: strategy.total_return == null ? "Run Research Lab backtest" : "Empirical Backtest" })}
          ${metricTile({ label: "CAGR", value: strategy.cagr != null ? fmtPct(strategy.cagr, { sign: true }) : "—", origin: perfOrigin, period: "Annualized" })}
          ${metricTile({ label: "Sharpe / Sortino", value: `${fmtNum(strategy.sharpe_ratio)} / ${fmtNum(strategy.sortino_ratio)}`, origin: perfOrigin, period: "Risk-Adjusted" })}
          ${metricTile({ label: "Profit Factor / Win Rate", value: `${fmtNum(strategy.profit_factor)} / ${strategy.win_rate != null ? fmtPct(strategy.win_rate) : "—"}`, origin: perfOrigin, subtext: `Trades: ${strategy.total_trades || 0}` })}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div class="lg:col-span-7 panel p-4">
            <div class="flex items-center justify-between mb-2">
              <div class="text-xs font-semibold text-[#e6edf6]">Verified Equity Curve</div>
              ${originBadge(perfOrigin)}
            </div>
            <div id="sd-eq-wrap" class="h-60">${eq.length >= 2 ? `<canvas id="sd-eq-chart"></canvas>` : stateBanner({ kind: "empty", title: "Awaiting Empirical Equity Curve", message: "Execute an out-of-sample or real-market backtest in Research Lab to populate equity curve data." })}</div>
          </div>
          <div class="lg:col-span-5 panel p-4">
            <div class="flex items-center justify-between mb-2">
              <div class="text-xs font-semibold text-[#e6edf6]">Monthly Return Distribution</div>
              ${originBadge(perfOrigin)}
            </div>
            <div id="sd-mret-wrap" class="h-60">${mRet.length >= 1 ? `<canvas id="sd-mret-chart"></canvas>` : stateBanner({ kind: "empty", title: "No Monthly Return Sample", message: "Insufficient verified monthly return observations." })}</div>
          </div>
        </div>
      `;
      if (eq.length >= 2) createEquityCurve("sd-eq-chart", eq, `${strategy.code} Equity`);
      if (mRet.length >= 1) createMonthlyReturnsBar("sd-mret-chart", mRet);
    } else if (activeTab === "risk") {
      panel.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${metricTile({ label: "Maximum Drawdown", value: strategy.max_drawdown != null ? fmtPct(strategy.max_drawdown) : "—", tone: "loss", origin: perfOrigin, period: "Historical Peak-to-Trough" })}
          ${metricTile({ label: "Risk per Trade", value: strategy.risk_per_trade_pct != null ? fmtPct(strategy.risk_per_trade_pct) : "—", origin: "DEMO", period: "Configured Budget" })}
          ${metricTile({ label: "Max Consecutive Losses", value: strategy.max_consecutive_losses != null ? String(strategy.max_consecutive_losses) : "—", origin: perfOrigin })}
          ${metricTile({ label: "Risk of Ruin Estimate", value: strategy.risk_of_ruin != null ? fmtPct(strategy.risk_of_ruin) : "—", origin: perfOrigin })}
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div class="panel p-4 space-y-2">
            <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Stop-Loss & Protection Methodology</div>
            <p class="text-xs text-[#cbd5e1] leading-relaxed">${esc(strategy.stop_loss_methodology || "Structure-anchored ATR stop-loss.")}</p>
            <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6] pt-2">Trading Cost & Slippage Assumptions</div>
            <p class="text-xs text-[#94a3b8] font-mono">${esc(strategy.cost_slippage_assumptions || "Institutional spread + round-turn commission + slippage stress model")}</p>
          </div>
          <div class="panel p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6] mb-2">Historical Drawdown Curve</div>
            <div class="h-48">${(strategy.drawdown?.length || eq.length >= 2) ? `<canvas id="sd-dd-chart"></canvas>` : stateBanner({ kind: "empty", title: "Awaiting Drawdown Series", message: "Run empirical backtest to measure drawdown profile." })}</div>
          </div>
        </div>
      `;
      if (strategy.drawdown?.length) createDrawdownChart("sd-dd-chart", strategy.drawdown);
      else if (eq.length >= 2) {
        let pk = 0;
        const dd = eq.map((p) => { const v = Number(p.value ?? p.equity ?? p); pk = Math.max(pk, v); return pk > 0 ? ((pk - v) / pk) * 100 : 0; });
        createDrawdownChart("sd-dd-chart", dd);
      }
    } else if (activeTab === "methodology") {
      panel.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="panel p-4 space-y-2">
            <div class="text-[11px] font-mono uppercase text-[#3b82f6]">Entry Logic</div>
            <p class="text-xs text-[#e6edf6] leading-relaxed">${esc(strategy.entry_logic || "Quantitative rule-based setup defined in version contract.")}</p>
          </div>
          <div class="panel p-4 space-y-2">
            <div class="text-[11px] font-mono uppercase text-[#3b82f6]">Exit Logic</div>
            <p class="text-xs text-[#e6edf6] leading-relaxed">${esc(strategy.exit_logic || "Partial target scale-out, trailing stop, and regime invalidation.")}</p>
          </div>
          <div class="panel p-4 space-y-2">
            <div class="text-[11px] font-mono uppercase text-[#94a3b8]">Take-Profit & Management</div>
            <p class="text-xs text-[#cbd5e1] leading-relaxed">${esc(strategy.take_profit_methodology || "R-multiple targets & structural trailing stop.")}</p>
          </div>
          <div class="panel p-4 space-y-2">
            <div class="text-[11px] font-mono uppercase text-[#94a3b8]">Position Sizing & Monetary Budget</div>
            <p class="text-xs text-[#cbd5e1] leading-relaxed">${esc(strategy.position_sizing_methodology || "Fixed fractional equity risk divided by stop distance and tick value.")}</p>
          </div>
        </div>
      `;
    } else if (activeTab === "execution") {
      panel.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div class="lg:col-span-7 panel p-4 space-y-3">
            <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Capacity, Brokers & Operational Limits</div>
            <div class="grid grid-cols-2 gap-3 text-xs">
              <div class="panel-elevated p-3">
                <div class="text-[10px] text-[#64748b] uppercase">Minimum Capital</div>
                <div class="font-mono text-sm text-[#e6edf6] mt-0.5">${fmtUsd(strategy.min_capital)}</div>
              </div>
              <div class="panel-elevated p-3">
                <div class="text-[10px] text-[#64748b] uppercase">Strategy Capacity Limit</div>
                <div class="font-mono text-sm text-[#e6edf6] mt-0.5">${strategy.capacity_limit_usd ? fmtUsd(strategy.capacity_limit_usd) : "Evaluation / Uncapped"}</div>
              </div>
              <div class="panel-elevated p-3 col-span-2">
                <div class="text-[10px] text-[#64748b] uppercase mb-1">Supported Brokers & Account Types</div>
                <div class="flex flex-wrap gap-1.5">${(strategy.supported_brokers || ["MT5 Demo"]).map((b) => statusBadge(b)).join("")}</div>
              </div>
            </div>
          </div>

          <div class="lg:col-span-5 panel p-4 space-y-3">
            <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Allocate Paper / Copy Capital</div>
            <div class="space-y-2.5">
              <div>
                <label class="block text-[11px] uppercase text-[#94a3b8] mb-1">Allocation USD</label>
                <input id="sd-alloc-amt" type="number" min="100" step="100" value="${Math.max(1000, Number(strategy.min_capital || 1000))}" class="input-term w-full font-mono" />
              </div>
              <div>
                <label class="block text-[11px] uppercase text-[#94a3b8] mb-1">Mandate Drawdown Stop (%)</label>
                <input id="sd-alloc-dd" type="number" min="1" max="30" step="0.5" value="8" class="input-term w-full font-mono" />
              </div>
              <button id="sd-alloc-btn" class="btn-primary w-full font-mono">Allocate Capital to ${esc(strategy.code)}</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById("sd-alloc-btn")?.addEventListener("click", async () => {
        const allocation = Number(document.getElementById("sd-alloc-amt")?.value || 1000);
        const maxDrawdownPct = Number(document.getElementById("sd-alloc-dd")?.value || 8);
        try {
          await api.subscribe({ strategyId: strategy.id, allocation, maxDrawdownPct });
          showToast(`Allocated ${fmtUsd(allocation)} to ${strategy.code}`, "success");
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    } else {
      panel.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="panel p-4 space-y-2">
            <div class="text-[11px] font-mono uppercase text-[#94a3b8]">Lifecycle Gate</div>
            <div>${statusBadge(strategy.lifecycle_status)}</div>
            <p class="text-xs text-[#cbd5e1]">${esc(strategy.status_note || "Validated only from empirical real-market runs.")}</p>
          </div>
          <div class="panel p-4 space-y-2">
            <div class="text-[11px] font-mono uppercase text-[#94a3b8]">Out-of-Sample Summary</div>
            <pre class="text-[11px] font-mono text-[#cbd5e1] overflow-x-auto">${esc(strategy.out_of_sample ? JSON.stringify(strategy.out_of_sample, null, 2) : "Awaiting Out-of-Sample Research Lab execution")}</pre>
          </div>
          <div class="panel p-4 space-y-2">
            <div class="text-[11px] font-mono uppercase text-[#94a3b8]">Walk-Forward Summary</div>
            <pre class="text-[11px] font-mono text-[#cbd5e1] overflow-x-auto">${esc(strategy.walk_forward ? JSON.stringify(strategy.walk_forward, null, 2) : "Awaiting Walk-Forward validation run")}</pre>
          </div>
        </div>
        <div class="panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Recorded Backtest & Validation History</div>
          ${dataTable({
            id: "sd-bt-table",
            emptyTitle: "No Validation Runs Recorded Yet",
            emptyMessage: "Launch a backtest in Research Lab for this strategy.",
            columns: [
              { key: "id", label: "Run ID", mono: true, render: (r) => esc(String(r.id).slice(0, 10)) },
              { key: "data_origin", label: "Origin", render: (r) => originBadge(r.data_origin || r.data_source) },
              { key: "symbol", label: "Symbol", mono: true },
              { key: "interval", label: "TF", mono: true },
              { key: "ret", label: "Return", align: "right", mono: true, render: (r) => fmtPct(r.metrics?.total_return_pct ?? r.total_return_pct, { sign: true }) },
              { key: "dd", label: "Max DD", align: "right", mono: true, render: (r) => fmtPct(r.metrics?.max_drawdown_pct ?? r.max_drawdown_pct) },
              { key: "created_at", label: "Timestamp", mono: true, render: (r) => fmtTs(r.created_at || r.completed_at) }
            ],
            rows: backtests
          })}
        </div>
      `;
    }
  }

  document.querySelectorAll("[data-sd-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.sdTab;
      renderTab();
    });
  });

  renderTab();
}
