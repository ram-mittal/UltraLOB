import os
from pathlib import Path
import sys

BUILD_DIR = Path(os.environ.get("ULTRALOB_TEST_BUILD_DIR", "build")).resolve()
os.environ["ULTRALOB_PRICER_LIBRARY"] = str(BUILD_DIR / "libultralob_quant.so")
os.environ["ULTRALOB_CUDA_ENABLED"] = "false"
os.environ["PRICING_API_KEY"] = "ultralob-ci-test-token"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402
import app as pricing_app  # noqa: E402

client = TestClient(pricing_app.app)


def test_health_reports_native_library():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["native_library_available"] is True


def test_cpu_pricing_endpoint_returns_prices_and_intervals():
    response = client.post(
        "/pricing/monte-carlo",
        headers={"Authorization": "Bearer ultralob-ci-test-token"},
        json={
            "spot": 100,
            "strike": 100,
            "risk_free_rate": 0.05,
            "dividend_yield": 0,
            "volatility": 0.2,
            "maturity_years": 1,
            "paths": 20000,
            "seed": 42,
            "backend": "cpu",
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["backend"] == "CPU"
    assert result["paths"] == 20000
    assert result["call"]["price"] > 0
    assert result["put"]["price"] > 0
    assert result["call"]["confidence_low_95"] <= result["call"]["confidence_high_95"]
    assert result["gpu_utilization"] is None


def test_pricing_rejects_odd_path_count():
    response = client.post(
        "/pricing/monte-carlo",
        headers={"Authorization": "Bearer ultralob-ci-test-token"},
        json={"paths": 999},
    )
    assert response.status_code == 422


def test_pricing_requires_configured_api_key():
    response = client.post("/pricing/monte-carlo", json={"paths": 20000})
    assert response.status_code == 401


def test_pricing_rejects_unknown_inputs():
    response = client.post(
        "/pricing/monte-carlo",
        headers={"Authorization": "Bearer ultralob-ci-test-token"},
        json={"paths": 20000, "unexpected": "field"},
    )
    assert response.status_code == 422
