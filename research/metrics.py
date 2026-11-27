"""Unified institutional performance metrics for backtests & forward tests."""

import math
from typing import Any, Dict, List, Optional
from .models import Trade


def _annualization_factor(candles_span_days: float) -> float:
    if candles_span_days <= 0:
        return 1.0
    return 365.25 / candles_span_days


def calculate_metrics(
    trades: List[Trade],
    initial_capital: float,
    equity_curve: List[Dict[str, Any]],
    start_ts: int,
    end_ts: int,
) -> Dict[str, Any]:
    """Computes realistic institutional metrics with zero fabricated values."""
    total_trades = len(trades)
    if initial_capital <= 0:
        raise ValueError("initial_capital must be positive")

    if total_trades == 0:
        return {
            "total_return_pct": 0.0,
            "cagr_pct": 0.0,
            "sharpe_ratio": None,
            "sortino_ratio": None,
            "max_drawdown_pct": 0.0,
            "profit_factor": None,
            "win_rate_pct": 0.0,
            "avg_profit_trade": None,
            "avg_loss_trade": None,
            "expectancy_usd": 0.0,
            "expectancy_r": 0.0,
            "total_trades": 0,
            "avg_holding_minutes": 0.0,
            "max_consecutive_losses": 0,
            "risk_of_ruin_pct": None,
            "final_equity": round(initial_capital, 2),
        }

    net_pnls = [t.net_pnl_usd for t in trades]
    wins = [p for p in net_pnls if p > 0]
    losses = [p for p in net_pnls if p < 0]

    final_equity = equity_curve[-1]["equity"] if equity_curve else (initial_capital + sum(net_pnls))
    total_return_pct = ((final_equity - initial_capital) / initial_capital) * 100.0

    span_days = max(1.0, (end_ts - start_ts) / 86_400_000.0) if end_ts > start_ts else 1.0
    years = span_days / 365.25
    if years >= 0.02 and final_equity > 0:
        cagr_pct = ((final_equity / initial_capital) ** (1.0 / years) - 1.0) * 100.0
    else:
        cagr_pct = total_return_pct

    win_rate_pct = (len(wins) / total_trades) * 100.0
    avg_win = (sum(wins) / len(wins)) if wins else None
    avg_loss = (sum(losses) / len(losses)) if losses else None  # Negative number

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    if gross_loss > 0:
        profit_factor: Optional[float] = round(gross_profit / gross_loss, 3)
    elif gross_profit > 0:
        profit_factor = 99.99  # Zero losing trades in sample
    else:
        profit_factor = 0.0

    expectancy_usd = sum(net_pnls) / total_trades
    expectancy_r = sum(t.r_multiple for t in trades) / total_trades
    avg_holding_minutes = sum(t.holding_minutes for t in trades) / total_trades

    # Max drawdown from equity curve
    peak = initial_capital
    max_dd_pct = 0.0
    for pt in equity_curve:
        eq = pt["equity"]
        if eq > peak:
            peak = eq
        if peak > 0:
            dd = ((peak - eq) / peak) * 100.0
            if dd > max_dd_pct:
                max_dd_pct = dd

    # Max consecutive losses
    max_consec = 0
    cur_consec = 0
    for p in net_pnls:
        if p < 0:
            cur_consec += 1
            max_consec = max(max_consec, cur_consec)
        else:
            cur_consec = 0

    # Sharpe & Sortino from per-trade percentage returns annualized by trade frequency
    trade_returns = []
    running_eq = initial_capital
    for p in net_pnls:
        base = max(1e-9, running_eq)
        trade_returns.append(p / base)
        running_eq += p

    trades_per_year = total_trades * _annualization_factor(span_days)
    sharpe_ratio = None
    sortino_ratio = None
    if len(trade_returns) >= 2:
        mean_r = sum(trade_returns) / len(trade_returns)
        var_r = sum((r - mean_r) ** 2 for r in trade_returns) / (len(trade_returns) - 1)
        std_r = math.sqrt(var_r)
        if std_r > 1e-12:
            sharpe_ratio = round((mean_r / std_r) * math.sqrt(trades_per_year), 3)

        downside = [min(0.0, r) for r in trade_returns]
        downside_var = sum(d * d for d in downside) / len(downside)
        downside_std = math.sqrt(downside_var)
        if downside_std > 1e-12:
            sortino_ratio = round((mean_r / downside_std) * math.sqrt(trades_per_year), 3)

    # Risk of Ruin (Kaufman / Balsara approximation using empirical win rate & payoff ratio)
    risk_of_ruin_pct = estimate_risk_of_ruin(
        win_prob=len(wins) / total_trades,
        avg_win=avg_win or 0.0,
        avg_loss=abs(avg_loss) if avg_loss is not None else 0.0,
        risk_fraction_per_trade=0.005,
        ruin_drawdown_fraction=0.25,
    )

    return {
        "total_return_pct": round(total_return_pct, 2),
        "cagr_pct": round(cagr_pct, 2),
        "sharpe_ratio": sharpe_ratio,
        "sortino_ratio": sortino_ratio,
        "max_drawdown_pct": round(-max_dd_pct, 2),  # Negative percentage convention
        "profit_factor": profit_factor,
        "win_rate_pct": round(win_rate_pct, 2),
        "avg_profit_trade": round(avg_win, 2) if avg_win is not None else None,
        "avg_loss_trade": round(avg_loss, 2) if avg_loss is not None else None,
        "expectancy_usd": round(expectancy_usd, 2),
        "expectancy_r": round(expectancy_r, 3),
        "total_trades": total_trades,
        "avg_holding_minutes": round(avg_holding_minutes, 1),
        "max_consecutive_losses": max_consec,
        "risk_of_ruin_pct": round(risk_of_ruin_pct, 2) if risk_of_ruin_pct is not None else None,
        "final_equity": round(final_equity, 2),
    }


def estimate_risk_of_ruin(
    win_prob: float,
    avg_win: float,
    avg_loss: float,
    risk_fraction_per_trade: float = 0.005,
    ruin_drawdown_fraction: float = 0.25,
) -> Optional[float]:
    """Conservative risk-of-ruin estimate for fixed fractional risk."""
    if avg_loss <= 0:
        return 0.0 if win_prob > 0 else 100.0
    payoff = avg_win / avg_loss
    edge = win_prob * payoff - (1.0 - win_prob)
    if edge <= 0:
        return 100.0
    units = max(1.0, ruin_drawdown_fraction / max(1e-4, risk_fraction_per_trade))
    z = (1.0 - edge) / (1.0 + edge)
    if z <= 0:
        return 0.0
    ror = (z ** units) * 100.0
    return min(100.0, max(0.0, ror))
