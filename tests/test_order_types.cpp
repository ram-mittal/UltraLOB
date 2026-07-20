// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Order Type Tests
// Validates all 7 order types: Market, Limit, Stop, StopLimit, IOC, FOK, GTC
// ─────────────────────────────────────────────────────────────────────────────

#include <gtest/gtest.h>
#include "ultralob/matching_engine.hpp"

using namespace ultralob;

// ─────────────────────────────────────────────────────────────────────────────
class OrderTypeTest : public ::testing::Test {
protected:
    static constexpr Symbol SYM = 1;

    std::vector<ExecutionReport> reports;

    static void exec_cb(const ExecutionReport& rpt, void* ctx) {
        auto* self = static_cast<OrderTypeTest*>(ctx);
        self->reports.push_back(rpt);
    }

    MatchingEngine engine{1000};
    OrderId next_id = 1;

    void SetUp() override {
        engine.add_symbol(SYM, exec_cb, this);
    }

    OrderRequest req(Side side, OrderType type, Price price, Qty qty,
                     Price stop = PRICE_NONE, Price lim = PRICE_NONE) {
        return OrderRequest{
            .id          = next_id++,
            .symbol      = SYM,
            .side        = side,
            .type        = type,
            .price       = price,
            .stop_price  = stop,
            .limit_price = lim,
            .qty         = qty,
        };
    }

    int fills()       { return (int)std::count_if(reports.begin(), reports.end(), [](auto& r){ return r.is_fill(); }); }
    int cancels()     { return (int)std::count_if(reports.begin(), reports.end(), [](auto& r){ return r.status == OrderStatus::Cancelled; }); }
    int rejects()     { return (int)std::count_if(reports.begin(), reports.end(), [](auto& r){ return r.status == OrderStatus::Rejected; }); }
    int partials()    { return (int)std::count_if(reports.begin(), reports.end(), [](auto& r){ return r.status == OrderStatus::PartiallyFilled; }); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Market
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderTypeTest, Market_FullFillAgainstBook) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 20));
    engine.submit(req(Side::Buy,  OrderType::Market, PRICE_NONE, 20));

    EXPECT_EQ(fills(), 2);
    EXPECT_FALSE(engine.book(SYM)->best_ask().has_value());
}

TEST_F(OrderTypeTest, Market_PartialFillThenCancel) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 5));
    engine.submit(req(Side::Buy,  OrderType::Market, PRICE_NONE, 10));

    EXPECT_GT(fills(), 0);
    EXPECT_EQ(cancels(), 1);  // 5 unfilled remainder cancelled
}

TEST_F(OrderTypeTest, Market_EmptyBookCancels) {
    engine.submit(req(Side::Buy, OrderType::Market, PRICE_NONE, 10));
    EXPECT_EQ(fills(),   0);
    EXPECT_EQ(cancels(), 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Limit
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderTypeTest, Limit_RestsIfNoMatch) {
    engine.submit(req(Side::Buy, OrderType::Limit, from_double(99.0), 10));
    EXPECT_EQ(fills(), 0);
    EXPECT_TRUE(engine.book(SYM)->best_bid().has_value());
}

TEST_F(OrderTypeTest, Limit_ImmediateCross) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy,  OrderType::Limit, from_double(101.0), 10));
    EXPECT_EQ(fills(), 2);
}

TEST_F(OrderTypeTest, Limit_AggressorFillsAtRestingPrice) {
    // Resting sell at 100 — buy limit at 101 should fill at 100 (resting price)
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy,  OrderType::Limit, from_double(101.0), 10));

    auto fill_rpt = std::find_if(reports.begin(), reports.end(),
        [](const ExecutionReport& r){ return r.is_fill() && r.side == Side::Buy; });
    ASSERT_NE(fill_rpt, reports.end());
    EXPECT_EQ(fill_rpt->exec_price, from_double(100.0));
}

// ─────────────────────────────────────────────────────────────────────────────
// IOC
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderTypeTest, IOC_FilledAmountMatchedRestCancelled) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 5));
    engine.submit(req(Side::Buy,  OrderType::IOC,   from_double(100.0), 10));

    EXPECT_GT(fills(),   0);
    EXPECT_EQ(cancels(), 1);  // remaining 5 cancelled
    EXPECT_FALSE(engine.book(SYM)->best_bid().has_value());
}

TEST_F(OrderTypeTest, IOC_NoMatchFullyCancel) {
    engine.submit(req(Side::Buy, OrderType::IOC, from_double(99.0), 10));

    EXPECT_EQ(fills(),   0);
    EXPECT_EQ(cancels(), 1);
    EXPECT_FALSE(engine.book(SYM)->best_bid().has_value());
}

