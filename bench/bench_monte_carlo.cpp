#include "ultralob/quant/monte_carlo.hpp"
#include <benchmark/benchmark.h>
using namespace ultralob::quant;
static void BM_MonteCarloCPU(benchmark::State& state) {
 MonteCarloConfig c; c.paths=static_cast<std::uint64_t>(state.range(0)); c.backend=PricingBackend::CPU;
 MonteCarloPricer p;
 for(auto _ : state) { const auto r=p.price(c); benchmark::DoNotOptimize(r.call.price); benchmark::DoNotOptimize(r.put.price); }
 state.SetItemsProcessed(state.iterations()*static_cast<std::int64_t>(c.paths));
}
BENCHMARK(BM_MonteCarloCPU)->Arg(10000)->Arg(100000)->Arg(1000000);
#ifdef ULTRALOB_HAS_CUDA
static void BM_MonteCarloCUDA(benchmark::State& state) {
 MonteCarloConfig c; c.paths=static_cast<std::uint64_t>(state.range(0)); c.backend=PricingBackend::CUDA;
 MonteCarloPricer p; (void)p.price(c);
 for(auto _ : state) { const auto r=p.price(c); benchmark::DoNotOptimize(r.call.price); benchmark::DoNotOptimize(r.put.price); }
 state.SetItemsProcessed(state.iterations()*static_cast<std::int64_t>(c.paths));
}
BENCHMARK(BM_MonteCarloCUDA)->Arg(10000)->Arg(100000)->Arg(1000000)->Arg(10000000);
#endif
BENCHMARK_MAIN();
