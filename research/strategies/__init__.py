"""Strategy registry for Phase 2–6 Python backtesting (UL-01 through UL-05)."""

from typing import Dict, Type
from .base import BaseStrategy
from .ul01_gold_trend import GoldInstitutionalTrend
from .ul02_liquidity_sweep import LiquiditySweepReversal
from .ul03_volume_profile import VolumeProfileMeanReversion
from .ul04_gold_scalper import GoldMomentumScalper
from .ul05_adaptive_regime import AdaptiveMultiRegime

STRATEGY_REGISTRY: Dict[str, Type[BaseStrategy]] = {
    "ul-01-gold-trend": GoldInstitutionalTrend,
    "UL-01": GoldInstitutionalTrend,
    "ul-02-liquidity-sweep": LiquiditySweepReversal,
    "UL-02": LiquiditySweepReversal,
    "ul-03-volume-profile": VolumeProfileMeanReversion,
    "UL-03": VolumeProfileMeanReversion,
    "ul-04-gold-scalper": GoldMomentumScalper,
    "UL-04": GoldMomentumScalper,
    "ul-05-adaptive-regime": AdaptiveMultiRegime,
    "UL-05": AdaptiveMultiRegime,
}


def build_strategy(strategy_id: str, params=None) -> BaseStrategy:
    cls = STRATEGY_REGISTRY.get(strategy_id)
    if not cls:
        raise ValueError(f"Strategy '{strategy_id}' is not registered (available: UL-01..UL-05).")
    return cls(params=params)
