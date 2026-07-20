#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — OrderBook
//
// The core Limit Order Book. Maintains bid and ask sides as sorted price-level
// maps and drives the FIFO price-time priority matching loop.
//
// Bid side: std::map<Price, PriceLevel, std::greater<Price>>
//   → best bid = begin() (highest price)
//
// Ask side: std::map<Price, PriceLevel>
//   → best ask = begin() (lowest price)
//
// Order lookup: unordered_map<OrderId, Order*> for O(1) cancel/modify.
//
// Stop order lists: sorted multimap<Price, Order*> per side, scanned on
// last-trade-price movement.
// ─────────────────────────────────────────────────────────────────────────────

#include "types.hpp"
#include "order.hpp"
#include "order_pool.hpp"
#include "price_level.hpp"

#include <map>
#include <unordered_map>
#include <functional>
#include <optional>
#include <cstddef>
#include <vector>

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// BookSide — one side of the limit order book
// ─────────────────────────────────────────────────────────────────────────────

template <typename PriceCompare = std::less<Price>>
class BookSide {
public:
    using LevelMap = std::map<Price, PriceLevel, PriceCompare>;

    // Add an order to its price level (creates level if absent)
    void add(Order* o) {
        auto& level = levels_[o->price];
        level.add(o);
    }

    // Remove an order from its price level; erase level if empty.
    // Correctly reduces total_qty BEFORE the intrusive list removal.
    void remove_order(Order* o) {
        auto it = levels_.find(o->price);
        if (it == levels_.end()) return;
        it->second.reduce_qty(o->leaves_qty);
        it->second.remove(o);
        if (it->second.empty()) {
            levels_.erase(it);
        }
    }

    // Legacy alias kept for internal match loops (which manage qty explicitly)
    void remove(Order* o) {
        auto it = levels_.find(o->price);
        if (it == levels_.end()) return;
        it->second.remove(o);
        if (it->second.empty()) {
            levels_.erase(it);
        }
    }

    // Reduce leaves_qty on the best order's level (after partial fill)
    void on_partial_fill(Order* o, Qty filled) {
        auto it = levels_.find(o->price);
        if (it != levels_.end()) {
            it->second.reduce_qty(filled);
        }
    }

    // Erase the best level (all orders in it fully matched — level gone)
    void erase_level(Price p) {
        levels_.erase(p);
    }

    [[nodiscard]] PriceLevel*       best_level() noexcept {
        if (levels_.empty()) return nullptr;
        return &levels_.begin()->second;
    }

    [[nodiscard]] const PriceLevel* best_level() const noexcept {
        if (levels_.empty()) return nullptr;
        return &levels_.begin()->second;
    }

    [[nodiscard]] std::optional<Price> best_price() const noexcept {
        if (levels_.empty()) return std::nullopt;
        return levels_.begin()->first;
    }

    [[nodiscard]] bool  empty()       const noexcept { return levels_.empty(); }
    [[nodiscard]] size_t depth()      const noexcept { return levels_.size(); }
    [[nodiscard]] const LevelMap& levels() const noexcept { return levels_; }

private:
    LevelMap levels_;
};

using BidSide = BookSide<std::greater<Price>>;
using AskSide = BookSide<std::less<Price>>;

// ─────────────────────────────────────────────────────────────────────────────
// Modify request parameters
// ─────────────────────────────────────────────────────────────────────────────
struct ModifyRequest {
    Symbol    symbol;
    OrderId   order_id;
    Price     new_price;   // 0 = keep existing
    Qty       new_qty;     // 0 = keep existing
};

// ─────────────────────────────────────────────────────────────────────────────
// OrderBook
// ─────────────────────────────────────────────────────────────────────────────
class OrderBook {
public:
    explicit OrderBook(Symbol symbol,
                       OrderPool& pool,
                       ExecCallback callback  = nullptr,
                       void*        cb_ctx    = nullptr) noexcept
        : symbol_(symbol)
        , pool_(pool)
        , callback_(callback)
        , cb_ctx_(cb_ctx)
    {}

    // Non-copyable
    OrderBook(const OrderBook&)            = delete;
    OrderBook& operator=(const OrderBook&) = delete;

