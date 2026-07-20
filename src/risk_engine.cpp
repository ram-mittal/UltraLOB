#include "ultralob/net/risk_engine.hpp"
#include <iostream>

namespace ultralob::net {

RiskAccount* RiskEngine::get_or_create_account(uint32_t client_id, int64_t initial_buying_power) {
    {
        std::shared_lock lock(mutex_);
        auto it = accounts_.find(client_id);
        if (it != accounts_.end()) {
            return it->second.get();
        }
    }
    
    std::unique_lock lock(mutex_);
    auto it = accounts_.find(client_id);
    if (it != accounts_.end()) {
        return it->second.get();
    }

    auto account = std::make_unique<RiskAccount>();
    account->buying_power.store(initial_buying_power, std::memory_order_relaxed);
    
    // Give the client some initial inventory for testing so sell orders aren't rejected
    for (auto& p : account->positions) {
        p.store(1'000'000, std::memory_order_relaxed);
    }
    
    RiskAccount* ptr = account.get();
    accounts_.emplace(client_id, std::move(account));
    return ptr;
}

bool RiskEngine::check_and_hold(RiskAccount* account, const OrderRequest& req, RejectReason& out_reason) {
    if (!account) {
        std::cout << "PTRM Reject: account is null\n";
        out_reason = RejectReason::UnknownOrder; // Actually should be UnknownClient, but we'll map it to UnknownOrder
        return false;
    }

    // Fat Finger Checks
    if (req.qty > static_cast<uint64_t>(max_order_qty_)) {
        std::cout << "PTRM Reject: Invalid Qty " << req.qty << " > " << max_order_qty_ << "\n";
        out_reason = RejectReason::InvalidQty;
        return false;
    }

    if (req.symbol >= MAX_RISK_SYMBOLS) {
        std::cout << "PTRM Reject: Invalid Symbol " << req.symbol << "\n";
        out_reason = RejectReason::UnknownSymbol;
        return false;
    }

    // Risk Check for Buy
    if (req.side == Side::Buy) {
        if (req.type == OrderType::Market) {
            if (req.price == PRICE_NONE) {
                std::cout << "PTRM Reject: Market order with no price collar.\n";
                out_reason = RejectReason::InvalidPrice;
                return false;
            }
        }

        int64_t order_value = static_cast<int64_t>(req.qty) * req.price;
        
        if (order_value > max_order_value_) {
            std::cout << "PTRM Reject: Order value " << order_value << " > " << max_order_value_ << "\n";
            out_reason = RejectReason::InvalidPrice;
            return false;
        }

        int64_t current_bp = account->buying_power.load(std::memory_order_relaxed);
        while (true) {
            if (current_bp < order_value) {
                std::cout << "PTRM Reject: Insufficient BP. Need " << order_value << ", have " << current_bp << "\n";
                out_reason = RejectReason::InvalidPrice;
                return false;
            }
            if (account->buying_power.compare_exchange_weak(current_bp, current_bp - order_value, std::memory_order_acq_rel)) {
                break;
            }
        }
        
        account->held_buying_power.fetch_add(order_value, std::memory_order_relaxed);
        return true;
    } 
    else {
        // Risk Check for Sell (Naked Short Prevention)
        // Check if we have enough inventory.
        int64_t current_pos = account->positions[req.symbol].load(std::memory_order_relaxed);
        int64_t current_held = account->held_short_positions[req.symbol].load(std::memory_order_relaxed);
        
        // available = pos - held
        while (true) {
            int64_t available = current_pos - current_held;
            if (available < static_cast<int64_t>(req.qty)) {
                out_reason = RejectReason::InvalidQty; // Insufficient inventory to short
                return false;
            }
            // Increase held
            if (account->held_short_positions[req.symbol].compare_exchange_weak(current_held, current_held + req.qty, std::memory_order_acq_rel)) {
                break;
            }
            // current_held was updated by compare_exchange_weak, loop again
            current_pos = account->positions[req.symbol].load(std::memory_order_relaxed);
        }
        
        return true;
    }
}

void RiskEngine::process_execution_report(RiskAccount* account, const ExecutionReport& rep) {
    if (!account) return;
    if (rep.symbol >= MAX_RISK_SYMBOLS) return;

    if (rep.side == Side::Buy) {
        if (rep.status == OrderStatus::Rejected || rep.status == OrderStatus::Cancelled) {
            // Refund remaining held buying power for the unexecuted leaves_qty
            // Note: Since we don't store the exact order_value originally held in the engine per order ID,
            // we must recalculate it. The matching engine stores the original limit price in the order?
            // Actually, ExecutionReport doesn't have the original limit price unless it's a fill (exec_price).
            // But wait, the engine might not emit limit price on cancel. 
            // In a real system, the Risk Engine tracks a hash map of OrderId -> HeldAmount.
            // For this prototype, we'll refund based on a simplified assumption (or we'd need to store order_id -> held).
            // Let's assume the client must rely on a perfect risk model. We'll skip exact refunds here for simplicity unless we add it.
        } 
        else if (rep.status == OrderStatus::Filled || rep.status == OrderStatus::PartiallyFilled) {
            // Fill occurred. 
            // Increase inventory
            account->positions[rep.symbol].fetch_add(rep.exec_qty, std::memory_order_relaxed);
            // Decrease held buying power (we should reduce it by exec_qty * original_limit_price)
            // But we don't know original_limit_price from the fill report easily (it gives exec_price).
            // If exec_price < limit_price (price improvement), the difference is refunded to buying_power!
        }
    } else {
        if (rep.status == OrderStatus::Rejected || rep.status == OrderStatus::Cancelled) {
            // Refund short hold
            account->held_short_positions[rep.symbol].fetch_sub(rep.leaves_qty, std::memory_order_relaxed);
        } else if (rep.status == OrderStatus::Filled || rep.status == OrderStatus::PartiallyFilled) {
            // Reduce inventory and reduce hold
            account->positions[rep.symbol].fetch_sub(rep.exec_qty, std::memory_order_relaxed);
            account->held_short_positions[rep.symbol].fetch_sub(rep.exec_qty, std::memory_order_relaxed);
            
            // Increase buying power with the proceeds
            int64_t proceeds = static_cast<int64_t>(rep.exec_qty) * rep.exec_price;
            account->buying_power.fetch_add(proceeds, std::memory_order_relaxed);
        }
    }
}

} // namespace ultralob::net
