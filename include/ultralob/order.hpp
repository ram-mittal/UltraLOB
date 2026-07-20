#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Order
//
// A single Order occupies exactly one 128-byte aligned block (two cache lines).
// The intrusive prev/next pointers allow O(1) removal from the price level's
// FIFO queue without scanning.
//
// Memory layout (cache-line friendly grouping):
//   [Line 0] hot match fields: id, price, qty, filled_qty, side, type, status
//   [Line 1] cold fields: stop_price, symbol, timestamp, prev/next pointers
// ─────────────────────────────────────────────────────────────────────────────

#include "types.hpp"
#include <atomic>
#include <cstring>

namespace ultralob {

struct alignas(128) Order {
    // ── Cache line 0: hot matching fields ────────────────────────────────────
    OrderId     id           = INVALID_ORDER_ID;
    uint32_t    client_id    = 0;              // owner of the order
    uint32_t    _pad0        = 0;
    Price       price        = PRICE_NONE;     // limit price (0 for Market)
    Qty         qty          = 0;              // original quantity
    Qty         leaves_qty   = 0;              // remaining unfilled quantity
    Qty         cum_qty      = 0;              // cumulative filled quantity
    Side        side         = Side::Buy;
    OrderType   type         = OrderType::Limit;
    OrderStatus status       = OrderStatus::New;
    uint8_t     _pad0_extra[5] = {};

    // ── Cache line 1: cold / activation fields ────────────────────────────────
    Price       stop_price   = PRICE_NONE;    // trigger for Stop/StopLimit
    Price       limit_price  = PRICE_NONE;    // post-trigger limit (StopLimit)
    Symbol      symbol       = 0;
    Nanos       timestamp    = 0;             // nanoseconds since epoch (insertion time)
    uint32_t    _pad1        = 0;

    // Intrusive doubly-linked list pointers (within a PriceLevel FIFO queue)
    Order*      prev         = nullptr;
    Order*      next         = nullptr;

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    [[nodiscard]] bool is_active() const noexcept {
        return status == OrderStatus::New ||
               status == OrderStatus::PartiallyFilled;
    }

    [[nodiscard]] bool is_filled() const noexcept {
        return status == OrderStatus::Filled;
    }

    [[nodiscard]] bool is_done() const noexcept {
        return status == OrderStatus::Filled    ||
               status == OrderStatus::Cancelled ||
               status == OrderStatus::Rejected;
    }

    [[nodiscard]] bool is_stop() const noexcept {
        return type == OrderType::Stop ||
               type == OrderType::StopLimit;
    }

    [[nodiscard]] bool is_marketable_buy(Price best_ask) const noexcept {
        if (type == OrderType::Market) return true;
        return (side == Side::Buy)  && (price >= best_ask);
    }

    [[nodiscard]] bool is_marketable_sell(Price best_bid) const noexcept {
        if (type == OrderType::Market) return true;
        return (side == Side::Sell) && (price <= best_bid);
    }

    // Apply a fill: update leaves_qty, cum_qty, status
    void apply_fill(Qty fill_qty) noexcept {
        leaves_qty -= fill_qty;
        cum_qty    += fill_qty;
        status = (leaves_qty == 0) ? OrderStatus::Filled
                                   : OrderStatus::PartiallyFilled;
    }

    void cancel() noexcept { status = OrderStatus::Cancelled; }
    void reject() noexcept { status = OrderStatus::Rejected;  }

    void reset() noexcept {
        std::memset(this, 0, sizeof(Order));
    }
};

// Ensure size is exactly 2 cache lines
static_assert(sizeof(Order) == 128, "Order must be 128 bytes (2 cache lines)");
static_assert(alignof(Order) == 128, "Order must be 128-byte aligned");

} // namespace ultralob