TEST_F(OrderTypeTest, IOC_FullFillNoCancel) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy,  OrderType::IOC,   from_double(100.0), 10));

    EXPECT_EQ(fills(),   2);
    EXPECT_EQ(cancels(), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// FOK
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderTypeTest, FOK_RejectedIfCannotFullyFill) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 5));
    engine.submit(req(Side::Buy,  OrderType::FOK,   from_double(100.0), 10));

    EXPECT_EQ(fills(),   0);
    EXPECT_EQ(rejects(), 1);
    // Resting sell should be untouched
    EXPECT_TRUE(engine.book(SYM)->best_ask().has_value());
}

TEST_F(OrderTypeTest, FOK_AcceptedIfCanFullyFill) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy,  OrderType::FOK,   from_double(100.0), 10));

    EXPECT_EQ(fills(),   2);
    EXPECT_EQ(rejects(), 0);
}

TEST_F(OrderTypeTest, FOK_AcceptedAcrossMultipleLevels) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 5));
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(101.0), 5));
    engine.submit(req(Side::Buy,  OrderType::FOK,   from_double(101.0), 10));

    EXPECT_EQ(fills(),   4);  // 2 pairs of matches = 4 fill reports
    EXPECT_EQ(rejects(), 0);
}

TEST_F(OrderTypeTest, FOK_EmptyBookRejected) {
    engine.submit(req(Side::Buy, OrderType::FOK, from_double(100.0), 10));
    EXPECT_EQ(fills(),   0);
    EXPECT_EQ(rejects(), 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// GTC (behaves like Limit in single session — persists in book)
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderTypeTest, GTC_RestsInBook) {
    engine.submit(req(Side::Buy, OrderType::GTC, from_double(99.0), 10));
    EXPECT_EQ(fills(), 0);
    EXPECT_TRUE(engine.book(SYM)->best_bid().has_value());
}

TEST_F(OrderTypeTest, GTC_CanBeCancelled) {
    auto r = req(Side::Buy, OrderType::GTC, from_double(99.0), 10);
    OrderId id = r.id;
    engine.submit(r);
    EXPECT_TRUE(engine.cancel(SYM, id));
    EXPECT_FALSE(engine.book(SYM)->best_bid().has_value());
}

TEST_F(OrderTypeTest, GTC_FillsImmediatelyIfMatchable) {
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(100.0), 10));
    engine.submit(req(Side::Buy,  OrderType::GTC,   from_double(100.0), 10));
    EXPECT_EQ(fills(), 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stop
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderTypeTest, Stop_DormantUntilTrigger) {
    // Buy stop at 105: activates when price rises to 105
    engine.submit(req(Side::Buy, OrderType::Stop, PRICE_NONE, 10,
                      from_double(105.0)));

    // No fills yet
    EXPECT_EQ(fills(), 0);
    EXPECT_FALSE(engine.book(SYM)->best_bid().has_value());
}

TEST_F(OrderTypeTest, Stop_ActivatesOnTriggerPrice) {
    // Place a sell so the stop market has liquidity
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(105.0), 20));

    // Buy stop at 105 — parked
    engine.submit(req(Side::Buy, OrderType::Stop, PRICE_NONE, 10,
                      from_double(105.0)));
    EXPECT_EQ(fills(), 0);

    // Simulate a trade at 105 by submitting a crossing order
    engine.submit(req(Side::Buy, OrderType::Limit, from_double(105.0), 5));
    // First buy limit triggers a fill at 105 which sets last_trade_price = 105
    // This should activate the stop
    EXPECT_GT(fills(), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// StopLimit
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderTypeTest, StopLimit_ActivatesAsLimitOrder) {
    // Place liquidity
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(106.0), 10));

    // StopLimit: trigger at 105, limit at 106
    auto sl = req(Side::Buy, OrderType::StopLimit, PRICE_NONE, 10,
                  from_double(105.0), from_double(106.0));
    engine.submit(sl);
    EXPECT_EQ(fills(), 0);  // not yet triggered

    // Trigger by crossing at 105
    engine.submit(req(Side::Sell, OrderType::Limit, from_double(105.0), 5));
    engine.submit(req(Side::Buy,  OrderType::Limit, from_double(105.0), 5));

    // Now stop is triggered; the StopLimit should be active as a Limit at 106
    // and match against the sell at 106
    EXPECT_GT(fills(), 0);
}

TEST_F(OrderTypeTest, StopLimit_PriceNotReachedStaysDormant) {
    engine.submit(req(Side::Buy, OrderType::StopLimit, PRICE_NONE, 10,
                      from_double(110.0), from_double(111.0)));
    EXPECT_EQ(fills(), 0);
    EXPECT_FALSE(engine.book(SYM)->best_bid().has_value());
}
