// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — OrderBook Implementation
//
// Implements FIFO price-time priority matching for all order types.
// ─────────────────────────────────────────────────────────────────────────────

#include "ultralob/order_book.hpp"
#include "ultralob/util/profiler.hpp"

#include <chrono>
#include <cassert>
#include <algorithm>
#include <stdexcept>

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

static Nanos now_nanos() noexcept {
    using namespace std::chrono;
    return duration_cast<nanoseconds>(
        steady_clock::now().time_since_epoch()).count();
}

// ─────────────────────────────────────────────────────────────────────────────
// make_order
// ─────────────────────────────────────────────────────────────────────────────
Order* OrderBook::make_order(
    OrderId   id,
    uint32_t  client_id,
    Side      side,
    OrderType type,
    Price     price,
    Qty       qty,
    Price     stop_price,
    Price     limit_price,
    Nanos     timestamp) noexcept
{
    Order* o = pool_.acquire();
    if (!o) [[unlikely]] return nullptr;

    o->id          = id;
    o->client_id   = client_id;
    o->side        = side;
    o->type        = type;
    o->price       = price;
    o->qty         = qty;
    o->leaves_qty  = qty;
    o->cum_qty     = 0;
    o->stop_price  = stop_price;
    o->limit_price = limit_price;
    o->symbol      = symbol_;
    o->timestamp   = (timestamp == 0) ? now_nanos() : timestamp;
    o->status      = (type == OrderType::Stop || type == OrderType::StopLimit)
                         ? OrderStatus::PendingActivation
                         : OrderStatus::New;
    return o;
}

// ─────────────────────────────────────────────────────────────────────────────
// emit
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::emit(const ExecutionReport& rpt) const noexcept {
    if (callback_) callback_(rpt, cb_ctx_);
}

