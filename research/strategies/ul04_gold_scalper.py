"""UL-04: Gold Momentum Scalper (XAUUSD — Tick/M1/M5 Execution-Aware Momentum).

Never uses fabricated L2 order-book depth when broker feed provides top-of-book
spread + tick volume only. Enforces strict spread & session liquidity gates.
"""

from typing import Dict, List, Optional
from ..indicators import atr_series, utc_hour
from ..models import Candle, CostModel
from .base import BaseStrategy, EntrySignal


class GoldMomentumScalper(BaseStrategy):
    strategy_id = "ul-04-gold-scalper"
    code = "UL-04"
    version = "1.0.0"
    name = "UL-04: Gold Momentum Scalper"
    supported_timeframes = ["1m", "5m", "15m"]

    def __init__(self, params: Optional[Dict] = None):
        super().__init__(params)
        self.risk_pct = float(self.params.get("risk_per_trade_pct", 0.25))
        self.max_spread_points = float(self.params.get("max_spread_points", 28.0))
        self._atr: List[Optional[float]] = []

    def prepare(self, candles: List[Candle]) -> None:
        self._atr = atr_series(candles, 14)

    def on_bar(self, idx: int, candles: List[Candle], cost_model: CostModel) -> Optional[EntrySignal]:
        if idx < 25:
            return None
        # Strict execution spread gate
        if cost_model.spread_points > self.max_spread_points:
            return None

        bar = candles[idx]
        hour = utc_hour(bar.timestamp)
        if not (7 <= hour <= 19):  # Liquid London + NY overlap hours only
            return None

        atr = self._atr[idx]
        if atr is None or atr <= 0:
            return None

        prev1 = candles[idx - 1]
        prev2 = candles[idx - 2]
        avg_vol = sum(c.volume for c in candles[idx - 12 : idx]) / 12.0
        vol_expansion = avg_vol > 0 and bar.volume >= avg_vol * 1.35

        # Short-term price velocity & acceleration across last 2 closed impulses
        v1 = bar.close - prev1.close
        v0 = prev1.close - prev2.close
        body = abs(bar.close - bar.open)
        bar_range = max(1e-9, bar.high - bar.low)
        impulse_ratio = body / bar_range

        # Volatility expansion check without extreme anomalous spike
        if not (0.55 * atr <= body <= 2.4 * atr):
            return None

        if vol_expansion and impulse_ratio >= 0.55:
            # Bullish momentum acceleration
            if v1 > 0 and v0 >= 0 and bar.close > prev1.high:
                stop = min(bar.low, prev1.low) - 0.35 * atr
                risk_dist = bar.close - stop
                if 0.4 * atr <= risk_dist <= 2.2 * atr:
                    return EntrySignal(
                        side="BUY",
                        stop_loss=round(stop, 2),
                        take_profit=round(bar.close + 1.9 * risk_dist, 2),
                        risk_pct=self.risk_pct,
                        breakeven_trigger_r=1.0,
                        max_hold_bars=12,
                        regime="MOMENTUM_ACCEL_BULL",
                        reason="Tick-volume expansion & positive short-term price acceleration within spread gate",
                        metadata={"volume_source": bar.volume_type, "spread_points": cost_model.spread_points},
                    )

            # Bearish momentum acceleration
            if v1 < 0 and v0 <= 0 and bar.close < prev1.low:
                stop = max(bar.high, prev1.high) + 0.35 * atr
                risk_dist = stop - bar.close
                if 0.4 * atr <= risk_dist <= 2.2 * atr:
                    return EntrySignal(
                        side="SELL",
                        stop_loss=round(stop, 2),
                        take_profit=round(bar.close - 1.9 * risk_dist, 2),
                        risk_pct=self.risk_pct,
                        breakeven_trigger_r=1.0,
                        max_hold_bars=12,
                        regime="MOMENTUM_ACCEL_BEAR",
                        reason="Tick-volume expansion & negative short-term price acceleration within spread gate",
                        metadata={"volume_source": bar.volume_type, "spread_points": cost_model.spread_points},
                    )

        return None
