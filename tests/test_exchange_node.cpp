#include <gtest/gtest.h>
#include "ultralob/exchange_node.hpp"
#include <thread>
#include <chrono>

using namespace ultralob;
using namespace std::chrono_literals;

class ExchangeNodeTest : public ::testing::Test {
public:
    ExchangeNode node;
    Symbol SYM = 1;

    void SetUp() override {
        node.add_symbol(SYM);
    }

    void TearDown() override {
        node.stop();
    }
};

TEST_F(ExchangeNodeTest, AsynchronousOrderSubmission) {
    ASSERT_TRUE(node.start());

    // Submit an order
    OrderRequest req{
        .id = 100,
        .symbol = SYM,
        .side = Side::Buy,
        .type = OrderType::Limit,
        .price = from_double(10.5),
        .qty = 50
    };

    bool pushed = node.push_inbound(InboundMessage{req});
    EXPECT_TRUE(pushed);

    // Poll the outbound queue for the execution report
    bool received = false;
    auto start_time = std::chrono::steady_clock::now();
    while (std::chrono::steady_clock::now() - start_time < 100ms) {
        auto msg = node.poll_outbound();
        if (msg) {
            EXPECT_EQ(msg->report.order_id, 100);
            EXPECT_EQ(msg->report.status, OrderStatus::New);
            received = true;
            break;
        }
        std::this_thread::yield();
    }
    
    EXPECT_TRUE(received) << "Did not receive ExecutionReport from async node";
}

TEST_F(ExchangeNodeTest, AsynchronousMatching) {
    ASSERT_TRUE(node.start());

    // Sell 10 @ 10.0
    OrderRequest sell_req{
        .id = 1,
        .symbol = SYM,
        .side = Side::Sell,
        .type = OrderType::Limit,
        .price = from_double(10.0),
        .qty = 10
    };
    node.push_inbound(InboundMessage{sell_req});

    // Buy 10 @ 10.0 (cross)
    OrderRequest buy_req{
        .id = 2,
        .symbol = SYM,
        .side = Side::Buy,
        .type = OrderType::Limit,
        .price = from_double(10.0),
        .qty = 10
    };
    node.push_inbound(InboundMessage{buy_req});

    // We expect:
    // 1. New (Sell)
    // 2. New (Buy)
    // 3. Filled (Sell)
    // 4. Filled (Buy)
    // Note: order of reports is deterministic within a thread
    int report_count = 0;
    int filled_count = 0;

    auto start_time = std::chrono::steady_clock::now();
    while (std::chrono::steady_clock::now() - start_time < 200ms) {
        auto msg = node.poll_outbound();
        if (msg) {
            report_count++;
            if (msg->report.status == OrderStatus::Filled) {
                filled_count++;
            }
            if (report_count == 4) break;
        }
    }

    EXPECT_EQ(report_count, 4);
    EXPECT_EQ(filled_count, 2);
}