// ─────────────────────────────────────────────────────────────────────────────
// fill — executes a single match between aggressor and resting order
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::fill(Order* aggressor, Order* resting,
                     Qty fill_qty, Price fill_price)
{
    assert(fill_qty > 0);
    assert(fill_qty <= aggressor->leaves_qty);
    assert(fill_qty <= resting->leaves_qty);

    ++seq_num_;

    // Apply fill to both sides
    aggressor->apply_fill(fill_qty);
    resting->apply_fill(fill_qty);

    // Update last trade price and activate stops if needed
    activate_stops(fill_price);
    last_trade_price_ = fill_price;

    // Emit fill report for aggressor
    emit({
        .order_id        = aggressor->id,
        .contra_order_id = resting->id,
        .client_id       = aggressor->client_id,
        .symbol          = symbol_,
        .side            = aggressor->side,
        .order_type      = aggressor->type,
        .status          = aggressor->status,
        .exec_price      = fill_price,
        .exec_qty        = fill_qty,
        .leaves_qty      = aggressor->leaves_qty,
        .cum_qty         = aggressor->cum_qty,
        .timestamp       = now_nanos(),
    });

    // Emit fill report for resting order
    emit({
        .order_id        = resting->id,
        .contra_order_id = aggressor->id,
        .client_id       = resting->client_id,
        .symbol          = symbol_,
        .side            = resting->side,
        .order_type      = resting->type,
        .status          = resting->status,
        .exec_price      = fill_price,
        .exec_qty        = fill_qty,
        .leaves_qty      = resting->leaves_qty,
        .cum_qty         = resting->cum_qty,
        .timestamp       = now_nanos(),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// release_done — return a completed order to the pool
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::release_done(Order* o) {
    order_map_.erase(o->id);
    pool_.release(o);
}

// ─────────────────────────────────────────────────────────────────────────────
// post — add a resting order to the book
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::post(Order* o) {
    order_map_.emplace(o->id, o);
    if (o->side == Side::Buy) {
        bids_.add(o);
    } else {
        asks_.add(o);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// can_fill_buy / can_fill_sell — FOK pre-check
// Walk the ask/bid side and see if qty can be fully filled
// ─────────────────────────────────────────────────────────────────────────────
bool OrderBook::can_fill_buy(Qty qty, Price limit) const noexcept {
    Qty remaining = qty;
    for (auto& [ask_price, level] : asks_.levels()) {
        if (limit != PRICE_NONE && ask_price > limit) break;
        if (level.total_qty() >= remaining) return true;
        remaining -= level.total_qty();
    }
    return remaining == 0;
}

bool OrderBook::can_fill_sell(Qty qty, Price limit) const noexcept {
    Qty remaining = qty;
    for (auto& [bid_price, level] : bids_.levels()) {
        if (limit != PRICE_NONE && bid_price < limit) break;
        if (level.total_qty() >= remaining) return true;
        remaining -= level.total_qty();
    }
    return remaining == 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// match_buy — match an incoming Buy against the ask side
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::match_buy(Order* aggressor) {
    TRACE_EVENT("OrderBook::match_buy");
    while (aggressor->leaves_qty > 0 && !asks_.empty()) {
        auto best_ask_price_opt = asks_.best_price();
        if (!best_ask_price_opt) break;
        Price best_ask_price = *best_ask_price_opt;

        // Price check: Limit/StopLimit orders won't cross above their limit
        if (aggressor->type == OrderType::Limit ||
            aggressor->type == OrderType::GTC   ||
            aggressor->type == OrderType::StopLimit)
        {
            if (aggressor->price < best_ask_price) break;
        }

        PriceLevel* level = asks_.best_level();
        assert(level && !level->empty());

        while (aggressor->leaves_qty > 0 && !level->empty()) {
            Order* resting = level->front();
            Qty fill_qty = std::min(aggressor->leaves_qty, resting->leaves_qty);
            Price fill_price = resting->price;

            fill(aggressor, resting, fill_qty, fill_price);

            if (resting->is_filled()) {
                // remove() subtracts resting->leaves_qty (now 0) from total_qty,
                // but we need to reduce by fill_qty. Reduce first, then remove.
                level->reduce_qty(fill_qty);  // leaves_qty is 0 now, so remove() won't double-subtract
                level->remove(resting);
                release_done(resting);
            } else {
                // Partial fill: resting stays; reduce the level's total_qty
                level->reduce_qty(fill_qty);
            }
        }

        // If level is now empty, erase it from the book
        if (level->empty()) {
            asks_.erase_level(best_ask_price);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// match_sell — match an incoming Sell against the bid side
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::match_sell(Order* aggressor) {
    TRACE_EVENT("OrderBook::match_sell");
    while (aggressor->leaves_qty > 0 && !bids_.empty()) {
        auto best_bid_price_opt = bids_.best_price();
        if (!best_bid_price_opt) break;
        Price best_bid_price = *best_bid_price_opt;

        // Price check for limit-style orders
        if (aggressor->type == OrderType::Limit ||
            aggressor->type == OrderType::GTC   ||
            aggressor->type == OrderType::StopLimit)
        {
            if (aggressor->price > best_bid_price) break;
        }

        PriceLevel* level = bids_.best_level();
        assert(level && !level->empty());

        while (aggressor->leaves_qty > 0 && !level->empty()) {
            Order* resting = level->front();
            Qty fill_qty = std::min(aggressor->leaves_qty, resting->leaves_qty);
            Price fill_price = resting->price;

            fill(aggressor, resting, fill_qty, fill_price);

            if (resting->is_filled()) {
                level->reduce_qty(fill_qty);
                level->remove(resting);
                release_done(resting);
            } else {
                level->reduce_qty(fill_qty);
            }
        }

        if (level->empty()) {
            bids_.erase_level(best_bid_price);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// add_to_stop_list / remove_from_stop_list
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::add_to_stop_list(Order* o) {
    if (o->side == Side::Buy) {
        buy_stops_.emplace(o->stop_price, o);
    } else {
        sell_stops_.emplace(o->stop_price, o);
    }
    order_map_.emplace(o->id, o);
}

void OrderBook::remove_from_stop_list(Order* o) {
    auto& stops = (o->side == Side::Buy) ? buy_stops_ : sell_stops_;
    auto range = stops.equal_range(o->stop_price);
    for (auto it = range.first; it != range.second; ++it) {
        if (it->second == o) {
            stops.erase(it);
            break;
        }
    }
    order_map_.erase(o->id);
}

// ─────────────────────────────────────────────────────────────────────────────
// activate_stops — scan stop lists after last-trade-price moves
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::activate_stops(Price new_last_trade_price) {
    if (new_last_trade_price == last_trade_price_) return;

    // Buy stops: trigger when price rises to or above stop_price
    // (buy stops are used for stop-loss on short positions / breakout entries)
    if (new_last_trade_price > last_trade_price_ || last_trade_price_ == PRICE_NONE) {
        // Activate buy stops with stop_price <= new_last_trade_price
        std::vector<Order*> to_activate;
        for (auto it = buy_stops_.begin();
             it != buy_stops_.end() && it->first <= new_last_trade_price;
             ++it)
        {
            to_activate.push_back(it->second);
        }
        for (Order* o : to_activate) {
            buy_stops_.erase(buy_stops_.find(o->stop_price));
            order_map_.erase(o->id);

            if (o->type == OrderType::Stop) {
                // Convert to Market
                o->type   = OrderType::Market;
                o->price  = PRICE_NONE;
                o->status = OrderStatus::New;
                submit(o);
            } else {
                // StopLimit: convert to Limit at limit_price
                o->type   = OrderType::Limit;
                o->price  = o->limit_price;
                o->status = OrderStatus::New;
                submit(o);
            }
        }
    }

    // Sell stops: trigger when price falls to or below stop_price
    if (new_last_trade_price < last_trade_price_ || last_trade_price_ == PRICE_NONE) {
        std::vector<Order*> to_activate;
        for (auto it = sell_stops_.begin();
             it != sell_stops_.end() && it->first >= new_last_trade_price;
             ++it)
        {
            to_activate.push_back(it->second);
        }
        for (Order* o : to_activate) {
            sell_stops_.erase(sell_stops_.find(o->stop_price));
            order_map_.erase(o->id);

            if (o->type == OrderType::Stop) {
                o->type   = OrderType::Market;
                o->price  = PRICE_NONE;
                o->status = OrderStatus::New;
                submit(o);
            } else {
                o->type   = OrderType::Limit;
                o->price  = o->limit_price;
                o->status = OrderStatus::New;
                submit(o);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// submit — main order routing entry point
// ─────────────────────────────────────────────────────────────────────────────
void OrderBook::submit(Order* o) {
    TRACE_EVENT("OrderBook::submit");
    assert(o != nullptr);

    // Emit acknowledgment report
    emit({
        .order_id        = o->id,
        .contra_order_id = 0,
        .client_id       = o->client_id,
        .symbol          = symbol_,
        .side            = o->side,
        .order_type      = o->type,
        .status          = o->status,
        .exec_price      = o->price, // Set to limit price so MD publisher can broadcast it
        .exec_qty        = 0,
        .leaves_qty      = o->leaves_qty,
        .cum_qty         = o->cum_qty,
        .timestamp       = now_nanos(),
    });

    switch (o->type) {


    // ── Stop / StopLimit: park in stop list until triggered ───────────────────
    case OrderType::Stop:
    case OrderType::StopLimit:
        if (o->status == OrderStatus::PendingActivation) {
            add_to_stop_list(o);
            return;
        }
        // Already activated (re-entering as Market or Limit) — fall through
        [[fallthrough]];

    // ── Market ────────────────────────────────────────────────────────────────
    case OrderType::Market:
    {
        if (o->side == Side::Buy)  match_buy(o);
        else                       match_sell(o);

        // Cancel any unfilled remainder (market orders don't rest)
        if (!o->is_filled()) {
            o->cancel();
            emit({
                .order_id   = o->id,
                .symbol     = symbol_,
                .side       = o->side,
                .order_type = o->type,
                .status     = OrderStatus::Cancelled,
                .exec_price = PRICE_NONE,
                .exec_qty   = 0,
                .leaves_qty = o->leaves_qty,
                .cum_qty    = o->cum_qty,
                .timestamp  = now_nanos(),
            });
        }
        release_done(o);
        break;
    }

    // ── IOC ───────────────────────────────────────────────────────────────────
    case OrderType::IOC:
    {
        if (o->side == Side::Buy)  match_buy(o);
        else                       match_sell(o);

        // Cancel unfilled remainder (IOC never rests)
        if (!o->is_filled()) {
            o->cancel();
            emit({
                .order_id   = o->id,
                .symbol     = symbol_,
                .side       = o->side,
                .order_type = o->type,
                .status     = OrderStatus::Cancelled,
                .exec_price = PRICE_NONE,
                .exec_qty   = 0,
                .leaves_qty = o->leaves_qty,
                .cum_qty    = o->cum_qty,
                .timestamp  = now_nanos(),
            });
        }
        release_done(o);
        break;
    }

    // ── FOK ───────────────────────────────────────────────────────────────────
    case OrderType::FOK:
    {
        // Pre-check: can we fill the entire order?
        bool can_fill =
            (o->side == Side::Buy)
                ? can_fill_buy(o->leaves_qty, o->price)
                : can_fill_sell(o->leaves_qty, o->price);

        if (!can_fill) {
            o->reject();
            emit({
                .order_id   = o->id,
                .symbol     = symbol_,
                .side       = o->side,
                .order_type = o->type,
                .status     = OrderStatus::Rejected,
                .exec_price = PRICE_NONE,
                .exec_qty   = 0,
                .leaves_qty = o->leaves_qty,
                .cum_qty    = 0,
                .timestamp  = now_nanos(),
            });
            release_done(o);
            return;
        }

        // Fill the full quantity
        if (o->side == Side::Buy)  match_buy(o);
        else                       match_sell(o);

        if (!o->is_filled()) {
            // Shouldn't happen after a successful pre-check, but be safe
            o->cancel();
        }
        release_done(o);
        break;
    }

    // ── Limit / GTC ───────────────────────────────────────────────────────────
    case OrderType::Limit:
    case OrderType::GTC:
    {
        // Try to match immediately
        if (o->side == Side::Buy)  match_buy(o);
        else                       match_sell(o);

        // Post unfilled remainder to the book
        if (!o->is_filled()) {
            post(o);  // order now rests in the book
        } else {
            release_done(o);
        }
        break;
    }

    } // end switch
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel
// ─────────────────────────────────────────────────────────────────────────────
bool OrderBook::cancel(OrderId id) {
    auto it = order_map_.find(id);
    if (it == order_map_.end()) return false;

    Order* o = it->second;
    if (o->is_done()) return false;

    // Check if it's a stop order
    if (o->status == OrderStatus::PendingActivation) {
        remove_from_stop_list(o);
    } else {
        // remove_order() reduces total_qty then removes from intrusive list
        if (o->side == Side::Buy) bids_.remove_order(o);
        else                      asks_.remove_order(o);
        order_map_.erase(it);
    }

    o->cancel();
    emit({
        .order_id   = id,
        .client_id  = o->client_id,
        .symbol     = symbol_,
        .side       = o->side,
        .order_type = o->type,
        .status     = OrderStatus::Cancelled,
        .exec_price = PRICE_NONE,
        .exec_qty   = 0,
        .leaves_qty = o->leaves_qty,
        .cum_qty    = o->cum_qty,
        .timestamp  = now_nanos(),
    });

    pool_.release(o);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// modify
// ─────────────────────────────────────────────────────────────────────────────
bool OrderBook::modify(const ModifyRequest& req) {
    auto it = order_map_.find(req.order_id);
    if (it == order_map_.end()) return false;

    Order* o = it->second;
    if (!o->is_active()) return false;
    if (o->status == OrderStatus::PendingActivation) return false;

    Price new_price = (req.new_price != 0) ? req.new_price : o->price;
    Qty   new_qty   = (req.new_qty   != 0) ? req.new_qty   : o->leaves_qty;

    bool price_changed = (new_price != o->price);
    bool qty_increased = (new_qty   >  o->leaves_qty);

    if (price_changed || qty_increased) {
        // Must cancel and re-add — loses time priority
        Nanos ts = now_nanos();  // new timestamp → end of queue

        if (o->side == Side::Buy) bids_.remove_order(o);
        else                      asks_.remove_order(o);
        order_map_.erase(it);

        // Re-initialize the order (reuse same memory)
        o->price      = new_price;
        o->qty        = new_qty;
        o->leaves_qty = new_qty;
        o->cum_qty    = 0;
        o->timestamp  = ts;
        o->status     = OrderStatus::New;
        o->prev       = nullptr;
        o->next       = nullptr;

        submit(o);
    } else {
        // Same price, qty reduction → in-place update, preserves priority
        Qty delta = o->leaves_qty - new_qty;
        if (o->side == Side::Buy) bids_.on_partial_fill(o, delta);
        else                      asks_.on_partial_fill(o, delta);
        o->leaves_qty = new_qty;
        o->qty        = new_qty;
    }
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// find
// ─────────────────────────────────────────────────────────────────────────────
Order* OrderBook::find(OrderId id) const noexcept {
    auto it = order_map_.find(id);
    if (it == order_map_.end()) return nullptr;
    return it->second;
}

} // namespace ultralob
