#include <gtest/gtest.h>
#include "ultralob/exchange_node.hpp"
#include "ultralob/net/risk_engine.hpp"
#include "ultralob/fix/fix_gateway.hpp"
#include "ultralob/fix/fix_initiator.hpp"
#include "ultralob/fix/fix_types.hpp"
#include "ultralob/fix/fix_application.hpp"

#include <asio.hpp>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <mutex>
#include <thread>
#include <vector>

using namespace ultralob;
using namespace ultralob::fix;
using namespace ultralob::net;
using namespace std::chrono_literals;

class FixGatewayTest : public ::testing::Test {
protected:
    void SetUp() override {
        // Prepare exchange node with test symbols
        exchange.add_symbol(1); // AAPL
        exchange.add_symbol(2); // MSFT
        exchange.start(-1);

        // Pre-configure risk accounts
        risk_engine.get_or_create_account(100, 100'000'000'000'000LL);
        risk_engine.get_or_create_account(101, 100'000'000'000'000LL);
    }

    void TearDown() override {
        exchange.stop();
        std::error_code ec;
        for (const auto& entry : std::filesystem::directory_iterator(".")) {
            if (entry.path().extension() == ".store" &&
                entry.path().filename().string().rfind("fix_server_session_", 0) == 0) {
                std::filesystem::remove(entry.path(), ec);
            }
        }
    }

    ExchangeNode exchange;
    RiskEngine   risk_engine;
};

