#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// FIX 4.4 Session State Machine
//
// Full lifecycle: Disconnected → Connecting → LogonSent → Active → LogoutSent
// Manages MsgSeqNum tracking, Heartbeat/TestRequest timers, gap detection
// with ResendRequest, and SequenceReset/PossDupFlag handling.
//
// Zero heap allocation on the hot path — all buffers are pre-allocated.
// Uses raw function pointers for callbacks (matches UltraLOB convention).
// ─────────────────────────────────────────────────────────────────────────────

#include "fix_types.hpp"
#include "fix_message.hpp"
#include "fix_builder.hpp"

#include <array>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <string_view>

namespace ultralob::fix {

class FixStore;

// ─────────────────────────────────────────────────────────────────────────────
// Session State
// ─────────────────────────────────────────────────────────────────────────────

enum class SessionState : uint8_t {
    Disconnected,
    Connecting,
    LogonSent,
    Active,
    LogoutSent,
};

// ─────────────────────────────────────────────────────────────────────────────
// Session Configuration — POD struct, can be stack-allocated
// ─────────────────────────────────────────────────────────────────────────────

struct SessionConfig {
    char sender_comp_id[32] = {};
    char target_comp_id[32] = {};
    int  heartbeat_interval_sec = 30;   // HeartBtInt (tag 108)
    int  reconnect_interval_sec = 5;

    // Gap-fill / recovery settings
    bool reset_on_logon = false;        // ResetSeqNumFlag (tag 141)
    int  test_request_delay_sec = 5;    // extra seconds after HeartBtInt before TestRequest

    void set_sender(std::string_view id) noexcept {
        auto n = (id.size() < sizeof(sender_comp_id) - 1) ? id.size() : sizeof(sender_comp_id) - 1;
        std::memcpy(sender_comp_id, id.data(), n);
        sender_comp_id[n] = '\0';
    }

