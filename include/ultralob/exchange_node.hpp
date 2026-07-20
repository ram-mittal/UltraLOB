#pragma once

#include "matching_engine.hpp"
#include "messages.hpp"
#include "util/mpsc_queue.hpp"
#include "util/thread_utils.hpp"
#include "ultralob/net/wire_protocol.hpp"
#include "ultralob/journal.hpp"

#include <thread>
#include "net/market_data_publisher.hpp"
#include <vector>
#include <memory>
#include <string>
#include <atomic>

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// ExchangeNode
//
// The asynchronous actor model wrapping the MatchingEngine.
// Provides lock-free inbound and outbound queues and manages the dedicated
// matching thread.
// ─────────────────────────────────────────────────────────────────────────────
class ExchangeNode {
public:
    static constexpr size_t QUEUE_CAPACITY = 1024 * 1024; // 1M slots (power of 2)

    ExchangeNode(size_t order_pool_capacity = OrderPool::DEFAULT_CAPACITY);
    ~ExchangeNode();

    ExchangeNode(const ExchangeNode&)            = delete;
    ExchangeNode& operator=(const ExchangeNode&) = delete;

    // Set Market Data Publisher
    void set_market_data_publisher(std::shared_ptr<net::MarketDataPublisher> publisher) {
        md_publisher_ = publisher;
    }

    // Recover state from a journal file before starting
    void recover_from_journal(const std::string& filepath);

    // Enable journaling for subsequent messages
    void enable_journaling(const std::string& filepath);

    // ─────────────────────────────────────────────────────────────────────────
    /// Start the matching thread. Optionally pin to a specific CPU core.
    // ─────────────────────────────────────────────────────────────────────────
    bool start(int core_id = -1);

    // ─────────────────────────────────────────────────────────────────────────
    /// Stop the matching thread gracefully.
    // ─────────────────────────────────────────────────────────────────────────
    void stop();

    // ─────────────────────────────────────────────────────────────────────────
    /// Push an inbound message (from a gateway). Thread-safe.
    // ─────────────────────────────────────────────────────────────────────────
    bool push_inbound(const InboundMessage& msg) noexcept {
        return inbound_queue_.try_push(msg);
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// Pop an outbound message (execution report).
    /// Typically called by a single outbound network thread.
    // ─────────────────────────────────────────────────────────────────────────
    std::optional<OutboundMessage> poll_outbound() noexcept {
        return outbound_queue_.try_pop();
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// Add a symbol to the node. Injects the async callback automatically.
    // ─────────────────────────────────────────────────────────────────────────
    // Register a symbol so the engine can trade it
    bool add_symbol(Symbol symbol) {
        return engine_.add_symbol(symbol, on_execution_report, this);
    }

    // Direct access to the engine (only safe before start() or after stop())
    MatchingEngine& engine() noexcept { return engine_; }

private:
    void spin_loop();
    
    // Callback injected into MatchingEngine to route ExecutionReports to outbound
    static void on_execution_report(const ExecutionReport& report, void* ctx) noexcept;

    MatchingEngine                     engine_;
    MPSCQueue<InboundMessage, QUEUE_CAPACITY>  inbound_queue_;
    MPSCQueue<OutboundMessage, QUEUE_CAPACITY> outbound_queue_;

    // Optional Market Data Publisher
    std::shared_ptr<net::MarketDataPublisher> md_publisher_;
    
    std::thread           thread_;
    std::atomic<bool> running_{false};

    std::unique_ptr<Journal> journal_;
};

} // namespace ultralob
