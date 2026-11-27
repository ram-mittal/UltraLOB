"""Unit tests for Phase 2 Python quantitative backtesting engine, UL-01..UL-03, and MC stress."""

import unittest

from research.cli import execute_request
from research.data_feed import generate_synthetic_research_xauusd, parse_mt5_csv
from research.engine import BacktestEngine
from research.models import Candle, CostModel
from research.strategies import build_strategy
from research.strategies.ul02_liquidity_sweep import LiquiditySweepReversal


class TestResearchEngine(unittest.TestCase):
    def test_mt5_csv_parser_labels_tick_volume(self):
        csv_data = (
            "<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n"
            "2025.01.02\t08:00:00\t2650.00\t2652.50\t2649.10\t2651.80\t420\t0\t25\n"
            "2025.01.02\t08:15:00\t2651.80\t2654.00\t2651.00\t2653.20\t515\t0\t25\n"
        )
        candles = parse_mt5_csv(csv_data)
        self.assertEqual(len(candles), 2)
        self.assertEqual(candles[0].volume_type, "BROKER_TICK_VOLUME")
        self.assertEqual(candles[1].close, 2653.20)

    def test_synthetic_research_cannot_promote_to_backtested(self):
        res = execute_request({
            "strategy_id": "ul-01-gold-trend",
            "data_source": "SIMULATED_RESEARCH",
            "bars": 1200,
            "mc_simulations": 200,
        })
        self.assertEqual(res["data_origin"], "SIMULATED_RESEARCH")
        self.assertFalse(res["can_promote_to_backtested"])
        self.assertIn("monte_carlo", res)
        self.assertIn("out_of_sample", res)
        self.assertIsInstance(res["walk_forward"], list)

    def test_ul01_through_ul05_run_end_to_end_with_realistic_costs(self):
        candles, meta = generate_synthetic_research_xauusd(bars=1500, interval="15m", seed=42)
        self.assertEqual(meta["data_origin"], "SIMULATED_RESEARCH")
        engine = BacktestEngine(initial_capital=10_000.0, cost_model=CostModel(), mc_simulations=300)

        for sid in [
            "ul-01-gold-trend",
            "ul-02-liquidity-sweep",
            "ul-03-volume-profile",
            "ul-04-gold-scalper",
            "ul-05-adaptive-regime",
        ]:
            strat = build_strategy(sid)
            report = engine.run(strat, candles, data_origin="SIMULATED_RESEARCH")
            self.assertEqual(report["strategy_id"], sid)
            self.assertGreaterEqual(report["metrics"]["total_trades"], 1)
            self.assertLessEqual(report["metrics"]["max_drawdown_pct"], 0.0)
            self.assertEqual(report["monte_carlo"]["simulations"], 300)
            # Confirm costs were charged whenever trades occurred
            for t in report["trades"]:
                self.assertGreater(t["commission_usd"], 0.0)

    def test_ul02_rejects_raw_wick_without_displacement(self):
        candles, _ = generate_synthetic_research_xauusd(bars=60, interval="15m", seed=7)
        strat = LiquiditySweepReversal()
        strat.prepare(candles)
        # Even at the exact sweep bar, UL-02 never enters on the sweep wick candle alone
        for idx in range(len(candles)):
            sig = strat.on_bar(idx, candles[: idx + 1], CostModel())
            if sig is not None:
                self.assertIn("MSS", sig.reason)


if __name__ == "__main__":
    unittest.main()
