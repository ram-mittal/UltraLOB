#include "ultralob/exchange_node.hpp"
#include "ultralob/net/gateway.hpp"
#include "ultralob/net/market_data_publisher.hpp"
#include "ultralob/net/risk_engine.hpp"
#include "ultralob/fix/fix_gateway.hpp"

#include <asio.hpp>
#include <iostream>
#include <iomanip>
#include <string>
#include <memory>
#include <vector>

using namespace ultralob;
using namespace ultralob::net;
using namespace ultralob::fix;

static void print_banner(uint16_t binary_port, uint16_t fix_port,
                         const std::string& mcast_addr, uint16_t mcast_port,
                         const std::string& journal_path, int core_id) {
    std::cout << "\n"
              << "================================================================================\n"
              << "   _   _ _ _             _     ___  ____  \n"
              << "  | | | | | |_ _ __ __ _| |   / _ \\| __ ) \n"
              << "  | | | | | __| '__/ _` | |  | | | |  _ \\ \n"
              << "  | |_| | | |_| | | (_| | |__| |_| | |_) |\n"
              << "   \\___/|_|\\__|_|  \\__,_|_____\\___/|____/ \n"
              << "  Institutional Low-Latency Limit Order Book & FIX 4.4 Matching Engine\n"
              << "================================================================================\n"
              << "  [Architecture]    Lock-Free MPSC Queues | Zero-Allocation Hot Path | AVX2/FMA\n"
              << "  [Engine Status]   PRODUCTION ACTIVE (Sequencer Core: " 
              << (core_id >= 0 ? std::to_string(core_id) : "Auto/Dedicated") << ")\n"
              << "  [Journal WAL]     " << journal_path << " (Memory-Mapped Persistence)\n"
              << "  [Market Data]     UDP Multicast ITCH @ " << mcast_addr << ":" << mcast_port << "\n"
              << "  [Binary Gateway]  Raw Binary TCP Gateway @ 0.0.0.0:" << binary_port << "\n"
              << "  [FIX 4.4 Gateway] Institutional Acceptor @ 0.0.0.0:" << fix_port << "\n"
              << "  [Pre-Trade Risk]  Active (Fat-Finger, Capital Buying Power, Short Prevention)\n"
              << "  [Active Universe] AAPL (1), MSFT (2), GOOGL (3), TSLA (4), NVDA (5)\n"
              << "================================================================================\n"
              << "  [Ready] Listening for institutional FIX & binary client connections...\n"
              << "  [Control] Press Ctrl+C to cleanly stop the matching engine.\n"
              << "================================================================================\n" << std::endl;
}

int main(int argc, char* argv[]) {
    try {
        uint16_t binary_port = 8080;
        uint16_t fix_port    = 9876;
        std::string mcast_addr = "239.255.0.1";
        uint16_t mcast_port  = 9001;
        std::string journal_path = "ultralob_events.journal";
        std::string store_dir = ".";
        int cpu_core = -1;

        // Parse command line arguments
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "--binary-port" && i + 1 < argc) {
                binary_port = static_cast<uint16_t>(std::atoi(argv[++i]));
            } else if (arg == "--fix-port" && i + 1 < argc) {
                fix_port = static_cast<uint16_t>(std::atoi(argv[++i]));
            } else if (arg == "--mcast-addr" && i + 1 < argc) {
                mcast_addr = argv[++i];
            } else if (arg == "--mcast-port" && i + 1 < argc) {
                mcast_port = static_cast<uint16_t>(std::atoi(argv[++i]));
            } else if (arg == "--journal" && i + 1 < argc) {
                journal_path = argv[++i];
            } else if (arg == "--store-dir" && i + 1 < argc) {
                store_dir = argv[++i];
            } else if (arg == "--core" && i + 1 < argc) {
                cpu_core = std::atoi(argv[++i]);
            } else if (arg == "--help" || arg == "-h") {
                std::cout << "Usage: ultralob_server [options]\n"
                          << "  --binary-port <port>  Binary gateway TCP port (default: 8080)\n"
                          << "  --fix-port <port>     Institutional FIX 4.4 port (default: 9876)\n"
                          << "  --mcast-addr <ip>     Market data multicast group (default: 239.255.0.1)\n"
                          << "  --mcast-port <port>   Market data UDP port (default: 9001)\n"
                          << "  --journal <path>      Event journal path (default: ultralob_events.journal)\n"
                          << "  --store-dir <path>    FIX message store directory (default: .)\n"
                          << "  --core <id>           CPU core affinity (-1 for unpinned, default: -1)\n";
                return 0;
            } else if (argc == 2 && arg[0] != '-') {
                // Backward-compatible port argument
                binary_port = static_cast<uint16_t>(std::atoi(argv[1]));
            }
        }

        // ── 1. Initialize UltraLOB Matching Engine & Multi-Asset Universe ───
        auto exchange = std::make_unique<ExchangeNode>();
        exchange->add_symbol(1); // AAPL
        exchange->add_symbol(2); // MSFT
        exchange->add_symbol(3); // GOOGL
        exchange->add_symbol(4); // TSLA
        exchange->add_symbol(5); // NVDA

        // ── 2. Memory-Mapped Journaling & State Recovery ─────────────────────
        exchange->recover_from_journal(journal_path);
        exchange->enable_journaling(journal_path);

        // ── 3. Start High-Frequency Sequencer Loop ──────────────────────────
        exchange->start(cpu_core);

        // ── 4. Market Data Multicast Publisher (ITCH) ───────────────────────
        auto md_publisher = std::make_shared<MarketDataPublisher>();
        md_publisher->start();
        exchange->set_market_data_publisher(md_publisher);

        // ── 5. Institutional Pre-Trade Risk Engine ──────────────────────────
        RiskEngine risk_engine;
        // Prime tier institutional accounts with $500M buying power
        risk_engine.get_or_create_account(100, 500'000'000'000'000LL); // PB Alpha
        risk_engine.get_or_create_account(101, 500'000'000'000'000LL); // Market Maker 1
        risk_engine.get_or_create_account(102, 500'000'000'000'000LL); // Quant Hedge Fund
        risk_engine.get_or_create_account(103, 100'000'000'000'000LL); // Agency Broker

        // ── 6. ASIO IO Context & Gateways ───────────────────────────────────
        asio::io_context io_context;

        // Legacy binary gateway
        Gateway binary_gateway(io_context, binary_port, *exchange);
        binary_gateway.start_routing();

        // Institutional FIX 4.4 Acceptor Gateway
        FixGateway fix_gateway(io_context, fix_port, *exchange, risk_engine, store_dir);
        fix_gateway.start_routing();

        // ── 7. Graceful Shutdown Signal Handler ─────────────────────────────
        asio::signal_set signals(io_context, SIGINT, SIGTERM);
        signals.async_wait([&](const asio::error_code& /*ec*/, int /*sig*/) {
            std::cout << "\n[UltraLOB] Shutdown signal received. Performing graceful shutdown...\n";
            fix_gateway.stop();
            binary_gateway.stop();
            exchange->stop();
            io_context.stop();
            std::cout << "[UltraLOB] Engine gracefully stopped. All stores & journals flushed.\n";
        });

        // ── 8. Print Production Banner & Run Event Loop ─────────────────────
        print_banner(binary_port, fix_port, mcast_addr, mcast_port, journal_path, cpu_core);

        io_context.run();

    } catch (const std::exception& e) {
        std::cerr << "Fatal Exception in UltraLOB Server: " << e.what() << "\n";
        return 1;
    }

    return 0;
}
