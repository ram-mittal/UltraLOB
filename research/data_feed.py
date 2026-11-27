"""XAUUSD Historical Data Loaders & Explicit Provenance Enforcement.

Strict rule: Real historical market candles (Twelve Data / MT5 broker export) are
never mixed with synthetic calibration data. When no API key or broker CSV is
provided, synthetic candles may ONLY be generated if `allow_simulated=True`,
and are permanently tagged `data_source='SIMULATED_RESEARCH'`.
"""

import csv
import io
import json
import math
import os
import random
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from .models import Candle

INTERVAL_MS = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
}


def parse_timestamp_ms(raw: str) -> int:
    s = str(raw).strip()
    if s.isdigit():
        val = int(s)
        return val * 1000 if val < 10_000_000_000 else val
    # Handle MT5 CSV format "YYYY.MM.DD HH:MM" or ISO-8601
    s_norm = s.replace(".", "-", 2) if len(s) >= 10 and s[4] == "." and s[7] == "." else s
    if " " in s_norm and "T" not in s_norm:
        s_norm = s_norm.replace(" ", "T", 1)
    if not (s_norm.endswith("Z") or "+" in s_norm[-6:]):
        s_norm += "+00:00"
    dt = datetime.fromisoformat(s_norm)
    return int(dt.astimezone(timezone.utc).timestamp() * 1000)


def parse_candles_from_json_rows(rows: List[Dict], volume_type: str = "TICK_VOLUME") -> List[Candle]:
    candles: List[Candle] = []
    for row in rows:
        ts = row.get("timestamp") or row.get("time") or row.get("datetime")
        if ts is None:
            continue
        ts_ms = int(ts) if isinstance(ts, (int, float)) and ts > 1_000_000_000 else parse_timestamp_ms(str(ts))
        if ts_ms < 10_000_000_000:
            ts_ms *= 1000
        c = Candle(
            timestamp=ts_ms,
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row.get("volume") or row.get("tick_volume") or 0.0),
            volume_type=volume_type,
        )
        if c.validate():
            candles.append(c)
    candles.sort(key=lambda x: x.timestamp)
    return candles


def parse_mt5_csv(csv_text: str) -> List[Candle]:
    """Parses MetaTrader 5 exported bar CSV (tab or comma delimited, `<TICKVOL>` / `volume`)."""
    lines = [ln for ln in csv_text.strip().splitlines() if ln.strip()]
    if len(lines) < 2:
        raise ValueError("CSV contains fewer than 2 rows.")
    delimiter = "\t" if "\t" in lines[0] else ","
    reader = csv.DictReader(io.StringIO("\n".join(lines)), delimiter=delimiter)
    candles: List[Candle] = []
    for row in reader:
        norm = {k.strip("<> ").lower(): (v or "").strip() for k, v in row.items() if k}
        if "date" in norm and "time" in norm:
            ts_ms = parse_timestamp_ms(f"{norm['date']} {norm['time']}")
        else:
            ts_raw = norm.get("datetime") or norm.get("timestamp") or norm.get("time") or norm.get("date")
            if not ts_raw:
                continue
            ts_ms = parse_timestamp_ms(ts_raw)
        vol = norm.get("tickvol") or norm.get("tick_volume") or norm.get("volume") or "1"
        c = Candle(
            timestamp=ts_ms,
            open=float(norm["open"]),
            high=float(norm["high"]),
            low=float(norm["low"]),
            close=float(norm["close"]),
            volume=float(vol),
            volume_type="BROKER_TICK_VOLUME",
        )
        if c.validate():
            candles.append(c)
    candles.sort(key=lambda x: x.timestamp)
    return candles


def fetch_twelvedata_xauusd(interval: str = "15m", outputsize: int = 1000, api_key: Optional[str] = None) -> Tuple[List[Candle], Dict]:
    """Fetches genuine historical XAU/USD OHLC from Twelve Data when API key is configured."""
    key = (api_key or os.environ.get("TWELVE_DATA_API_KEY", "")).strip()
    if not key:
        raise RuntimeError("TWELVE_DATA_API_KEY is not configured. Upload an MT5 broker CSV or pass synthetic research calibration explicitly.")

    td_interval = {"1m": "1min", "5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h"}.get(interval)
    if not td_interval:
        raise ValueError(f"Unsupported interval: {interval}")

    qs = urllib.parse.urlencode({
        "symbol": "XAU/USD",
        "interval": td_interval,
        "outputsize": str(min(5000, max(100, outputsize))),
        "order": "ASC",
        "timezone": "UTC",
        "apikey": key,
    })
    url = f"https://api.twelvedata.com/time_series?{qs}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "UltraLOB-Research/2.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if payload.get("status") == "error" or not isinstance(payload.get("values"), list):
        raise RuntimeError(payload.get("message") or "Twelve Data returned no XAU/USD series.")

    candles = parse_candles_from_json_rows(payload["values"], volume_type="TICK_VOLUME")
    meta = {
        "data_origin": "REAL_MARKET",
        "provider": "Twelve Data (XAU/USD)",
        "volume_disclosure": "FX/Spot Gold feed does not provide centralized exchange depth; volume defaults to tick proxy if omitted.",
    }
    return candles, meta


