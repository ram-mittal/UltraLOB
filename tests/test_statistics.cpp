// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Statistics Tests
// ─────────────────────────────────────────────────────────────────────────────

#include <gtest/gtest.h>
#include "ultralob/statistics.hpp"
#include "ultralob/matching_engine.hpp"

using namespace ultralob;

// ─────────────────────────────────────────────────────────────────────────────
class StatisticsTest : public ::testing::Test {
protected:
    static constexpr Symbol SYM = 1;

    std::vector<ExecutionReport> reports;
    Statistics* stats_ptr = nullptr;

    static void exec_cb(const ExecutionReport& rpt, void* ctx) {
        auto* self = static_cast<StatisticsTest*>(ctx);
        self->reports.push_back(rpt);
        // Update VWAP on fills — only count one side per trade (Buy side)
        // to avoid double-counting (each fill produces 2 reports, one per side)
        if (rpt.is_fill() && rpt.side == Side::Buy && self->stats_ptr) {
            self->stats_ptr->on_fill(rpt.exec_price, rpt.exec_qty);
        }
    }

    MatchingEngine engine{2000};
    OrderId next_id = 1;

    void SetUp() override {
        engine.add_symbol(SYM, exec_cb, this);
        stats_ptr = engine.stats(SYM);
        ASSERT_NE(stats_ptr, nullptr);
    }

    OrderRequest req(Side side, OrderType type, Price price, Qty qty) {
        return OrderRequest{
            .id = next_id++, .symbol = SYM,
            .side = side, .type = type, .price = price, .qty = qty
        };
    }

    void populate_book() {
        // Bid side: 3 levels
        engine.submit(req(Side::Buy, OrderType::Limit, from_double(100.0), 100));
        engine.submit(req(Side::Buy, OrderType::Limit, from_double(99.0),  200));
        engine.submit(req(Side::Buy, OrderType::Limit, from_double(98.0),  300));
        // Ask side: 3 levels
        engine.submit(req(Side::Sell, OrderType::Limit, from_double(101.0), 100));
        engine.submit(req(Side::Sell, OrderType::Limit, from_double(102.0), 200));
        engine.submit(req(Side::Sell, OrderType::Limit, from_double(103.0), 300));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Spread
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(StatisticsTest, SpreadEmptyBook) {
    EXPECT_FALSE(stats_ptr->spread().has_value());
}

TEST_F(StatisticsTest, SpreadOneSideOnly) {
    engine.submit(req(Side::Buy, OrderType::Limit, from_double(100.0), 10));
    EXPECT_FALSE(stats_ptr->spread().has_value());
}

TEST_F(StatisticsTest, SpreadCorrect) {
    populate_book();
    auto s = stats_ptr->spread();
    ASSERT_TRUE(s.has_value());
    // best_ask (101) - best_bid (100) = 1.00 → 100_000_000 in fixed-point
    EXPECT_EQ(*s, from_double(1.0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mid Price
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(StatisticsTest, MidPriceEmptyBook) {
    EXPECT_FALSE(stats_ptr->mid_price().has_value());
}

TEST_F(StatisticsTest, MidPriceCorrect) {
    populate_book();
    auto mid = stats_ptr->mid_price();
    ASSERT_TRUE(mid.has_value());
    // (101 + 100) / 2 = 100.5
    Price expected = (from_double(100.0) + from_double(101.0)) / 2;
    EXPECT_EQ(*mid, expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// VWAP
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(StatisticsTest, VWAPNoFills) {
    EXPECT_FALSE(stats_ptr->vwap().has_value());
}

TEST_F(StatisticsTest, VWAPSingleFill) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy,  OrderType::Limit, from_double(100.0), 10));

    auto v = stats_ptr->vwap();
    ASSERT_TRUE(v.has_value());
    EXPECT_EQ(*v, from_double(100.0));
}

TEST_F(StatisticsTest, VWAPTwoFillsDifferentPrices) {
    // Fill 10 at 100, then 10 at 102
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy,  OrderType::Limit, from_double(100.0), 10));

    engine.submit(req(Side::Sell, OrderType::Limit, from_double(102.0), 10));
    engine.submit(req(Side::Buy,  OrderType::Limit, from_double(102.0), 10));

    auto v = stats_ptr->vwap();
    ASSERT_TRUE(v.has_value());
    // VWAP = (100*10 + 102*10) / (10+10) = 101
    // Note: each fill emits 2 reports (one per side), so we need to check
    // that on_fill was called with the right params.
    // Expected VWAP = 101.0
    Price expected = from_double(101.0);
    EXPECT_EQ(*v, expected);
}

TEST_F(StatisticsTest, VWAPResetWorks) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy,  OrderType::Limit, from_double(100.0), 10));

    EXPECT_TRUE(stats_ptr->vwap().has_value());
    stats_ptr->reset_vwap();
    EXPECT_FALSE(stats_ptr->vwap().has_value());
}

