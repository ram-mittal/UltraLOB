#include <benchmark/benchmark.h>
#include "ultralob/matching_engine.hpp"
#include <thread>
#include <atomic>

using namespace ultralob;

static void BM_Scaling_Threads(benchmark::State& state) {
    MatchingEngine engine;
    engine.add_symbol(1);
    
    std::atomic<uint64_t> order_id_gen{1};

    for (auto _ : state) {
        OrderRequest req;
        req.id = order_id_gen.fetch_add(1, std::memory_order_relaxed);
        req.client_id = state.thread_index();
        req.symbol = 1;
        req.side = (req.id % 2 == 0) ? Side::Buy : Side::Sell;
        req.type = OrderType::Limit;
        req.price = 10000 + (req.id % 100);
        req.qty = 100;
        req.timestamp = 0;
        
        engine.submit(req);
    }
    state.SetItemsProcessed(state.iterations());
}

// Test with 1, 2, 4, 8, 16 threads concurrently hitting the engine
BENCHMARK(BM_Scaling_Threads)->Threads(1)->Threads(2)->Threads(4)->Threads(8)->Threads(16);

static void BM_Scaling_Symbols(benchmark::State& state) {
    MatchingEngine engine;
    int num_symbols = state.range(0);
    for (int i = 0; i < num_symbols; ++i) {
        engine.add_symbol(i + 1);
    }
    
    uint64_t order_id = 1;

    for (auto _ : state) {
        OrderRequest req;
        req.id = ++order_id;
        req.client_id = 1;
        req.symbol = (order_id % num_symbols) + 1;
        req.side = (req.id % 2 == 0) ? Side::Buy : Side::Sell;
        req.type = OrderType::Limit;
        req.price = 10000 + (req.id % 100);
        req.qty = 100;
        req.timestamp = 0;
        
        engine.submit(req);
    }
    state.SetItemsProcessed(state.iterations());
}

// Test with 1, 10, 100, 1000, 10000 concurrent active order books
BENCHMARK(BM_Scaling_Symbols)->RangeMultiplier(10)->Range(1, 10000);

BENCHMARK_MAIN();
