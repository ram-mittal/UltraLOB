# UltraLOB Monte Carlo pricing service

This service wraps the native `ultralob_pricer` executable in a validated HTTP API. It is separate from the exchange server and must be deployed on a host that supports long-running containers. Choose the CUDA image and a GPU-enabled host for actual NVIDIA execution; Vercel serves the frontend and proxies requests but does not provide the CUDA device.

## API

- `GET /health` — readiness, binary presence, and whether the container was built with CUDA.
- `POST /pricing/monte-carlo` — price European call and put options.

Example JSON request:

    {
      "spot": 150.25,
      "strike": 155,
      "risk_free_rate": 0.045,
      "dividend_yield": 0.005,
      "volatility": 0.28,
      "maturity_years": 0.5,
      "paths": 2000000,
      "seed": 42,
      "backend": "auto"
    }

The response includes Monte Carlo and Black-Scholes prices, standard errors, confidence intervals, selected backend, path throughput, and elapsed time. GPU utilization is currently returned as null because the C++ engine does not yet collect hardware utilization telemetry.

## Local CPU service

From the repository root:

    docker build -f pricing_service/Dockerfile.cpu -t ultralob-pricing:cpu .
    docker run --rm -p 8000:8000 ultralob-pricing:cpu

Open `http://localhost:8000/docs` to explore the API.

## NVIDIA GPU service

Build on a compatible CUDA build host:

    docker build -f pricing_service/Dockerfile.cuda -t ultralob-pricing:cuda .

Run on a GPU-enabled Docker host with NVIDIA Container Toolkit:

    docker run --rm --gpus all -p 8000:8000 \
      -e PRICING_API_KEY="replace-with-a-long-random-token" \
      ultralob-pricing:cuda

The GPU host needs a compatible NVIDIA driver. The container includes the CUDA toolkit and CURAND and compiles the CUDA pricing kernel. Use the CPU image for development and API smoke testing only.

## Configuration

- `ULTRALOB_PRICER_BIN`: path to the compiled executable (default `/app/ultralob_pricer`).
- `PRICING_API_KEY`: optional bearer token required for pricing requests.
- `PRICER_TIMEOUT_SECONDS`: subprocess timeout (default 120 seconds).
- `ULTRALOB_CUDA_ENABLED`: informational build flag returned by health checks.

For a public deployment, set `PRICING_API_KEY` on the service and set the same value as `PRICING_API_KEY` in Vercel. Also configure `PRICING_SERVICE_URL` in Vercel as the service origin, for example `https://pricing.your-domain.com` (no route suffix). Keep the pricing service behind TLS and use a GPU plan/instance if CUDA pricing is required.
