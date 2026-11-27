"""Strategy registry for Phase 2 Python backtesting."""

from typing import Dict, Type
from .base import BaseStrategy
from .ul01_gold_trend import GoldInstitutionalTrend
from .ul02_liquidity_sweep import LiquiditySweepReversal
from .ul03_volume_profile import VolumeProfileMeanReversion

STRATEGY_REGISTRY: Dict[str, Type[BaseStrategy]] = {
    "ul-01-gold-trend": GoldInstitutionalTrend,
    "UL-01": GoldInstitutionalTrend,
    "ul-02-liquidity-sweep": LiquiditySweepReversal,
    "UL-02": LiquiditySweepReversal,
    "ul-03-volume-profile": VolumeProfileMeanReversion,
    "UL-03": VolumeProfileMeanReversion,
}


def build_strategy(strategy_id: str, params=None) -> BaseStrategy:
    cls = STRATEGY_REGISTRY.get(strategy_id)
    if not cls:
        raise ValueError(f"Strategy '{strategy_id}' is not yet implemented in Phase 2 backtester (available: UL-01, UL-02, UL-03).")
    return cls(params=params)
