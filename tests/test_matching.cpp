// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Matching Engine Tests
// Tests the MatchingEngine multi-symbol API layer
// ─────────────────────────────────────────────────────────────────────────────

#include <gtest/gtest.h>
#include "ultralob/matching_engine.hpp"

using namespace ultralob;

// ─────────────────────────────────────────────────────────────────────────────
class MatchingEngineTest : public ::testing::Test {
protected:
    static constexpr Symbol SYM = 42;

    std::vector<ExecutionReport> reports;

    static void exec_cb(const ExecutionReport& rpt, void* ctx) {
        auto* self = static_cast<MatchingEngineTest*>(ctx);
        self->reports.push_back(rpt);
    }

    MatchingEngine engine{500};
    OrderId next_id = 1;

    void SetUp() override {
        engine.add_symbol(SYM, exec_cb, this);
    }

    OrderRequest make_req(Side side, OrderType type, Price price, Qty qty,
                          Price stop = PRICE_NONE, Price lim = PRICE_NONE) {
        return OrderRequest{
            .id         = next_id++,
            .symbol     = SYM,
            .side       = side,
            .type       = type,
            .price      = price,
            .stop_price = stop,
            .limit_price = lim,
            .qty        = qty,
        };
    }

    int count_fills() {
        int n = 0;
        for (auto& r : reports) if (r.is_fill()) ++n;
        return n;
    }

    int count_status(OrderStatus s) {
        int n = 0;
        for (auto& r : reports) if (r.status == s) ++n;
        return n;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Symbol management
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(MatchingEngineTest, AddAndRemoveSymbol) {
    EXPECT_TRUE(engine.has_symbol(SYM));
    engine.remove_symbol(SYM);
    EXPECT_FALSE(engine.has_symbol(SYM));
}

TEST_F(MatchingEngineTest, DuplicateSymbolFails) {
    EXPECT_FALSE(engine.add_symbol(SYM));
}

// ─────────────────────────────────────────────────────────────────────────────
// Limit order matching
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(MatchingEngineTest, LimitOrderRestingNoMatch) {
    engine.submit(make_req(Side::Buy, OrderType::Limit, from_double(100.0), 10));
    EXPECT_EQ(count_fills(), 0);
    EXPECT_EQ(engine.book(SYM)->best_bid(), from_double(100.0));
}

TEST_F(MatchingEngineTest, LimitCrossProducesFullFill) {
    engine.submit(make_req(Side::Buy,  OrderType::Limit, from_double(100.0), 10));
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(100.0), 10));

    // Both orders fully filled — 2 fill reports (one per side)
    EXPECT_EQ(count_fills(), 2);
    EXPECT_FALSE(engine.book(SYM)->best_bid().has_value());
    EXPECT_FALSE(engine.book(SYM)->best_ask().has_value());
}

TEST_F(MatchingEngineTest, LimitPartialFill) {
    engine.submit(make_req(Side::Buy,  OrderType::Limit, from_double(100.0), 10));
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(100.0),  6));

    // Sell fully fills (6 of 6), Buy partially fills (6 of 10)
    auto partial = std::find_if(reports.begin(), reports.end(),
        [](const ExecutionReport& r) {
            return r.status == OrderStatus::PartiallyFilled;
        });
    ASSERT_NE(partial, reports.end());
    EXPECT_EQ(partial->leaves_qty, 4u);

    // Residual buy still rests
    EXPECT_TRUE(engine.book(SYM)->best_bid().has_value());
}

TEST_F(MatchingEngineTest, LimitNoCrossIfPriceGap) {
    engine.submit(make_req(Side::Buy,  OrderType::Limit, from_double(99.0), 10));
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(101.0), 10));

    EXPECT_EQ(count_fills(), 0);
    EXPECT_TRUE(engine.book(SYM)->best_bid().has_value());
    EXPECT_TRUE(engine.book(SYM)->best_ask().has_value());
}