TEST_F(FixGatewayTest, OrderSubmissionAndMatchingLifecycle) {
    asio::io_context io_context;

    // Start FixGateway on ephemeral port
    FixGateway gateway(io_context, 0, exchange, risk_engine, ".");
    gateway.start_routing();
    uint16_t port = gateway.port();
    ASSERT_GT(port, 0);

    // Run io_context on background thread
    std::thread io_thread([&io_context] {
        io_context.run();
    });

    // Configure FIX Initiator (Client)
    SessionConfig client_cfg;
    client_cfg.set_sender("TRADER_PROD");
    client_cfg.set_target("ULTRALOB");
    client_cfg.heartbeat_interval_sec = 30;

    FixInitiator client(client_cfg, "127.0.0.1", port, nullptr);

    std::mutex cv_m;
    std::condition_variable cv;
    std::vector<FixExecutionReport> reports;
    std::atomic<bool> logged_on{false};

    client.set_on_state_change([](SessionState /*old_st*/, SessionState new_st, void* ctx) {
        auto* flag = static_cast<std::atomic<bool>*>(ctx);
        if (new_st == SessionState::Active) {
            flag->store(true);
        }
    }, &logged_on);

    client.set_on_execution_report([](const FixExecutionReport& rep, void* ctx) {
        auto* self_tuple = static_cast<std::pair<std::mutex*, std::pair<std::condition_variable*, std::vector<FixExecutionReport>*>>*>(ctx);
        {
            std::lock_guard<std::mutex> lock(*self_tuple->first);
            self_tuple->second.second->push_back(rep);
        }
        self_tuple->second.first->notify_all();
    }, new std::pair<std::mutex*, std::pair<std::condition_variable*, std::vector<FixExecutionReport>*>>(
        &cv_m, {&cv, &reports}));

    ASSERT_TRUE(client.start());

    // Wait for Logon
    auto deadline = std::chrono::steady_clock::now() + 5s;
    while (!logged_on.load() && std::chrono::steady_clock::now() < deadline) {
        std::this_thread::sleep_for(10ms);
    }
    EXPECT_TRUE(logged_on.load());
    EXPECT_TRUE(client.is_active());

    // ── 1. Submit NewOrderSingle (Buy Limit 100 AAPL @ 150.00) ───────────
    FixNewOrderSingle buy_order;
    buy_order.set_cl_ord_id("CL-BUY-001");
    buy_order.set_symbol("AAPL");
    buy_order.side = FixSide::Buy;
    buy_order.ord_type = FixOrdType::Limit;
    buy_order.order_qty = 100;
    buy_order.price = 150.00;
    buy_order.time_in_force = FixTimeInForce::Day;

    ASSERT_TRUE(client.send_new_order_single(buy_order));

    // Wait for Ack (OrderStatus::New)
    {
        std::unique_lock<std::mutex> lock(cv_m);
        bool got_ack = cv.wait_for(lock, 3s, [&reports] {
            return !reports.empty() && reports.front().ord_status == FixOrdStatus::New;
        });
        EXPECT_TRUE(got_ack);
        if (got_ack) {
            EXPECT_EQ(std::string_view(reports.front().cl_ord_id), "CL-BUY-001");
            EXPECT_EQ(std::string_view(reports.front().symbol), "AAPL");
            EXPECT_EQ(reports.front().side, FixSide::Buy);
            EXPECT_EQ(reports.front().cum_qty, 0);
            EXPECT_EQ(reports.front().leaves_qty, 100);
        }
    }

    // ── 2. Submit Crossing NewOrderSingle (Sell Limit 100 AAPL @ 150.00) ──
    FixNewOrderSingle sell_order;
    sell_order.set_cl_ord_id("CL-SELL-001");
    sell_order.set_symbol("AAPL");
    sell_order.side = FixSide::Sell;
    sell_order.ord_type = FixOrdType::Limit;
    sell_order.order_qty = 100;
    sell_order.price = 150.00;
    sell_order.time_in_force = FixTimeInForce::Day;

    ASSERT_TRUE(client.send_new_order_single(sell_order));

    // Wait for Fill ExecutionReports
    {
        std::unique_lock<std::mutex> lock(cv_m);
        bool got_fills = cv.wait_for(lock, 3s, [&reports] {
            int fill_count = 0;
            for (const auto& r : reports) {
                if (r.ord_status == FixOrdStatus::Filled) {
                    ++fill_count;
                }
            }
            return fill_count >= 1; // At least one side filled
        });
        EXPECT_TRUE(got_fills);
    }

    // ── 3. Test Order Cancel ─────────────────────────────────────────────
    FixNewOrderSingle cancel_target;
    cancel_target.set_cl_ord_id("CL-BUY-002");
    cancel_target.set_symbol("AAPL");
    cancel_target.side = FixSide::Buy;
    cancel_target.ord_type = FixOrdType::Limit;
    cancel_target.order_qty = 50;
    cancel_target.price = 140.00; // Far below market, rests on book
    ASSERT_TRUE(client.send_new_order_single(cancel_target));

    // Wait for Ack
    {
        std::unique_lock<std::mutex> lock(cv_m);
        bool acked = cv.wait_for(lock, 3s, [&reports] {
            for (const auto& r : reports) {
                if (std::string_view(r.cl_ord_id) == "CL-BUY-002" && r.ord_status == FixOrdStatus::New) {
                    return true;
                }
            }
            return false;
        });
        EXPECT_TRUE(acked);
    }

    // Now send cancel
    FixOrderCancelRequest cancel_req;
    cancel_req.set_cl_ord_id("CL-CXL-001");
    cancel_req.set_orig_cl_ord_id("CL-BUY-002");
    cancel_req.set_symbol("AAPL");
    cancel_req.side = FixSide::Buy;
    cancel_req.order_qty = 50;
    ASSERT_TRUE(client.send_order_cancel(cancel_req));

    // Wait for Cancelled report
    {
        std::unique_lock<std::mutex> lock(cv_m);
        bool cancelled = cv.wait_for(lock, 3s, [&reports] {
            for (const auto& r : reports) {
                if (std::string_view(r.cl_ord_id) == "CL-BUY-002" && r.ord_status == FixOrdStatus::Cancelled) {
                    return true;
                }
            }
            return false;
        });
        EXPECT_TRUE(cancelled);
    }

    // Cleanup
    client.stop();
    gateway.stop();
    io_context.stop();
    if (io_thread.joinable()) {
        io_thread.join();
    }
}
