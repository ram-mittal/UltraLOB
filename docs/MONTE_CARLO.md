# GPU Monte Carlo option pricing

UltraLOB's Monte Carlo module is a standalone quantitative-pricing library and executable. It does not run inside the matching engine's single-threaded sequencer.

## Model

The first increment prices European vanilla calls and puts under risk-neutral geometric Brownian motion:

S(T) = S(0) * exp((r - q - 0.5 * sigma^2) * T + sigma * sqrt(T) * Z), where Z is standard normal.

The implementation samples the exact terminal distribution and pairs each normal draw with its negative (antithetic variates). Mean, sample standard error, and 95% normal confidence intervals are calculated from the independent antithetic-pair payoffs. Path-dependent contracts such as Asian, barrier, and lookback options require time-stepped paths and are not part of this first increment.

The CPU implementation is always built. The optional CUDA implementation uses CURAND Philox, one GPU thread per antithetic pair, block reductions, and transfers partial sums back to the host. A fixed seed is repeatable within a given backend/toolchain; CPU and CUDA use different random-number generators and are not expected to match bit-for-bit.

## Pricing inputs

| CLI flag | Meaning | Default | Constraint |
|---|---|---:|---|
| `--spot` | Underlying spot price | `100` | Positive finite number |
| `--strike` | Option strike | `100` | Positive finite number |
| `--rate` | Annual continuously compounded risk-free rate | `0.05` | Finite decimal |
| `--dividend` | Annual continuous dividend yield | `0.00` | Finite decimal |
| `--vol` | Annualized volatility | `0.20` | Non-negative decimal |
| `--maturity` | Time to maturity in years | `1.0` | Positive finite number |
| `--paths` | Total simulated paths | `1000000` | Even integer >= 4 |
| `--seed` | RNG seed | `42` | Unsigned integer |
| `--backend` | `auto`, `cpu`, or `cuda` | `auto` | CUDA requires CUDA build and device |
| `--help` | Show CLI help | — | No value |

## CPU build and run

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
ctest --test-dir build --output-on-failure

./build/ultralob_pricer --backend cpu --spot 100 --strike 100 \
  --rate 0.05 --dividend 0.00 --vol 0.20 --maturity 1.0 \
  --paths 1000000 --seed 42
```

## CUDA build and run

Install a compatible NVIDIA driver and CUDA Toolkit, including nvcc and CURAND:

```bash
cmake -S . -B build-cuda -DCMAKE_BUILD_TYPE=Release -DULTRALOB_ENABLE_CUDA=ON
cmake --build build-cuda --config Release
ctest --test-dir build-cuda --output-on-failure

./build-cuda/ultralob_pricer --backend cuda --spot 100 --strike 100 \
  --rate 0.05 --dividend 0.00 --vol 0.20 --maturity 1.0 \
  --paths 10000000 --seed 42
```

`--backend cuda` reports an error if the build has no CUDA support or no GPU is available. `--backend auto` uses CUDA when a device is available and falls back to CPU otherwise.

The number of independent observations used for standard-error calculation is `paths / 2`, because each observation is the average payoff of one antithetic pair.

## Outputs and validation

The executable prints Monte Carlo estimates, Black-Scholes reference values, standard errors, 95% confidence intervals, selected backend, path count, seed, and elapsed time. Black-Scholes is a validation reference rather than a replacement for Monte Carlo.

## Integration boundary

The current web terminal is a static Vercel frontend. The production C++ server exposes binary TCP and FIX gateways rather than a JSON pricing endpoint. This increment therefore adds a reusable pricing library and CLI. The pricing arguments described above are currently passed to the standalone `ultralob_pricer` executable; they are not yet exposed as fields in the web terminal. A later API service can call `MonteCarloPricer` and publish results to the terminal without coupling GPU work to matching or FIX session threads.

For live trading, feed the service a coherent market-data snapshot (for example, mid-price) plus explicit contract inputs. Do not let the GPU worker inspect mutable order-book structures. Production use also requires instrument metadata, market-data freshness controls, rate and volatility curves, independent model validation, and deployment risk limits.
