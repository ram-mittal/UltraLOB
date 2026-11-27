"""UL-01: Gold Institutional Trend (XAUUSD — H4/H1 Regime + M15 Execution)."""

from typing import Dict, List, Optional
from ..data_feed import aggregate_candles
from ..indicators import adx_series, atr_series, ema_series, recent_swing_high, recent_swing_low, utc_hour
from ..models import Candle, CostModel
from .base import BaseStrategy, EntrySignal


class GoldInstitutionalTrend(BaseStrategy):
    strategy_id = "ul-01-gold-trend"
    code = "UL-01"
    version = "1.0.0"
    name = "UL-01: Gold Institutional Trend"
    supported_timeframes = ["4h", "1h", "15m"]

    def __init__(self, params: Optional[Dict] = None):
        super().__init__(params)
        self.risk_pct = float(self.params.get("risk_per_trade_pct", 0.5))
        self.min_adx = float(self.params.get("min_adx", 18.0))
        self.max_spread_points = float(self.params.get("max_spread_points", 45.0))
        self._m15_ema_fast: List[Optional[float]] = []
        self._m15_ema_slow: List[Optional[float]] = []
        self._m15_atr: List[Optional[float]] = []
        self._m15_adx: List[Optional[float]] = []
        self._h1_candles: List[Candle] = []
        self._h1_ema_fast: List[Optional[float]] = []
        self._h1_ema_slow: List[Optional[float]] = []
        self._h4_candles: List[Candle] = []
        self._h4_ema_fast: List[Optional[float]] = []
        self._h4_ema_slow: List[Optional[float]] = []

    def prepare(self, candles: List[Candle]) -> None:
        closes = [c.close for c in candles]
        self._m15_ema_fast = ema_series(closes, 12)
        self._m15_ema_slow = ema_series(closes, 26)
        self._m15_atr = atr_series(candles, 14)
        self._m15_adx = adx_series(candles, 14)

        self._h1_candles = aggregate_candles(candles, 3600)
        h1_closes = [c.close for c in self._h1_candles]
        self._h1_ema_fast = ema_series(h1_closes, 12)
        self._h1_ema_slow = ema_series(h1_closes, 26)

        self._h4_candles = aggregate_candles(candles, 14_400)
        h4_closes = [c.close for c in self._h4_candles]
        self._h4_ema_fast = ema_series(h4_closes, 8)
        self._h4_ema_slow = ema_series(h4_closes, 21)

    def _latest_closed_htf_bias(self, htf_candles: List[Candle], ema_f: List[Optional[float]], ema_s: List[Optional[float]], cur_ts: int, bucket_ms: int) -> Optional[str]:
        # Only examine bars whose closing timestamp <= cur_ts (no lookahead into active bar)
        idx = -1
        for k, hc in enumerate(htf_candles):
            if hc.timestamp + bucket_ms <= cur_ts:
                idx = k
            else:
                break
        if idx < 1 or ema_f[idx] is None or ema_s[idx] is None:
            return None
        if ema_f[idx] > ema_s[idx] and htf_candles[idx].close > ema_f[idx]:
            return "BULLISH"
        if ema_f[idx] < ema_s[idx] and htf_candles[idx].close < ema_f[idx]:
            return "BEARISH"
        return "NEUTRAL"

    def on_bar(self, idx: int, candles: List[Candle], cost_model: CostModel) -> Optional[EntrySignal]:
        if idx < 60:
            return None
        if cost_model.spread_points > self.max_spread_points:
            return None

        bar = candles[idx]
        hour = utc_hour(bar.timestamp)
        if not (7 <= hour <= 20):  # Active London + NY sessions
            return None

        atr = self._m15_atr[idx]
        adx = self._m15_adx[idx]
        ef = self._m15_ema_fast[idx]
        es = self._m15_ema_slow[idx]
        if atr is None or adx is None or ef is None or es is None or atr <= 0:
            return None

        # Volatility & trend-strength filter (avoid dead chop and extreme spikes)
        atr_pct = (atr / bar.close) * 100.0
        if adx < self.min_adx or atr_pct < 0.04 or atr_pct > 1.2:
            return None

        h1_bias = self._latest_closed_htf_bias(self._h1_candles, self._h1_ema_fast, self._h1_ema_slow, bar.timestamp, 3_600_000)
        h4_bias = self._latest_closed_htf_bias(self._h4_candles, self._h4_ema_fast, self._h4_ema_slow, bar.timestamp, 14_400_000)

        # Require H1 directional bias, and disallow fighting opposite H4 bias
        if h1_bias not in ("BULLISH", "BEARISH"):
            return None
        if h4_bias in ("BULLISH", "BEARISH") and h4_bias != h1_bias:
            return None

        prev = candles[idx - 1]
        swing_hi = recent_swing_high(candles, idx - 1, lookback=32, left=3, right=2)
        swing_lo = recent_swing_low(candles, idx - 1, lookback=32, left=3, right=2)

        # Bullish breakout retest or momentum continuation
        if h1_bias == "BULLISH" and ef > es and bar.close > ef:
            retest_or_break = (
                (swing_hi is not None and prev.close <= swing_hi and bar.close > swing_hi)
                or (bar.low <= ef * 1.0005 and bar.close > bar.open and bar.close > prev.high)
            )
            if retest_or_break:
                struct_sl = (swing_lo - 0.5 * atr) if swing_lo is not None else (bar.close - 1.8 * atr)
                sl = min(bar.close - 1.2 * atr, max(bar.close - 3.0 * atr, struct_sl))
                risk_dist = bar.close - sl
                if risk_dist > 0.5 * atr:
                    return EntrySignal(
                        side="BUY",
                        stop_loss=round(sl, 2),
                        take_profit=round(bar.close + 2.8 * risk_dist, 2),
                        risk_pct=self.risk_pct,
                        partial_tp_r=1.5,
                        partial_fraction=0.5,
                        breakeven_trigger_r=1.2,
                        max_hold_bars=96,
                        regime="TREND_BULLISH",
                        reason="H1/H4 bullish alignment with M15 breakout/retest continuation",
                    )

        # Bearish breakout retest or momentum continuation
        if h1_bias == "BEARISH" and ef < es and bar.close < ef:
            retest_or_break = (
                (swing_lo is not None and prev.close >= swing_lo and bar.close < swing_lo)
                or (bar.high >= ef * 0.9995 and bar.close < bar.open and bar.close < prev.low)
            )
            if retest_or_break:
                struct_sl = (swing_hi + 0.5 * atr) if swing_hi is not None else (bar.close + 1.8 * atr)
                sl = max(bar.close + 1.2 * atr, min(bar.close + 3.0 * atr, struct_sl))
                risk_dist = sl - bar.close
                if risk_dist > 0.5 * atr:
                    return EntrySignal(
                        side="SELL",
                        stop_loss=round(sl, 2),
                        take_profit=round(bar.close - 2.8 * risk_dist, 2),
                        risk_pct=self.risk_pct,
                        partial_tp_r=1.5,
                        partial_fraction=0.5,
                        breakeven_trigger_r=1.2,
                        max_hold_bars=96,
                        regime="TREND_BEARISH",
                        reason="H1/H4 bearish alignment with M15 breakdown/retest continuation",
                    )

        return None
