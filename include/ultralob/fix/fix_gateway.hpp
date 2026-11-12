#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB Production FIX 4.4 Gateway
//
// Institutional-grade FIX 4.4 Acceptor Gateway bridging external FIX clients
// directly to UltraLOB's sub-microsecond MatchingEngine & ExchangeNode.
//
// Features:
//   - Asynchronous multi-client TCP connection management via Asio
//   - Full FIX 4.4 Acceptor session lifecycle (Logon, Heartbeat, TestRequest, Logout)
//   - Per-session persistent message store (FixStore) for sequence tracking & recovery
//   - Zero-allocation hot path message parsing & framing (FixFramer & FixMessage)
//   - Pre-trade risk validation via UltraLOB RiskEngine (BuyingPower & ShortPrevention)
//   - Lock-free order submission to ExchangeNode's sequencer thread
//   - Dedicated outbound router thread polling ExecutionReports and routing back to FIX
// ─────────────────────────────────────────────────────────────────────────────

#include "fix_types.hpp"
#include "fix_framer.hpp"
#include "fix_builder.hpp"
#include "fix_message.hpp"
#include "fix_session.hpp"
#include "fix_store.hpp"
#include "fix_application.hpp"

#include "ultralob/exchange_node.hpp"
#include "ultralob/net/risk_engine.hpp"
#include "ultralob/types.hpp"

#include <asio.hpp>
#include <memory>
#include <unordered_map>
#include <mutex>
#include <thread>
#include <atomic>
#include <string>
#include <deque>

namespace ultralob::fix {

using ultralob::net::RiskEngine;
using ultralob::net::RiskAccount;

class FixGateway;

// ─────────────────────────────────────────────────────────────────────────────
// FixServerSession — Represents an active connected FIX client
// ─────────────────────────────────────────────────────────────────────────────

class FixServerSession : public std::enable_shared_from_this<FixServerSession> {
public:
    using tcp = asio::ip::tcp;

    FixServerSession(tcp::socket socket,
                     FixGateway& gateway,
                     ExchangeNode& exchange,
                     RiskEngine& risk_engine,
                     uint32_t client_id,
                     const std::string& store_dir = ".");

    ~FixServerSession();

    void start();
    void stop();

    void send_execution_report(const ExecutionReport& report);
    void send_raw(const char* data, size_t len);

    [[nodiscard]] uint32_t client_id() const noexcept { return client_id_; }
    [[nodiscard]] RiskAccount* risk_account() const noexcept { return risk_account_; }
    [[nodiscard]] const std::string& sender_comp_id() const noexcept { return sender_comp_id_; }
    [[nodiscard]] bool is_active() const noexcept { return session_ && session_->is_active(); }

private:
    void do_read();
    void handle_fix_message(const FixMessage& msg);
    void handle_new_order_single(const FixMessage& msg);
    void handle_order_cancel_request(const FixMessage& msg);
    void handle_order_cancel_replace_request(const FixMessage& msg);

    void send_reject(uint64_t ref_seq, std::string_view text);
    void send_order_cancel_reject(std::string_view cl_ord_id,
                                  std::string_view orig_cl_ord_id,
                                  std::string_view order_id,
                                  int reason,
                                  std::string_view text);

    static void on_session_send(const char* data, size_t len, void* ctx) noexcept {
        static_cast<FixServerSession*>(ctx)->send_raw(data, len);
    }

    tcp::socket          socket_;
    FixGateway&          gateway_;
    ExchangeNode&        exchange_;
    RiskEngine&          risk_engine_;
    uint32_t             client_id_;
    RiskAccount*         risk_account_ = nullptr;
    std::string          store_dir_;

    FixFramer            framer_;
    FixMessage           in_msg_;
    FixBuilder           out_builder_;

    std::unique_ptr<FixSession> session_;
    std::unique_ptr<FixStore>   store_;

    std::string          sender_comp_id_;
    std::string          target_comp_id_ = "ULTRALOB";

    char                 read_buf_[4096];
    std::deque<std::string> write_queue_;

    // Fast order mapping (ClOrdID <-> OrderId)
    std::mutex           map_mutex_;
    std::unordered_map<std::string, OrderId> cl_to_order_id_;
    std::unordered_map<OrderId, std::string> order_to_cl_ord_id_;
    std::unordered_map<OrderId, std::string> order_to_symbol_;
    uint64_t             next_order_id_seq_ = 1;
};

// ─────────────────────────────────────────────────────────────────────────────
// FixGateway — Institutional FIX 4.4 Gateway Server
// ─────────────────────────────────────────────────────────────────────────────

class FixGateway {
public:
    using tcp = asio::ip::tcp;

    FixGateway(asio::io_context& io_context,
               uint16_t port,
               ExchangeNode& exchange,
               RiskEngine& risk_engine,
               const std::string& store_dir = ".");

    ~FixGateway();

    FixGateway(const FixGateway&)            = delete;
    FixGateway& operator=(const FixGateway&) = delete;

    // Starts the router thread bridging ExchangeNode outbound queue to FIX clients
    void start_routing();

    // Gracefully stops routing and all active FIX sessions
    void stop();

    [[nodiscard]] uint16_t port() const noexcept {
        asio::error_code ec;
        auto ep = acceptor_.local_endpoint(ec);
        return ec ? 0 : ep.port();
    }

    [[nodiscard]] size_t session_count() const noexcept;

    // Unregister disconnected session
    void remove_session(uint32_t client_id);

private:
    void do_accept();
    void route_report(const ExecutionReport& report);

    asio::io_context&    io_context_;
    tcp::acceptor        acceptor_;
    ExchangeNode&        exchange_;
    RiskEngine&          risk_engine_;
    std::string          store_dir_;

    std::atomic<uint32_t> next_client_id_{100};

    std::mutex           sessions_mutex_;
    std::unordered_map<uint32_t, std::shared_ptr<FixServerSession>> sessions_;

    std::atomic<bool>    running_{false};
    std::thread          router_thread_;
};

} // namespace ultralob::fix
