import ctypes
import hmac
import os
from pathlib import Path
from threading import Lock
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

APP_VERSION = "1.1.0"
LIBRARY_PATH = Path(os.getenv("ULTRALOB_PRICER_LIBRARY", "/app/build/libultralob_quant.so"))
PRICING_API_KEY = os.getenv("PRICING_API_KEY", "")
CUDA_BUILD_ENABLED = os.getenv("ULTRALOB_CUDA_ENABLED", "false").lower() == "true"

app = FastAPI(
    title="UltraLOB Quant Pricing API",
    version=APP_VERSION,
    description="In-process HTTP wrapper around the UltraLOB C++ Monte Carlo pricing library.",
)


class NativeRequest(ctypes.Structure):
    _fields_ = [
        ("spot", ctypes.c_double),
        ("strike", ctypes.c_double),
        ("risk_free_rate", ctypes.c_double),
        ("dividend_yield", ctypes.c_double),
        ("volatility", ctypes.c_double),
        ("maturity_years", ctypes.c_double),
        ("paths", ctypes.c_uint64),
        ("seed", ctypes.c_uint64),
        ("backend", ctypes.c_int),
    ]


class NativeResult(ctypes.Structure):
    _fields_ = [
        ("call_price", ctypes.c_double),
        ("call_black_scholes", ctypes.c_double),
        ("call_standard_error", ctypes.c_double),
        ("call_confidence_low_95", ctypes.c_double),
        ("call_confidence_high_95", ctypes.c_double),
        ("put_price", ctypes.c_double),
        ("put_black_scholes", ctypes.c_double),
        ("put_standard_error", ctypes.c_double),
        ("put_confidence_low_95", ctypes.c_double),
        ("put_confidence_high_95", ctypes.c_double),
        ("elapsed_ms", ctypes.c_double),
        ("paths_per_second", ctypes.c_double),
        ("paths", ctypes.c_uint64),
        ("seed", ctypes.c_uint64),
        ("backend", ctypes.c_int),
    ]


def load_native_library():
    if not LIBRARY_PATH.is_file():
        return None
    library = ctypes.CDLL(str(LIBRARY_PATH))
    library.ultralob_monte_carlo_price.argtypes = [
        ctypes.POINTER(NativeRequest),
        ctypes.POINTER(NativeResult),
        ctypes.POINTER(ctypes.c_char),
        ctypes.c_size_t,
    ]
    library.ultralob_monte_carlo_price.restype = ctypes.c_int
    return library


try:
    NATIVE_LIBRARY = load_native_library()
    NATIVE_LOAD_ERROR = None
except OSError as exc:
    NATIVE_LIBRARY = None
    NATIVE_LOAD_ERROR = str(exc)

# One pricing job at a time prevents concurrent requests from overcommitting
# GPU memory and makes benchmark timings easier to interpret.
PRICING_LOCK = Lock()


class PricingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    spot: float = Field(default=100.0, gt=0.0, le=1_000_000_000, allow_inf_nan=False)
    strike: float = Field(default=100.0, gt=0.0, le=1_000_000_000, allow_inf_nan=False)
    risk_free_rate: float = Field(default=0.05, ge=-1.0, le=1.0, allow_inf_nan=False)
    dividend_yield: float = Field(default=0.0, ge=-1.0, le=1.0, allow_inf_nan=False)
    volatility: float = Field(default=0.20, ge=0.0, le=5.0, allow_inf_nan=False)
    maturity_years: float = Field(default=1.0, gt=0.0, le=100.0, allow_inf_nan=False)
    paths: int = Field(default=1_000_000, ge=4, le=50_000_000)
    seed: int = Field(default=42, ge=0, le=9_007_199_254_740_991)
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
    ready = NATIVE_LIBRARY is not None
    return {
        "status": "ok" if ready else "degraded",
        "service": "ultralob-pricing",
        "version": APP_VERSION,
        "native_library_available": ready,
        "cuda_build_enabled": CUDA_BUILD_ENABLED,
        "load_error": NATIVE_LOAD_ERROR,
    }


@app.post("/pricing/monte-carlo")
def price_monte_carlo(
    request: PricingRequest,
    authorization: str | None = Header(default=None),
):
    verify_api_key(authorization)
    if NATIVE_LIBRARY is None:
        raise HTTPException(status_code=503, detail="Native Monte Carlo pricing library is not loaded")

    backend_codes = {"auto": 0, "cpu": 1, "cuda": 2}
    native_request = NativeRequest(
        request.spot,
        request.strike,
        request.risk_free_rate,
        request.dividend_yield,
        request.volatility,
        request.maturity_years,
        request.paths,
        request.seed,
        backend_codes[request.backend],
    )
    native_result = NativeResult()
    error_buffer = ctypes.create_string_buffer(512)

    try:
        with PRICING_LOCK:
            status = NATIVE_LIBRARY.ultralob_monte_carlo_price(
                ctypes.byref(native_request),
                ctypes.byref(native_result),
                error_buffer,
                ctypes.sizeof(error_buffer),
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Native pricing invocation failed: {exc}")

    if status != 0:
        message = error_buffer.value.decode("utf-8", errors="replace") or "Native pricing engine failed"
        raise HTTPException(status_code=422, detail=message)

    actual_backend = "CUDA" if native_result.backend == 2 else "CPU"
    return {
        "backend": actual_backend,
        "paths": native_result.paths,
        "seed": native_result.seed,
        "elapsed_ms": native_result.elapsed_ms,
        "paths_per_second": native_result.paths_per_second,
        "service_elapsed_ms": native_result.elapsed_ms,
        "inputs": {
            "spot": request.spot,
            "strike": request.strike,
            "risk_free_rate": request.risk_free_rate,
            "dividend_yield": request.dividend_yield,
            "volatility": request.volatility,
            "maturity_years": request.maturity_years,
        },
        "call": {
            "price": native_result.call_price,
            "black_scholes": native_result.call_black_scholes,
            "standard_error": native_result.call_standard_error,
            "confidence_low_95": native_result.call_confidence_low_95,
            "confidence_high_95": native_result.call_confidence_high_95,
        },
        "put": {
            "price": native_result.put_price,
            "black_scholes": native_result.put_black_scholes,
            "standard_error": native_result.put_standard_error,
            "confidence_low_95": native_result.put_confidence_low_95,
            "confidence_high_95": native_result.put_confidence_high_95,
        },
        "model": "risk-neutral-gbm-european-vanilla",
        "variance_reduction": "antithetic-variates",
        # CUDA utilization requires an additional NVML/nvidia-smi telemetry integration.
        "gpu_utilization": None,
    }
