# UltraLOB Monte Carlo pricing service

This service exposes the C++ Monte Carlo pricing engine through a validated FastAPI interface. The native C++ shared library is loaded once when the Python process starts. The service therefore keeps the CUDA context warm between requests instead of starting a new pricing executable for each calculation.

Deploy this service separately from the Vercel frontend. **Vercel serves the UI and proxies requests; CUDA execution happens on the GPU-enabled container host.**

## API

- `GET /health` — readiness, native library status, and whether the container was built with CUDA.
- `POST /pricing/monte-carlo` — price European call and put options.

Example request:

```json
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
```

The response contains the Monte Carlo and Black–Scholes prices, standard errors, 95% confidence intervals, actual selected backend, path throughput, elapsed native pricing time, and optional GPU utilization. GPU utilization is only populated when NVML can access the NVIDIA device; otherwise the API explicitly returns `null`.

The service validates all inputs. Paths must be even and between 4 and 50,000,000. Calls are serialized per service process to avoid GPU memory oversubscription and to make CPU/GPU comparisons more meaningful.

## Local CPU service

From the repository root:

```bash
docker build -f pricing_service/Dockerfile.cpu -t ultralob-pricing:cpu .
docker run --rm -p 8000:8000 ultralob-pricing:cpu
```

Open `http://localhost:8000/docs` to explore the API. The CPU image is useful for local integration testing and does not require an NVIDIA device.

## NVIDIA GPU service

Build the CUDA-enabled container:

```bash
docker build -f pricing_service/Dockerfile.cuda -t ultralob-pricing:cuda .
```

Run it on a GPU-enabled Docker host with a compatible NVIDIA driver and NVIDIA Container Toolkit:

```bash
docker run --rm --gpus all -p 8000:8000 \
  -e PRICING_API_KEY="replace-with-a-long-random-token" \
  ultralob-pricing:cuda
```

The image compiles the C++ CUDA kernel and CURAND integration. The Docker build defaults to CUDA architectures 75, 80, 86, 89, and 90. To target other supported hardware, pass a different architecture list:

```bash
docker build -f pricing_service/Dockerfile.cuda \
  --build-arg CUDA_ARCHITECTURES="80;86;89;90" \
  -t ultralob-pricing:cuda .
```

## Connect Vercel to the pricing service

After deploying the container to a host that exposes an HTTPS URL:

1. Set `PRICING_SERVICE_URL` in the Vercel project to the service origin, for example `https://pricing.example.com` (do not include `/health` or `/pricing/monte-carlo`).
2. Set `PRICING_API_KEY` in Vercel to the same secret configured on the pricing container.
3. Redeploy the Vercel project from the branch containing the frontend changes.
4. Open `https://your-domain/api/pricing` to verify health; it should return `"status":"ok"`.
5. Open the trading terminal and run a CPU simulation first. Then select NVIDIA CUDA or use the CPU/GPU comparison action.

The Vercel proxy is same-origin, so browser requests do not need direct CORS access to the pricing host. Keep the upstream service behind TLS and do not put the API key in frontend JavaScript.

## Configuration

Use [`.env.example`](.env.example) as a template for the pricing container environment. Replace the placeholder API key with a long random secret; do not commit real credentials.


- `ULTRALOB_PRICER_LIBRARY`: path to `libultralob_quant.so` (default `/app/build/libultralob_quant.so`).
- `PRICING_API_KEY`: optional bearer token required for pricing requests.
- `ULTRALOB_CUDA_ENABLED`: informational flag returned by health checks; set by the supplied Dockerfiles.
- `nvidia-ml-py`: optional hardware telemetry interface; GPU utilization is null when NVML is unavailable.

For GPU execution, the CUDA image must be deployed on an instance that has an NVIDIA GPU attached and exposes the driver libraries to the container. Building the CUDA image alone does not provide a GPU.
