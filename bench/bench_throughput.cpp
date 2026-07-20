// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Throughput Benchmark
//
// Measures raw order submission throughput: how many orders/second the
// matching engine can process.
//
// Scenarios:
//   1. Limit order rain: alternating buy/sell limits across a price range
//      (book builds up depth — no matches)
//   2. Aggressive crossing: every other order matches the opposite side
//   3. Cancel storm: add + immediate cancel at high rate
//   4. Market order flood: market orders against a pre-seeded book
// ─────────────────────────────────────────────────────────────────────────────

#include <benchmark/benchmark.h>
#include "ultralob/matching_engine.hpp"

#include <random>
#include <vector>

using namespace ultralob;

static constexpr Symbol SYM  = 1;
static constexpr size_t POOL = 2'000'000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
static void noop_cb(const ExecutionReport&, void*) {}

struct BenchFixture {
    MatchingEngine engine{POOL};
    OrderId        next_id = 1;

    BenchFixture() {
        engine.add_symbol(SYM, noop_cb, nullptr);
    }

    OrderRequest limit(Side side, Price price, Qty qty) {
        return OrderRequest{
            .id = next_id++, .symbol = SYM,
            .side = side, .type = OrderType::Limit,
            .price = price, .qty = qty
        };
    }

    OrderRequest market(Side side, Qty qty) {
        return OrderRequest{
            .id = next_id++, .symbol = SYM,
            .side = side, .type = OrderType::Market,
            .price = PRICE_NONE, .qty = qty
        };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark 1: Limit order rain (no matches — pure book building)
// ─────────────────────────────────────────────────────────────────────────────
static void BM_LimitOrderRain(benchmark::State& state) {
    BenchFixture fix;

    // Pre-build price array: alternating bids (90-100) and asks (101-111)
    static constexpr int PRICE_LEVELS = 100;
    std::vector<Price> bid_prices(PRICE_LEVELS), ask_prices(PRICE_LEVELS);
    for (int i = 0; i < PRICE_LEVELS; ++i) {
        bid_prices[i] = from_double(100.0 - i * 0.01);
        ask_prices[i] = from_double(101.0 + i * 0.01);
    }

    int64_t counter = 0;
    for (auto _ : state) {
        int idx = counter % PRICE_LEVELS;
        Side side = (counter % 2 == 0) ? Side::Buy : Side::Sell;
        Price price = (side == Side::Buy) ? bid_prices[idx] : ask_prices[idx];

        fix.engine.submit(fix.limit(side, price, 100));
        ++counter;

        // Reset pool every 900k orders to avoid exhaustion
        if (counter % 900'000 == 0) {
            // Simplest reset: cancel all orders by recreating the engine
            // (in a real scenario we'd drain and recycle)
            state.PauseTiming();
            fix.engine.remove_symbol(SYM);
            fix.engine.add_symbol(SYM, noop_cb, nullptr);
            state.ResumeTiming();
        }
    }

    state.SetItemsProcessed(state.iterations());
    state.SetLabel("orders/sec");
}
BENCHMARK(BM_LimitOrderRain)->Iterations(5'000'000)->Unit(benchmark::kNanosecond);

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark 2: Aggressive crossing (match on every other order)
// ─────────────────────────────────────────────────────────────────────────────
static void BM_AggressiveCrossing(benchmark::State& state) {
    BenchFixture fix;

    Price buy_price  = from_double(100.0);
    Price sell_price = from_double(100.0);  // cross immediately

    int64_t counter = 0;
    for (auto _ : state) {
        if (counter % 2 == 0) {
            fix.engine.submit(fix.limit(Side::Buy,  buy_price,  10));
        } else {
            fix.engine.submit(fix.limit(Side::Sell, sell_price, 10));
        }
        ++counter;
    }

    state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_AggressiveCrossing)->Iterations(2'000'000)->Unit(benchmark::kNanosecond);

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark 3: Add + Cancel storm (tests pool recycle rate)
// ─────────────────────────────────────────────────────────────────────────────
static void BM_AddCancelStorm(benchmark::State& state) {
    BenchFixture fix;

    std::vector<OrderId> ids;
    ids.reserve(1024);

    for (auto _ : state) {
        // Submit
        auto req = fix.limit(Side::Buy, from_double(99.0), 1);
        OrderId id = req.id;
        fix.engine.submit(req);

        // Cancel immediately
        fix.engine.cancel(SYM, id);
    }

    state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_AddCancelStorm)->Iterations(2'000'000)->Unit(benchmark::kNanosecond);

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark 4: Market order flood against deep book
// ─────────────────────────────────────────────────────────────────────────────
static void BM_MarketOrderFlood(benchmark::State& state) {
    BenchFixture fix;

    // Seed the book with 1000 ask levels × 1000 qty each
    static constexpr int SEED_LEVELS = 500;
    for (int i = 0; i < SEED_LEVELS; ++i) {
        Price ask = from_double(100.0 + i * 0.01);
        // Each level gets a fat qty so market orders always fill
        fix.engine.submit(fix.limit(Side::Sell, ask, 1'000'000));
    }

    for (auto _ : state) {
        fix.engine.submit(fix.market(Side::Buy, 1));
    }

    state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_MarketOrderFlood)->Iterations(1'000'000)->Unit(benchmark::kNanosecond);

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark 5: Mixed realistic workload
// Approximates: 60% limit posts, 20% cancels, 15% market, 5% modify
// ─────────────────────────────────────────────────────────────────────────────
static void BM_MixedWorkload(benchmark::State& state) {
    BenchFixture fix;

    std::mt19937_64 rng{42};
    std::uniform_int_distribution<int>     op_dist(0, 99);
    std::uniform_int_distribution<int>     px_dist(0, 99);
    std::uniform_int_distribution<Qty>     qty_dist(1, 1000);

    std::vector<OrderId> resting_ids;
    resting_ids.reserve(10'000);

    Price base_bid = from_double(99.0);
    Price base_ask = from_double(101.0);
    int64_t counter = 0;

    for (auto _ : state) {
        int op = op_dist(rng);

        if (op < 30) {
            // Limit buy
            Price p = base_bid - from_double(px_dist(rng) * 0.01);
            auto req = fix.limit(Side::Buy, p, qty_dist(rng));
            OrderId id = req.id;
            fix.engine.submit(req);
            if (resting_ids.size() < 5000) resting_ids.push_back(id);

        } else if (op < 60) {
            // Limit sell
            Price p = base_ask + from_double(px_dist(rng) * 0.01);
            auto req = fix.limit(Side::Sell, p, qty_dist(rng));
            OrderId id = req.id;
            fix.engine.submit(req);
            if (resting_ids.size() < 5000) resting_ids.push_back(id);

        } else if (op < 80) {
            // Cancel a random resting order
            if (!resting_ids.empty()) {
                size_t idx = rng() % resting_ids.size();
                fix.engine.cancel(SYM, resting_ids[idx]);
                resting_ids.erase(resting_ids.begin() + (long)idx);
            }

        } else if (op < 95) {
            // Market order
            Side side = (counter % 2 == 0) ? Side::Buy : Side::Sell;
            fix.engine.submit(fix.market(side, qty_dist(rng)));

        } else {
            // Modify (reduce qty)
            if (!resting_ids.empty()) {
                size_t idx = rng() % resting_ids.size();
                fix.engine.modify(SYM, {SYM, resting_ids[idx], 0, 50});
            }
        }

        ++counter;

        // Periodic pool reset to keep benchmark running
        if (counter % 800'000 == 0) {
            state.PauseTiming();
            resting_ids.clear();
            fix.engine.remove_symbol(SYM);
            fix.engine.add_symbol(SYM, noop_cb, nullptr);
            state.ResumeTiming();
        }
    }

    state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_MixedWorkload)->Iterations(3'000'000)->Unit(benchmark::kNanosecond);

BENCHMARK_MAIN();
