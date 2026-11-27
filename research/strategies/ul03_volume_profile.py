"""UL-03: Volume Profile Mean Reversion (XAUUSD — Tick Volume Profile & VWAP).

IMPORTANT DISCLOSURE: When run on FX/CFD XAUUSD bars, Volume Profile and VWAP
use broker TICK_VOLUME rather than centralized exchange volume.
"""

from typing import Dict, List, Optional
from ..indicators import adx_series, atr_series, compute_tick_volume_profile, compute_vwap_bands, utc_hour
from ..models import Candle, CostModel
from .base import BaseStrategy, EntrySignal


class VolumeProfileMeanReversion(BaseStrategy):
    strategy_id = "ul-03-volume-profile"
    code = "UL-03"
    version = "1.0.0"
    name = "UL-03: Volume Profile Mean Reversion"
    supported_timeframes = ["1h", "15m"]

    def __init__(self, params: Optional[Dict] = None):
        super().__init__(params)
        self.risk_pct = float(self.params.get("risk_per_trade_pct", 0.4))
        self.max_adx_range = float(self.params.get("max_adx_range", 24.0))
        self.vp_lookback = int(self.params.get("vp_lookback", 64))
        self.max_spread_points = float(self.params.get("max_spread_points", 40.0))
        self._atr: List[Optional[float]] = []
        self._adx: List[Optional[float]] = []

    def prepare(self, candles: List[Candle]) -> None:
        self._atr = atr_series(candles, 14)
        self._adx = adx_series(candles, 14)

    def on_bar(self, idx: int, candles: List[Candle], cost_model: CostModel) -> Optional[EntrySignal]:
        if idx < max(self.vp_lookback, 40):
            return None
        if cost_model.spread_points > self.max_spread_points:
            return None

        bar = candles[idx]
        hour = utc_hour(bar.timestamp)
        if not (2 <= hour <= 21):
            return None

        atr = self._atr[idx]
        adx = self._adx[idx]
        if atr is None or adx is None or atr <= 0:
            return None

        # Never fade strong directional trends
        if adx > self.max_adx_range:
            return None

        window = candles[idx - self.vp_lookback : idx]
        vp = compute_tick_volume_profile(window, bins=24, value_area_pct=0.70)
        vwap_info = compute_vwap_bands(window[-32:])
        poc, vah, val = vp["poc"], vp["vah"], vp["val"]
        vwap, lower_1, upper_1 = vwap_info["vwap"], vwap_info["lower_1"], vwap_info["upper_1"]
        if None in (poc, vah, val, vwap, lower_1, upper_1):
            return None

        prev = candles[idx - 1]
        vol_source = vp.get("volume_source", "TICK_VOLUME")

        # Bullish mean reversion: extended below VAL & lower VWAP band, rejecting upward back toward POC
        if (bar.low < val and bar.low < lower_1) and (bar.close > bar.open) and (bar.close > prev.close):
            target = min(poc, vwap) if poc > bar.close else max(poc, vwap)
            if target > bar.close + 0.8 * atr:
                stop = min(bar.low, prev.low) - 0.8 * atr
                risk_dist = bar.close - stop
                reward_dist = target - bar.close
                if risk_dist > 0.4 * atr and (reward_dist / risk_dist) >= 1.2:
                    return EntrySignal(
                        side="BUY",
                        stop_loss=round(stop, 2),
                        take_profit=round(target, 2),
                        risk_pct=self.risk_pct,
                        breakeven_trigger_r=1.0,
                        max_hold_bars=48,
                        regime="RANGE_MEAN_REVERSION",
                        reason=f"Value area low ({val}) rejection toward POC ({poc})",
                        metadata={"volume_source": vol_source, "poc": poc, "val": val, "vah": vah},
                    )

        # Bearish mean reversion: extended above VAH & upper VWAP band, rejecting downward toward POC
        if (bar.high > vah and bar.high > upper_1) and (bar.close < bar.open) and (bar.close < prev.close):
            target = max(poc, vwap) if poc < bar.close else min(poc, vwap)
            if target < bar.close - 0.8 * atr:
                stop = max(bar.high, prev.high) + 0.8 * atr
                risk_dist = stop - bar.close
                reward_dist = bar.close - target
                if risk_dist > 0.4 * atr and (reward_dist / risk_dist) >= 1.2:
                    return EntrySignal(
                        side="SELL",
                        stop_loss=round(stop, 2),
                        take_profit=round(target, 2),
                        risk_pct=self.risk_pct,
                        breakeven_trigger_r=1.0,
                        max_hold_bars=48,
                        regime="RANGE_MEAN_REVERSION",
                        reason=f"Value area high ({vah}) rejection toward POC ({poc})",
                        metadata={"volume_source": vol_source, "poc": poc, "val": val, "vah": vah},
                    )

        return None
