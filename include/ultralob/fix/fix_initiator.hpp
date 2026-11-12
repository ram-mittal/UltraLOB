#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// FIX 4.4 Initiator (Client Transport & Session Runner)
//
// Combines:
//   - Asynchronous / non-blocking TCP transport via Asio
//   - Zero-copy stream framing via FixFramer
//   - Session lifecycle, timers & sequence recovery via FixSession & FixStore
//   - Application-level dispatch & serialization via FixApplication
//
// Operates on a dedicated network thread with thread-safe submission and
// lock-free queue integration for low-latency strategy engines.
// ─────────────────────────────────────────────────────────────────────────────

#include "fix_types.hpp"
#include "fix_framer.hpp"
#include "fix_session.hpp"
#include "fix_store.hpp"
#include "fix_application.hpp"

#include <asio.hpp>
#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace ultralob::fix {

class FixInitiator {
public:
    using tcp = asio::ip::tcp;

    FixInitiator(const SessionConfig& config,
                 const std::string& host,
                 uint16_t port,
                 FixStore* store = nullptr) noexcept;

    ~FixInitiator();

    FixInitiator(const FixInitiator&)            = delete;
    FixInitiator& operator=(const FixInitiator&) = delete;

    // ── Application Callbacks ────────────────────────────────────────────
    void set_on_execution_report(OnExecutionReportFn fn, void* ctx) noexcept {
        app_.set_on_execution_report(fn, ctx);
    }
    void set_on_order_cancel_reject(OnOrderCancelRejectFn fn, void* ctx) noexcept {
        app_.set_on_order_cancel_reject(fn, ctx);
    }
    void set_on_state_change(StateCallback fn, void* ctx) noexcept {
        session_.set_state_callback(fn, ctx);
    }

    // ── Connection & Lifecycle ───────────────────────────────────────────

    // Starts the network thread and initiates TCP connection + FIX Logon
    bool start();

    // Initiates FIX Logout and stops the network thread
    void stop();

    [[nodiscard]] bool is_connected() const noexcept { return connected_.load(std::memory_order_acquire); }
    [[nodiscard]] bool is_active()    const noexcept { return session_.is_active(); }
    [[nodiscard]] SessionState state() const noexcept { return session_.state(); }

    // ── Order Entry Methods (Thread-Safe) ────────────────────────────────
    bool send_new_order_single(const FixNewOrderSingle& nos) noexcept;
    bool send_order_cancel(const FixOrderCancelRequest& cxl) noexcept;
    bool send_order_replace(const FixOrderCancelReplaceRequest& replace) noexcept;

    // ── Component Access ─────────────────────────────────────────────────
    [[nodiscard]] FixSession&     session()     noexcept { return session_; }
    [[nodiscard]] FixApplication& application() noexcept { return app_; }
    [[nodiscard]] FixStore*       store()       noexcept { return store_; }

private:
    void run_network_loop();
    void do_connect();
    void do_read();
    void start_timer();
    void on_send_raw(const char* data, size_t len) noexcept;

    static void on_session_send(const char* data, size_t len, void* ctx) noexcept {
        static_cast<FixInitiator*>(ctx)->on_send_raw(data, len);
    }

    static void on_session_app_msg(const FixMessage& msg, void* ctx) noexcept {
        static_cast<FixInitiator*>(ctx)->app_.on_application_message(msg);
    }

    std::string    host_;
    uint16_t       port_;
    FixStore*      store_ = nullptr;

    FixSession     session_;
    FixApplication app_;
    FixFramer      framer_;
    FixMessage     in_msg_;

    // Asio Networking
    asio::io_context        io_;
    std::unique_ptr<tcp::socket> socket_;
    asio::steady_timer      timer_;
    char                    recv_buf_[4096];

    std::thread             network_thread_;
    std::atomic<bool>       running_{false};
    std::atomic<bool>       connected_{false};
};

} // namespace ultralob::fix

