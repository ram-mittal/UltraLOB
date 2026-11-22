# GPU Monte Carlo option pricing

UltraLOB's Monte Carlo module is a standalone quantitative-pricing library and executable. It does not run inside the matching engine's single-threaded sequencer.

## Model

The first increment prices European vanilla calls and puts under risk-neutral geometric Brownian motion:

S(T) = S(0) * exp((r - q - 0.5 * sigma^2) * T + sigma * sqrt(T) * Z), where Z is standard normal.

The implementation samples the exact terminal distribution and pairs each normal draw with its negative (antithetic variates). Mean, sample standard error, and 95% normal confidence intervals are calculated from the independent antithetic-pair payoffs. Path-dependent contracts such as Asian, barrier, and lookback options require time-stepped paths and are not part of this first increment.

The CPU implementation is always built. The optional CUDA implementation uses CURAND Philox, one GPU thread per antithetic pair, block reductions, and transfers partial sums back to the host. A fixed seed is repeatable within a given backend/toolchain; CPU and CUDA use different random-number generators and are not expected to match bit-for-bit.

## CPU build

    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
    cmake --build build --config Release
    ctest --test-dir build --output-on-failure
    ./build/ultralob_pricer --backend cpu --spot 100 --strike 100 --rate 0.05 --dividend 0 --vol 0.20 --maturity 1 --paths 1000000

## CUDA build

Install a compatible NVIDIA driver and CUDA Toolkit, including nvcc and CURAND headers/libraries:

    cmake -S . -B build-cuda -DCMAKE_BUILD_TYPE=Release -DULTRALOB_ENABLE_CUDA=ON
    cmake --build build-cuda --config Release
    ctest --test-dir build-cuda --output-on-failure
    ./build-cuda/ultralob_pricer --backend cuda --paths 10000000

`--backend cuda` reports an error if no GPU is available. `--backend auto` selects CUDA if present and otherwise uses CPU.

## Parameters and interpretation

Rates, dividend yield, and volatility are annualized decimals (`0.20` is 20%); maturity is in years. `--paths` is the total path count and must be even and at least four. Every pair represents two terminal scenarios (`+Z`, `-Z`), so the confidence interval uses `paths / 2` independent pair samples.

The CLI displays Monte Carlo estimates, Black-Scholes reference values, standard errors, 95% confidence intervals, backend, and elapsed time. Black-Scholes is a validation reference, not a replacement for Monte Carlo.

## Integration boundary

The current web terminal is a static Vercel frontend. The production C++ server exposes binary TCP and FIX gateways rather than a JSON pricing endpoint. This increment therefore adds a reusable pricing library and CLI. A later API service can call `MonteCarloPricer` and publish results to the terminal without coupling GPU work to matching or FIX session threads.

For live trading, feed the service a coherent market-data snapshot (for example, mid-price) plus explicit contract inputs. Do not let the GPU worker inspect mutable order-book structures. Production use also requires instrument metadata, market-data freshness controls, rate and volatility curves, independent model validation, and deployment risk limits.
