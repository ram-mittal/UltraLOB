// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Latency Benchmark
//
// Measures per-order round-trip latency using rdtsc (TSC cycles → ns).
// Reports min, median, 99th, 99.9th percentile latencies.
//
// Scenarios:
//   - Single limit order add (resting, no match)
//   - Single limit order add + cancel
//   - Single limit order cross (immediate fill)
//   - Market order against 1-level book
// ─────────────────────────────────────────────────────────────────────────────

#include <benchmark/benchmark.h>
#include "ultralob/matching_engine.hpp"

#include <cstdint>
#include <vector>
#include <algorithm>
#include <numeric>
#include <cmath>

using namespace ultralob;

static constexpr Symbol SYM = 1;
static void noop_cb(const ExecutionReport&, void*) {}

// ─────────────────────────────────────────────────────────────────────────────
// TSC helpers (x86 only; falls back to chrono on other platforms)
// ─────────────────────────────────────────────────────────────────────────────
#if defined(__x86_64__) || defined(_M_X64)
#  if defined(_MSC_VER)
#    include <intrin.h>
     static inline uint64_t rdtsc() { return __rdtsc(); }
#  else
#    include <x86intrin.h>
     static inline uint64_t rdtsc() { return __rdtsc(); }
#  endif
#else
#  include <chrono>
   static inline uint64_t rdtsc() {
       using namespace std::chrono;
       return (uint64_t)duration_cast<nanoseconds>(
           steady_clock::now().time_since_epoch()).count();
   }