// ─────────────────────────────────────────────────────────────────────────────
// Order Imbalance
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(StatisticsTest, ImbalanceEmptyBook) {
    EXPECT_DOUBLE_EQ(stats_ptr->order_imbalance(), 0.0);
}

TEST_F(StatisticsTest, ImbalancePerfectBalance) {
    // Equal qty on both sides
    engine.submit(req(Side::Buy,  OrderType::Limit, from_double(99.0),  100));
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(101.0), 100));

    double oi = stats_ptr->order_imbalance();
    EXPECT_NEAR(oi, 0.0, 1e-9);
}

TEST_F(StatisticsTest, ImbalanceFullBidSide) {
    engine.submit(req(Side::Buy, OrderType::Limit, from_double(99.0), 100));
    // No asks
    double oi = stats_ptr->order_imbalance();
    EXPECT_DOUBLE_EQ(oi, 1.0);  // all bids
}

TEST_F(StatisticsTest, ImbalanceFullAskSide) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(101.0), 100));
    double oi = stats_ptr->order_imbalance();
    EXPECT_DOUBLE_EQ(oi, -1.0);  // all asks
}

TEST_F(StatisticsTest, ImbalanceRange) {
    populate_book();
    double oi = stats_ptr->order_imbalance();
    // Both sides: bid = 600, ask = 600 → 0
    EXPECT_NEAR(oi, 0.0, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Position
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(StatisticsTest, QueuePositionFirstOrder) {
    auto r = req(Side::Buy, OrderType::Limit, from_double(100.0), 10);
    OrderId id = r.id;
    engine.submit(r);

    auto pos = stats_ptr->queue_position(id);
    ASSERT_TRUE(pos.has_value());
    EXPECT_EQ(*pos, 0u);  // first in queue
}

TEST_F(StatisticsTest, QueuePositionThirdOrder) {
    OrderId id_first = next_id;
    engine.submit(req(Side::Buy, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy, OrderType::Limit, from_double(100.0), 10));
    auto r = req(Side::Buy, OrderType::Limit, from_double(100.0), 10);
    OrderId id_third = r.id;
    engine.submit(r);
    (void)id_first;

    auto pos = stats_ptr->queue_position(id_third);
    ASSERT_TRUE(pos.has_value());
    EXPECT_EQ(*pos, 2u);
}

TEST_F(StatisticsTest, QueuePositionUnknownOrder) {
    EXPECT_FALSE(stats_ptr->queue_position(99999).has_value());
}

TEST_F(StatisticsTest, QtyAheadCalculation) {
    engine.submit(req(Side::Buy, OrderType::Limit, from_double(100.0), 30));  // 30 ahead
    engine.submit(req(Side::Buy, OrderType::Limit, from_double(100.0), 20));  // 20 ahead
    auto r = req(Side::Buy, OrderType::Limit, from_double(100.0), 10);
    OrderId id = r.id;
    engine.submit(r);

    auto qty = stats_ptr->qty_ahead(id);
    ASSERT_TRUE(qty.has_value());
    EXPECT_EQ(*qty, 50u);  // 30 + 20
}

// ─────────────────────────────────────────────────────────────────────────────
// Depth snapshot
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(StatisticsTest, SnapshotCapturesAllLevels) {
    populate_book();
    auto snap = stats_ptr->snapshot(5);
    EXPECT_EQ(snap.bid_levels, 3u);
    EXPECT_EQ(snap.ask_levels, 3u);
    EXPECT_EQ(snap.bid_prices[0], from_double(100.0));
    EXPECT_EQ(snap.ask_prices[0], from_double(101.0));
}

TEST_F(StatisticsTest, DepthVWAPCorrect) {
    populate_book();
    auto dv = stats_ptr->depth_vwap(3);

    // Bid side: (100*100 + 99*200 + 98*300) / 600 = (10000+19800+29400)/600 = 59200/600 ≈ 98.666...
    // In fixed-point: divide by PRICE_SCALE to compare
    double bid_expected = (100.0 * 100.0 + 99.0 * 200.0 + 98.0 * 300.0) / 600.0;
    double bid_actual   = dv.bid_vwap / static_cast<double>(PRICE_SCALE);
    EXPECT_NEAR(bid_actual, bid_expected, 1e-4);

    // Ask side: (101*100 + 102*200 + 103*300) / 600 = (10100+20400+30900)/600 = 61400/600 ≈ 102.333...
    double ask_expected = (101.0 * 100.0 + 102.0 * 200.0 + 103.0 * 300.0) / 600.0;
    double ask_actual   = dv.ask_vwap / static_cast<double>(PRICE_SCALE);
    EXPECT_NEAR(ask_actual, ask_expected, 1e-4);
}
