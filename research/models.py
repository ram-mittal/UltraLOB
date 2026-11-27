"""Core data structures for OHLCV candles, transaction cost models, trades, and reports."""

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class Candle:
    timestamp: int  # Unix epoch milliseconds (UTC)
    open: float
    high: float
    low: float
    close: float
    volume: float  # For MT5/FX/CFD gold feeds, labeled explicitly as tick volume
    volume_type: str = "TICK_VOLUME"

    def validate(self) -> bool:
        return (
            self.timestamp > 0
            and self.open > 0
            and self.high > 0
            and self.low > 0
            and self.close > 0
            and self.high >= max(self.open, self.close, self.low)
            and self.low <= min(self.open, self.close, self.high)
            and self.volume >= 0
        )


@dataclass
class CostModel:
    symbol: str = "XAUUSD"
    contract_size: float = 100.0  # Standard 1.00 lot = 100 troy oz XAUUSD
    point: float = 0.01
    spread_points: float = 25.0  # $0.25 spread in gold points
    slippage_points: float = 5.0  # $0.05 slippage per side
    commission_per_lot_round_turn: float = 7.0  # USD per 1.00 lot round turn
    swap_long_per_lot_daily: float = -8.5  # USD overnight swap per 1.00 lot
    swap_short_per_lot_daily: float = 2.0
    volume_min: float = 0.01
    volume_max: float = 50.0
    volume_step: float = 0.01
    execution_delay_bars: int = 1  # Enforces next-bar execution to avoid lookahead

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Trade:
    id: str
    strategy_id: str
    symbol: str
    side: str  # "BUY" or "SELL"
    entry_time: int
    exit_time: int
    entry_price: float
    exit_price: float
    stop_loss: float
    take_profit: float
    lots: float
    gross_pnl_usd: float
    commission_usd: float
    swap_usd: float
    slippage_usd: float
    net_pnl_usd: float
    r_multiple: float
    holding_minutes: float
    exit_reason: str  # "TP", "SL", "TRAILING_SL", "PARTIAL_TP", "TIME_EXIT", "REGIME_EXIT", "EOD"
    regime: str = "UNKNOWN"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
