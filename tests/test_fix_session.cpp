// ─────────────────────────────────────────────────────────────────────────────
// FIX Session State Machine Tests
//
// Tests the full lifecycle: state transitions, heartbeat/test-request timers,
// sequence number tracking, gap detection, ResendRequest, SequenceReset,
// and PossDupFlag handling.
// ─────────────────────────────────────────────────────────────────────────────

#include <gtest/gtest.h>
#include "ultralob/fix/fix_session.hpp"
#include "ultralob/fix/fix_store.hpp"
#include <filesystem>
#include <string>
#include <vector>
#include <chrono>

using namespace ultralob::fix;
using Clock     = std::chrono::steady_clock;
using TimePoint = Clock::time_point;

// ─────────────────────────────────────────────────────────────────────────────
// Test Harness — captures outbound messages and state transitions
// ─────────────────────────────────────────────────────────────────────────────

struct SentMessage {
    std::string data;
};

struct StateTransition {
    SessionState old_state;
    SessionState new_state;
};

struct ReceivedAppMsg {
    std::string msg_type;
};

struct TestHarness {
    std::vector<SentMessage>     sent_messages;
    std::vector<StateTransition> transitions;
    std::vector<ReceivedAppMsg>  app_messages;

    // Controllable time for deterministic testing
    TimePoint current_time = Clock::now();

    static void on_send(const char* data, size_t len, void* ctx) {
        auto* h = static_cast<TestHarness*>(ctx);
        h->sent_messages.push_back({std::string(data, len)});
    }

    static void on_state(SessionState old_s, SessionState new_s, void* ctx) {
        auto* h = static_cast<TestHarness*>(ctx);
        h->transitions.push_back({old_s, new_s});
    }

    static void on_app_msg(const FixMessage& msg, void* ctx) {
        auto* h = static_cast<TestHarness*>(ctx);
        h->app_messages.push_back({std::string(msg.msg_type())});
    }

    static TimePoint get_time_fn(TestHarness* h) {
        return h->current_time;
    }

    void advance_time(std::chrono::seconds sec) {
        current_time += sec;
    }

    void clear() {
        sent_messages.clear();
        transitions.clear();
        app_messages.clear();
    }

    // Parse the last sent message
    FixMessage parse_last_sent() {
        FixMessage msg;
        if (!sent_messages.empty()) {
            auto& last = sent_messages.back();
            msg.parse(last.data.data(), last.data.size());
        }
        return msg;
    }

