"""CLI bridge invoked by Node.js (/api/research/backtest) or standalone terminal runs."""

import json
import sys
from typing import Any, Dict

from research.data_feed import (
    fetch_twelvedata_xauusd,
    generate_synthetic_research_xauusd,
    parse_candles_from_json_rows,
    parse_mt5_csv,
)
from research.engine import BacktestEngine
from research.models import CostModel
from research.strategies import build_strategy


def execute_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    strategy_id = str(payload.get("strategy_id") or "ul-01-gold-trend")
    interval = str(payload.get("interval") or "15m")
    data_source = str(payload.get("data_source") or "SIMULATED_RESEARCH").upper()
    initial_capital = float(payload.get("initial_capital") or 10_000.0)
    mc_simulations = int(payload.get("mc_simulations") or 500)
    params = payload.get("params") or {}
    cost_cfg = payload.get("cost_model") or {}

    if data_source == "TWELVE_DATA":
        candles, feed_meta = fetch_twelvedata_xauusd(
            interval=interval,
            outputsize=int(payload.get("bars") or 1200),
        )
        data_origin = "REAL_MARKET"
    elif data_source == "BROKER_EXPORT_CSV":
        csv_text = payload.get("csv_text") or ""
        candles = parse_mt5_csv(csv_text)
        feed_meta = {
            "data_origin": "REAL_MARKET",
            "provider": "MT5 Broker CSV Export",
            "volume_disclosure": "Uses broker TICK_VOLUME from terminal export.",
        }
        data_origin = "REAL_MARKET"
    elif data_source == "BROKER_EXPORT_JSON":
        candles = parse_candles_from_json_rows(payload.get("candles") or [], volume_type="BROKER_TICK_VOLUME")
        feed_meta = {"data_origin": "REAL_MARKET", "provider": "Broker OHLCV JSON"}
        data_origin = "REAL_MARKET"
    elif data_source == "SIMULATED_RESEARCH":
        candles, feed_meta = generate_synthetic_research_xauusd(
            bars=int(payload.get("bars") or 1200),
            interval=interval,
            seed=int(payload.get("seed") or 101),
        )
        data_origin = "SIMULATED_RESEARCH"
    else:
        raise ValueError(f"Unsupported data_source: {data_source}")

    cost_model = CostModel(
        symbol=str(payload.get("symbol") or "XAUUSD"),
        spread_points=float(cost_cfg.get("spread_points", 25.0)),
        slippage_points=float(cost_cfg.get("slippage_points", 5.0)),
        commission_per_lot_round_turn=float(cost_cfg.get("commission_per_lot_round_turn", 7.0)),
    )

    strategy = build_strategy(strategy_id, params=params)
    engine = BacktestEngine(
        initial_capital=initial_capital,
        cost_model=cost_model,
        mc_simulations=mc_simulations,
    )
    report = engine.run(strategy=strategy, candles=candles, data_origin=data_origin)
    report["feed_meta"] = feed_meta
    report["can_promote_to_backtested"] = data_origin == "REAL_MARKET" and report["metrics"]["total_trades"] >= 10
    return report


def main() -> None:
    raw = sys.stdin.read().strip()
    payload = json.loads(raw) if raw else {}
    try:
        result = execute_request(payload)
        sys.stdout.write(json.dumps({"ok": True, "report": result}))
    except Exception as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
