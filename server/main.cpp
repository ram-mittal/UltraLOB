#include "ultralob/exchange_node.hpp"
#include "ultralob/net/gateway.hpp"
#include "ultralob/net/market_data_publisher.hpp"
#include <asio.hpp>
#include <iostream>

using namespace ultralob;
using namespace ultralob::net;

int main(int argc, char* argv[]) {
    try {
        short port = 8080;
        if (argc == 2) {
            port = static_cast<short>(std::atoi(argv[1]));
        }

        std::cout << "Starting UltraLOB Matching Engine...\n";
        
        auto exchange = std::make_unique<ExchangeNode>();
        // Pre-register some symbols
        exchange->add_symbol(1); // AAPL
        exchange->add_symbol(2); // MSFT
        exchange->add_symbol(3); // GOOG

        // Recover state from journal (if exists) and enable journaling
        std::string journal_path = "ultralob_events.journal";
        exchange->recover_from_journal(journal_path);
        exchange->enable_journaling(journal_path);
        std::cout << "Journaling enabled on: " << journal_path << "\n";

        // Pin the sequencer thread to core 0 (or generic run if unavailable)
        exchange->start(-1); 
        std::cout << "Engine Sequencer running on dedicated thread.\n";

        // Market Data Publisher
        auto md_publisher = std::shared_ptr<MarketDataPublisher>(new MarketDataPublisher());
        md_publisher->start();
        exchange->set_market_data_publisher(md_publisher);
        std::cout << "Market Data Publisher multicasting on 239.255.0.1:9001\n";

        asio::io_context io_context;
        Gateway gateway(io_context, port, *exchange);
        
        // Start the router thread that bridges Engine -> ASIO
        gateway.start_routing();
        
        std::cout << "Gateway listening on port " << port << "...\n";
        
        // Block main thread on ASIO event loop
        io_context.run();

    } catch (std::exception& e) {
        std::cerr << "Fatal Exception: " << e.what() << "\n";
        return 1;
    }

    return 0;
}