def generate_synthetic_research_xauusd(
    bars: int = 1500,
    interval: str = "15m",
    seed: int = 101,
    start_price: float = 2650.0,
) -> Tuple[List[Candle], Dict]:
    """Generates regime-switching synthetic XAUUSD bars for deterministic engine testing ONLY.

    Must NEVER be labeled as REAL_MARKET or used to promote strategies beyond RESEARCH.
    """
    rng = random.Random(seed)
    step_ms = INTERVAL_MS.get(interval, 900_000)
    # Start Monday 00:00 UTC so session boundaries align cleanly
    start_ts = 1_735_776_000_000  # 2025-01-02 00:00:00 UTC

    candles: List[Candle] = []
    price = start_price
    regimes = ["TREND_UP", "RANGE", "TREND_DOWN", "VOLATILE"]
    regime_idx = 0

    for i in range(bars):
        if i % 180 == 0:
            regime_idx = (regime_idx + 1) % len(regimes)
        reg = regimes[regime_idx]
        ts = start_ts + i * step_ms
        hour_utc = datetime.fromtimestamp(ts / 1000.0, tz=timezone.utc).hour

        # Higher tick volume & volatility during London/NY sessions (07-20 UTC)
        session_mult = 1.6 if 7 <= hour_utc <= 20 else 0.75
        if reg == "TREND_UP":
            drift = 0.00022
            sigma = 0.0014 * session_mult
        elif reg == "TREND_DOWN":
            drift = -0.00020
            sigma = 0.0014 * session_mult
        elif reg == "RANGE":
            mean_anchor = start_price + math.sin(i / 45.0) * 14.0
            drift = (mean_anchor - price) / price * 0.08
            sigma = 0.0009 * session_mult
        else:
            drift = 0.0
            sigma = 0.0022 * session_mult

        ret = drift + rng.gauss(0.0, sigma)
        open_p = price
        close_p = max(100.0, open_p * math.exp(ret))
        wick_up = abs(rng.gauss(0.0, sigma * 0.65)) * open_p
        wick_dn = abs(rng.gauss(0.0, sigma * 0.65)) * open_p
        high_p = max(open_p, close_p) + wick_up
        low_p = max(50.0, min(open_p, close_p) - wick_dn)
        tick_vol = max(50.0, round(rng.uniform(220, 950) * session_mult * (1.4 if abs(ret) > sigma else 1.0), 1))

        candles.append(Candle(
            timestamp=ts,
            open=round(open_p, 2),
            high=round(high_p, 2),
            low=round(low_p, 2),
            close=round(close_p, 2),
            volume=tick_vol,
            volume_type="SYNTHETIC_TICK_VOLUME",
        ))
        price = close_p

    meta = {
        "data_origin": "SIMULATED_RESEARCH",
        "provider": "UltraLOB Synthetic Regime Generator (Calibration Only)",
        "warning": "SIMULATED_RESEARCH data — never valid as empirical historical performance or for live promotion.",
    }
    return candles, meta


def aggregate_candles(candles: List[Candle], target_seconds: int) -> List[Candle]:
    """Resamples lower-timeframe candles into closed higher-timeframe bars (e.g. M15 -> H1/H4)."""
    if not candles:
        return []
    bucket_ms = target_seconds * 1000
    buckets: Dict[int, List[Candle]] = {}
    for c in candles:
        b = (c.timestamp // bucket_ms) * bucket_ms
        buckets.setdefault(b, []).append(c)

    result: List[Candle] = []
    for b in sorted(buckets.keys()):
        group = buckets[b]
        result.append(Candle(
            timestamp=b,
            open=group[0].open,
            high=max(x.high for x in group),
            low=min(x.low for x in group),
            close=group[-1].close,
            volume=sum(x.volume for x in group),
            volume_type=group[0].volume_type,
        ))
    return result
