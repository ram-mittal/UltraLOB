// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — MatchingEngine Implementation
// ─────────────────────────────────────────────────────────────────────────────

#include "ultralob/matching_engine.hpp"
#include "ultralob/util/profiler.hpp"

#include <chrono>
#include <stdexcept>
#include <cassert>

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
static Nanos now_nanos() noexcept {
    using namespace std::chrono;
    return duration_cast<nanoseconds>(
        steady_clock::now().time_since_epoch()).count();
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbol management
// ─────────────────────────────────────────────────────────────────────────────
bool MatchingEngine::add_symbol(Symbol symbol,
                                ExecCallback callback,
                                void*        cb_ctx)
{
    if (books_.contains(symbol)) {
        return false;
    }
    auto book  = std::make_unique<OrderBook>(symbol, pool_, callback, cb_ctx);
    auto stats = std::make_unique<Statistics>(*book);
    books_.emplace(symbol, BookEntry{std::move(book), std::move(stats)});
    return true;
}

void MatchingEngine::remove_symbol(Symbol symbol) {
    books_.erase(symbol);
}

bool MatchingEngine::has_symbol(Symbol symbol) const noexcept {
    return books_.contains(symbol);
}

// ─────────────────────────────────────────────────────────────────────────────
// Accessors
// ─────────────────────────────────────────────────────────────────────────────
OrderBook* MatchingEngine::book(Symbol symbol) noexcept {
    auto it = books_.find(symbol);
    return (it != books_.end()) ? it->second.book.get() : nullptr;
}

Statistics* MatchingEngine::stats(Symbol symbol) noexcept {
    auto it = books_.find(symbol);
    return (it != books_.end()) ? it->second.stats.get() : nullptr;
}

// ─────────────────────────────────────────────────────────────────────────────
// allocate_and_validate — create an Order and validate all parameters
// ─────────────────────────────────────────────────────────────────────────────
Order* MatchingEngine::allocate_and_validate(const OrderRequest& req,
                                              RejectReason& reason) noexcept
{
    // Basic validation
    if (req.id == INVALID_ORDER_ID) {
        reason = RejectReason::InvalidOrderId;
        return nullptr;
    }
    if (req.qty == 0) {
        reason = RejectReason::InvalidQty;
        return nullptr;
    }

    // Price validation for order types that require it
    switch (req.type) {
        case OrderType::Limit:
        case OrderType::GTC:
        case OrderType::IOC:
        case OrderType::FOK:
            if (req.price <= 0) {
                reason = RejectReason::InvalidPrice;
                return nullptr;
            }
            break;
        case OrderType::Stop:
        case OrderType::StopLimit:
            if (req.stop_price <= 0) {
                reason = RejectReason::InvalidPrice;
                return nullptr;
            }
            if (req.type == OrderType::StopLimit && req.limit_price <= 0) {
                reason = RejectReason::InvalidPrice;
                return nullptr;
            }
            break;
        case OrderType::Market:
            break;
    }

    auto it = books_.find(req.symbol);
    if (it == books_.end()) {
        reason = RejectReason::UnknownSymbol;
        return nullptr;
    }

    // Check for duplicate order ID
    if (it->second.book->find(req.id) != nullptr) {
        reason = RejectReason::DuplicateId;
        return nullptr;
    }

    Order* o = it->second.book->make_order(
        req.id,
        req.client_id,
        req.side,
        req.type,
        req.price,
        req.qty,
        req.stop_price,
        req.limit_price,
        req.timestamp == 0 ? now_nanos() : req.timestamp);

    if (!o) [[unlikely]] {
        reason = RejectReason::PoolExhausted;
        return nullptr;
    }

    reason = RejectReason::None;
    return o;
}

// ─────────────────────────────────────────────────────────────────────────────
// submit
// ─────────────────────────────────────────────────────────────────────────────
Order* MatchingEngine::submit(const OrderRequest& req) {
    TRACE_EVENT("MatchingEngine::submit");
    RejectReason reason = RejectReason::None;
    Order* o = allocate_and_validate(req, reason);

    if (!o) [[unlikely]] {
        // Emit rejection via the book's callback if we can find the book
        auto it = books_.find(req.symbol);
        if (it != books_.end() && reason != RejectReason::UnknownSymbol) {
            // Build a synthetic report on the stack (no pool allocation needed)
            ExecutionReport rpt{
                .order_id   = req.id,
                .contra_order_id = 0,
                .client_id  = req.client_id,
                .symbol     = req.symbol,
                .side       = req.side,
                .order_type = req.type,
                .status     = OrderStatus::Rejected,
                .exec_price = PRICE_NONE,
                .exec_qty   = 0,
                .leaves_qty = req.qty,
                .cum_qty    = 0,
                .timestamp  = now_nanos(),
            };
            it->second.book->emit_rejection(rpt);
        }
        return nullptr;
    }

    auto it = books_.find(req.symbol);
    assert(it != books_.end());

    // Update VWAP stats via a wrapper callback
    // (Statistics::on_fill is called via the exec callback set at add_symbol)
    it->second.book->submit(o);
    return o;  // NOTE: may be nullptr if pool released it after filling
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel
// ─────────────────────────────────────────────────────────────────────────────
bool MatchingEngine::cancel(Symbol symbol, OrderId order_id) {
    auto it = books_.find(symbol);
    if (it == books_.end()) return false;
    return it->second.book->cancel(order_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// modify
// ─────────────────────────────────────────────────────────────────────────────
bool MatchingEngine::modify(Symbol symbol, const ModifyRequest& req) {
    auto it = books_.find(symbol);
    if (it == books_.end()) return false;
    return it->second.book->modify(req);
}

} // namespace ultralob
