#define ULTRALOB_PROFILING 1
#include "ultralob/matching_engine.hpp"
#include "ultralob/util/profiler.hpp"
#include <iostream>

using namespace ultralob;

int main() {
    MatchingEngine engine;
    engine.add_symbol(1);
    
    std::cout << "Running Profiler on 10,000 orders..." << std::endl;
    for (int i = 0; i < 10000; ++i) {
        OrderRequest req;
        req.id = i + 1;
        req.client_id = 1;
        req.symbol = 1;
        req.side = (i % 2 == 0) ? Side::Buy : Side::Sell;
        req.type = OrderType::Limit;
        req.price = 10000;
        req.qty = 100;
        req.timestamp = 0;
        
        TRACE_EVENT("Bench_Submit");
        engine.submit(req);
    }
    
    ultralob::util::Profiler::get().dump("trace.json");
    return 0;
}