    void set_target(std::string_view id) noexcept {
        auto n = (id.size() < sizeof(target_comp_id) - 1) ? id.size() : sizeof(target_comp_id) - 1;
        std::memcpy(target_comp_id, id.data(), n);
        target_comp_id[n] = '\0';
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Callback types — raw function pointers (matches UltraLOB convention)
// ─────────────────────────────────────────────────────────────────────────────

// Called when the session has an outbound message to send over TCP.
// data/len is a complete serialized FIX message. Caller must NOT store pointers.
using SendCallback     = void(*)(const char* data, size_t len, void* ctx);

// Called when an application-level message (D, F, G, 8, 9, etc.) is received.
using AppMsgCallback   = void(*)(const FixMessage& msg, void* ctx);

// Called on session state transitions.
using StateCallback    = void(*)(SessionState old_state, SessionState new_state, void* ctx);

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp utility — fast UTC "YYYYMMDD-HH:MM:SS.sss" without allocation
// ─────────────────────────────────────────────────────────────────────────────

inline constexpr size_t SENDING_TIME_LEN = 21;  // "20260712-12:00:00.000"

// Writes a FIX-format UTC timestamp to buf (must be >= SENDING_TIME_LEN bytes).
// Returns the number of characters written.
size_t format_utc_timestamp(char* buf, size_t buf_size) noexcept;

// ─────────────────────────────────────────────────────────────────────────────
// FixSession — the session-level state machine
// ─────────────────────────────────────────────────────────────────────────────

class FixSession {
public:
    using Clock     = std::chrono::steady_clock;
    using TimePoint = Clock::time_point;

    explicit FixSession(const SessionConfig& config) noexcept;

    // ── Callbacks ────────────────────────────────────────────────────────
    void set_send_callback(SendCallback cb, void* ctx) noexcept {
        send_cb_  = cb;
        send_ctx_ = ctx;
    }
    void set_app_msg_callback(AppMsgCallback cb, void* ctx) noexcept {
        app_cb_  = cb;
        app_ctx_ = ctx;
    }
    void set_state_callback(StateCallback cb, void* ctx) noexcept {
        state_cb_  = cb;
        state_ctx_ = ctx;
    }

    // ── Store Integration ────────────────────────────────────────────────
    void set_store(FixStore* store) noexcept { store_ = store; }
    [[nodiscard]] FixStore* store() const noexcept { return store_; }
    void recover_from_store() noexcept;

    // ── Session Lifecycle ────────────────────────────────────────────────

    // Initiate a logon — transitions to LogonSent and sends 35=A
    void initiate_logon() noexcept;

    // Initiate a graceful logout — transitions to LogoutSent and sends 35=5
    void initiate_logout(std::string_view text = {}) noexcept;

    // Called by the transport when a complete FIX message has been framed.
    // The session processes session-level messages internally and dispatches
    // application messages to the app_msg_callback.
    void on_message_received(const FixMessage& msg) noexcept;

    // Must be called periodically (e.g., every 100ms–1s) to drive heartbeat
    // and test-request timer logic.
    void on_timer_tick() noexcept;

    // Called by transport when the connection is established
    void on_connected() noexcept;

    // Called by transport when the connection drops
    void on_disconnected() noexcept;

    // ── Outbound Application Messages ────────────────────────────────────

    // Build and send an application-level message.  The builder must have
    // body fields set (e.g. tag 35, 11, 55, etc.) but NOT header fields
    // (49, 56, 34, 52) — the session stamps those automatically.
    // Returns true if the message was sent (state == Active).
    [[nodiscard]] bool send_app_message(FixBuilder& builder) noexcept;

    // ── Sequence Number Management ───────────────────────────────────────

    [[nodiscard]] uint64_t next_outbound_seq() const noexcept { return out_seq_; }
    [[nodiscard]] uint64_t next_inbound_seq()  const noexcept { return in_seq_; }
    void set_next_outbound_seq(uint64_t seq) noexcept { out_seq_ = seq; }
    void set_next_inbound_seq(uint64_t seq) noexcept  { in_seq_ = seq; }

    // ── State Queries ────────────────────────────────────────────────────

    [[nodiscard]] SessionState state() const noexcept { return state_; }
    [[nodiscard]] const SessionConfig& config() const noexcept { return config_; }
    [[nodiscard]] bool is_active() const noexcept { return state_ == SessionState::Active; }

    // ── Testing Helpers ──────────────────────────────────────────────────

    void set_time_source(TimePoint (*fn)()) noexcept { time_fn_ = fn; }
    [[nodiscard]] TimePoint last_send_time() const noexcept { return last_send_time_; }
    [[nodiscard]] TimePoint last_recv_time() const noexcept { return last_recv_time_; }
    [[nodiscard]] bool test_request_pending() const noexcept { return test_req_pending_; }

    // Reset session state (for reconnection)
    void reset() noexcept;

private:
    // ── State Transitions ────────────────────────────────────────────────
    void transition_to(SessionState new_state) noexcept;

    // ── Session Message Handlers ─────────────────────────────────────────
    void handle_logon(const FixMessage& msg) noexcept;
    void handle_logout(const FixMessage& msg) noexcept;
    void handle_heartbeat(const FixMessage& msg) noexcept;
    void handle_test_request(const FixMessage& msg) noexcept;
    void handle_resend_request(const FixMessage& msg) noexcept;
    void handle_sequence_reset(const FixMessage& msg) noexcept;
    void handle_reject(const FixMessage& msg) noexcept;

    // ── Sequence Validation ──────────────────────────────────────────────
    // Returns true if sequence is valid and message should be processed.
    // On gap: sends ResendRequest and returns false.
    [[nodiscard]] bool validate_inbound_seq(const FixMessage& msg) noexcept;

    // ── Outbound Helpers ─────────────────────────────────────────────────
    void send_message(FixBuilder& builder) noexcept;
    void send_heartbeat(std::string_view test_req_id = {}) noexcept;
    void send_test_request() noexcept;
    void send_resend_request(uint64_t begin_seq, uint64_t end_seq) noexcept;
    void send_sequence_reset(uint64_t new_seq_no) noexcept;
    void send_sequence_reset_range(uint64_t msg_seq, uint64_t new_seq_no) noexcept;
    void resend_application_message(const FixMessage& orig_msg, uint64_t seq) noexcept;
    void send_reject(uint64_t ref_seq, std::string_view text) noexcept;

    // ── Timestamp Helper ─────────────────────────────────────────────────
    void stamp_header(FixBuilder& builder) noexcept;

    TimePoint now() const noexcept {
        return time_fn_ ? time_fn_() : Clock::now();
    }

    // ── Data ─────────────────────────────────────────────────────────────
    SessionConfig  config_;
    SessionState   state_ = SessionState::Disconnected;

    uint64_t out_seq_ = 1;           // next outbound MsgSeqNum
    uint64_t in_seq_  = 1;           // next expected inbound MsgSeqNum

    TimePoint last_send_time_{};     // last time we sent anything
    TimePoint last_recv_time_{};     // last time we received anything
    bool      test_req_pending_ = false;
    uint64_t  test_req_id_counter_ = 0;
    char      pending_test_req_id_[24] = {};

    // Pre-allocated builder for session-level messages
    FixBuilder session_builder_;
    FixBuilder resend_builder_;

    // Optional persistent store
    FixStore* store_ = nullptr;

    // Callbacks
    SendCallback   send_cb_    = nullptr;
    void*          send_ctx_   = nullptr;
    AppMsgCallback app_cb_     = nullptr;
    void*          app_ctx_    = nullptr;
    StateCallback  state_cb_   = nullptr;
    void*          state_ctx_  = nullptr;

    // Pluggable time source for testing
    TimePoint (*time_fn_)() = nullptr;
};

} // namespace ultralob::fix

