#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — MatchingEngine
//
// The top-level order router. Accepts raw order parameters, allocates an Order
// from the pool, validates it, and submits it to the appropriate OrderBook.
//
// Supports multiple symbols (one OrderBook per Symbol).
// Stop order activation is driven through OrderBook::activate_stops().
//
// Design: single-threaded matching engine per symbol — identical to how
// real exchanges (Nasdaq, CME) partition their matching engines.
// ─────────────────────────────────────────────────────────────────────────────

#include "types.hpp"
#include "order.hpp"
#include "order_book.hpp"
#include "order_pool.hpp"
#include "statistics.hpp"

#include <unordered_map>
#include <memory>
#include <string>
#include <string_view>

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// Order submission request (external API boundary object)
// ─────────────────────────────────────────────────────────────────────────────
struct OrderRequest {
    OrderId   id          = INVALID_ORDER_ID;
    uint32_t  client_id   = 0;
    Symbol    symbol      = 0;
    Side      side        = Side::Buy;
    OrderType type        = OrderType::Limit;
    Price     price       = PRICE_NONE;   // limit price (0 for Market)
    Price     stop_price  = PRICE_NONE;   // Stop/StopLimit trigger
    Price     limit_price = PRICE_NONE;   // StopLimit post-trigger limit
    Qty       qty         = 0;
    Nanos     timestamp   = 0;            // if 0, engine stamps with current time
};

// ─────────────────────────────────────────────────────────────────────────────
// Rejection reason codes
// ─────────────────────────────────────────────────────────────────────────────
enum class RejectReason : uint8_t {
    None            = 0,
    InvalidQty      = 1,
    InvalidPrice    = 2,
    InvalidOrderId  = 3,
    DuplicateId     = 4,
    UnknownSymbol   = 5,
    PoolExhausted   = 6,
    FOKFailed       = 7,   // FOK pre-check: insufficient liquidity
    MarketNoLiq     = 8,   // Market order with empty opposite side
    UnknownOrder    = 9,
};

[[nodiscard]] inline constexpr std::string_view to_string(RejectReason r) noexcept {
    switch (r) {
        case RejectReason::None:           return "None";
        case RejectReason::InvalidQty:     return "InvalidQty";
        case RejectReason::InvalidPrice:   return "InvalidPrice";
        case RejectReason::InvalidOrderId: return "InvalidOrderId";
        case RejectReason::DuplicateId:    return "DuplicateId";
        case RejectReason::UnknownSymbol:  return "UnknownSymbol";
        case RejectReason::PoolExhausted:  return "PoolExhausted";
        case RejectReason::FOKFailed:      return "FOKFailed";
        case RejectReason::MarketNoLiq:    return "MarketNoLiq";
        case RejectReason::UnknownOrder:   return "UnknownOrder";
    }
    return "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// MatchingEngine
// ─────────────────────────────────────────────────────────────────────────────
class MatchingEngine {
public:
    explicit MatchingEngine(size_t pool_capacity = OrderPool::DEFAULT_CAPACITY)
        : pool_(pool_capacity)
    {}

    // ─────────────────────────────────────────────────────────────────────────
    /// Register a symbol. Must be called before submitting orders for it.
    // ─────────────────────────────────────────────────────────────────────────
    bool add_symbol(Symbol symbol,
                    ExecCallback callback = nullptr,
                    void*        cb_ctx   = nullptr);

    void remove_symbol(Symbol symbol);

    [[nodiscard]] bool has_symbol(Symbol symbol) const noexcept;

    // ─────────────────────────────────────────────────────────────────────────
    /// Submit a new order. Returns the assigned Order* (or nullptr on reject).
    /// Rejection is also signalled via the ExecutionReport callback.
    // ─────────────────────────────────────────────────────────────────────────
    [[nodiscard]] Order* submit(const OrderRequest& req);

    // ─────────────────────────────────────────────────────────────────────────
    /// Cancel an order by symbol + order ID.
    // ─────────────────────────────────────────────────────────────────────────
    bool cancel(Symbol symbol, OrderId order_id);

    // ─────────────────────────────────────────────────────────────────────────
    /// Modify a resting order.
    // ─────────────────────────────────────────────────────────────────────────
    bool modify(Symbol symbol, const ModifyRequest& req);

    // ─────────────────────────────────────────────────────────────────────────
    // Accessors
    // ─────────────────────────────────────────────────────────────────────────
    [[nodiscard]] OrderPool&   pool()   noexcept { return pool_; }
    [[nodiscard]] OrderBook*   book(Symbol symbol) noexcept;
    [[nodiscard]] Statistics*  stats(Symbol symbol) noexcept;

    [[nodiscard]] size_t symbol_count() const noexcept { return books_.size(); }

private:
    [[nodiscard]] Order* allocate_and_validate(const OrderRequest& req,
                                                RejectReason& reason) noexcept;

    struct BookEntry {
        std::unique_ptr<OrderBook>  book;
        std::unique_ptr<Statistics> stats;
    };

    OrderPool pool_;
    std::unordered_map<Symbol, BookEntry> books_;
};

} // namespace ultralob
