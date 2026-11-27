"""UL-05: Adaptive Multi-Regime Strategy (Regime-Switching Meta-Strategy)."""

from typing import Dict, List, Optional
from ..indicators import adx_series, atr_series, utc_hour
from ..models import Candle, CostModel
from .base import BaseStrategy, EntrySignal
from .ul01_gold_trend import GoldInstitutionalTrend
from .ul03_volume_profile import VolumeProfileMeanReversion


class AdaptiveMultiRegime(BaseStrategy):
    strategy_id = "ul-05-adaptive-regime"
    code = "UL-05"
    version = "1.0.0"
    name = "UL-05: Adaptive Multi-Regime Strategy"
    supported_timeframes = ["4h", "1h", "15m"]

    def __init__(self, params: Optional[Dict] = None):
        super().__init__(params)
        self.trend_engine = GoldInstitutionalTrend(params={"risk_per_trade_pct": float(self.params.get("risk_per_trade_pct", 0.5))})
        self.range_engine = VolumeProfileMeanReversion(params={"risk_per_trade_pct": float(self.params.get("risk_per_trade_pct", 0.4))})
        self._atr: List[Optional[float]] = []
        self._adx: List[Optional[float]] = []

    def prepare(self, candles: List[Candle]) -> None:
        self._atr = atr_series(candles, 14)
        self._adx = adx_series(candles, 14)
        self.trend_engine.prepare(candles)
        self.range_engine.prepare(candles)

    def _classify_regime(self, idx: int, candles: List[Candle]) -> str:
        atr = self._atr[idx]
        adx = self._adx[idx]
        if atr is None or adx is None or atr <= 0:
            return "LOW_LIQUIDITY_CHOP"

        bar = candles[idx]
        atr_pct = (atr / bar.close) * 100.0
        hour = utc_hour(bar.timestamp)
        avg_atr = sum(x for x in self._atr[max(0, idx - 24) : idx] if x is not None) / max(
            1, len([x for x in self._atr[max(0, idx - 24) : idx] if x is not None])
        )

        # Rollover / illiquid hours or compressed noise -> stand aside
        if hour < 2 or hour > 21 or atr_pct < 0.03:
            return "LOW_LIQUIDITY_CHOP"
        if avg_atr > 0 and atr > 1.75 * avg_atr and adx >= 24.0:
            return "HIGH_VOLATILITY_BREAKOUT"
        if adx >= 23.0:
            return "TRENDING"
        return "RANGE_BOUND"

    def on_bar(self, idx: int, candles: List[Candle], cost_model: CostModel) -> Optional[EntrySignal]:
        if idx < 64:
            return None

        regime = self._classify_regime(idx, candles)
        if regime == "LOW_LIQUIDITY_CHOP":
            return None

        if regime in ("TRENDING", "HIGH_VOLATILITY_BREAKOUT"):
            sig = self.trend_engine.on_bar(idx, candles, cost_model)
            if sig is not None:
                if regime == "HIGH_VOLATILITY_BREAKOUT":
                    # Throttle risk during volatility spikes
                    sig.risk_pct = round(sig.risk_pct * 0.7, 3)
                sig.regime = f"ADAPTIVE_{regime}"
                sig.reason = f"[{regime}] {sig.reason}"
                return sig

        if regime == "RANGE_BOUND":
            sig = self.range_engine.on_bar(idx, candles, cost_model)
            if sig is not None:
                sig.regime = "ADAPTIVE_RANGE_BOUND"
                sig.reason = f"[RANGE_BOUND] {sig.reason}"
                return sig

        return None
