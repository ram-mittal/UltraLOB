// Quantitative Research Lab — Backtesting, Historical Data, Transaction Costs, OOS, Walk-Forward & Monte Carlo
import { api } from "../api.js";
import { createEquityCurve, createDrawdownChart } from "../components/charts.js";
import {
  isBrowser, esc, fmtUsd, fmtPct, fmtNum, fmtTs,
  metricTile, originBadge, statusBadge, stateBanner, dataTable, wireTableInteractions
} from "../components/ui.js";

export function render({ params } = {}) {
  const preStrat = params?.get("strategy") || "ul-01-gold-trend";
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Quantitative Research Lab</h1>
          <p class="text-xs text-[#94a3b8]">Empirical strategy backtesting with transaction costs, out-of-sample split, walk-forward validation, and trade-sequence Monte Carlo.</p>
        </div>
        <div class="flex items-center gap-2">
          ${originBadge("BACKTEST")}
          ${originBadge("SIMULATED_RESEARCH")}
        </div>
      </div>

      <!-- Backtest Runner Configuration -->
      <form id="rs-run-form" class="panel p-4 space-y-3">
        <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Backtest &amp; Validation Specification</span>
          <span class="text-[10px] font-mono text-[#64748b]">ONLY REAL_MARKET RUNS PROMOTE STRATEGY LIFECYCLE</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <div class="col-span-2 sm:col-span-2">
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Strategy Model</label>
            <select name="strategy_id" id="rs-strat-select" data-preselect="${esc(preStrat)}" class="input-term w-full font-mono text-[11px]">
              <option value="ul-01-gold-trend">UL-01: Gold Institutional Trend</option>
              <option value="ul-02-liquidity-sweep">UL-02: Gold Liquidity Sweep</option>
              <option value="ul-03-volume-profile">UL-03: Gold Volume Profile</option>
              <option value="ul-04-gold-scalper">UL-04: Gold High-Frequency Scalper</option>
              <option value="ul-05-adaptive-regime">UL-05: Gold Adaptive Regime</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Data Origin</label>
            <select name="data_source" id="rs-data-src" class="input-term w-full font-mono text-[11px]">
              <option value="REAL_MARKET">REAL_MARKET (OHLCV)</option>
              <option value="SIMULATED_RESEARCH">SIMULATED_RESEARCH</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Timeframe</label>
            <select name="interval" class="input-term w-full font-mono text-[11px]">
              <option value="15m">M15</option>
              <option value="1h" selected>H1</option>
              <option value="4h">H4</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Bars / Window</label>
            <input name="bars" type="number" min="200" max="5000" value="900" class="input-term w-full font-mono text-[11px]" />
          </div>
          <div>
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Initial Capital ($)</label>
            <input name="initial_capital" type="number" min="500" step="500" value="10000" class="input-term w-full font-mono text-[11px]" />
          </div>
        </div>

        <!-- Cost Model & Monte Carlo Controls -->
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
          <div>
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Spread (points)</label>
            <input name="spread_points" type="number" min="0" step="1" value="25" class="input-term w-full font-mono text-[11px]" />
          </div>
          <div>
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Commission ($/lot)</label>
            <input name="commission_per_lot" type="number" min="0" step="0.5" value="7" class="input-term w-full font-mono text-[11px]" />
          </div>
          <div>
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Slippage (points)</label>
            <input name="slippage_points" type="number" min="0" step="1" value="8" class="input-term w-full font-mono text-[11px]" />
          </div>
          <div>
            <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Monte Carlo Runs</label>
            <input name="mc_simulations" type="number" min="100" max="2000" step="100" value="500" class="input-term w-full font-mono text-[11px]" />
          </div>
          <div class="flex items-end">
            <button type="submit" id="rs-run-btn" class="btn-primary w-full font-mono">Execute Backtest</button>
          </div>
        </div>

        <!-- Optional Historical CSV Upload -->
        <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#94a3b8] border-t border-[#232a37] pt-2">
          <div class="flex items-center gap-2">
            <span>Optional MT5 OHLCV CSV Upload (for REAL_MARKET offline testing):</span>
            <input id="rs-csv-file" type="file" accept=".csv,.txt" class="text-[11px] font-mono text-[#cbd5e1]" />
          </div>
          <span id="rs-csv-status" class="font-mono text-[#64748b]">Auto-fetches Twelve Data XAU/USD when empty</span>
        </div>
      </form>

      <!-- Active Result Output -->
      <div id="rs-result-root" class="space-y-4"></div>

      <!-- Historical Backtest Runs -->
      <div class="panel overflow-hidden">
        <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
          <div>
            <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Validation Run History</h2>
            <p class="text-[11px] text-[#64748b]">Click any recorded run to inspect full OOS split, walk-forward folds, and Monte Carlo percentiles.</p>
          </div>
          <button id="rs-hist-refresh" class="btn-secondary px-2 py-1 text-[10px] font-mono">Refresh</button>
        </div>
        <div id="rs-history-table"></div>
      </div>
    </div>
  `;
}

export async function init({ showToast }) {
  if (!isBrowser()) return;
  let uploadedCsv = null;
  let historyList = [];

  const pre = document.getElementById("rs-strat-select")?.dataset?.preselect;
  if (pre) {
    const sel = document.getElementById("rs-strat-select");
    if (sel) sel.value = pre;
  }

  document.getElementById("rs-csv-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) { uploadedCsv = null; return; }
    uploadedCsv = await file.text();
    const lbl = document.getElementById("rs-csv-status");
    if (lbl) lbl.textContent = `Loaded CSV: ${file.name} (${uploadedCsv.length.toLocaleString()} bytes)`;
  });

  function renderResult(bt) {
    const root = document.getElementById("rs-result-root");
    if (!root || !bt) return;

    const m = bt.metrics || bt;
    const oos = bt.out_of_sample || bt.oos_metrics || {};
    const is = bt.in_sample || {};
    const wf = Array.isArray(bt.walk_forward) ? bt.walk_forward : (Array.isArray(bt.walk_forward_metrics) ? bt.walk_forward_metrics : []);
    const mc = bt.monte_carlo || {};
    const origin = bt.data_origin || bt.data_source || "SIMULATED_RESEARCH";
    const eq = bt.equity_curve || [];
    const dd = bt.drawdown_series || [];

    root.innerHTML = `
      <div class="panel p-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="font-mono text-xs font-semibold text-[#3b82f6]">${esc(bt.code || bt.strategy_id)}</span>
          ${originBadge(origin)}
          ${bt.can_promote_to_backtested ? statusBadge("VALIDATED_BACKTEST") : statusBadge("RESEARCH")}
        </div>
        <div class="font-mono text-[11px] text-[#94a3b8]">Symbol: ${esc(bt.symbol || "XAUUSD")} • Bars: ${bt.bars ?? "—"} • ${esc(fmtTs(bt.created_at || bt.completed_at))}</div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${metricTile({ label: "Total Return / CAGR", value: `${fmtPct(m.total_return_pct, { sign: true })} / ${fmtPct(m.cagr_pct, { sign: true })}`, tone: (m.total_return_pct || 0) >= 0 ? "gain" : "loss", origin, period: "Full Test" })}
        ${metricTile({ label: "Max Drawdown", value: fmtPct(m.max_drawdown_pct), tone: "loss", origin, period: "Peak-to-Trough" })}
        ${metricTile({ label: "Sharpe / Profit Factor", value: `${fmtNum(m.sharpe_ratio)} / ${fmtNum(m.profit_factor)}`, origin, subtext: `Win Rate ${fmtPct(m.win_rate_pct)}` })}
        ${metricTile({ label: "Trades / Expectancy", value: `${m.total_trades ?? 0} / ${m.expectancy_r != null ? fmtNum(m.expectancy_r) + "R" : fmtUsd(m.expectancy)}`, origin, subtext: `Risk of Ruin: ${fmtPct(m.risk_of_ruin_pct)}` })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-7 panel p-4">
          <div class="text-xs font-semibold text-[#e6edf6] mb-2">Simulated / Empirical Backtest Equity Curve</div>
          <div class="h-56">${eq.length >= 2 ? `<canvas id="rs-eq-chart"></canvas>` : stateBanner({ kind: "empty", title: "No Equity Curve Array", message: "Zero trades generated in test window." })}</div>
        </div>
        <div class="lg:col-span-5 panel p-4">
          <div class="text-xs font-semibold text-[#e6edf6] mb-2">Backtest Underwater Drawdown</div>
          <div class="h-56">${dd.length >= 2 ? `<canvas id="rs-dd-chart"></canvas>` : stateBanner({ kind: "empty", title: "No Drawdown Series", message: "Drawdown series unavailable." })}</div>
        </div>
      </div>

      <!-- In-Sample vs OOS + Monte Carlo Percentiles -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-6 panel p-4 space-y-2">
          <div class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">In-Sample vs Out-of-Sample Split</div>
          ${dataTable({
            id: "rs-tbl-oos",
            columns: [
              { key: "segment", label: "Split" },
              { key: "ret", label: "Return", align: "right", mono: true, render: (r) => fmtPct(r.ret, { sign: true }) },
              { key: "pf", label: "Profit Factor", align: "right", mono: true, render: (r) => fmtNum(r.pf) },
              { key: "sharpe", label: "Sharpe", align: "right", mono: true, render: (r) => fmtNum(r.sharpe) },
              { key: "trades", label: "Trades", align: "right", mono: true }
            ],
            rows: [
              { segment: "In-Sample (70%)", ret: is.total_return_pct, pf: is.profit_factor, sharpe: is.sharpe_ratio, trades: is.total_trades ?? "—" },
              { segment: "Out-of-Sample (30%)", ret: oos.total_return_pct, pf: oos.profit_factor, sharpe: oos.sharpe_ratio, trades: oos.total_trades ?? "—" }
            ]
          })}
        </div>

        <div class="lg:col-span-6 panel p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Trade-Sequence Monte Carlo (${mc.simulations ?? 0} paths)</span>
            ${originBadge("SIMULATED_RESEARCH")}
          </div>
          <div class="grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">P5 TERMINAL EQ</div><div class="text-[#ef4444]">${fmtUsd(mc.terminal_equity_p05)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">P50 MEDIAN EQ</div><div class="text-[#e6edf6]">${fmtUsd(mc.terminal_equity_p50)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">P95 TERMINAL EQ</div><div class="text-[#22c55e]">${fmtUsd(mc.terminal_equity_p95)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">MAX DD (P95)</div><div class="text-[#eab308]">${fmtPct(mc.max_drawdown_p95_pct)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">MAX DD (P99)</div><div class="text-[#ef4444]">${fmtPct(mc.max_drawdown_p99_pct)}</div></div>
            <div class="panel-elevated p-2.5"><div class="text-[10px] text-[#64748b]">PROB BREACH RUIN</div><div class="text-[#fca5a5]">${fmtPct(mc.prob_breach_ruin_pct)}</div></div>
          </div>
        </div>
      </div>

      ${wf.length ? `
        <div class="panel overflow-hidden">
          <div class="px-4 py-3 border-b border-[#232a37] text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Walk-Forward Validation Folds</div>
          ${dataTable({
            id: "rs-tbl-wf",
            columns: [
              { key: "fold", label: "Fold", mono: true },
              { key: "test_return_pct", label: "OOS Return", align: "right", mono: true, render: (r) => fmtPct(r.test_return_pct ?? r.total_return_pct, { sign: true }) },
              { key: "test_max_drawdown_pct", label: "OOS Max DD", align: "right", mono: true, render: (r) => fmtPct(r.test_max_drawdown_pct ?? r.max_drawdown_pct) },
              { key: "test_trades", label: "Trades", align: "right", mono: true, render: (r) => r.test_trades ?? r.total_trades ?? 0 }
            ],
            rows: wf
          })}
        </div>` : ""}
    `;

    if (eq.length >= 2) createEquityCurve("rs-eq-chart", eq, `${bt.code || "Strategy"} Equity`);
    if (dd.length >= 2) createDrawdownChart("rs-dd-chart", dd);
  }

  async function loadHistory() {
    const tblEl = document.getElementById("rs-history-table");
    try {
      const res = await api.getBacktests();
      historyList = res?.backtests || [];
      if (tblEl) {
        tblEl.innerHTML = dataTable({
          id: "rs-tbl-hist",
          emptyTitle: "No Validation History Yet",
          emptyMessage: "Execute your first strategy backtest above to build validation provenance.",
          columns: [
            { key: "strategy_id", label: "Strategy", mono: true },
            { key: "data_origin", label: "Data Origin", render: (r) => originBadge(r.data_origin || r.data_source) },
            { key: "ret", label: "Return", align: "right", mono: true, render: (r) => fmtPct(r.metrics?.total_return_pct ?? r.total_return_pct, { sign: true }) },
            { key: "dd", label: "Max DD", align: "right", mono: true, render: (r) => fmtPct(r.metrics?.max_drawdown_pct ?? r.max_drawdown_pct) },
            { key: "sharpe", label: "Sharpe", align: "right", mono: true, render: (r) => fmtNum(r.metrics?.sharpe_ratio ?? r.sharpe_ratio) },
            { key: "trades", label: "Trades", align: "right", mono: true, render: (r) => r.metrics?.total_trades ?? r.total_trades ?? 0 },
            { key: "created_at", label: "Completed", mono: true, render: (r) => fmtTs(r.created_at || r.completed_at) }
          ],
          rows: historyList.map((b) => ({ ...b, _rowId: b.id, _clickable: true }))
        });
        wireTableInteractions("rs-tbl-hist", async (rowId) => {
          try {
            const detail = await api.getBacktest(rowId);
            if (detail?.backtest) renderResult(detail.backtest);
          } catch {
            const item = historyList.find((x) => x.id === rowId);
            if (item) renderResult(item);
          }
        });
      }
      if (historyList.length && !document.getElementById("rs-eq-chart")) {
        renderResult(historyList[0]);
      }
    } catch (err) {
      if (tblEl) tblEl.innerHTML = stateBanner({ kind: "error", title: "Failed Loading History", message: err.message });
    }
  }

  document.getElementById("rs-run-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("rs-run-btn");
    const fd = new FormData(e.target);
    if (btn) { btn.disabled = true; btn.textContent = "Running Python Engine..."; }

    try {
      const payload = {
        strategy_id: fd.get("strategy_id"),
        data_source: fd.get("data_source"),
        interval: fd.get("interval"),
        bars: Number(fd.get("bars") || 900),
        initial_capital: Number(fd.get("initial_capital") || 10000),
        mc_simulations: Number(fd.get("mc_simulations") || 500),
        cost_model: {
          spread_points: Number(fd.get("spread_points") || 25),
          commission_per_lot: Number(fd.get("commission_per_lot") || 7),
          slippage_points: Number(fd.get("slippage_points") || 8)
        }
      };
      if (uploadedCsv) payload.csv_text = uploadedCsv;

      const res = await api.runBacktest(payload);
      showToast(`Backtest complete (${res.backtest.data_origin})`, "success");
      renderResult(res.backtest);
      await loadHistory();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Execute Backtest"; }
    }
  });

  document.getElementById("rs-hist-refresh")?.addEventListener("click", loadHistory);
  await loadHistory();
}
