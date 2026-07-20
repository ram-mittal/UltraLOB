#pragma once

#include "ultralob/messages.hpp"
#include <atomic>
#include <array>
#include <unordered_map>
#include <shared_mutex>
#include <memory>
#include <cstdint>
#include <string>

namespace ultralob::net {

constexpr size_t MAX_RISK_SYMBOLS = 1024;

struct RiskAccount {
    // Balances in Fixed-Point (same scale as Price)
    std::atomic<int64_t> buying_power{0};
    std::atomic<int64_t> held_buying_power{0};

    // Positions (can be negative for shorts). 
    std::array<std::atomic<int64_t>, MAX_RISK_SYMBOLS> positions{};
    std::array<std::atomic<int64_t>, MAX_RISK_SYMBOLS> held_short_positions{}; // amount held for pending sells

    RiskAccount() {
        for (auto& p : positions) p.store(0);
        for (auto& h : held_short_positions) h.store(0);
    }
};

class RiskEngine {
public:
    RiskEngine() = default;
    
    // Register or get an account for a client. 
    // This is called when a Session is established, so it's not on the ultra-hot path.
    RiskAccount* get_or_create_account(uint32_t client_id, int64_t initial_buying_power = 10'000'000'000'000LL); // $100,000.00 default

    // Fat finger checks
    int64_t max_order_qty_{1'000'000};
    int64_t max_order_value_{10'000'000'000'000LL}; // $100,000

    // Called by the Gateway BEFORE sending the order to the sequencer.
    // Returns true if risk passes and capital is held. Returns false to reject.
    bool check_and_hold(RiskAccount* account, const OrderRequest& req, RejectReason& out_reason);

    // Called by the Gateway Router when an ExecutionReport comes back.
    // Releases holds or realizes fills.
    void process_execution_report(RiskAccount* account, const ExecutionReport& rep);

private:
    std::shared_mutex mutex_;
    std::unordered_map<uint32_t, std::unique_ptr<RiskAccount>> accounts_;
};

} // namespace ultralob::net
