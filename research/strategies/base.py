"""Base strategy interface for Phase 2 quantitative strategies."""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from ..models import Candle, CostModel


@dataclass
class EntrySignal:
    side: str  # "BUY" or "SELL"
    stop_loss: float
    take_profit: float
    risk_pct: float = 0.5
    partial_tp_r: Optional[float] = None  # Book partial at this R-multiple
    partial_fraction: float = 0.5
    breakeven_trigger_r: Optional[float] = None
    trail_atr_mult: Optional[float] = None
    max_hold_bars: Optional[int] = None
    regime: str = "UNKNOWN"
    reason: str = ""
    metadata: Optional[Dict[str, Any]] = None


class BaseStrategy:
    strategy_id: str = "base"
    code: str = "UL-00"
    version: str = "1.0.0"
    name: str = "Base Strategy"
    supported_timeframes: List[str] = ["15m"]

    def __init__(self, params: Optional[Dict[str, Any]] = None):
        self.params = params or {}

    def prepare(self, candles: List[Candle]) -> None:
        """Optional indicator precomputation over full candle history (strictly causal at index i)."""
        pass

    def on_bar(self, idx: int, candles: List[Candle], cost_model: CostModel) -> Optional[EntrySignal]:
        """Evaluates bar `idx` using ONLY candles[0..idx]. Returns EntrySignal or None."""
        raise NotImplementedError