#endif

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: Limit order add latency (no match)
// ─────────────────────────────────────────────────────────────────────────────
static void BM_Latency_LimitAdd(benchmark::State& state) {
    MatchingEngine engine{1'000'000};
    engine.add_symbol(SYM, noop_cb, nullptr);
    OrderId next_id = 1;

    std::vector<uint64_t> samples;
    samples.reserve(1'000'000);

    Price buy_price = from_double(99.0);

    for (auto _ : state) {
        OrderRequest req{
            .id = next_id++, .symbol = SYM,
            .side = Side::Buy, .type = OrderType::Limit,
            .price = buy_price, .qty = 100
        };

        uint64_t t0 = rdtsc();
        engine.submit(req);
        uint64_t t1 = rdtsc();

        samples.push_back(t1 - t0);

        // Drain pool every 800k orders
        if (next_id % 800'000 == 0) {
            state.PauseTiming();
            engine.remove_symbol(SYM);
            engine.add_symbol(SYM, noop_cb, nullptr);
            state.ResumeTiming();
        }
    }

    // Report percentiles via custom counters
    if (!samples.empty()) {
        std::sort(samples.begin(), samples.end());
        size_t n = samples.size();
        state.counters["cycles_min"]  = (double)samples[0];
        state.counters["cycles_p50"]  = (double)samples[n * 50 / 100];
        state.counters["cycles_p99"]  = (double)samples[n * 99 / 100];
        state.counters["cycles_p999"] = (double)samples[n * 999 / 1000];
        state.counters["cycles_max"]  = (double)samples[n - 1];
    }
}
BENCHMARK(BM_Latency_LimitAdd)
    ->Iterations(500'000)
    ->Unit(benchmark::kNanosecond);

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: Limit add + cancel latency
// ─────────────────────────────────────────────────────────────────────────────
static void BM_Latency_AddCancel(benchmark::State& state) {
    MatchingEngine engine{200'000};
    engine.add_symbol(SYM, noop_cb, nullptr);
    OrderId next_id = 1;

    std::vector<uint64_t> samples;
    samples.reserve(500'000);

    for (auto _ : state) {
        OrderId id = next_id;
        OrderRequest req{
            .id = next_id++, .symbol = SYM,
            .side = Side::Buy, .type = OrderType::Limit,
            .price = from_double(99.0), .qty = 100
        };

        uint64_t t0 = rdtsc();
        engine.submit(req);
        engine.cancel(SYM, id);
        uint64_t t1 = rdtsc();

        samples.push_back(t1 - t0);
    }

    if (!samples.empty()) {
        std::sort(samples.begin(), samples.end());
        size_t n = samples.size();
        state.counters["cycles_p50"]  = (double)samples[n * 50 / 100];
        state.counters["cycles_p99"]  = (double)samples[n * 99 / 100];
        state.counters["cycles_p999"] = (double)samples[n * 999 / 1000];
    }
}
BENCHMARK(BM_Latency_AddCancel)
    ->Iterations(200'000)
    ->Unit(benchmark::kNanosecond);

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: Immediate fill (aggressor crosses resting order) latency
// ─────────────────────────────────────────────────────────────────────────────
static void BM_Latency_ImmediateFill(benchmark::State& state) {
    MatchingEngine engine{2'000'000};
    engine.add_symbol(SYM, noop_cb, nullptr);
    OrderId next_id = 1;

    std::vector<uint64_t> samples;
    samples.reserve(500'000);

    int64_t counter = 0;
    for (auto _ : state) {
        if (counter % 2 == 0) {
            // Resting sell
            OrderRequest rest{
                .id = next_id++, .symbol = SYM,
                .side = Side::Sell, .type = OrderType::Limit,
                .price = from_double(100.0), .qty = 100
            };
            engine.submit(rest);
        } else {
            // Aggressor buy — triggers match
            OrderRequest aggr{
                .id = next_id++, .symbol = SYM,
                .side = Side::Buy, .type = OrderType::Limit,
                .price = from_double(100.0), .qty = 100
            };
            uint64_t t0 = rdtsc();
            engine.submit(aggr);
            uint64_t t1 = rdtsc();
            samples.push_back(t1 - t0);
        }
        ++counter;
    }

    if (!samples.empty()) {
        std::sort(samples.begin(), samples.end());
        size_t n = samples.size();
        state.counters["cycles_p50"]  = (double)samples[n * 50 / 100];
        state.counters["cycles_p99"]  = (double)samples[n * 99 / 100];
        state.counters["cycles_p999"] = (double)samples[n * 999 / 1000];
    }
}
BENCHMARK(BM_Latency_ImmediateFill)
    ->Iterations(1'000'000)
    ->Unit(benchmark::kNanosecond);

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: Market order against pre-seeded 1-level book
// ─────────────────────────────────────────────────────────────────────────────
static void BM_Latency_MarketOrder(benchmark::State& state) {
    MatchingEngine engine{100};
    engine.add_symbol(SYM, noop_cb, nullptr);
    OrderId next_id = 1;

    // Seed: one massive resting sell so market always fills
    engine.submit(OrderRequest{
        .id = next_id++, .symbol = SYM,
        .side = Side::Sell, .type = OrderType::Limit,
        .price = from_double(100.0), .qty = 1'000'000'000ULL
    });

    std::vector<uint64_t> samples;
    samples.reserve(500'000);

    for (auto _ : state) {
        OrderRequest req{
            .id = next_id++, .symbol = SYM,
            .side = Side::Buy, .type = OrderType::Market,
            .price = PRICE_NONE, .qty = 1
        };
        uint64_t t0 = rdtsc();
        engine.submit(req);
        uint64_t t1 = rdtsc();
        samples.push_back(t1 - t0);
    }

    if (!samples.empty()) {
        std::sort(samples.begin(), samples.end());
        size_t n = samples.size();
        state.counters["cycles_min"]  = (double)samples[0];
        state.counters["cycles_p50"]  = (double)samples[n * 50 / 100];
        state.counters["cycles_p99"]  = (double)samples[n * 99 / 100];
        state.counters["cycles_p999"] = (double)samples[n * 999 / 1000];
    }
}
BENCHMARK(BM_Latency_MarketOrder)
    ->Iterations(500'000)
    ->Unit(benchmark::kNanosecond);

BENCHMARK_MAIN();
