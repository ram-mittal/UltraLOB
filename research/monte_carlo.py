"""Monte Carlo trade-sequence resampling & risk-of-ruin stress testing."""

import random
from typing import Any, Dict, List
from .models import Trade


def _quantile(sorted_vals: List[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    pos = (len(sorted_vals) - 1) * p
    lo = int(pos)
    hi = min(len(sorted_vals) - 1, lo + 1)
    frac = pos - lo
    return sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac


def run_trade_sequence_monte_carlo(
    trades: List[Trade],
    initial_capital: float = 10_000.0,
    simulations: int = 1000,
    ruin_drawdown_pct: float = 20.0,
    slippage_stress_multiplier: float = 1.5,
    seed: int = 42,
) -> Dict[str, Any]:
    """Resamples historical trade sequence with replacement to measure drawdown tail risk."""
    if not trades:
        return {
            "data_origin": "SIMULATED_RESEARCH",
            "simulations": 0,
            "note": "No trades available to resample.",
            "max_drawdown_p50_pct": 0.0,
            "max_drawdown_p95_pct": 0.0,
            "max_drawdown_p99_pct": 0.0,
            "prob_breach_ruin_pct": 0.0,
            "terminal_equity_p05": initial_capital,
            "terminal_equity_p50": initial_capital,
            "terminal_equity_p95": initial_capital,
        }

    rng = random.Random(seed)
    n_trades = len(trades)
    base_returns = []
    stressed_returns = []
    for t in trades:
        # Convert each trade's net P&L and stressed-slippage P&L to fractional return vs initial capital
        # Using fractional R * assumed risk per trade preserves path scaling properly
        extra_slip = max(0.0, (slippage_stress_multiplier - 1.0) * (t.slippage_usd + t.commission_usd * 0.25))
        base_returns.append(t.net_pnl_usd / initial_capital)
        stressed_returns.append((t.net_pnl_usd - extra_slip) / initial_capital)

    terminals: List[float] = []
    max_dds: List[float] = []
    stressed_max_dds: List[float] = []
    ruin_breaches = 0

    for _ in range(simulations):
        eq = initial_capital
        peak = eq
        max_dd = 0.0
        breached = False

        seq = rng.choices(range(n_trades), k=n_trades)
        for idx in seq:
            eq = max(0.0, eq * (1.0 + base_returns[idx]))
            if eq > peak:
                peak = eq
            dd = ((peak - eq) / peak) * 100.0 if peak > 0 else 100.0
            if dd > max_dd:
                max_dd = dd
            if dd >= ruin_drawdown_pct:
                breached = True

        # Stressed execution scenario (higher slippage)
        s_eq = initial_capital
        s_peak = s_eq
        s_max_dd = 0.0
        for idx in seq:
            s_eq = max(0.0, s_eq * (1.0 + stressed_returns[idx]))
            if s_eq > s_peak:
                s_peak = s_eq
            s_dd = ((s_peak - s_eq) / s_peak) * 100.0 if s_peak > 0 else 100.0
            if s_dd > s_max_dd:
                s_max_dd = s_dd

        terminals.append(eq)
        max_dds.append(max_dd)
        stressed_max_dds.append(s_max_dd)
        if breached:
            ruin_breaches += 1

    terminals.sort()
    max_dds.sort()
    stressed_max_dds.sort()

    return {
        "data_origin": "SIMULATED_RESEARCH",
        "simulations": simulations,
        "trade_count_per_path": n_trades,
        "ruin_threshold_pct": ruin_drawdown_pct,
        "slippage_stress_multiplier": slippage_stress_multiplier,
        "terminal_equity_p05": round(_quantile(terminals, 0.05), 2),
        "terminal_equity_p50": round(_quantile(terminals, 0.50), 2),
        "terminal_equity_p95": round(_quantile(terminals, 0.95), 2),
        "max_drawdown_p50_pct": round(-_quantile(max_dds, 0.50), 2),
        "max_drawdown_p95_pct": round(-_quantile(max_dds, 0.95), 2),
        "max_drawdown_p99_pct": round(-_quantile(max_dds, 0.99), 2),
        "stressed_max_drawdown_p95_pct": round(-_quantile(stressed_max_dds, 0.95), 2),
        "prob_breach_ruin_pct": round((ruin_breaches / simulations) * 100.0, 2),
    }
