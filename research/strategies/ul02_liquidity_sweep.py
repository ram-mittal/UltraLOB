"""UL-02: Liquidity Sweep Reversal (XAUUSD — Sweep + Rejection + Displacement + MSS)."""

from typing import Dict, List, Optional
from ..indicators import atr_series, recent_swing_high, recent_swing_low, utc_day_key, utc_hour
from ..models import Candle, CostModel
from .base import BaseStrategy, EntrySignal


class LiquiditySweepReversal(BaseStrategy):
    strategy_id = "ul-02-liquidity-sweep"
    code = "UL-02"
    version = "1.0.0"
    name = "UL-02: Liquidity Sweep Reversal"
    supported_timeframes = ["4h", "1h", "15m"]

    def __init__(self, params: Optional[Dict] = None):
        super().__init__(params)
        self.risk_pct = float(self.params.get("risk_per_trade_pct", 0.5))
        self.max_spread_points = float(self.params.get("max_spread_points", 45.0))
        self.require_displacement = bool(self.params.get("require_displacement", True))
        self._atr: List[Optional[float]] = []
        self._prev_day_hl: Dict[str, tuple] = {}
        self._asian_hl: Dict[str, tuple] = {}
        self._pending_sweep: Optional[Dict] = None

    def prepare(self, candles: List[Candle]) -> None:
        self._atr = atr_series(candles, 14)
        self._prev_day_hl.clear()
        self._asian_hl.clear()
        self._pending_sweep = None

        # Precompute strictly completed previous UTC day H/L and completed Asian session H/L
        daily_bars: Dict[str, List[Candle]] = {}
        asian_bars: Dict[str, List[Candle]] = {}
        for c in candles:
            dk = utc_day_key(c.timestamp)
            daily_bars.setdefault(dk, []).append(c)
            if 0 <= utc_hour(c.timestamp) < 7:
                asian_bars.setdefault(dk, []).append(c)

        days = sorted(daily_bars.keys())
        for i in range(1, len(days)):
            prev_bars = daily_bars[days[i - 1]]
            self._prev_day_hl[days[i]] = (max(b.high for b in prev_bars), min(b.low for b in prev_bars))

        for dk, ab in asian_bars.items():
            if len(ab) >= 4:
                self._asian_hl[dk] = (max(b.high for b in ab), min(b.low for b in ab))

    def on_bar(self, idx: int, candles: List[Candle], cost_model: CostModel) -> Optional[EntrySignal]:
        if idx < 40:
            return None
        if cost_model.spread_points > self.max_spread_points:
            return None

        bar = candles[idx]
        hour = utc_hour(bar.timestamp)
        if not (7 <= hour <= 20):  # Trade post-Asian London/NY sweeps
            return None

        atr = self._atr[idx]
        if atr is None or atr <= 0:
            return None

        dk = utc_day_key(bar.timestamp)
        levels_high = []
        levels_low = []
        if dk in self._prev_day_hl:
            levels_high.append(("PDH", self._prev_day_hl[dk][0]))
            levels_low.append(("PDL", self._prev_day_hl[dk][1]))
        if dk in self._asian_hl:
            levels_high.append(("ASIAN_HIGH", self._asian_hl[dk][0]))
            levels_low.append(("ASIAN_LOW", self._asian_hl[dk][1]))

        sh = recent_swing_high(candles, idx - 1, lookback=36, left=3, right=2)
        sl_lvl = recent_swing_low(candles, idx - 1, lookback=36, left=3, right=2)
        if sh is not None:
            levels_high.append(("SWING_HIGH", sh))
        if sl_lvl is not None:
            levels_low.append(("SWING_LOW", sl_lvl))

        # Step 1: Detect liquidity sweep + immediate rejection close back inside level
        # Simple wick through a level does NOT trigger a trade on its own; we arm confirmation for MSS/displacement.
        for name, lvl in levels_low:
            if bar.low < lvl and bar.close > lvl:
                self._pending_sweep = {
                    "dir": "BULLISH",
                    "level_name": name,
                    "level": lvl,
                    "sweep_extreme": bar.low,
                    "bar_idx": idx,
                }
                break
        else:
            for name, lvl in levels_high:
                if bar.high > lvl and bar.close < lvl:
                    self._pending_sweep = {
                        "dir": "BEARISH",
                        "level_name": name,
                        "level": lvl,
                        "sweep_extreme": bar.high,
                        "bar_idx": idx,
                    }
                    break

        if self._pending_sweep is None:
            return None

        sw = self._pending_sweep
        age = idx - sw["bar_idx"]
        if age > 6:
            self._pending_sweep = None
            return None
        if age == 0:
            # Wait for subsequent confirmation candle (MSS + displacement) so raw wick never fires alone
            return None

        body = abs(bar.close - bar.open)
        candle_range = max(1e-9, bar.high - bar.low)
        displacement_ok = (not self.require_displacement) or (body >= 0.45 * candle_range and body >= 0.35 * atr)
        local_hi = max(c.high for c in candles[max(0, idx - 4) : idx])
        local_lo = min(c.low for c in candles[max(0, idx - 4) : idx])

        if sw["dir"] == "BULLISH" and bar.close > bar.open and displacement_ok and bar.close > local_hi:
            extreme = min(sw["sweep_extreme"], min(c.low for c in candles[sw["bar_idx"] : idx + 1]))
            stop = extreme - 0.5 * atr
            risk_dist = bar.close - stop
            if 0.6 * atr <= risk_dist <= 3.5 * atr:
                opposing_tp = sh if (sh and sh > bar.close + 1.8 * risk_dist) else (bar.close + 2.4 * risk_dist)
                self._pending_sweep = None
                return EntrySignal(
                    side="BUY",
                    stop_loss=round(stop, 2),
                    take_profit=round(opposing_tp, 2),
                    risk_pct=self.risk_pct,
                    breakeven_trigger_r=1.3,
                    max_hold_bars=64,
                    regime="LIQUIDITY_SWEEP_BULL",
                    reason=f"Bullish sweep of {sw['level_name']} confirmed by displacement & MSS",
                    metadata={"swept_level": sw["level_name"]},
                )

        if sw["dir"] == "BEARISH" and bar.close < bar.open and displacement_ok and bar.close < local_lo:
            extreme = max(sw["sweep_extreme"], max(c.high for c in candles[sw["bar_idx"] : idx + 1]))
            stop = extreme + 0.5 * atr
            risk_dist = stop - bar.close
            if 0.6 * atr <= risk_dist <= 3.5 * atr:
                opposing_tp = sl_lvl if (sl_lvl and sl_lvl < bar.close - 1.8 * risk_dist) else (bar.close - 2.4 * risk_dist)
                self._pending_sweep = None
                return EntrySignal(
                    side="SELL",
                    stop_loss=round(stop, 2),
                    take_profit=round(opposing_tp, 2),
                    risk_pct=self.risk_pct,
                    breakeven_trigger_r=1.3,
                    max_hold_bars=64,
                    regime="LIQUIDITY_SWEEP_BEAR",
                    reason=f"Bearish sweep of {sw['level_name']} confirmed by displacement & MSS",
                    metadata={"swept_level": sw["level_name"]},
                )

        return None
