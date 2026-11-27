"""Shared technical, market-structure, and tick-volume-profile indicators.

Notice: When computed from FX/CFD gold candles, Volume Profile operates strictly
on broker tick volume and is tagged as `TICK_VOLUME` rather than centralized exchange volume.
"""

import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from .models import Candle


def ema_series(values: List[float], period: int) -> List[Optional[float]]:
    if period <= 0 or len(values) < period:
        return [None] * len(values)
    k = 2.0 / (period + 1)
    out: List[Optional[float]] = [None] * len(values)
    sma = sum(values[:period]) / period
    out[period - 1] = sma
    prev = sma
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1.0 - k)
        out[i] = prev
    return out


def atr_series(candles: List[Candle], period: int = 14) -> List[Optional[float]]:
    n = len(candles)
    if n < period + 1:
        return [None] * n
    trs = [candles[0].high - candles[0].low]
    for i in range(1, n):
        hi, lo, prev_c = candles[i].high, candles[i].low, candles[i - 1].close
        trs.append(max(hi - lo, abs(hi - prev_c), abs(lo - prev_c)))
    out: List[Optional[float]] = [None] * n
    first = sum(trs[1 : period + 1]) / period
    out[period] = first
    prev = first
    for i in range(period + 1, n):
        prev = ((prev * (period - 1)) + trs[i]) / period
        out[i] = prev
    return out


def adx_series(candles: List[Candle], period: int = 14) -> List[Optional[float]]:
    """Wilder ADX series used for trend-strength and range-regime filtering."""
    n = len(candles)
    if n < period * 2 + 2:
        return [None] * n

    tr = [0.0] * n
    plus_dm = [0.0] * n
    minus_dm = [0.0] * n

    for i in range(1, n):
        up = candles[i].high - candles[i - 1].high
        down = candles[i - 1].low - candles[i].low
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
        tr[i] = max(
            candles[i].high - candles[i].low,
            abs(candles[i].high - candles[i - 1].close),
            abs(candles[i].low - candles[i - 1].close),
        )

    smooth_tr = sum(tr[1 : period + 1])
    smooth_plus = sum(plus_dm[1 : period + 1])
    smooth_minus = sum(minus_dm[1 : period + 1])

    dx_list: List[Optional[float]] = [None] * n
    for i in range(period, n):
        if i > period:
            smooth_tr = smooth_tr - (smooth_tr / period) + tr[i]
            smooth_plus = smooth_plus - (smooth_plus / period) + plus_dm[i]
            smooth_minus = smooth_minus - (smooth_minus / period) + minus_dm[i]
        if smooth_tr <= 0:
            continue
        pdi = 100.0 * (smooth_plus / smooth_tr)
        mdi = 100.0 * (smooth_minus / smooth_tr)
        denom = pdi + mdi
        dx_list[i] = 100.0 * abs(pdi - mdi) / denom if denom > 0 else 0.0

    adx: List[Optional[float]] = [None] * n
    valid_dx = [(idx, v) for idx, v in enumerate(dx_list) if v is not None]
    if len(valid_dx) >= period:
        first_idx = valid_dx[period - 1][0]
        seed = sum(v for _, v in valid_dx[:period]) / period
        adx[first_idx] = seed
        prev = seed
        for idx in range(first_idx + 1, n):
            if dx_list[idx] is not None:
                prev = ((prev * (period - 1)) + dx_list[idx]) / period
                adx[idx] = prev
    return adx


def recent_swing_high(candles: List[Candle], end_idx: int, lookback: int = 30, left: int = 3, right: int = 3) -> Optional[float]:
    start = max(left, end_idx - lookback)
    stop = end_idx - right
    highs = []
    for i in range(start, stop + 1):
        h = candles[i].high
        if all(candles[j].high <= h for j in range(i - left, i + right + 1) if j != i):
            highs.append(h)
    return highs[-1] if highs else None


def recent_swing_low(candles: List[Candle], end_idx: int, lookback: int = 30, left: int = 3, right: int = 3) -> Optional[float]:
    start = max(left, end_idx - lookback)
    stop = end_idx - right
    lows = []
    for i in range(start, stop + 1):
        l = candles[i].low
        if all(candles[j].low >= l for j in range(i - left, i + right + 1) if j != i):
            lows.append(l)
    return lows[-1] if lows else None


def compute_tick_volume_profile(
    candles: List[Candle],
    bins: int = 24,
    value_area_pct: float = 0.70,
) -> Dict:
    """Computes POC, VAH, VAL over a candle window using broker tick volume."""
    if not candles:
        return {"poc": None, "vah": None, "val": None, "volume_source": "TICK_VOLUME"}

    lo = min(c.low for c in candles)
    hi = max(c.high for c in candles)
    if hi <= lo:
        return {"poc": lo, "vah": hi, "val": lo, "volume_source": "TICK_VOLUME"}

    step = (hi - lo) / bins
    hist = [0.0] * bins
    for c in candles:
        typical = (c.high + c.low + c.close) / 3.0
        idx = min(bins - 1, max(0, int((typical - lo) / step)))
        hist[idx] += max(1.0, c.volume)

    poc_idx = max(range(bins), key=lambda i: hist[i])
    poc_price = lo + (poc_idx + 0.5) * step

    total_vol = sum(hist)
    target_vol = total_vol * value_area_pct
    acc_vol = hist[poc_idx]
    lo_idx = poc_idx
    hi_idx = poc_idx

    while acc_vol < target_vol and (lo_idx > 0 or hi_idx < bins - 1):
        left_v = hist[lo_idx - 1] if lo_idx > 0 else -1.0
        right_v = hist[hi_idx + 1] if hi_idx < bins - 1 else -1.0
        if right_v >= left_v and hi_idx < bins - 1:
            hi_idx += 1
            acc_vol += hist[hi_idx]
        elif lo_idx > 0:
            lo_idx -= 1
            acc_vol += hist[lo_idx]
        else:
            break

    val_price = lo + lo_idx * step
    vah_price = lo + (hi_idx + 1) * step
    return {
        "poc": round(poc_price, 2),
        "vah": round(vah_price, 2),
        "val": round(val_price, 2),
        "volume_source": candles[-1].volume_type or "TICK_VOLUME",
    }


def compute_vwap_bands(candles: List[Candle]) -> Dict[str, Optional[float]]:
    if not candles:
        return {"vwap": None, "upper_1": None, "lower_1": None, "upper_2": None, "lower_2": None}
    pv_sum = 0.0
    v_sum = 0.0
    typicals = []
    weights = []
    for c in candles:
        tp = (c.high + c.low + c.close) / 3.0
        w = max(1.0, c.volume)
        pv_sum += tp * w
        v_sum += w
        typicals.append(tp)
        weights.append(w)
    vwap = pv_sum / v_sum if v_sum > 0 else candles[-1].close
    var = sum(w * ((tp - vwap) ** 2) for tp, w in zip(typicals, weights)) / max(1.0, v_sum)
    std = math.sqrt(var)
    return {
        "vwap": round(vwap, 2),
        "std": round(std, 4),
        "upper_1": round(vwap + std, 2),
        "lower_1": round(vwap - std, 2),
        "upper_2": round(vwap + 2.0 * std, 2),
        "lower_2": round(vwap - 2.0 * std, 2),
    }


def utc_hour(ts_ms: int) -> int:
    return datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).hour


def utc_day_key(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).strftime("%Y-%m-%d")