    // Parse sent message at index
    FixMessage parse_sent(size_t idx) {
        FixMessage msg;
        if (idx < sent_messages.size()) {
            auto& m = sent_messages[idx];
            msg.parse(m.data.data(), m.data.size());
        }
        return msg;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build a FIX message as if received from counterparty
// ─────────────────────────────────────────────────────────────────────────────

class MsgFactory {
public:
    static std::string build_logon(std::string_view sender, std::string_view target,
                                    uint64_t seq, int heartbeat = 30) {
        FixBuilder b;
        b.set_msg_type(MsgType::Logon);
        b.set_sender_comp_id(sender);
        b.set_target_comp_id(target);
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        b.set_int(Tag::EncryptMethod, 0);
        b.set_int(Tag::HeartBtInt, heartbeat);
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    static std::string build_heartbeat(std::string_view sender, std::string_view target,
                                        uint64_t seq, std::string_view test_req_id = {}) {
        FixBuilder b;
        b.set_msg_type(MsgType::Heartbeat);
        b.set_sender_comp_id(sender);
        b.set_target_comp_id(target);
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        if (!test_req_id.empty()) {
            b.set_string(Tag::TestReqID, test_req_id);
        }
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    static std::string build_test_request(std::string_view sender, std::string_view target,
                                           uint64_t seq, std::string_view test_req_id) {
        FixBuilder b;
        b.set_msg_type(MsgType::TestRequest);
        b.set_sender_comp_id(sender);
        b.set_target_comp_id(target);
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        b.set_string(Tag::TestReqID, test_req_id);
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    static std::string build_logout(std::string_view sender, std::string_view target,
                                     uint64_t seq, std::string_view text = {}) {
        FixBuilder b;
        b.set_msg_type(MsgType::Logout);
        b.set_sender_comp_id(sender);
        b.set_target_comp_id(target);
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        if (!text.empty()) b.set_string(Tag::Text, text);
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    static std::string build_execution_report(std::string_view sender, std::string_view target,
                                               uint64_t seq, std::string_view cl_ord_id) {
        FixBuilder b;
        b.set_msg_type(MsgType::ExecutionReport);
        b.set_sender_comp_id(sender);
        b.set_target_comp_id(target);
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        b.set_string(Tag::OrderID, "ORD-1");
        b.set_string(Tag::ExecID, "EXEC-1");
        b.set_string(Tag::ClOrdID, cl_ord_id);
        b.set_char(Tag::ExecType, FixExecType::New);
        b.set_char(Tag::OrdStatus, FixOrdStatus::New);
        b.set_string(Tag::Symbol, "AAPL");
        b.set_char(Tag::Side, FixSide::Buy);
        b.set_int(Tag::LeavesQty, 100);
        b.set_int(Tag::CumQty, 0);
        b.set_double(Tag::AvgPx, 0.0, 2);
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    static std::string build_resend_request(std::string_view sender, std::string_view target,
                                             uint64_t seq, uint64_t begin_seq, uint64_t end_seq) {
        FixBuilder b;
        b.set_msg_type(MsgType::ResendRequest);
        b.set_sender_comp_id(sender);
        b.set_target_comp_id(target);
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        b.set_int(Tag::BeginSeqNo, static_cast<int64_t>(begin_seq));
        b.set_int(Tag::EndSeqNo, static_cast<int64_t>(end_seq));
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    static std::string build_sequence_reset(std::string_view sender, std::string_view target,
                                             uint64_t seq, uint64_t new_seq, bool gap_fill = true) {
        FixBuilder b;
        b.set_msg_type(MsgType::SequenceReset);
        b.set_sender_comp_id(sender);
        b.set_target_comp_id(target);
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        b.set_int(Tag::NewSeqNo, static_cast<int64_t>(new_seq));
        if (gap_fill) {
            b.set_char(Tag::GapFillFlag, 'Y');
            b.set_char(Tag::PossDupFlag, 'Y');
        }
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixture
// ─────────────────────────────────────────────────────────────────────────────

class FixSessionTest : public ::testing::Test {
protected:
    void SetUp() override {
        config_.set_sender("TRADER");
        config_.set_target("EXCHANGE");
        config_.heartbeat_interval_sec = 30;
        config_.test_request_delay_sec = 5;

        session_ = std::make_unique<FixSession>(config_);
        session_->set_send_callback(TestHarness::on_send, &harness_);
        session_->set_app_msg_callback(TestHarness::on_app_msg, &harness_);
        session_->set_state_callback(TestHarness::on_state, &harness_);

        // Use deterministic time source
        time_harness_ = &harness_;
        session_->set_time_source([]() -> TimePoint {
            return time_harness_->current_time;
        });
    }

    // Perform the standard logon handshake: send Logon, receive Logon response
    void do_logon() {
        session_->on_connected();
        session_->initiate_logon();
        // Simulate receiving Logon response
        auto logon_resp = MsgFactory::build_logon("EXCHANGE", "TRADER", 1);
        FixMessage msg;
        msg.parse(logon_resp.data(), logon_resp.size());
        session_->on_message_received(msg);
    }

    SessionConfig config_{};
    std::unique_ptr<FixSession> session_;
    TestHarness harness_;

    // Static pointer so the lambda can capture it
    static TestHarness* time_harness_;
};

TestHarness* FixSessionTest::time_harness_ = nullptr;


// ═══════════════════════════════════════════════════════════════════════════
// STATE TRANSITION TESTS
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixSessionTest, InitialStateIsDisconnected) {
    EXPECT_EQ(session_->state(), SessionState::Disconnected);
}

TEST_F(FixSessionTest, ConnectedTransitionsToConnecting) {
    session_->on_connected();
    EXPECT_EQ(session_->state(), SessionState::Connecting);
    ASSERT_EQ(harness_.transitions.size(), 1u);
    EXPECT_EQ(harness_.transitions[0].old_state, SessionState::Disconnected);
    EXPECT_EQ(harness_.transitions[0].new_state, SessionState::Connecting);
}

TEST_F(FixSessionTest, LogonSendsLogonMessage) {
    session_->on_connected();
    harness_.clear();
    session_->initiate_logon();

    EXPECT_EQ(session_->state(), SessionState::LogonSent);
    ASSERT_EQ(harness_.sent_messages.size(), 1u);

    auto msg = harness_.parse_last_sent();
    EXPECT_TRUE(msg.is_valid());
    EXPECT_EQ(msg.msg_type(), MsgType::Logon);
    EXPECT_EQ(msg.sender_comp_id(), "TRADER");
    EXPECT_EQ(msg.target_comp_id(), "EXCHANGE");
    EXPECT_EQ(msg.get_int(Tag::EncryptMethod).value(), 0);
    EXPECT_EQ(msg.get_int(Tag::HeartBtInt).value(), 30);
}

TEST_F(FixSessionTest, FullLogonHandshake) {
    do_logon();
    EXPECT_EQ(session_->state(), SessionState::Active);
    EXPECT_TRUE(session_->is_active());
}

TEST_F(FixSessionTest, LogoutFromActive) {
    do_logon();
    harness_.clear();

    session_->initiate_logout("Testing");
    EXPECT_EQ(session_->state(), SessionState::LogoutSent);

    auto msg = harness_.parse_last_sent();
    EXPECT_EQ(msg.msg_type(), MsgType::Logout);
    EXPECT_EQ(msg.get_string(Tag::Text), "Testing");
}

TEST_F(FixSessionTest, LogoutConfirmation) {
    do_logon();
    session_->initiate_logout();
    EXPECT_EQ(session_->state(), SessionState::LogoutSent);

    // Receive logout confirmation
    auto logout = MsgFactory::build_logout("EXCHANGE", "TRADER", 2);
    FixMessage msg;
    msg.parse(logout.data(), logout.size());
    session_->on_message_received(msg);

    EXPECT_EQ(session_->state(), SessionState::Disconnected);
}

TEST_F(FixSessionTest, CounterpartyInitiatedLogout) {
    do_logon();
    harness_.clear();

    // Counterparty sends Logout while we're Active
    auto logout = MsgFactory::build_logout("EXCHANGE", "TRADER", 2);
    FixMessage msg;
    msg.parse(logout.data(), logout.size());
    session_->on_message_received(msg);

    // We should respond with our own Logout
    ASSERT_GE(harness_.sent_messages.size(), 1u);
    auto resp = harness_.parse_last_sent();
    EXPECT_EQ(resp.msg_type(), MsgType::Logout);
    EXPECT_EQ(session_->state(), SessionState::Disconnected);
}

TEST_F(FixSessionTest, DisconnectTransitionsToDisconnected) {
    do_logon();
    session_->on_disconnected();
    EXPECT_EQ(session_->state(), SessionState::Disconnected);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEQUENCE NUMBER TESTS
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixSessionTest, OutboundSequenceIncrements) {
    do_logon();
    uint64_t seq_before = session_->next_outbound_seq();

    FixBuilder builder;
    builder.set_msg_type(MsgType::NewOrderSingle);
    builder.set_string(Tag::ClOrdID, "ORD-1");
    builder.set_string(Tag::Symbol, "AAPL");
    builder.set_char(Tag::Side, FixSide::Buy);
    builder.set_char(Tag::OrdType, FixOrdType::Limit);
    builder.set_double(Tag::Price, 150.0, 2);
    builder.set_int(Tag::OrderQty, 100);
    builder.set_string(Tag::TransactTime, "20260712-12:00:00.000");
    session_->send_app_message(builder);

    EXPECT_EQ(session_->next_outbound_seq(), seq_before + 1);
}

TEST_F(FixSessionTest, InboundSequenceTracking) {
    do_logon();
    EXPECT_EQ(session_->next_inbound_seq(), 2u);  // after logon (seq 1)

    // Receive a heartbeat with seq 2
    auto hb = MsgFactory::build_heartbeat("EXCHANGE", "TRADER", 2);
    FixMessage msg;
    msg.parse(hb.data(), hb.size());
    session_->on_message_received(msg);
    EXPECT_EQ(session_->next_inbound_seq(), 3u);
}

TEST_F(FixSessionTest, SendAppMessageFailsWhenNotActive) {
    // Not yet logged in
    FixBuilder builder;
    builder.set_msg_type(MsgType::NewOrderSingle);
    EXPECT_FALSE(session_->send_app_message(builder));
}

// ═══════════════════════════════════════════════════════════════════════════
// HEARTBEAT / TEST-REQUEST TIMER TESTS
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixSessionTest, HeartbeatSentAfterInterval) {
    do_logon();
    harness_.clear();

    // Advance time past heartbeat interval
    harness_.advance_time(std::chrono::seconds(31));
    session_->on_timer_tick();

    ASSERT_GE(harness_.sent_messages.size(), 1u);
    auto msg = harness_.parse_last_sent();
    EXPECT_EQ(msg.msg_type(), MsgType::Heartbeat);
}

TEST_F(FixSessionTest, NoHeartbeatBeforeInterval) {
    do_logon();
    harness_.clear();

    // Advance time but less than heartbeat interval
    harness_.advance_time(std::chrono::seconds(10));
    session_->on_timer_tick();

    EXPECT_EQ(harness_.sent_messages.size(), 0u);
}

TEST_F(FixSessionTest, TestRequestSentOnMissingInbound) {
    do_logon();
    harness_.clear();

    // Advance past heartbeat + test_request_delay
    harness_.advance_time(std::chrono::seconds(36));  // 30 + 5 + 1
    session_->on_timer_tick();

    // Should have sent heartbeat AND test request
    // (heartbeat because no outbound, test request because no inbound)
    bool found_test_req = false;
    for (auto& sent : harness_.sent_messages) {
        FixMessage msg;
        msg.parse(sent.data.data(), sent.data.size());
        if (msg.msg_type() == MsgType::TestRequest) {
            found_test_req = true;
            EXPECT_TRUE(msg.has_tag(Tag::TestReqID));
        }
    }
    EXPECT_TRUE(found_test_req) << "Expected TestRequest to be sent";
    EXPECT_TRUE(session_->test_request_pending());
}

TEST_F(FixSessionTest, TestRequestClearedByHeartbeatResponse) {
    do_logon();
    harness_.clear();

    // Trigger test request
    harness_.advance_time(std::chrono::seconds(36));
    session_->on_timer_tick();
    EXPECT_TRUE(session_->test_request_pending());

    // Find the TestReqID we sent
    std::string test_req_id;
    for (auto& sent : harness_.sent_messages) {
        FixMessage msg;
        msg.parse(sent.data.data(), sent.data.size());
        if (msg.msg_type() == MsgType::TestRequest) {
            test_req_id = std::string(msg.get_string(Tag::TestReqID));
        }
    }
    ASSERT_FALSE(test_req_id.empty());

    // Receive a heartbeat echoing the TestReqID
    auto hb = MsgFactory::build_heartbeat("EXCHANGE", "TRADER", 2, test_req_id);
    FixMessage resp;
    resp.parse(hb.data(), hb.size());
    session_->on_message_received(resp);

    EXPECT_FALSE(session_->test_request_pending());
}

TEST_F(FixSessionTest, RespondToTestRequest) {
    do_logon();
    harness_.clear();

    // Receive a TestRequest from counterparty
    auto test_req = MsgFactory::build_test_request("EXCHANGE", "TRADER", 2, "TR-42");
    FixMessage msg;
    msg.parse(test_req.data(), test_req.size());
    session_->on_message_received(msg);

    // Should respond with Heartbeat echoing the TestReqID
    ASSERT_GE(harness_.sent_messages.size(), 1u);
    auto resp = harness_.parse_last_sent();
    EXPECT_EQ(resp.msg_type(), MsgType::Heartbeat);
    EXPECT_EQ(resp.get_string(Tag::TestReqID), "TR-42");
}

// ═══════════════════════════════════════════════════════════════════════════
// GAP DETECTION / RESEND TESTS
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixSessionTest, GapDetectionSendsResendRequest) {
    do_logon();
    harness_.clear();

    // Receive message with seq 5 (expected 2) → gap [2, 4]
    auto exec = MsgFactory::build_execution_report("EXCHANGE", "TRADER", 5, "ORD-1");
    FixMessage msg;
    msg.parse(exec.data(), exec.size());
    session_->on_message_received(msg);

    // Should have sent a ResendRequest
    bool found_resend = false;
    for (auto& sent : harness_.sent_messages) {
        FixMessage sm;
        sm.parse(sent.data.data(), sent.data.size());
        if (sm.msg_type() == MsgType::ResendRequest) {
            found_resend = true;
            EXPECT_EQ(sm.get_int(Tag::BeginSeqNo).value(), 2);
            EXPECT_EQ(sm.get_int(Tag::EndSeqNo).value(), 4);
        }
    }
    EXPECT_TRUE(found_resend) << "Expected ResendRequest for gap [2, 4]";

    // The application message should still be delivered
    EXPECT_EQ(harness_.app_messages.size(), 1u);
    EXPECT_EQ(harness_.app_messages[0].msg_type, "8");

    // Sequence should advance past the gap
    EXPECT_EQ(session_->next_inbound_seq(), 6u);
}

TEST_F(FixSessionTest, SequenceResetGapFill) {
    do_logon();

    // Simulate gap: we expect seq 2, receive GapFill resetting to seq 5
    auto reset = MsgFactory::build_sequence_reset("EXCHANGE", "TRADER", 2, 5, true);
    FixMessage msg;
    msg.parse(reset.data(), reset.size());
    session_->on_message_received(msg);

    // Expected inbound should now be 5
    EXPECT_EQ(session_->next_inbound_seq(), 5u);
}

TEST_F(FixSessionTest, SequenceResetNonGapFill) {
    do_logon();

    // Non-gap-fill SequenceReset (reset mode)
    auto reset = MsgFactory::build_sequence_reset("EXCHANGE", "TRADER", 2, 10, false);
    FixMessage msg;
    msg.parse(reset.data(), reset.size());
    session_->on_message_received(msg);

    EXPECT_EQ(session_->next_inbound_seq(), 10u);
}

TEST_F(FixSessionTest, DuplicateMessageWithPossDupAccepted) {
    do_logon();

    // Receive normal message seq 2
    auto exec1 = MsgFactory::build_execution_report("EXCHANGE", "TRADER", 2, "ORD-1");
    FixMessage msg1;
    msg1.parse(exec1.data(), exec1.size());
    session_->on_message_received(msg1);
    EXPECT_EQ(session_->next_inbound_seq(), 3u);

    harness_.clear();

    // Receive same seq 2 with PossDupFlag=Y (legitimate resend)
    FixBuilder b;
    b.set_msg_type(MsgType::ExecutionReport);
    b.set_sender_comp_id("EXCHANGE");
    b.set_target_comp_id("TRADER");
    b.set_msg_seq_num(2);
    b.set_sending_time("20260712-12:00:00.000");
    b.set_char(Tag::PossDupFlag, 'Y');
    b.set_string(Tag::OrderID, "ORD-1");
    b.set_string(Tag::ExecID, "EXEC-1");
    b.set_string(Tag::ClOrdID, "ORD-1");
    b.set_char(Tag::ExecType, FixExecType::New);
    b.set_char(Tag::OrdStatus, FixOrdStatus::New);
    b.set_string(Tag::Symbol, "AAPL");
    b.set_char(Tag::Side, FixSide::Buy);
    b.set_int(Tag::LeavesQty, 100);
    b.set_int(Tag::CumQty, 0);
    b.set_double(Tag::AvgPx, 0.0, 2);
    auto dup = b.finalize();
    FixMessage msg2;
    msg2.parse(dup.data(), dup.size());
    session_->on_message_received(msg2);

    // Should be delivered to app layer (PossDup accepted)
    EXPECT_EQ(harness_.app_messages.size(), 1u);
}

TEST_F(FixSessionTest, DuplicateWithoutPossDupRejected) {
    do_logon();

    // Receive normal message seq 2
    auto exec1 = MsgFactory::build_execution_report("EXCHANGE", "TRADER", 2, "ORD-1");
    FixMessage msg1;
    msg1.parse(exec1.data(), exec1.size());
    session_->on_message_received(msg1);
    EXPECT_EQ(session_->next_inbound_seq(), 3u);

    harness_.clear();

    // Receive same seq 2 WITHOUT PossDupFlag → should be rejected
    auto dup = MsgFactory::build_execution_report("EXCHANGE", "TRADER", 2, "ORD-DUP");
    FixMessage msg2;
    msg2.parse(dup.data(), dup.size());
    session_->on_message_received(msg2);

    // Should NOT be delivered to app layer
    EXPECT_EQ(harness_.app_messages.size(), 0u);
}

// ═══════════════════════════════════════════════════════════════════════════
// RESEND REQUEST HANDLING
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixSessionTest, HandleResendRequestWithGapFill) {
    do_logon();
    // Send a few messages to advance outbound seq
    for (int i = 0; i < 3; ++i) {
        FixBuilder b;
        b.set_msg_type(MsgType::Heartbeat);
        session_->send_app_message(b);
    }
    harness_.clear();

    // Counterparty requests resend of seq 2-4
    auto resend = MsgFactory::build_resend_request("EXCHANGE", "TRADER", 2, 2, 4);
    FixMessage msg;
    msg.parse(resend.data(), resend.size());
    session_->on_message_received(msg);

    // Should respond with SequenceReset-GapFill (for now, until message store is added)
    bool found_reset = false;
    for (auto& sent : harness_.sent_messages) {
        FixMessage sm;
        sm.parse(sent.data.data(), sent.data.size());
        if (sm.msg_type() == MsgType::SequenceReset) {
            found_reset = true;
            auto gf = sm.get_char(Tag::GapFillFlag);
            EXPECT_TRUE(gf.has_value());
            EXPECT_EQ(*gf, 'Y');
            EXPECT_EQ(sm.get_int(Tag::NewSeqNo).value(), 5);
        }
    }
    EXPECT_TRUE(found_reset) << "Expected SequenceReset-GapFill response";
}

// ═══════════════════════════════════════════════════════════════════════════
// APPLICATION MESSAGE DISPATCH
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixSessionTest, ApplicationMessageDispatched) {
    do_logon();
    harness_.clear();

    // Receive an ExecutionReport (application-level message)
    auto exec = MsgFactory::build_execution_report("EXCHANGE", "TRADER", 2, "ORD-1");
    FixMessage msg;
    msg.parse(exec.data(), exec.size());
    session_->on_message_received(msg);

    EXPECT_EQ(harness_.app_messages.size(), 1u);
    EXPECT_EQ(harness_.app_messages[0].msg_type, "8");
}

TEST_F(FixSessionTest, SendApplicationMessage) {
    do_logon();
    harness_.clear();

    FixBuilder builder;
    builder.set_msg_type(MsgType::NewOrderSingle);
    builder.set_string(Tag::ClOrdID, "ORD-1");
    builder.set_string(Tag::Symbol, "AAPL");
    builder.set_char(Tag::Side, FixSide::Buy);
    builder.set_char(Tag::OrdType, FixOrdType::Limit);
    builder.set_double(Tag::Price, 150.25, 2);
    builder.set_int(Tag::OrderQty, 100);
    builder.set_string(Tag::TransactTime, "20260712-12:00:01.000");

    EXPECT_TRUE(session_->send_app_message(builder));

    ASSERT_EQ(harness_.sent_messages.size(), 1u);
    auto msg = harness_.parse_last_sent();
    EXPECT_EQ(msg.msg_type(), MsgType::NewOrderSingle);
    EXPECT_EQ(msg.sender_comp_id(), "TRADER");
    EXPECT_EQ(msg.target_comp_id(), "EXCHANGE");
    EXPECT_EQ(msg.get_string(Tag::ClOrdID), "ORD-1");
}

// ═══════════════════════════════════════════════════════════════════════════
// RESET / RECONNECTION
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixSessionTest, ResetClearsState) {
    do_logon();

    session_->reset();
    EXPECT_EQ(session_->state(), SessionState::Disconnected);
    EXPECT_EQ(session_->next_outbound_seq(), 1u);
    EXPECT_EQ(session_->next_inbound_seq(), 1u);
    EXPECT_FALSE(session_->test_request_pending());
}

TEST_F(FixSessionTest, SetSequenceNumbers) {
    session_->set_next_outbound_seq(100);
    session_->set_next_inbound_seq(200);
    EXPECT_EQ(session_->next_outbound_seq(), 100u);
    EXPECT_EQ(session_->next_inbound_seq(), 200u);
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMER TICK DOES NOTHING WHEN NOT ACTIVE
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixSessionTest, TimerTickInDisconnectedState) {
    harness_.advance_time(std::chrono::seconds(100));
    session_->on_timer_tick();
    EXPECT_EQ(harness_.sent_messages.size(), 0u);
}

TEST_F(FixSessionTest, HeartbeatIntervalFromCounterparty) {
    session_->on_connected();
    session_->initiate_logon();

    // Counterparty responds with HeartBtInt=10
    auto logon_resp = MsgFactory::build_logon("EXCHANGE", "TRADER", 1, 10);
    FixMessage msg;
    msg.parse(logon_resp.data(), logon_resp.size());
    session_->on_message_received(msg);

    EXPECT_EQ(session_->config().heartbeat_interval_sec, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE INTEGRATION & RESEND REPLAY TESTS
// ═══════════════════════════════════════════════════════════════════════════

TEST(FixSessionStoreIntegration, AutoStoresOutboundAndInbound) {
    auto path = (std::filesystem::temp_directory_path() / "test_session_store1.dat").string();
    std::filesystem::remove(path);

    {
        FixStore store(path, 64ULL * 1024 * 1024);
        SessionConfig config;
        config.set_sender("TRADER");
        config.set_target("EXCHANGE");

        TestHarness harness;
        FixSession session(config);
        session.set_store(&store);
        session.set_send_callback(TestHarness::on_send, &harness);

        session.on_connected();
        session.initiate_logon(); // out_seq 1

        // Verify logon was stored in store
        EXPECT_EQ(store.get_sender_seq(), 2u);
        auto stored_logon = store.retrieve(1, StoreDirection::Outbound);
        EXPECT_FALSE(stored_logon.empty());

        // Inbound logon response
        auto logon_resp = MsgFactory::build_logon("EXCHANGE", "TRADER", 1);
        FixMessage in_msg;
        (void)in_msg.parse(logon_resp.data(), logon_resp.size());
        session.on_message_received(in_msg);

        // Verify inbound logon was stored
        auto stored_in = store.retrieve(1, StoreDirection::Inbound);
        EXPECT_FALSE(stored_in.empty());

        // Send an application message (seq 2)
        FixBuilder b;
        b.set_msg_type(MsgType::NewOrderSingle);
        b.set_string(Tag::ClOrdID, "ORD-1");
        b.set_string(Tag::Symbol, "AAPL");
        b.set_char(Tag::Side, FixSide::Buy);
        b.set_char(Tag::OrdType, FixOrdType::Limit);
        b.set_double(Tag::Price, 150.0, 2);
        b.set_int(Tag::OrderQty, 100);
        b.set_string(Tag::TransactTime, "20260712-12:00:00.000");
        (void)session.send_app_message(b);

        EXPECT_EQ(store.get_sender_seq(), 3u);
        auto stored_order = store.retrieve(2, StoreDirection::Outbound);
        EXPECT_FALSE(stored_order.empty());
    }

    std::filesystem::remove(path);
}

TEST(FixSessionStoreIntegration, ReplaysAppMessageWithPossDup) {
    auto path = (std::filesystem::temp_directory_path() / "test_session_store2.dat").string();
    std::filesystem::remove(path);

    {
        FixStore store(path, 64ULL * 1024 * 1024);
        SessionConfig config;
        config.set_sender("TRADER");
        config.set_target("EXCHANGE");

        TestHarness harness;
        FixSession session(config);
        session.set_store(&store);
        session.set_send_callback(TestHarness::on_send, &harness);

        session.on_connected();
        session.initiate_logon(); // out_seq 1 (Logon)

        auto logon_resp = MsgFactory::build_logon("EXCHANGE", "TRADER", 1);
        FixMessage in_logon;
        (void)in_logon.parse(logon_resp.data(), logon_resp.size());
        session.on_message_received(in_logon);

        // Send NewOrderSingle (out_seq 2)
        FixBuilder b;
        b.set_msg_type(MsgType::NewOrderSingle);
        b.set_string(Tag::ClOrdID, "ORD-42");
        b.set_string(Tag::Symbol, "AAPL");
        b.set_char(Tag::Side, FixSide::Buy);
        b.set_char(Tag::OrdType, FixOrdType::Limit);
        b.set_double(Tag::Price, 150.0, 2);
        b.set_int(Tag::OrderQty, 100);
        b.set_string(Tag::TransactTime, "20260712-12:00:00.000");
        (void)session.send_app_message(b);

        harness.clear();

        // Exchange requests resend of seq 1 to 2
        // seq 1 is Logon (admin -> should be skipped via GapFill)
        // seq 2 is NewOrderSingle (app -> should be resent with PossDupFlag=Y)
        auto resend = MsgFactory::build_resend_request("EXCHANGE", "TRADER", 2, 1, 2);
        FixMessage in_resend;
        (void)in_resend.parse(resend.data(), resend.size());
        session.on_message_received(in_resend);

        // We should receive 2 messages:
        // 1. SequenceReset-GapFill for seq 1 (NewSeqNo=2)
        // 2. Resent NewOrderSingle for seq 2 (PossDupFlag=Y, ClOrdID=ORD-42)
        ASSERT_EQ(harness.sent_messages.size(), 2u);

        FixMessage msg1, msg2;
        (void)msg1.parse(harness.sent_messages[0].data.data(), harness.sent_messages[0].data.size());
        EXPECT_EQ(msg1.msg_type(), MsgType::SequenceReset);
        EXPECT_EQ(msg1.get_int(Tag::MsgSeqNum).value(), 1);
        EXPECT_EQ(msg1.get_int(Tag::NewSeqNo).value(), 2);
        EXPECT_EQ(msg1.get_char(Tag::GapFillFlag).value(), 'Y');

        (void)msg2.parse(harness.sent_messages[1].data.data(), harness.sent_messages[1].data.size());
        EXPECT_EQ(msg2.msg_type(), MsgType::NewOrderSingle);
        EXPECT_EQ(msg2.get_int(Tag::MsgSeqNum).value(), 2);
        EXPECT_EQ(msg2.get_char(Tag::PossDupFlag).value(), 'Y');
        EXPECT_EQ(msg2.get_string(Tag::ClOrdID), "ORD-42");
    }

    std::filesystem::remove(path);
}

TEST(FixSessionStoreIntegration, RecoverFromStoreRestoresSequences) {
    auto path = (std::filesystem::temp_directory_path() / "test_session_store3.dat").string();
    std::filesystem::remove(path);

    {
        FixStore store(path, 64ULL * 1024 * 1024);
        store.set_sender_seq(15);
        store.set_target_seq(20);
        store.flush();
    }

    {
        FixStore store(path, 64ULL * 1024 * 1024);
        SessionConfig config;
        FixSession session(config);
        session.set_store(&store);
        session.recover_from_store();

        EXPECT_EQ(session.next_outbound_seq(), 15u);
        EXPECT_EQ(session.next_inbound_seq(), 20u);
    }

    std::filesystem::remove(path);
}

