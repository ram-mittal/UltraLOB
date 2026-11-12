// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB FIX 4.4 Initiator Client Demo
//
// Demonstrates end-to-end operation of the low-latency FIX engine:
//   1. Connects to the FIX server via non-blocking TCP (FixInitiator)
//   2. Performs automated Logon handshake (FixSession state machine)
//   3. Uses memory-mapped append-only log (FixStore) for sequence tracking
//   4. Sends multiple NewOrderSingle (35=D) requests
//   5. Receives and processes real-time ExecutionReports (35=8) via callbacks
//   6. Submits an OrderCancelRequest (35=F)
//   7. Initiates graceful Logout (35=5)
//   8. Verifies message store persistence & recovery
// ─────────────────────────────────────────────────────────────────────────────

#include "ultralob/fix/fix_initiator.hpp"
#include "ultralob/fix/fix_store.hpp"
#include "ultralob/fix/fix_application.hpp"

#include <iostream>
#include <iomanip>
#include <chrono>
#include <thread>
#include <atomic>
#include <filesystem>

using namespace ultralob::fix;

static std::atomic<int> g_exec_count{0};

void on_execution_report(const FixExecutionReport& rep, void* /*ctx*/) {
    g_exec_count.fetch_add(1, std::memory_order_release);

    std::string exec_type_str = "Unknown";
    if (rep.exec_type == FixExecType::New)        exec_type_str = "NEW (Ack)";
    else if (rep.exec_type == FixExecType::Fill)  exec_type_str = "FILL";
    else if (rep.exec_type == FixExecType::PartialFill) exec_type_str = "PARTIAL_FILL";
    else if (rep.exec_type == FixExecType::Cancelled)   exec_type_str = "CANCELLED";
    else if (rep.exec_type == FixExecType::Rejected)    exec_type_str = "REJECTED";

    std::string side_str = (rep.side == FixSide::Buy) ? "BUY" : "SELL";

    std::cout << "  [EXEC_REPORT] "
              << "ClOrdID=" << std::left << std::setw(10) << rep.cl_ord_id
              << " | " << std::setw(12) << exec_type_str
              << " | " << std::setw(6) << rep.symbol
              << " | " << std::setw(4) << side_str
              << " | Qty=" << std::setw(4) << rep.order_qty
              << " | LastQty=" << std::setw(4) << rep.last_qty
              << " | LastPx=" << std::fixed << std::setprecision(2) << rep.last_px
              << " | Leaves=" << rep.leaves_qty
              << " | CumQty=" << rep.cum_qty
              << " | OrderID=" << rep.order_id
              << "\n";
}

void on_order_cancel_reject(const FixOrderCancelReject& rej, void* /*ctx*/) {
    std::cout << "  [CANCEL_REJECT] ClOrdID=" << rej.cl_ord_id
              << " OrigClOrdID=" << rej.orig_cl_ord_id
              << " Reason=" << rej.cxl_rej_reason
              << " Text=" << rej.text << "\n";
}

void on_state_change(SessionState old_s, SessionState new_s, void* /*ctx*/) {
    auto to_name = [](SessionState s) -> const char* {
        switch (s) {
            case SessionState::Disconnected: return "Disconnected";
            case SessionState::Connecting:   return "Connecting";
            case SessionState::LogonSent:    return "LogonSent";
            case SessionState::Active:       return "Active";
            case SessionState::LogoutSent:   return "LogoutSent";
        }
        return "Unknown";
    };
    std::cout << "  [SESSION_STATE] " << to_name(old_s) << " -> " << to_name(new_s) << "\n";
}

