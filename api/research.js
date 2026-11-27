import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ensureDbReady,
  getAllStrategiesInMemory,
  getMemoryStore,
  extractAuthContext,
  query
} from "./store.js";
import { roleHasPermission } from "./security.js";
import { recordAuditLog } from "../db/client.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runPythonCli(payload) {
  return new Promise((resolve, reject) => {
    const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
    let attemptIndex = 0;

    function trySpawn() {
      if (attemptIndex >= candidates.length) {
        return reject(new Error("Python runtime not available on this host."));
      }
      const cmd = candidates[attemptIndex++];
      const child = spawn(cmd, ["-m", "research.cli"], {
        cwd: PROJECT_ROOT,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { child.kill(); } catch {}
          reject(new Error("Backtest execution timed out after 30s."));
        }
      }, 30_000);

      child.on("error", (err) => {
        clearTimeout(timer);
        if (err.code === "ENOENT") {
          return trySpawn();
        }
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        try {
          const parsed = JSON.parse(stdout || "{}");
          if (code !== 0 || !parsed.ok) {
            return reject(new Error(parsed.error || stderr || `Python exited with code ${code}`));
          }
          resolve(parsed.report);
        } catch (parseErr) {
          reject(new Error(`Invalid JSON from research engine: ${stderr || parseErr.message}`));
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    }

    trySpawn();
  });
}

async function persistBacktestReport(report, auth, dbAvailable) {
  const backtestId = crypto.randomUUID();
  const record = {
    id: backtestId,
    strategy_id: report.strategy_id,
    code: report.code,
    version: report.version,
    symbol: report.symbol,
    data_origin: report.data_origin,
    volume_source: report.volume_source,
    can_promote_to_backtested: Boolean(report.can_promote_to_backtested),
    feed_meta: report.feed_meta || {},
    bars: report.bars,
    start_ts: report.start_ts,
    end_ts: report.end_ts,
    initial_capital: report.initial_capital,
    cost_model: report.cost_model,
    metrics: report.metrics,
    in_sample: report.in_sample,
    out_of_sample: report.out_of_sample,
    walk_forward: report.walk_forward,
    monte_carlo: report.monte_carlo,
    equity_curve: report.equity_curve,
    equity_timestamps: report.equity_timestamps,
    drawdown_series: report.drawdown_series,
    trades: report.trades,
    created_at: new Date().toISOString()
  };

  if (dbAvailable) {
    const ownerUuid = /^[0-9a-f-]{36}$/i.test(auth.userId) ? auth.userId : null;
    await query(
      `INSERT INTO backtests
       (id, strategy_id, strategy_version, instrument, timeframe, data_source,
        start_date, end_date, walk_forward_windows, cost_model, status, created_by, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7 / 1000.0),to_timestamp($8 / 1000.0),$9,$10::jsonb,'COMPLETED',$11,NOW())`,
      [
        backtestId,
        report.strategy_id,
        report.version || "1.0.0",
        report.symbol || "XAUUSD",
        "15m",
        report.data_origin,
        report.start_ts,
        report.end_ts,
        Array.isArray(report.walk_forward) ? report.walk_forward.length : 0,
        JSON.stringify(report.cost_model || {}),
        ownerUuid
      ]
    );

    const m = report.metrics || {};
    await query(
      `INSERT INTO backtest_results
       (backtest_id, total_return_pct, cagr_pct, sharpe_ratio, sortino_ratio, max_drawdown_pct,
        profit_factor, win_rate_pct, avg_profit_trade, avg_loss_trade, expectancy, total_trades,
        avg_holding_minutes, max_consecutive_losses, risk_of_ruin_pct, oos_metrics,
        walk_forward_metrics, equity_curve, drawdown_series, monthly_returns)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,'[]'::jsonb)`,
      [
        backtestId,
        m.total_return_pct,
        m.cagr_pct,
        m.sharpe_ratio,
        m.sortino_ratio,
        m.max_drawdown_pct,
        m.profit_factor,
        m.win_rate_pct,
        m.avg_profit_trade,
        m.avg_loss_trade,
        m.expectancy_r,
        m.total_trades || 0,
        m.avg_holding_minutes,
        m.max_consecutive_losses,
        m.risk_of_ruin_pct,
        JSON.stringify({ in_sample: report.in_sample, out_of_sample: report.out_of_sample }),
        JSON.stringify(report.walk_forward || []),
        JSON.stringify(report.equity_curve || []),
        JSON.stringify(report.drawdown_series || [])
      ]
    );

    if (report.monte_carlo?.simulations > 0) {
      await query(
        `INSERT INTO monte_carlo_simulations
         (strategy_id, user_id, simulation_type, data_source_label, symbol, paths, parameters, results)
         VALUES ($1,$2,'TRADE_SEQUENCE_BOOTSTRAP','SIMULATED_RESEARCH',$3,$4,$5::jsonb,$6::jsonb)`,
        [
          report.strategy_id,
          ownerUuid,
          report.symbol || "XAUUSD",
          report.monte_carlo.simulations,
          JSON.stringify({ ruin_threshold_pct: report.monte_carlo.ruin_threshold_pct }),
          JSON.stringify(report.monte_carlo)
        ]
      );
    }

    // Strict lifecycle rule: ONLY promote to BACKTESTED when backed by REAL_MARKET history
    if (report.can_promote_to_backtested) {
      await query(
        `UPDATE strategies
         SET lifecycle_status = CASE WHEN lifecycle_status = 'RESEARCH' THEN 'BACKTESTED' ELSE lifecycle_status END,
             data_source_label = 'BACKTEST',
             status_note = 'Verified against historical OHLCV with transaction costs, OOS split, and Monte Carlo stress test.',
             updated_at = NOW()
         WHERE id = $1`,
        [report.strategy_id]
      );
    }

    await recordAuditLog({
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: "BACKTEST_EXECUTED",
      targetType: "strategy",
      targetId: report.strategy_id,
      details: {
        backtest_id: backtestId,
        data_origin: report.data_origin,
        promoted: report.can_promote_to_backtested,
        total_trades: m.total_trades
      }
    });
  } else {
    const mem = getMemoryStore();
    mem.backtests.unshift(record);
    if (mem.backtests.length > 50) mem.backtests.length = 50;

    if (report.can_promote_to_backtested) {
      const strat = getAllStrategiesInMemory().find((s) => s.id === report.strategy_id);
      if (strat) {
        if (strat.lifecycle_status === "RESEARCH") strat.lifecycle_status = "BACKTESTED";
        strat.data_source_label = "BACKTEST";
        strat.total_return = report.metrics.total_return_pct;
        strat.cagr = report.metrics.cagr_pct;
        strat.sharpe_ratio = report.metrics.sharpe_ratio;
        strat.sortino_ratio = report.metrics.sortino_ratio;
        strat.max_drawdown = report.metrics.max_drawdown_pct;
        strat.profit_factor = report.metrics.profit_factor;
        strat.win_rate = report.metrics.win_rate_pct;
        strat.expectancy = report.metrics.expectancy_r;
        strat.total_trades = report.metrics.total_trades;
        strat.risk_of_ruin = report.metrics.risk_of_ruin_pct;
        strat.out_of_sample = report.out_of_sample;
        strat.walk_forward = report.walk_forward;
        strat.monte_carlo_risk = report.monte_carlo;
        strat.equity_curve = report.equity_curve;
        strat.drawdown = report.drawdown_series;
        strat.status_note = "Verified against historical OHLCV with transaction costs, OOS split, and Monte Carlo stress test.";
      }
    }
  }

  return record;
}

export default async function researchHandler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/research/, "").split("?")[0];
  const dbAvailable = await ensureDbReady().catch(() => false);

  // GET /api/research/backtests
  if (request.method === "GET" && (subPath === "/backtests" || subPath === "/backtests/")) {
    const strategyFilter = request.query?.strategy_id ? String(request.query.strategy_id) : null;
    if (dbAvailable) {
      const res = await query(
        `SELECT b.id, b.strategy_id, b.strategy_version AS version, b.instrument AS symbol,
                b.timeframe, b.data_source AS data_origin, b.status, b.created_at, b.completed_at,
                br.total_return_pct, br.cagr_pct, br.sharpe_ratio, br.sortino_ratio,
                br.max_drawdown_pct, br.profit_factor, br.win_rate_pct, br.expectancy,
                br.total_trades, br.risk_of_ruin_pct, br.oos_metrics, br.walk_forward_metrics,
                br.equity_curve, br.drawdown_series
         FROM backtests b
         LEFT JOIN backtest_results br ON br.backtest_id = b.id
         WHERE ($1::text IS NULL OR b.strategy_id = $1)
         ORDER BY b.created_at DESC LIMIT 30`,
        [strategyFilter]
      );
      return response.status(200).json({ backtests: res.rows });
    }
    const list = getMemoryStore().backtests.filter((b) => !strategyFilter || b.strategy_id === strategyFilter);
    return response.status(200).json({ backtests: list });
  }

  // GET /api/research/backtests/:id
  const detailMatch = subPath.match(/^\/backtests\/([^/]+)$/);
  if (request.method === "GET" && detailMatch) {
    const id = detailMatch[1];
    const found = getMemoryStore().backtests.find((b) => b.id === id);
    if (found) return response.status(200).json({ backtest: found });
    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(id)) {
      const res = await query(
        `SELECT b.*, b.data_source AS data_origin, br.* FROM backtests b LEFT JOIN backtest_results br ON br.backtest_id = b.id WHERE b.id = $1`,
        [id]
      );
      if (res.rows[0]) return response.status(200).json({ backtest: res.rows[0] });
    }
    return response.status(404).json({ error: "Backtest run not found." });
  }

  // POST /api/research/backtest
  if (request.method === "POST" && subPath === "/backtest") {
    const auth = extractAuthContext(request);
    if (!auth.authenticated) {
      return response.status(401).json({ error: "Authentication required to run and record backtests.", code: "AUTH_REQUIRED" });
    }
    if (!roleHasPermission(auth.role, "backtests:run")) {
      return response.status(403).json({
        error: `Role '${auth.role}' is not authorized to execute research backtests. Use Researcher, Strategy Provider, or Admin.`,
        code: "FORBIDDEN_ROLE"
      });
    }

    const body = request.body || {};
    const strategyId = String(body.strategy_id || "ul-01-gold-trend").trim();
    const dataSource = String(body.data_source || "SIMULATED_RESEARCH").toUpperCase();
    const interval = String(body.interval || "15m");
    const initialCapital = Math.min(10_000_000, Math.max(500, Number(body.initial_capital || 10_000)));
    const bars = Math.min(5000, Math.max(150, Number(body.bars || 1200)));
    const mcSimulations = Math.min(2000, Math.max(100, Number(body.mc_simulations || 500)));

    if (![
      "ul-01-gold-trend", "UL-01",
      "ul-02-liquidity-sweep", "UL-02",
      "ul-03-volume-profile", "UL-03",
      "ul-04-gold-scalper", "UL-04",
      "ul-05-adaptive-regime", "UL-05"
    ].includes(strategyId)) {
      return response.status(400).json({ error: "Select a supported quantitative model (UL-01 through UL-05)." });
    }

    try {
      const report = await runPythonCli({
        strategy_id: strategyId,
        symbol: "XAUUSD",
        interval,
        data_source: dataSource,
        bars,
        initial_capital: initialCapital,
        mc_simulations: mcSimulations,
        seed: Number(body.seed || 101),
        csv_text: body.csv_text || null,
        candles: body.candles || null,
        cost_model: body.cost_model || {},
        params: body.params || {}
      });

      const saved = await persistBacktestReport(report, auth, dbAvailable);
      return response.status(200).json({ backtest: saved });
    } catch (err) {
      return response.status(400).json({ error: err.message, code: "BACKTEST_FAILED" });
    }
  }

  return response.status(404).json({ error: "Research endpoint not found." });
}
