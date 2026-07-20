// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — OrderBook Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

#include <gtest/gtest.h>
#include "ultralob/order_book.hpp"
#include "ultralob/order_pool.hpp"

using namespace ultralob;

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────
class OrderBookTest : public ::testing::Test {
protected:
    static constexpr Symbol SYM = 1;

    OrderPool pool{1000};

    // Capture execution reports
    std::vector<ExecutionReport> reports;

    static void exec_cb(const ExecutionReport& rpt, void* ctx) {
        auto* self = static_cast<OrderBookTest*>(ctx);
        self->reports.push_back(rpt);
    }

    OrderBook book{SYM, pool, exec_cb, this};

    OrderId next_id = 1;

    Order* make_limit(Side side, Price price, Qty qty) {
        return book.make_order(next_id++, 0, side, OrderType::Limit,
                               price, qty, PRICE_NONE, PRICE_NONE, 0);
    }

    void submit(Order* o) { book.submit(o); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests: book structure
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderBookTest, EmptyBookHasNoBestPrices) {
    EXPECT_FALSE(book.best_bid().has_value());
    EXPECT_FALSE(book.best_ask().has_value());
}

TEST_F(OrderBookTest, SingleBidUpdatesBook) {
    auto* o = make_limit(Side::Buy, from_double(100.0), 10);
    submit(o);

    ASSERT_TRUE(book.best_bid().has_value());
    EXPECT_EQ(*book.best_bid(), from_double(100.0));
    EXPECT_FALSE(book.best_ask().has_value());
}

TEST_F(OrderBookTest, SingleAskUpdatesBook) {
    auto* o = make_limit(Side::Sell, from_double(101.0), 10);
    submit(o);

    ASSERT_TRUE(book.best_ask().has_value());
    EXPECT_EQ(*book.best_ask(), from_double(101.0));
    EXPECT_FALSE(book.best_bid().has_value());
}

TEST_F(OrderBookTest, BestBidIsHighestPrice) {
    submit(make_limit(Side::Buy, from_double(99.0),  5));
    submit(make_limit(Side::Buy, from_double(100.0), 5));
    submit(make_limit(Side::Buy, from_double(98.0),  5));

    EXPECT_EQ(*book.best_bid(), from_double(100.0));
}

TEST_F(OrderBookTest, BestAskIsLowestPrice) {
    submit(make_limit(Side::Sell, from_double(102.0), 5));
    submit(make_limit(Side::Sell, from_double(101.0), 5));
    submit(make_limit(Side::Sell, from_double(103.0), 5));

    EXPECT_EQ(*book.best_ask(), from_double(101.0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: cancel
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderBookTest, CancelRestingOrder) {
    auto* o = make_limit(Side::Buy, from_double(100.0), 10);
    OrderId id = o->id;
    submit(o);

    ASSERT_TRUE(book.best_bid().has_value());
    bool cancelled = book.cancel(id);
    EXPECT_TRUE(cancelled);
    EXPECT_FALSE(book.best_bid().has_value());

    // Should get a cancel report
    auto cancel_rpt = std::find_if(reports.begin(), reports.end(),
        [](const ExecutionReport& r) {
            return r.status == OrderStatus::Cancelled;
        });
    EXPECT_NE(cancel_rpt, reports.end());
}

TEST_F(OrderBookTest, CancelUnknownOrderReturnsFalse) {
    EXPECT_FALSE(book.cancel(99999));
}

TEST_F(OrderBookTest, CancelOneOfMultipleAtSamePrice) {
    submit(make_limit(Side::Buy, from_double(100.0), 10));
    auto* o2 = make_limit(Side::Buy, from_double(100.0), 20);
    OrderId id2 = o2->id;
    submit(o2);
    submit(make_limit(Side::Buy, from_double(100.0), 30));

    EXPECT_TRUE(book.cancel(id2));
    // Level still exists with 2 orders
    ASSERT_TRUE(book.best_bid().has_value());
    EXPECT_EQ(*book.best_bid(), from_double(100.0));
    EXPECT_EQ(book.bids().best_level()->count(), 2u);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: modify
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderBookTest, ModifyQtyReducePreservesTimePriority) {
    auto* o1 = make_limit(Side::Buy, from_double(100.0), 100);
    OrderId id1 = o1->id;
    submit(o1);
    submit(make_limit(Side::Buy, from_double(100.0), 50));

    // Reduce o1's qty — should stay at front
    book.modify({SYM, id1, 0, 80});

    Order* front = book.bids().best_level()->front();
    EXPECT_EQ(front->id, id1);
    EXPECT_EQ(front->leaves_qty, 80u);
}

TEST_F(OrderBookTest, ModifyPriceLosesTimePriority) {
    auto* o1 = make_limit(Side::Buy, from_double(100.0), 100);
    OrderId id1 = o1->id;
    submit(o1);
    submit(make_limit(Side::Buy, from_double(100.0), 50));  // o2

    // Change price: o1 goes to end of queue at new price
    book.modify({SYM, id1, from_double(99.0), 0});

    // At original price, only o2 remains
    // At 99.0, o1 is the only order
    EXPECT_EQ(*book.best_bid(), from_double(100.0));
    EXPECT_EQ(book.bids().best_level()->count(), 1u);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: FIFO ordering
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderBookTest, FIFOOrderingAtSamePrice) {
    // Place 3 buy orders at same price
    auto* o1 = make_limit(Side::Buy, from_double(100.0), 10); OrderId id1 = o1->id;
    auto* o2 = make_limit(Side::Buy, from_double(100.0), 10); OrderId id2 = o2->id;
    auto* o3 = make_limit(Side::Buy, from_double(100.0), 10); OrderId id3 = o3->id;
    submit(o1); submit(o2); submit(o3);

    // Place a matching sell: should fill in FIFO order
    auto* sell = book.make_order(next_id++, 0, Side::Sell, OrderType::Limit,
                                 from_double(100.0), 25, PRICE_NONE, PRICE_NONE, 0);
    submit(sell);

    // Check fill reports: o1 fully filled (10), o2 fully filled (10), o3 partial (5)
    int fills_for_o1 = 0, fills_for_o2 = 0, fills_for_o3 = 0;
    for (auto& r : reports) {
        if (!r.is_fill()) continue;
        if (r.order_id == id1) ++fills_for_o1;
        if (r.order_id == id2) ++fills_for_o2;
        if (r.order_id == id3) ++fills_for_o3;
    }
    EXPECT_GE(fills_for_o1, 1);
    EXPECT_GE(fills_for_o2, 1);
    EXPECT_GE(fills_for_o3, 1);

    // o1 and o2 should be fully filled (gone from book)
    EXPECT_EQ(book.find(id1), nullptr);
    EXPECT_EQ(book.find(id2), nullptr);
    // o3 partially filled — still in book
    EXPECT_NE(book.find(id3), nullptr);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: level removal
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(OrderBookTest, PriceLevelRemovedWhenEmpty) {
    auto* bid = make_limit(Side::Buy, from_double(100.0), 10);
    auto* ask = book.make_order(next_id++, 0, Side::Sell, OrderType::Limit,
                                from_double(100.0), 10, PRICE_NONE, PRICE_NONE, 0);
    submit(bid);
    submit(ask);  // full fill → level disappears

    EXPECT_FALSE(book.best_bid().has_value());
    EXPECT_FALSE(book.best_ask().has_value());
}

TEST_F(OrderBookTest, DepthDecrementsOnCancel) {
    submit(make_limit(Side::Sell, from_double(101.0), 10));
    submit(make_limit(Side::Sell, from_double(102.0), 10));
    auto* o = make_limit(Side::Sell, from_double(103.0), 10);
    OrderId id = o->id;
    submit(o);

    EXPECT_EQ(book.asks().depth(), 3u);
    book.cancel(id);
    EXPECT_EQ(book.asks().depth(), 2u);
}
