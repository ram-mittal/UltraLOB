#include "ultralob/fix/fix_session.hpp"
#include "ultralob/fix/fix_store.hpp"
#include <cstring>
#include <ctime>

namespace ultralob::fix {

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp Utility
// ─────────────────────────────────────────────────────────────────────────────

size_t format_utc_timestamp(char* buf, size_t buf_size) noexcept {
    if (buf_size < SENDING_TIME_LEN) return 0;

    auto now = std::chrono::system_clock::now();
    auto time_t_val = std::chrono::system_clock::to_time_t(now);
    auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;

    struct tm tm_val{};
#ifdef _WIN32
    gmtime_s(&tm_val, &time_t_val);
#else
    gmtime_r(&time_t_val, &tm_val);
#endif

    // "YYYYMMDD-HH:MM:SS.mmm"
    auto write_2 = [](char* p, int v) {
        p[0] = '0' + static_cast<char>(v / 10);
        p[1] = '0' + static_cast<char>(v % 10);
    };
    auto write_3 = [](char* p, int v) {
        p[0] = '0' + static_cast<char>((v / 100) % 10);
        p[1] = '0' + static_cast<char>((v / 10) % 10);
        p[2] = '0' + static_cast<char>(v % 10);
    };
    auto write_4 = [](char* p, int v) {
        p[0] = '0' + static_cast<char>((v / 1000) % 10);
        p[1] = '0' + static_cast<char>((v / 100) % 10);
        p[2] = '0' + static_cast<char>((v / 10) % 10);
        p[3] = '0' + static_cast<char>(v % 10);
    };

    write_4(buf, 1900 + tm_val.tm_year);
    write_2(buf + 4, tm_val.tm_mon + 1);
    write_2(buf + 6, tm_val.tm_mday);
    buf[8] = '-';
    write_2(buf + 9, tm_val.tm_hour);
    buf[11] = ':';
    write_2(buf + 12, tm_val.tm_min);
    buf[14] = ':';
    write_2(buf + 15, tm_val.tm_sec);
    buf[17] = '.';
    write_3(buf + 18, static_cast<int>(millis.count()));

    return SENDING_TIME_LEN;
}

// ─────────────────────────────────────────────────────────────────────────────
// FixSession
// ─────────────────────────────────────────────────────────────────────────────

FixSession::FixSession(const SessionConfig& config) noexcept
    : config_(config) {}

void FixSession::reset() noexcept {
    state_             = SessionState::Disconnected;
    out_seq_           = 1;
    in_seq_            = 1;
    last_send_time_    = {};
    last_recv_time_    = {};
    test_req_pending_  = false;
    test_req_id_counter_ = 0;
    std::memset(pending_test_req_id_, 0, sizeof(pending_test_req_id_));
}

void FixSession::recover_from_store() noexcept {
    if (!store_) return;
    out_seq_ = store_->get_sender_seq();
    in_seq_  = store_->get_target_seq();
}

void FixSession::transition_to(SessionState new_state) noexcept {
    if (state_ == new_state) return;
    auto old = state_;
    state_ = new_state;
    if (state_cb_) state_cb_(old, new_state, state_ctx_);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

void FixSession::on_connected() noexcept {
    transition_to(SessionState::Connecting);
}

void FixSession::on_disconnected() noexcept {
    transition_to(SessionState::Disconnected);
    test_req_pending_ = false;
}

void FixSession::initiate_logon() noexcept {
    session_builder_.reset();
    session_builder_.set_msg_type(MsgType::Logon);
    session_builder_.set_int(Tag::EncryptMethod, 0);
    session_builder_.set_int(Tag::HeartBtInt, config_.heartbeat_interval_sec);

    send_message(session_builder_);
    transition_to(SessionState::LogonSent);
}

void FixSession::initiate_logout(std::string_view text) noexcept {
    if (state_ != SessionState::Active && state_ != SessionState::LogonSent) return;

    session_builder_.reset();
    session_builder_.set_msg_type(MsgType::Logout);
    if (!text.empty()) {
        session_builder_.set_string(Tag::Text, text);
    }

    send_message(session_builder_);
    transition_to(SessionState::LogoutSent);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound Message Dispatch
// ─────────────────────────────────────────────────────────────────────────────

void FixSession::on_message_received(const FixMessage& msg) noexcept {
    if (!msg.is_valid()) return;

    last_recv_time_ = now();
    test_req_pending_ = false;

    if (store_) {
        auto seq_opt = msg.msg_seq_num();
        if (seq_opt.has_value() && *seq_opt > 0) {
            store_->store(static_cast<uint64_t>(*seq_opt), msg.raw_data(), msg.raw_len(), StoreDirection::Inbound);
            store_->set_target_seq(in_seq_);
        }
    }

    auto mt = msg.msg_type();

    // Logon is special — we process it before sequence validation when
    // we are in LogonSent state.
    if (mt == MsgType::Logon) {
        handle_logon(msg);
        return;
    }

    // SequenceReset-GapFill may arrive with PossDupFlag and adjusts our
    // expected sequence, so handle it before the normal seq check to avoid
    // an infinite ResendRequest loop.
    if (mt == MsgType::SequenceReset) {
        handle_sequence_reset(msg);
        return;
    }

    // Validate inbound sequence number
    if (!validate_inbound_seq(msg)) return;

    // Dispatch session-level messages
    if      (mt == MsgType::Heartbeat)      handle_heartbeat(msg);
    else if (mt == MsgType::TestRequest)     handle_test_request(msg);
    else if (mt == MsgType::Logout)          handle_logout(msg);
    else if (mt == MsgType::ResendRequest)   handle_resend_request(msg);
    else if (mt == MsgType::Reject)          handle_reject(msg);
    else {
        // Application-level message — forward to callback
        if (app_cb_) app_cb_(msg, app_ctx_);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer Tick — drives heartbeat / test-request logic
// ─────────────────────────────────────────────────────────────────────────────

void FixSession::on_timer_tick() noexcept {
    if (state_ != SessionState::Active) return;

    auto t = now();
    auto hb_interval = std::chrono::seconds(config_.heartbeat_interval_sec);

    // ── Send heartbeat if we haven't sent anything recently ──────────
    if (last_send_time_ != TimePoint{} &&
        (t - last_send_time_) >= hb_interval) {
        send_heartbeat();
    }

    // ── Check for missing inbound traffic ────────────────────────────
    auto test_req_threshold = hb_interval +
        std::chrono::seconds(config_.test_request_delay_sec);

    if (last_recv_time_ != TimePoint{} &&
        (t - last_recv_time_) >= test_req_threshold) {
        if (!test_req_pending_) {
            send_test_request();
            test_req_pending_ = true;
        }
        // If we already sent a TestRequest and still no response after
        // another full interval, we consider the connection dead.
        // The transport layer should handle the actual disconnect.
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound Application Messages
// ─────────────────────────────────────────────────────────────────────────────

bool FixSession::send_app_message(FixBuilder& builder) noexcept {
    if (state_ != SessionState::Active) return false;
    send_message(builder);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session-Level Message Handlers
// ─────────────────────────────────────────────────────────────────────────────

void FixSession::handle_logon(const FixMessage& msg) noexcept {
    // Accept the logon sequence number
    auto seq_opt = msg.msg_seq_num();
    if (seq_opt.has_value()) {
        uint64_t msg_seq = static_cast<uint64_t>(*seq_opt);
        if (msg_seq >= in_seq_) {
            // If there's a gap, we still accept the logon but need to
            // request the missing messages after transitioning to Active.
            if (msg_seq > in_seq_ && state_ == SessionState::LogonSent) {
                // Remember there's a gap — we'll handle it after going Active
                uint64_t gap_begin = in_seq_;
                in_seq_ = msg_seq + 1;
                transition_to(SessionState::Active);
                // Now request the gap fill
                send_resend_request(gap_begin, msg_seq - 1);
                return;
            }
            in_seq_ = msg_seq + 1;
        }
    }

    if (state_ == SessionState::LogonSent) {
        transition_to(SessionState::Active);
    }
    else if (state_ == SessionState::Connecting || state_ == SessionState::Disconnected) {
        // Acceptor-side: received a logon, respond with our own logon
        session_builder_.reset();
        session_builder_.set_msg_type(MsgType::Logon);
        session_builder_.set_int(Tag::EncryptMethod, 0);
        session_builder_.set_int(Tag::HeartBtInt, config_.heartbeat_interval_sec);
        send_message(session_builder_);
        transition_to(SessionState::Active);
    }

    // Read HeartBtInt from counterparty if present
    auto hb = msg.get_int(Tag::HeartBtInt);
    if (hb.has_value() && *hb > 0) {
        // Use the counterparty's heartbeat interval (common convention)
        config_.heartbeat_interval_sec = static_cast<int>(*hb);
    }
}

void FixSession::handle_logout(const FixMessage& msg) noexcept {
    (void)msg;
    if (state_ == SessionState::LogoutSent) {
        // We initiated logout and received confirmation
        transition_to(SessionState::Disconnected);
    } else if (state_ == SessionState::Active) {
        // Counterparty initiated logout — respond and disconnect
        session_builder_.reset();
        session_builder_.set_msg_type(MsgType::Logout);
        send_message(session_builder_);
        transition_to(SessionState::Disconnected);
    }
}

void FixSession::handle_heartbeat(const FixMessage& msg) noexcept {
    // If this heartbeat contains our TestReqID, our test-request was answered
    if (msg.has_tag(Tag::TestReqID)) {
        auto id = msg.get_string(Tag::TestReqID);
        if (id == std::string_view(pending_test_req_id_)) {
            test_req_pending_ = false;
        }
    }
}

void FixSession::handle_test_request(const FixMessage& msg) noexcept {
    // Respond with a Heartbeat echoing the TestReqID
    auto test_req_id = msg.get_string(Tag::TestReqID);
    send_heartbeat(test_req_id);
}

void FixSession::handle_resend_request(const FixMessage& msg) noexcept {
    auto begin_opt = msg.get_int(Tag::BeginSeqNo);
    auto end_opt   = msg.get_int(Tag::EndSeqNo);

    if (!begin_opt.has_value()) return;

    uint64_t begin_seq = static_cast<uint64_t>(*begin_opt);
    uint64_t end_seq   = (end_opt.has_value() && *end_opt > 0) ? static_cast<uint64_t>(*end_opt) : (out_seq_ - 1);

    if (end_seq < begin_seq) return;
    if (end_seq >= out_seq_) end_seq = out_seq_ - 1;

    if (!store_) {
        // No persistent store available: send a SequenceReset-GapFill spanning the requested range
        send_sequence_reset(end_seq + 1);
        return;
    }

    // Replay stored messages or generate gap fills
    uint64_t gap_start = 0;

    for (uint64_t s = begin_seq; s <= end_seq; ++s) {
        auto stored_sv = store_->retrieve(s, StoreDirection::Outbound);
        bool should_gap_fill = true;

        if (!stored_sv.empty()) {
            FixMessage stored_msg;
            if (stored_msg.parse(stored_sv.data(), stored_sv.size())) {
                auto mt = stored_msg.msg_type();
                // FIX 4.4: Admin messages should never be resent
                bool is_admin = (mt == MsgType::Logon || mt == MsgType::Logout ||
                                 mt == MsgType::Heartbeat || mt == MsgType::TestRequest ||
                                 mt == MsgType::ResendRequest || mt == MsgType::Reject ||
                                 mt == MsgType::SequenceReset);
                if (!is_admin) {
                    should_gap_fill = false;
                    if (gap_start > 0) {
                        send_sequence_reset_range(gap_start, s);
                        gap_start = 0;
                    }
                    resend_application_message(stored_msg, s);
                }
            }
        }

        if (should_gap_fill) {
            if (gap_start == 0) {
                gap_start = s;
            }
        }
    }

    if (gap_start > 0) {
        send_sequence_reset_range(gap_start, end_seq + 1);
    }
}

void FixSession::handle_sequence_reset(const FixMessage& msg) noexcept {
    auto new_seq_opt = msg.get_int(Tag::NewSeqNo);
    if (!new_seq_opt.has_value()) return;

    uint64_t new_seq = static_cast<uint64_t>(*new_seq_opt);

    auto gap_fill = msg.get_char(Tag::GapFillFlag);
    if (gap_fill.has_value() && *gap_fill == 'Y') {
        // GapFill mode: validate sequence of the GapFill message itself
        auto msg_seq_opt = msg.msg_seq_num();
        if (msg_seq_opt.has_value()) {
            uint64_t msg_seq = static_cast<uint64_t>(*msg_seq_opt);
            // The GapFill message's MsgSeqNum should match our expected in_seq_
            // If not, it might be a subsequent gap fill — accept if >= in_seq_
            if (msg_seq < in_seq_) return;  // ignore old gap fills
        }
        // Advance expected inbound sequence to NewSeqNo
        if (new_seq > in_seq_) {
            in_seq_ = new_seq;
        }
    } else {
        // Reset mode: unconditionally set expected sequence
        if (new_seq >= in_seq_) {
            in_seq_ = new_seq;
        }
    }
}

void FixSession::handle_reject(const FixMessage& msg) noexcept {
    // Session-level reject — log or pass to app layer
    if (app_cb_) app_cb_(msg, app_ctx_);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequence Validation
// ─────────────────────────────────────────────────────────────────────────────

bool FixSession::validate_inbound_seq(const FixMessage& msg) noexcept {
    auto seq_opt = msg.msg_seq_num();
    if (!seq_opt.has_value()) return false;

    uint64_t msg_seq = static_cast<uint64_t>(*seq_opt);

    // Check PossDupFlag
    bool poss_dup = false;
    auto pd = msg.get_char(Tag::PossDupFlag);
    if (pd.has_value() && *pd == 'Y') {
        poss_dup = true;
    }

    if (msg_seq == in_seq_) {
        // Expected sequence — advance
        in_seq_ = msg_seq + 1;
        return true;
    }
    else if (msg_seq > in_seq_) {
        // Gap detected — request resend
        send_resend_request(in_seq_, msg_seq - 1);
        // Still process this message (advance sequence)
        in_seq_ = msg_seq + 1;
        return true;
    }
    else {
        // msg_seq < in_seq_ — duplicate or resent message
        if (poss_dup) {
            // PossDupFlag=Y: this is a legitimate resend, process it
            return true;
        }
        // Otherwise, this is a lower sequence without PossDup — reject it
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound Helpers
// ─────────────────────────────────────────────────────────────────────────────

void FixSession::stamp_header(FixBuilder& builder) noexcept {
    builder.set_sender_comp_id(config_.sender_comp_id);
    builder.set_target_comp_id(config_.target_comp_id);
    builder.set_msg_seq_num(out_seq_++);

    char ts_buf[SENDING_TIME_LEN + 1];
    size_t ts_len = format_utc_timestamp(ts_buf, sizeof(ts_buf));
    builder.set_sending_time(std::string_view(ts_buf, ts_len));
}

void FixSession::send_message(FixBuilder& builder) noexcept {
    uint64_t msg_seq = out_seq_;
    stamp_header(builder);
    auto sv = builder.finalize();
    last_send_time_ = now();
    if (store_) {
        store_->store(msg_seq, sv.data(), sv.size(), StoreDirection::Outbound);
        store_->set_sender_seq(out_seq_);
    }
    if (send_cb_) send_cb_(sv.data(), sv.size(), send_ctx_);
}

void FixSession::send_heartbeat(std::string_view test_req_id) noexcept {
    session_builder_.reset();
    session_builder_.set_msg_type(MsgType::Heartbeat);
    if (!test_req_id.empty()) {
        session_builder_.set_string(Tag::TestReqID, test_req_id);
    }
    send_message(session_builder_);
}

void FixSession::send_test_request() noexcept {
    // Generate a unique TestReqID
    auto id = ++test_req_id_counter_;
    char buf[24];
    size_t len = 0;
    // Simple uint64 -> string
    if (id == 0) { buf[0] = '0'; len = 1; }
    else {
        char tmp[24];
        size_t n = 0;
        uint64_t v = id;
        while (v > 0) { tmp[n++] = '0' + static_cast<char>(v % 10); v /= 10; }
        for (size_t i = 0; i < n; ++i) buf[i] = tmp[n - 1 - i];
        len = n;
    }
    buf[len] = '\0';

    // Store pending ID for matching the response
    std::memcpy(pending_test_req_id_, buf, len + 1);

    session_builder_.reset();
    session_builder_.set_msg_type(MsgType::TestRequest);
    session_builder_.set_string(Tag::TestReqID, std::string_view(buf, len));
    send_message(session_builder_);
}

void FixSession::send_resend_request(uint64_t begin_seq, uint64_t end_seq) noexcept {
    session_builder_.reset();
    session_builder_.set_msg_type(MsgType::ResendRequest);
    session_builder_.set_int(Tag::BeginSeqNo, static_cast<int64_t>(begin_seq));
    session_builder_.set_int(Tag::EndSeqNo, static_cast<int64_t>(end_seq));
    send_message(session_builder_);
}

void FixSession::send_sequence_reset(uint64_t new_seq_no) noexcept {
    session_builder_.reset();
    session_builder_.set_msg_type(MsgType::SequenceReset);
    session_builder_.set_char(Tag::GapFillFlag, 'Y');
    session_builder_.set_int(Tag::NewSeqNo, static_cast<int64_t>(new_seq_no));
    // Note: GapFill messages use PossDupFlag=Y
    session_builder_.set_char(Tag::PossDupFlag, 'Y');
    send_message(session_builder_);
}

void FixSession::send_sequence_reset_range(uint64_t msg_seq, uint64_t new_seq_no) noexcept {
    session_builder_.reset();
    session_builder_.set_msg_type(MsgType::SequenceReset);
    session_builder_.set_sender_comp_id(config_.sender_comp_id);
    session_builder_.set_target_comp_id(config_.target_comp_id);
    session_builder_.set_msg_seq_num(msg_seq);

    char ts_buf[SENDING_TIME_LEN + 1];
    size_t ts_len = format_utc_timestamp(ts_buf, sizeof(ts_buf));
    session_builder_.set_sending_time(std::string_view(ts_buf, ts_len));
    session_builder_.set_char(Tag::GapFillFlag, 'Y');
    session_builder_.set_int(Tag::NewSeqNo, static_cast<int64_t>(new_seq_no));
    session_builder_.set_char(Tag::PossDupFlag, 'Y');

    auto sv = session_builder_.finalize();
    last_send_time_ = now();
    if (send_cb_) send_cb_(sv.data(), sv.size(), send_ctx_);
}

void FixSession::resend_application_message(const FixMessage& orig_msg, uint64_t seq) noexcept {
    resend_builder_.reset();
    resend_builder_.set_msg_type(orig_msg.msg_type());
    resend_builder_.set_sender_comp_id(config_.sender_comp_id);
    resend_builder_.set_target_comp_id(config_.target_comp_id);
    resend_builder_.set_msg_seq_num(seq);

    char ts_buf[SENDING_TIME_LEN + 1];
    size_t ts_len = format_utc_timestamp(ts_buf, sizeof(ts_buf));
    resend_builder_.set_sending_time(std::string_view(ts_buf, ts_len));
    resend_builder_.set_char(Tag::PossDupFlag, 'Y');

    // OrigSendingTime (tag 122)
    auto orig_st = orig_msg.get_string(Tag::SendingTime);
    if (!orig_st.empty()) {
        resend_builder_.set_string(122, orig_st);
    }

    // Copy all other non-header fields
    for (size_t i = 0; i < orig_msg.field_count(); ++i) {
        const auto& f = orig_msg.field(i);
        if (f.tag == Tag::BeginString || f.tag == Tag::BodyLength ||
            f.tag == Tag::CheckSum || f.tag == Tag::MsgType ||
            f.tag == Tag::MsgSeqNum || f.tag == Tag::SenderCompID ||
            f.tag == Tag::TargetCompID || f.tag == Tag::SendingTime ||
            f.tag == Tag::PossDupFlag || f.tag == 122 /* OrigSendingTime */) {
            continue;
        }
        resend_builder_.set_string(f.tag, f.value);
    }

    auto sv = resend_builder_.finalize();
    last_send_time_ = now();
    if (send_cb_) send_cb_(sv.data(), sv.size(), send_ctx_);
}

void FixSession::send_reject(uint64_t ref_seq, std::string_view text) noexcept {
    session_builder_.reset();
    session_builder_.set_msg_type(MsgType::Reject);
    session_builder_.set_int(45, static_cast<int64_t>(ref_seq));  // RefSeqNum
    if (!text.empty()) {
        session_builder_.set_string(Tag::Text, text);
    }
    send_message(session_builder_);
}

} // namespace ultralob::fix
