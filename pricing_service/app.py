import hmac
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

APP_VERSION = "1.0.0"
PRICER_BIN = Path(os.getenv("ULTRALOB_PRICER_BIN", "/app/ultralob_pricer"))
PRICING_API_KEY = os.getenv("PRICING_API_KEY", "")
PRICER_TIMEOUT_SECONDS = int(os.getenv("PRICER_TIMEOUT_SECONDS", "120"))

app = FastAPI(
    title="UltraLOB Quant Pricing API",
    version=APP_VERSION,
    description="HTTP service for the UltraLOB C++ Monte Carlo option pricer.",
)


class PricingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    spot: float = Field(default=100.0, gt=0.0, le=1_000_000_000)
    strike: float = Field(default=100.0, gt=0.0, le=1_000_000_000)
    risk_free_rate: float = Field(default=0.05, ge=-1.0, le=1.0)
    dividend_yield: float = Field(default=0.0, ge=-1.0, le=1.0)
    volatility: float = Field(default=0.20, ge=0.0, le=5.0)
    maturity_years: float = Field(default=1.0, gt=0.0, le=100.0)
    paths: int = Field(default=1_000_000, ge=4, le=50_000_000)
    seed: int = Field(default=42, ge=0, le=18_446_744_073_709_551_615)
    backend: Literal["auto", "cpu", "cuda"] = "auto"

    @field_validator("paths")
    @classmethod
    def paths_must_be_even(cls, value: int) -> int:
        if value % 2:
            raise ValueError("paths must be even because simulations use antithetic pairs")
        return value


def verify_api_key(authorization: str | None) -> None:
    if not PRICING_API_KEY:
        return
    expected = f"Bearer {PRICING_API_KEY}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing pricing API token")


@app.get("/health")
def health():
    return {
        "status": "ok" if PRICER_BIN.is_file() and os.access(PRICER_BIN, os.X_OK) else "degraded",
        "service": "ultralob-pricing",
        "version": APP_VERSION,
        "pricer_available": PRICER_BIN.is_file() and os.access(PRICER_BIN, os.X_OK),
        "cuda_build_enabled": os.getenv("ULTRALOB_CUDA_ENABLED", "false").lower() == "true",
    }


@app.post("/pricing/monte-carlo")
def price_monte_carlo(
    request: PricingRequest,
    authorization: str | None = Header(default=None),
):
    verify_api_key(authorization)
    if not PRICER_BIN.is_file() or not os.access(PRICER_BIN, os.X_OK):
        raise HTTPException(status_code=503, detail="Monte Carlo pricing binary is not installed")

    args = [
        str(PRICER_BIN),
        "--spot", str(request.spot),
        "--strike", str(request.strike),
        "--rate", str(request.risk_free_rate),
        "--dividend", str(request.dividend_yield),
        "--vol", str(request.volatility),
        "--maturity", str(request.maturity_years),
        "--paths", str(request.paths),
        "--seed", str(request.seed),
        "--backend", request.backend,
        "--json",
    ]

    started = time.perf_counter()
    try:
        completed = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=PRICER_TIMEOUT_SECONDS,
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Pricing request exceeded the service timeout")
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"Could not execute pricing engine: {exc}")

    if completed.returncode != 0:
        detail = completed.stderr.strip() or "Monte Carlo engine returned an error"
        raise HTTPException(status_code=422, detail=detail[-1500:])

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Pricing engine returned invalid JSON")

    payload["service_elapsed_ms"] = (time.perf_counter() - started) * 1000.0
    payload["model"] = "risk-neutral-gbm-european-vanilla"
    payload["variance_reduction"] = "antithetic-variates"
    payload["gpu_utilization"] = None
    return payload