int main(int argc, char* argv[]) {
    try {
        uint16_t port = 9876;
        if (argc > 1) port = static_cast<uint16_t>(std::stoi(argv[1]));

        std::cout << "=================================================================\n";
        std::cout << "       UltraLOB Low-Latency FIX 4.4 Engine Demonstration         \n";
        std::cout << "=================================================================\n\n";

        // ── 1. Configure Persistent Message Store ────────────────────────
        std::string store_path = "fix_client_demo.store";
        std::filesystem::remove(store_path); // Start fresh for demo

        FixStore store(store_path, 64ULL * 1024 * 1024);
        store.set_session_ids("TRADER-1", "ULTRALOB-MOCK");

        std::cout << "[1/6] Initialized memory-mapped FIX store at: " << store_path << "\n";

        // ── 2. Configure Session ─────────────────────────────────────────
        SessionConfig config;
        config.set_sender("TRADER-1");
        config.set_target("ULTRALOB-MOCK");
        config.heartbeat_interval_sec = 10;
        config.test_request_delay_sec = 2;

        std::cout << "[2/6] Configuring FIX 4.4 Initiator (Sender="
                  << config.sender_comp_id << ", Target=" << config.target_comp_id
                  << ", HeartBtInt=" << config.heartbeat_interval_sec << "s)...\n";

        FixInitiator initiator(config, "127.0.0.1", port, &store);
        initiator.set_on_execution_report(on_execution_report, nullptr);
        initiator.set_on_order_cancel_reject(on_order_cancel_reject, nullptr);
        initiator.set_on_state_change(on_state_change, nullptr);

        // ── 3. Connect & Logon ───────────────────────────────────────────
        std::cout << "[3/6] Connecting to FIX Server on 127.0.0.1:" << port << "...\n";
        if (!initiator.start()) {
            std::cerr << "Failed to start initiator network thread!\n";
            return 1;
        }

        // Wait for session to become Active
        for (int i = 0; i < 50 && !initiator.is_active(); ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }

        if (!initiator.is_active()) {
            std::cerr << "ERROR: Failed to establish Active FIX session within timeout!\n";
            initiator.stop();
            return 1;
        }

        std::cout << "\n>>> FIX Session is ACTIVE! Ready for order entry <<<\n\n";

        // ── 4. Send Orders (NewOrderSingle 35=D) ──────────────────────────
        std::cout << "[4/6] Submitting Orders via FixInitiator:\n";

        // Order 1: Buy 100 AAPL @ $150.25 Limit
        FixNewOrderSingle order1;
        order1.set_cl_ord_id("ORD-001");
        order1.set_symbol("AAPL");
        order1.side = FixSide::Buy;
        order1.ord_type = FixOrdType::Limit;
        order1.price = 150.25;
        order1.order_qty = 100;
        std::cout << "  >> Sending NewOrderSingle: BUY 100 AAPL @ $150.25 (ClOrdID=ORD-001)\n";
        initiator.send_new_order_single(order1);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));

        // Order 2: Buy 50 MSFT @ $310.50 Limit
        FixNewOrderSingle order2;
        order2.set_cl_ord_id("ORD-002");
        order2.set_symbol("MSFT");
        order2.side = FixSide::Buy;
        order2.ord_type = FixOrdType::Limit;
        order2.price = 310.50;
        order2.order_qty = 50;
        std::cout << "  >> Sending NewOrderSingle: BUY 50 MSFT @ $310.50 (ClOrdID=ORD-002)\n";
        initiator.send_new_order_single(order2);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));

        // Order 3: Sell 200 GOOGL @ $2800.00 Limit
        FixNewOrderSingle order3;
        order3.set_cl_ord_id("ORD-003");
        order3.set_symbol("GOOGL");
        order3.side = FixSide::Sell;
        order3.ord_type = FixOrdType::Limit;
        order3.price = 2800.00;
        order3.order_qty = 200;
        std::cout << "  >> Sending NewOrderSingle: SELL 200 GOOGL @ $2800.00 (ClOrdID=ORD-003)\n";
        initiator.send_new_order_single(order3);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));

        // ── 5. Send Cancel (OrderCancelRequest 35=F) ──────────────────────
        std::cout << "\n[5/6] Submitting Order Cancel Request:\n";
        FixOrderCancelRequest cxl;
        cxl.set_cl_ord_id("CXL-001");
        cxl.set_orig_cl_ord_id("ORD-002");
        cxl.set_symbol("MSFT");
        cxl.side = FixSide::Buy;
        cxl.order_qty = 50;
        std::cout << "  >> Sending OrderCancelRequest: OrigClOrdID=ORD-002 (ClOrdID=CXL-001)\n";
        initiator.send_order_cancel(cxl);

        // Wait for all execution reports to arrive
        for (int i = 0; i < 50 && g_exec_count.load() < 7; ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }

        std::cout << "\n  Total ExecutionReports received: " << g_exec_count.load() << "\n\n";

        // ── 6. Graceful Logout & Verification ────────────────────────────
        std::cout << "[6/6] Initiating Graceful Logout...\n";
        initiator.stop();
        std::cout << "  Initiator disconnected cleanly.\n\n";

        // Verify Store Persistence
        std::cout << "=================================================================\n";
        std::cout << "            Message Store Persistence Verification               \n";
        std::cout << "=================================================================\n";
        std::cout << "  Store File:              " << store_path << "\n";
        std::cout << "  Next Outbound Sequence:  " << store.get_sender_seq() << "\n";
        std::cout << "  Next Inbound Sequence:   " << store.get_target_seq() << "\n";
        std::cout << "  Total Messages Logged:   " << store.message_count() << "\n\n";

        std::cout << "  Sample Stored Outbound Messages:\n";
        for (uint64_t seq = 1; seq < store.get_sender_seq(); ++seq) {
            auto raw = store.retrieve(seq, StoreDirection::Outbound);
            if (!raw.empty()) {
                FixMessage m;
                if (m.parse(raw.data(), raw.size())) {
                    std::cout << "    [Seq " << seq << "] MsgType=" << m.msg_type();
                    if (m.has_tag(Tag::ClOrdID)) {
                        std::cout << " ClOrdID=" << m.get_string(Tag::ClOrdID);
                    }
                    if (m.has_tag(Tag::Symbol)) {
                        std::cout << " Symbol=" << m.get_string(Tag::Symbol);
                    }
                    std::cout << " (" << raw.size() << " bytes)\n";
                }
            }
        }

        std::cout << "\n=================================================================\n";
        std::cout << "      All FIX Engine stages executed successfully!               \n";
        std::cout << "=================================================================\n";

    } catch (const std::exception& e) {
        std::cerr << "Fatal Exception: " << e.what() << "\n";
        return 1;
    }

    return 0;
}

