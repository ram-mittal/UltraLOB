"""OHLCV Backtesting Engine with Costs, Delay, OOS Split, and Walk-Forward Validation."""

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from .metrics import calculate_metrics
from .models import Candle, CostModel, Trade
from .monte_carlo import run_trade_sequence_monte_carlo
from .strategies.base import BaseStrategy, EntrySignal


def _round_lots(raw_lots: float, step: float, vol_min: float, vol_max: float) -> float:
    if raw_lots < vol_min:
        return 0.0
    bounded = min(vol_max, raw_lots)
    steps = math.floor((bounded + 1e-10) / step)
    return round(steps * step, 4)


def _day_ordinal(ts_ms: int) -> int:
    return datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).toordinal()


class BacktestEngine:
    def __init__(
        self,
        initial_capital: float = 10_000.0,
        cost_model: Optional[CostModel] = None,
        mc_simulations: int = 1000,
    ):
        self.initial_capital = float(initial_capital)
        self.cost_model = cost_model or CostModel()
        self.mc_simulations = mc_simulations

    def _simulate_slice(
        self,
        strategy: BaseStrategy,
        candles: List[Candle],
        start_idx: int = 0,
        end_idx: Optional[int] = None,
    ) -> Dict[str, Any]:
        end_idx = len(candles) if end_idx is None else min(len(candles), end_idx)
        cm = self.cost_model
        half_spread = (cm.spread_points * cm.point) / 2.0
        slip_price = cm.slippage_points * cm.point

        equity = self.initial_capital
        trades: List[Trade] = []
        equity_curve: List[Dict[str, Any]] = []
        pending_signal: Optional[EntrySignal] = None
        pending_trigger_bar: int = -1
        open_pos: Optional[Dict[str, Any]] = None
        trade_seq = 0

        if end_idx - start_idx < 5:
            return {
                "trades": [],
                "equity_curve": [],
                "metrics": calculate_metrics([], equity, [], candles[start_idx].timestamp, candles[end_idx - 1].timestamp),
            }

        strategy.prepare(candles[:end_idx])

        for i in range(start_idx, end_idx):
            bar = candles[i]

            # 1. Execute pending signal at open of current bar (enforces execution_delay_bars >= 1)
            if pending_signal is not None and open_pos is None and i >= pending_trigger_bar + cm.execution_delay_bars:
                sig = pending_signal
                pending_signal = None
                side = sig.side
                entry_price = (bar.open + half_spread + slip_price) if side == "BUY" else (bar.open - half_spread - slip_price)

                # Validate SL/TP orientation against actual entry price
                valid_levels = (
                    (side == "BUY" and sig.stop_loss < entry_price < sig.take_profit)
                    or (side == "SELL" and sig.stop_loss > entry_price > sig.take_profit)
                )
                if valid_levels and equity > 100.0:
                    stop_dist = abs(entry_price - sig.stop_loss)
                    risk_usd = equity * (sig.risk_pct / 100.0)
                    loss_per_lot = stop_dist * cm.contract_size
                    lots = _round_lots(risk_usd / max(1e-9, loss_per_lot), cm.volume_step, cm.volume_min, cm.volume_max)
                    if lots >= cm.volume_min:
                        open_pos = {
                            "side": side,
                            "entry_time": bar.timestamp,
                            "entry_bar": i,
                            "entry_price": entry_price,
                            "initial_sl": sig.stop_loss,
                            "stop_loss": sig.stop_loss,
                            "take_profit": sig.take_profit,
                            "lots": lots,
                            "initial_lots": lots,
                            "partial_booked": False,
                            "partial_tp_r": sig.partial_tp_r,
                            "partial_fraction": sig.partial_fraction,
                            "breakeven_trigger_r": sig.breakeven_trigger_r,
                            "trail_atr_mult": sig.trail_atr_mult,
                            "max_hold_bars": sig.max_hold_bars,
                            "regime": sig.regime,
                            "risk_usd": risk_usd,
                            "last_day": _day_ordinal(bar.timestamp),
                            "swap_acc": 0.0,
                            "metadata": sig.metadata or {},
                        }

            # 2. Manage open position on current bar conservatively (SL checked before TP!)
            if open_pos is not None:
                cur_day = _day_ordinal(bar.timestamp)
                days_held = max(0, cur_day - open_pos["last_day"])
                if days_held > 0:
                    swap_rate = cm.swap_long_per_lot_daily if open_pos["side"] == "BUY" else cm.swap_short_per_lot_daily
                    open_pos["swap_acc"] += swap_rate * open_pos["lots"] * days_held
                    open_pos["last_day"] = cur_day

                side = open_pos["side"]
                sl = open_pos["stop_loss"]
                tp = open_pos["take_profit"]
                init_risk_dist = abs(open_pos["entry_price"] - open_pos["initial_sl"])

                # Effective bid/ask bounds inside bar
                bid_hi, bid_lo = bar.high - half_spread, bar.low - half_spread
                ask_hi, ask_lo = bar.high + half_spread, bar.low + half_spread

                exit_price = None
                exit_reason = None

                if side == "BUY":
                    if bid_lo <= sl:
                        exit_price = min(sl, bar.open - half_spread) - slip_price
                        exit_reason = "TRAILING_SL" if open_pos["stop_loss"] != open_pos["initial_sl"] else "SL"
                    elif bid_hi >= tp:
                        exit_price = tp - slip_price
                        exit_reason = "TP"
                else:
                    if ask_hi >= sl:
                        exit_price = max(sl, bar.open + half_spread) + slip_price
                        exit_reason = "TRAILING_SL" if open_pos["stop_loss"] != open_pos["initial_sl"] else "SL"
                    elif ask_lo <= tp:
                        exit_price = tp + slip_price
                        exit_reason = "TP"

                # Partial TP & Break-even management when trade remains open
                if exit_price is None and init_risk_dist > 0:
                    if open_pos["partial_tp_r"] and not open_pos["partial_booked"]:
                        pt_price = (
                            open_pos["entry_price"] + open_pos["partial_tp_r"] * init_risk_dist
                            if side == "BUY"
                            else open_pos["entry_price"] - open_pos["partial_tp_r"] * init_risk_dist
                        )
                        hit_partial = (bid_hi >= pt_price) if side == "BUY" else (ask_lo <= pt_price)
                        part_lots = _round_lots(open_pos["lots"] * open_pos["partial_fraction"], cm.volume_step, cm.volume_min, open_pos["lots"] - cm.volume_min)
                        if hit_partial and part_lots >= cm.volume_min:
                            trade_seq += 1
                            fill_p = pt_price - slip_price if side == "BUY" else pt_price + slip_price
                            gross = ((fill_p - open_pos["entry_price"]) if side == "BUY" else (open_pos["entry_price"] - fill_p)) * part_lots * cm.contract_size
                            comm = cm.commission_per_lot_round_turn * part_lots
                            slip_cost = slip_price * 2.0 * part_lots * cm.contract_size
                            net = gross - comm
                            equity += net
                            trades.append(Trade(
                                id=f"bt-{trade_seq}",
                                strategy_id=strategy.strategy_id,
                                symbol=cm.symbol,
                                side=side,
                                entry_time=open_pos["entry_time"],
                                exit_time=bar.timestamp,
                                entry_price=round(open_pos["entry_price"], 2),
                                exit_price=round(fill_p, 2),
                                stop_loss=round(sl, 2),
                                take_profit=round(tp, 2),
                                lots=part_lots,
                                gross_pnl_usd=round(gross, 2),
                                commission_usd=round(comm, 2),
                                swap_usd=0.0,
                                slippage_usd=round(slip_cost, 2),
                                net_pnl_usd=round(net, 2),
                                r_multiple=round(net / max(1e-9, open_pos["risk_usd"] * (part_lots / open_pos["initial_lots"])), 2),
                                holding_minutes=round((bar.timestamp - open_pos["entry_time"]) / 60_000.0, 1),
                                exit_reason="PARTIAL_TP",
                                regime=open_pos["regime"],
                                metadata=open_pos["metadata"],
                            ))
                            open_pos["lots"] = round(open_pos["lots"] - part_lots, 4)
                            open_pos["partial_booked"] = True

                    if open_pos["breakeven_trigger_r"]:
                        be_price = (
                            open_pos["entry_price"] + open_pos["breakeven_trigger_r"] * init_risk_dist
                            if side == "BUY"
                            else open_pos["entry_price"] - open_pos["breakeven_trigger_r"] * init_risk_dist
                        )
                        if (side == "BUY" and bid_hi >= be_price) or (side == "SELL" and ask_lo <= be_price):
                            open_pos["stop_loss"] = (
                                max(open_pos["stop_loss"], open_pos["entry_price"])
                                if side == "BUY"
                                else min(open_pos["stop_loss"], open_pos["entry_price"])
                            )

                    if open_pos["max_hold_bars"] and (i - open_pos["entry_bar"]) >= open_pos["max_hold_bars"]:
                        exit_price = (bar.close - half_spread - slip_price) if side == "BUY" else (bar.close + half_spread + slip_price)
                        exit_reason = "TIME_EXIT"

                if exit_price is not None:
                    trade_seq += 1
                    lots = open_pos["lots"]
                    gross = ((exit_price - open_pos["entry_price"]) if side == "BUY" else (open_pos["entry_price"] - exit_price)) * lots * cm.contract_size
                    comm = cm.commission_per_lot_round_turn * lots
                    slip_cost = slip_price * 2.0 * lots * cm.contract_size
                    swap_usd = open_pos["swap_acc"]
                    net = gross - comm + swap_usd
                    equity += net
                    trades.append(Trade(
                        id=f"bt-{trade_seq}",
                        strategy_id=strategy.strategy_id,
                        symbol=cm.symbol,
                        side=side,
                        entry_time=open_pos["entry_time"],
                        exit_time=bar.timestamp,
                        entry_price=round(open_pos["entry_price"], 2),
                        exit_price=round(exit_price, 2),
                        stop_loss=round(open_pos["stop_loss"], 2),
                        take_profit=round(tp, 2),
                        lots=lots,
                        gross_pnl_usd=round(gross, 2),
                        commission_usd=round(comm, 2),
                        swap_usd=round(swap_usd, 2),
                        slippage_usd=round(slip_cost, 2),
                        net_pnl_usd=round(net, 2),
                        r_multiple=round(net / max(1e-9, open_pos["risk_usd"] * (lots / open_pos["initial_lots"])), 2),
                        holding_minutes=round((bar.timestamp - open_pos["entry_time"]) / 60_000.0, 1),
                        exit_reason=exit_reason,
                        regime=open_pos["regime"],
                        metadata=open_pos["metadata"],
                    ))
                    open_pos = None

            # Record equity curve periodically (every bar with open mark-to-market or trade close)
            mtm = 0.0
            if open_pos is not None:
                mark = (bar.close - half_spread) if open_pos["side"] == "BUY" else (bar.close + half_spread)
                mtm = ((mark - open_pos["entry_price"]) if open_pos["side"] == "BUY" else (open_pos["entry_price"] - mark)) * open_pos["lots"] * cm.contract_size
            equity_curve.append({"timestamp": bar.timestamp, "equity": round(equity + mtm, 2)})

            # 3. Evaluate strategy for new signal only if flat and not already pending
            if open_pos is None and pending_signal is None and i < end_idx - 1:
                sig = strategy.on_bar(i, candles[: i + 1], cm)
                if sig is not None:
                    pending_signal = sig
                    pending_trigger_bar = i

        metrics = calculate_metrics(
            trades=trades,
            initial_capital=self.initial_capital,
            equity_curve=equity_curve,
            start_ts=candles[start_idx].timestamp,
            end_ts=candles[end_idx - 1].timestamp,
        )
        return {
            "trades": trades,
            "equity_curve": equity_curve,
            "metrics": metrics,
        }

    def run(
        self,
        strategy: BaseStrategy,
        candles: List[Candle],
        data_origin: str = "REAL_MARKET",
        oos_split_ratio: float = 0.70,
        walk_forward_windows: int = 3,
    ) -> Dict[str, Any]:
        if len(candles) < 120:
            raise ValueError("At least 120 OHLCV bars are required for backtesting.")

        # 1. Full sample simulation
        full = self._simulate_slice(strategy, candles, 0, len(candles))

        # 2. Out-of-Sample (OOS) split
        split_idx = max(80, min(len(candles) - 30, int(len(candles) * oos_split_ratio)))
        in_sample = self._simulate_slice(strategy, candles, 0, split_idx)
        out_of_sample = self._simulate_slice(strategy, candles, split_idx, len(candles))

        # 3. Walk-Forward windows across trailing slices
        wf_results = []
        if walk_forward_windows >= 2 and len(candles) >= 240:
            window_size = len(candles) // (walk_forward_windows + 1)
            for w in range(1, walk_forward_windows + 1):
                w_start = w * window_size
                w_end = min(len(candles), w_start + window_size)
                if w_end - w_start >= 40:
                    w_res = self._simulate_slice(strategy, candles, w_start, w_end)
                    wf_results.append({
                        "window": w,
                        "start_ts": candles[w_start].timestamp,
                        "end_ts": candles[w_end - 1].timestamp,
                        "bars": w_end - w_start,
                        "total_trades": w_res["metrics"]["total_trades"],
                        "total_return_pct": w_res["metrics"]["total_return_pct"],
                        "max_drawdown_pct": w_res["metrics"]["max_drawdown_pct"],
                        "sharpe_ratio": w_res["metrics"]["sharpe_ratio"],
                    })

        # 4. Monte Carlo trade-sequence stress test
        mc = run_trade_sequence_monte_carlo(
            trades=full["trades"],
            initial_capital=self.initial_capital,
            simulations=self.mc_simulations,
        )

        # Downsample equity & drawdown series to max 120 points for UI charts
        raw_eq = full["equity_curve"]
        step = max(1, len(raw_eq) // 120)
        sampled_eq = raw_eq[::step]
        if raw_eq and sampled_eq[-1] != raw_eq[-1]:
            sampled_eq.append(raw_eq[-1])

        peak = self.initial_capital
        dd_series = []
        for pt in sampled_eq:
            peak = max(peak, pt["equity"])
            dd_series.append(round(-((peak - pt["equity"]) / peak) * 100.0, 2) if peak > 0 else 0.0)

        return {
            "strategy_id": strategy.strategy_id,
            "code": strategy.code,
            "version": strategy.version,
            "symbol": self.cost_model.symbol,
            "data_origin": data_origin,
            "volume_source": candles[0].volume_type,
            "bars": len(candles),
            "start_ts": candles[0].timestamp,
            "end_ts": candles[-1].timestamp,
            "initial_capital": self.initial_capital,
            "cost_model": self.cost_model.to_dict(),
            "metrics": full["metrics"],
            "in_sample": in_sample["metrics"],
            "out_of_sample": out_of_sample["metrics"],
            "walk_forward": wf_results,
            "monte_carlo": mc,
            "equity_curve": [pt["equity"] for pt in sampled_eq],
            "equity_timestamps": [pt["timestamp"] for pt in sampled_eq],
            "drawdown_series": dd_series,
            "trades": [t.to_dict() for t in full["trades"][-100:]],
        }
