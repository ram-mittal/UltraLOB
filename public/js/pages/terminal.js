// Live Market & Paper Sandbox Order Terminal — Real-Market Chart, Risk-Sized Order Ticket & Open Blotter
import { api } from "../api.js";
import { createEquityCurve } from "../components/charts.js";
import {
  isBrowser, esc, fmtUsd, fmtNum, fmtPrice,
  originBadge, statusBadge, stateBanner, dataTable
} from "../components/ui.js";

export function render() {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold tracking-tight text-[#e6edf6]">Market Feed &amp; Paper Order Terminal</h1>
          <p class="text-xs text-[#94a3b8]">Real Twelve Data (XAU/USD, equities) and Kraken Spot (BTC/USD) historical feeds paired with Risk-Normalized Paper Sandbox / MT5 Demo Bridge execution.</p>
        </div>
        <div class="flex items-center gap-2">
          <span id="tm-feed-badge">${originBadge("REAL_MARKET")}</span>
          <a href="/legacy" class="btn-secondary font-mono text-[11px]">Simulated FIX 4.4 Sandbox (/legacy)</a>
        </div>
      </div>

      <div class="rounded border border-[#3b82f6]/30 bg-[#1c2330]/60 px-3.5 py-2 text-[11px] text-[#cbd5e1] flex flex-wrap items-center justify-between gap-2">
        <span><strong>RUNTIME SEPARATION:</strong> This web ticket executes against Paper Sandbox / MT5 Demo Bridge (<code class="font-mono">/api/copy-trading/execute</code>). The standalone C++20 FIX 4.4 / binary matching engine (<code class="font-mono">server/main.cpp</code>) is a separate runtime and is not connected to the web terminal or hosted FIX view.</span>
        ${originBadge("PAPER_SANDBOX")}
      </div>

      <!-- Instrument & Interval Selector Bar -->
      <div class="panel p-3 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <select id="tm-symbol" class="input-term font-mono text-xs">
            <option value="XAUUSD">XAUUSD (Gold Spot)</option>
            <option value="BTCUSDT">BTCUSDT (Kraken Spot)</option>
            <option value="AAPL">AAPL (Equities)</option>
            <option value="NVDA">NVDA (Equities)</option>
            <option value="SPY">SPY (Equities)</option>
          </select>
          <select id="tm-interval" class="input-term font-mono text-xs">
            <option value="15m">M15</option>
            <option value="1h" selected>H1</option>
            <option value="4h">H4</option>
            <option value="1d">D1</option>
          </select>
          <button id="tm-reload-chart" class="btn-secondary font-mono text-[11px]">Sync Real Feed</button>
        </div>
        <div id="tm-quote-bar" class="font-mono text-xs text-[#94a3b8] flex items-center gap-4">
          <span>Last: <strong id="tm-last-px" class="text-[#e6edf6]">—</strong></span>
          <span id="tm-feed-status" class="text-[11px]">Awaiting feed sync...</span>
        </div>
      </div>

      <!-- Chart + Risk-Sized Order Ticket -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div class="lg:col-span-8 panel p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]" id="tm-chart-title">XAUUSD Real-Market Close Series</span>
            ${originBadge("REAL_MARKET")}
          </div>
          <div id="tm-chart-wrap" class="h-72"></div>
        </div>

        <form id="tm-order-form" class="lg:col-span-4 panel p-4 space-y-3">
          <div class="flex items-center justify-between border-b border-[#232a37] pb-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Risk-Normalized Order Ticket</span>
            ${originBadge("PAPER_SANDBOX")}
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Side</label>
              <select name="side" class="input-term w-full font-mono text-[11px]">
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Strategy Tag</label>
              <select name="strategyId" class="input-term w-full font-mono text-[11px]">
                <option value="ul-01-gold-trend">UL-01 Trend</option>
                <option value="ul-02-liquidity-sweep">UL-02 Sweep</option>
                <option value="ul-03-volume-profile">UL-03 Profile</option>
                <option value="manual">Manual Ticket</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Entry Price</label>
              <input id="tm-ord-price" name="price" type="number" step="0.01" required placeholder="2650.00" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Stop Loss Price</label>
              <input id="tm-ord-sl" name="stopPrice" type="number" step="0.01" required placeholder="2640.00" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Target Price</label>
              <input id="tm-ord-tp" name="targetPrice" type="number" step="0.01" placeholder="2675.00" class="input-term w-full font-mono text-[11px]" />
            </div>
            <div>
              <label class="block text-[10px] uppercase text-[#94a3b8] mb-1">Risk Budget (%)</label>
              <input id="tm-ord-risk" name="riskPct" type="number" step="0.05" min="0.05" max="2.0" value="0.50" class="input-term w-full font-mono text-[11px]" />
            </div>
          </div>

          <div class="flex gap-2">
            <button type="button" id="tm-preview-size-btn" class="btn-secondary flex-1 font-mono text-[11px]">Preview Lot Size</button>
            <button type="submit" class="btn-primary flex-1 font-mono text-[11px]">Submit Paper Order</button>
          </div>
          <div id="tm-size-preview" class="text-[11px] font-mono text-[#94a3b8]"></div>
        </form>
      </div>

      <!-- Open Positions & Fills -->
      <div class="panel overflow-hidden">
        <div class="px-4 py-3 border-b border-[#232a37] flex items-center justify-between">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-[#e6edf6]">Paper Sandbox Positions</h2>
          <a href="#/execution" class="text-[11px] font-mono text-[#3b82f6] hover:underline">Full Execution Blotter →</a>
        </div>
        <div id="tm-positions-table"></div>
      </div>
    </div>
  `;
}

export async function init({ showToast }) {
  if (!isBrowser()) return;

  async function loadChart() {
    const symbol = document.getElementById("tm-symbol")?.value || "XAUUSD";
    const interval = document.getElementById("tm-interval")?.value || "1h";
    const titleEl = document.getElementById("tm-chart-title");
    if (titleEl) titleEl.textContent = `${symbol} Real-Market Series (${interval})`;

    const wrap = document.getElementById("tm-chart-wrap");
    const statusEl = document.getElementById("tm-feed-status");
    const lastEl = document.getElementById("tm-last-px");

    try {
      const data = await api.getMarketHistory({ symbol, interval, limit: 80 });
      const candles = data?.candles || [];
      if (candles.length >= 2) {
        const last = candles[candles.length - 1];
        if (lastEl) lastEl.textContent = fmtPrice(last.close, symbol);
        if (statusEl) statusEl.textContent = `Source: ${data.provider || "Market Feed"} (${candles.length} bars)`;
        const pxInp = document.getElementById("tm-ord-price");
        const slInp = document.getElementById("tm-ord-sl");
        if (pxInp && !pxInp.value) pxInp.value = Number(last.close).toFixed(2);
        if (slInp && !slInp.value) slInp.value = (Number(last.close) * 0.996).toFixed(2);
        if (wrap) {
          wrap.innerHTML = `<canvas id="tm-price-chart"></canvas>`;
          createEquityCurve("tm-price-chart", candles.map((c) => ({ time: new Date(c.time).toISOString().slice(0, 16), value: c.close })), symbol);
        }
      } else {
        if (statusEl) statusEl.textContent = data?.error || "Feed awaiting bars";
        if (wrap) wrap.innerHTML = stateBanner({ kind: "empty", title: "Awaiting Historical Feed", message: data?.note || "No historical candles returned for this symbol." });
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message;
      if (wrap) wrap.innerHTML = stateBanner({ kind: "disconnected", title: "Historical Feed Unavailable", message: err.message });
    }
  }

  async function loadPositions() {
    const tbl = document.getElementById("tm-positions-table");
    if (!tbl) return;
    try {
      const p = await api.getPortfolio();
      const trades = p?.trades || [];
      tbl.innerHTML = dataTable({
        id: "tm-tbl-pos",
        emptyTitle: "No Active Paper Positions",
        emptyMessage: "Submit a risk-normalized order above (fund Paper Sandbox first if equity is $0).",
        columns: [
          { key: "symbol", label: "Symbol", mono: true },
          { key: "side", label: "Side", mono: true },
          { key: "qty", label: "Volume", align: "right", mono: true, render: (r) => fmtNum(r.qty, 3) },
          { key: "price", label: "Entry", align: "right", mono: true, render: (r) => fmtPrice(r.price, r.symbol) },
          { key: "pnl", label: "P&L", align: "right", mono: true, render: (r) => fmtUsd(r.pnl || 0, { sign: true }) },
          { key: "status", label: "Status", render: (r) => statusBadge(r.status) },
          {
            key: "act",
            label: "",
            align: "right",
            render: (r) => r.status === "open" ? `<button data-tm-close="${esc(r.id)}" data-tm-px="${esc(r.price)}" class="btn-secondary px-2 py-0.5 text-[10px] font-mono">Close</button>` : ""
          }
        ],
        rows: trades.slice(0, 15)
      });
      tbl.querySelectorAll("[data-tm-close]").forEach((b) => b.addEventListener("click", async () => {
        try { await api.closeTrade(b.dataset.tmClose, Number(b.dataset.tmPx)); showToast("Closed position", "success"); loadPositions(); } catch (e) { showToast(e.message, "error"); }
      }));
    } catch (err) {
      tbl.innerHTML = stateBanner({ kind: "error", title: "Portfolio Load Error", message: err.message });
    }
  }

  document.getElementById("tm-preview-size-btn")?.addEventListener("click", async () => {
    const symbol = document.getElementById("tm-symbol")?.value || "XAUUSD";
    const price = Number(document.getElementById("tm-ord-price")?.value || 0);
    const stopPrice = Number(document.getElementById("tm-ord-sl")?.value || 0);
    const riskPct = Number(document.getElementById("tm-ord-risk")?.value || 0.5);
    try {
      const res = await api.previewPositionSize({ symbol, entryPrice: price, stopPrice, riskPct });
      const prevEl = document.getElementById("tm-size-preview");
      if (prevEl) prevEl.innerHTML = `<span class="text-[#22c55e]">Approved Vol: ${fmtNum(res.volume ?? res.qty, 3)} | Risk $: ${fmtUsd(res.riskAmount ?? 0)}</span>`;
    } catch (err) {
      const prevEl = document.getElementById("tm-size-preview");
      if (prevEl) prevEl.innerHTML = `<span class="text-[#fca5a5]">${esc(err.message)}</span>`;
    }
  });

  document.getElementById("tm-order-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const symbol = document.getElementById("tm-symbol")?.value || "XAUUSD";
    try {
      await api.executeOrder({
        symbol,
        side: fd.get("side"),
        strategyId: fd.get("strategyId"),
        price: Number(fd.get("price")),
        stopPrice: Number(fd.get("stopPrice")),
        targetPrice: fd.get("targetPrice") ? Number(fd.get("targetPrice")) : undefined,
        riskPct: Number(fd.get("riskPct"))
      });
      showToast("Paper order executed through Risk Engine", "success");
      loadPositions();
    } catch (err) { showToast(err.message, "error"); }
  });

  document.getElementById("tm-reload-chart")?.addEventListener("click", loadChart);
  document.getElementById("tm-symbol")?.addEventListener("change", loadChart);
  document.getElementById("tm-interval")?.addEventListener("change", loadChart);

  await Promise.all([loadChart(), loadPositions()]);
}
