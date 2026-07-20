#include <benchmark/benchmark.h>
#include "ultralob/exchange_node.hpp"

using namespace ultralob;

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: Async Round Trip Latency (End-to-End)
// 
// Pushes N orders into the sequencer, then polls the outbound queue for N 
// execution reports, measuring the true wall-clock time passing through 
// the two thread boundaries.
// ─────────────────────────────────────────────────────────────────────────────
static void BM_Sequencer_RoundTrip(benchmark::State& state) {
    auto node = std::make_unique<ExchangeNode>();
    Symbol SYM = 1;
    node->add_symbol(SYM);
    
    // Pin to core 0 (or fallback if Windows core 0 is busy)
    // For a real benchmark on an isolated system, use isolated cores.
    node->start(-1); 

    OrderId next_id = 1;
    InboundMessage msg{OrderRequest{
        .id = 0,
        .symbol = SYM,
        .side = Side::Buy,
        .type = OrderType::Limit,
        .price = from_double(100.0),
        .qty = 10,
        .stop_price = PRICE_NONE,
        .limit_price = PRICE_NONE,
        .timestamp = 0
    }};

    for (auto _ : state) {
        msg.submit.id = next_id++;
        
        // Push to inbound
        while (!node->push_inbound(msg)) {
            // spin wait if queue is full
        }

        // Wait for it on outbound
        std::optional<OutboundMessage> out;
        while (!(out = node->poll_outbound())) {
            // spin wait
        }
        benchmark::DoNotOptimize(out);
    }

    node->stop();
}
BENCHMARK(BM_Sequencer_RoundTrip);

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: Async Throughput (Pipelined)
//
// Producer blasts N messages as fast as possible, Consumer (benchmark thread)
// drains them. Measures how many ops/sec the queues + engine can handle.
// ─────────────────────────────────────────────────────────────────────────────
static void BM_Sequencer_Throughput(benchmark::State& state) {
    auto node = std::make_unique<ExchangeNode>();
    Symbol SYM = 1;
    node->add_symbol(SYM);
    node->start(-1);

    InboundMessage msg{OrderRequest{
        .id = 0,
        .symbol = SYM,
        .side = Side::Buy,
        .type = OrderType::Limit,
        .price = from_double(100.0),
        .qty = 10,
        .stop_price = PRICE_NONE,
        .limit_price = PRICE_NONE,
        .timestamp = 0
    }};

    OrderId id = 1;
    const size_t batch_size = 1000;

    for (auto _ : state) {
        // Produce a batch
        for (size_t i = 0; i < batch_size; ++i) {
            msg.submit.id = id++;
            while (!node->push_inbound(msg)) {}
        }
        
        // Consume a batch
        size_t consumed = 0;
        while (consumed < batch_size) {
            if (node->poll_outbound()) {
                consumed++;
            }
        }
    }
    
    state.SetItemsProcessed(state.iterations() * batch_size);
    node->stop();
}
BENCHMARK(BM_Sequencer_Throughput);

BENCHMARK_MAIN();