    // ─────────────────────────────────────────────────────────────────────────
    /// Allocate a new Order from the pool and initialize it.
    /// Returns nullptr if the pool is exhausted.
    // ─────────────────────────────────────────────────────────────────────────
    [[nodiscard]] Order* make_order(
        OrderId   id,
        uint32_t  client_id,
        Side      side,
        OrderType type,
        Price     price,
        Qty       qty,
        Price     stop_price  = PRICE_NONE,
        Price     limit_price = PRICE_NONE,
        Nanos     timestamp   = 0) noexcept;

    // ─────────────────────────────────────────────────────────────────────────
    /// Submit a pre-built order to the book.
    /// Routing and matching happen inside.
    // ─────────────────────────────────────────────────────────────────────────
    void submit(Order* o);

    // ─────────────────────────────────────────────────────────────────────────
    /// Cancel an order by ID. Returns true if found and cancelled.
    // ─────────────────────────────────────────────────────────────────────────
    bool cancel(OrderId id);

    // ─────────────────────────────────────────────────────────────────────────
    /// Modify price and/or quantity of a resting order.
    /// - Price change → cancel + re-add (loses time priority)
    /// - Qty reduce at same price → in-place update (preserves time priority)
    /// - Qty increase at same price → cancel + re-add (loses time priority)
    // ─────────────────────────────────────────────────────────────────────────
    bool modify(const ModifyRequest& req);

    // ─────────────────────────────────────────────────────────────────────────
    /// Emit a pre-built rejection report via the callback.
    /// Used by MatchingEngine for validation failures before order allocation.
    // ─────────────────────────────────────────────────────────────────────────
    void emit_rejection(const ExecutionReport& rpt) const noexcept {
        emit(rpt);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Accessors
    // ─────────────────────────────────────────────────────────────────────────

    [[nodiscard]] std::optional<Price> best_bid() const noexcept { return bids_.best_price(); }
    [[nodiscard]] std::optional<Price> best_ask() const noexcept { return asks_.best_price(); }
    [[nodiscard]] Symbol               symbol()   const noexcept { return symbol_; }
    [[nodiscard]] uint64_t             seq_num()  const noexcept { return seq_num_; }
    [[nodiscard]] Price                last_trade_price() const noexcept { return last_trade_price_; }

    [[nodiscard]] const BidSide& bids() const noexcept { return bids_; }
    [[nodiscard]] const AskSide& asks() const noexcept { return asks_; }

    // Lookup a resting order by ID (returns nullptr if not found / done)
    [[nodiscard]] Order* find(OrderId id) const noexcept;

    // ─────────────────────────────────────────────────────────────────────────
    // Stop order activation (called by matching engine after each fill)
    // ─────────────────────────────────────────────────────────────────────────
    void activate_stops(Price new_last_trade_price);

private:
    // ── Internal matching ────────────────────────────────────────────────────

    /// Match an incoming Buy order against the ask side.
    void match_buy(Order* aggressor);

    /// Match an incoming Sell order against the bid side.
    void match_sell(Order* aggressor);

    /// Check if a full-fill of qty is possible (for FOK pre-check).
    [[nodiscard]] bool can_fill_buy(Qty qty, Price limit) const noexcept;
    [[nodiscard]] bool can_fill_sell(Qty qty, Price limit) const noexcept;

    /// Post a resting order to the appropriate side.
    void post(Order* o);

    /// Execute a single fill between aggressor and resting order.
    void fill(Order* aggressor, Order* resting, Qty fill_qty, Price fill_price);

    /// Emit an execution report via the callback.
    void emit(const ExecutionReport& rpt) const noexcept;

    /// Release a fully-done order back to the pool.
    void release_done(Order* o);

    /// Add a stop order to the appropriate stop list.
    void add_to_stop_list(Order* o);

    /// Remove a stop order from its list.
    void remove_from_stop_list(Order* o);

    // ── Data members ─────────────────────────────────────────────────────────

    Symbol       symbol_;
    OrderPool&   pool_;
    ExecCallback callback_ = nullptr;
    void*        cb_ctx_   = nullptr;

    BidSide      bids_;
    AskSide      asks_;

    // O(1) order lookup by ID
    std::unordered_map<OrderId, Order*> order_map_;

    // Stop order lists: Buy stops activate when last_trade >= stop_price
    //                   Sell stops activate when last_trade <= stop_price
    std::multimap<Price, Order*> buy_stops_;   // ascending: lowest trigger first
    std::multimap<Price, Order*> sell_stops_;  // descending: highest trigger first

    Price    last_trade_price_ = PRICE_NONE;
    uint64_t seq_num_          = 0;
};

} // namespace ultralob
