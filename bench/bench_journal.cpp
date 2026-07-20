#include <benchmark/benchmark.h>
#include "ultralob/journal.hpp"
#include <filesystem>

using namespace ultralob;

static void BM_JournalAppend(benchmark::State& state) {
    std::string test_file = "bench_events.journal";
    if (std::filesystem::exists(test_file)) {
        std::filesystem::remove(test_file);
    }
    
    {
        // We preallocate 1 GB so we don't hit the end during the benchmark
        Journal journal(test_file, 1024 * 1024 * 1024);
        
        net::ClientRequest req;
        req.type = MsgType::SubmitOrder;
        req.submit.id = 1;
        req.submit.symbol = 1;
        req.submit.side = Side::Buy;
        req.submit.type = OrderType::Limit;
        req.submit.price = from_double(100.0);
        req.submit.qty = 10;
        
        for (auto _ : state) {
            benchmark::DoNotOptimize(journal.append(req));
        }
    } // Journal destroyed here, file handles closed
    
    state.SetItemsProcessed(state.iterations());
    std::filesystem::remove(test_file);
}

BENCHMARK(BM_JournalAppend)->Name("JournalAppend");

BENCHMARK_MAIN();