// ─────────────────────────────────────────────────────────────────────────────
// Market order tests
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(MatchingEngineTest, MarketOrderFillsAgainstBook) {
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(101.0), 20));
    engine.submit(make_req(Side::Buy,  OrderType::Market, PRICE_NONE, 15));

    EXPECT_EQ(count_fills(), 2);  // 1 for each side
    // 5 units remain in ask
    EXPECT_TRUE(engine.book(SYM)->best_ask().has_value());
}

TEST_F(MatchingEngineTest, MarketOrderEmptyBookGetsRejected) {
    engine.submit(make_req(Side::Buy, OrderType::Market, PRICE_NONE, 10));
    // Cancelled (no liquidity)
    EXPECT_EQ(count_status(OrderStatus::Cancelled), 1);
    EXPECT_EQ(count_fills(), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel via engine
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(MatchingEngineTest, CancelRestingLimitOrder) {
    auto req = make_req(Side::Buy, OrderType::Limit, from_double(100.0), 10);
    OrderId id = req.id;
    engine.submit(req);

    EXPECT_TRUE(engine.cancel(SYM, id));
    EXPECT_FALSE(engine.book(SYM)->best_bid().has_value());
    EXPECT_EQ(count_status(OrderStatus::Cancelled), 1);
}

TEST_F(MatchingEngineTest, CancelUnknownSymbolReturnsFalse) {
    EXPECT_FALSE(engine.cancel(999, 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation rejects
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(MatchingEngineTest, RejectsZeroQty) {
    auto req = make_req(Side::Buy, OrderType::Limit, from_double(100.0), 0);
    Order* o = engine.submit(req);
    EXPECT_EQ(o, nullptr);
}

TEST_F(MatchingEngineTest, RejectsUnknownSymbol) {
    OrderRequest req{
        .id = next_id++, .symbol = 999,
        .side = Side::Buy, .type = OrderType::Limit,
        .price = from_double(100.0), .qty = 10
    };
    Order* o = engine.submit(req);
    EXPECT_EQ(o, nullptr);
}

TEST_F(MatchingEngineTest, RejectsInvalidOrderId) {
    OrderRequest req{
        .id = INVALID_ORDER_ID, .symbol = SYM,
        .side = Side::Buy, .type = OrderType::Limit,
        .price = from_double(100.0), .qty = 10
    };
    Order* o = engine.submit(req);
    EXPECT_EQ(o, nullptr);
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-level matching
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(MatchingEngineTest, MarketOrderConsumesMultiplePriceLevels) {
    // Ask side: 5 at 101, 5 at 102, 5 at 103
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(101.0), 5));
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(102.0), 5));
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(103.0), 5));

    // Market buy for 12: should consume 101 (5), 102 (5), 103 (2)
    engine.submit(make_req(Side::Buy, OrderType::Market, PRICE_NONE, 12));

    EXPECT_GT(count_fills(), 0);
    // 3 remain at 103
    ASSERT_TRUE(engine.book(SYM)->best_ask().has_value());
    EXPECT_EQ(*engine.book(SYM)->best_ask(), from_double(103.0));
    EXPECT_EQ(engine.book(SYM)->asks().best_level()->total_qty(), 3u);
}

TEST_F(MatchingEngineTest, PriceTimePriorityAcrossLevels) {
    // Two sells at 100, one at 101
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(100.0), 5));
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(100.0), 5));
    engine.submit(make_req(Side::Sell, OrderType::Limit, from_double(101.0), 5));

    // Buy limit at 101: should fill 100 level first (price priority)
    engine.submit(make_req(Side::Buy, OrderType::Limit, from_double(101.0), 12));

    // 100 level: 10 filled (5+5); 101 level: 2 filled
    EXPECT_FALSE(engine.book(SYM)->best_ask().has_value() &&
                 *engine.book(SYM)->best_ask() == from_double(100.0));
}
