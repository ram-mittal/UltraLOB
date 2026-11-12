#include <gtest/gtest.h>
#include "ultralob/fix/fix_framer.hpp"
#include "ultralob/fix/fix_builder.hpp"
#include "ultralob/fix/fix_message.hpp"
#include <string>

using namespace ultralob::fix;

class FixFramerTest : public ::testing::Test {
protected:
    FixFramer  framer;
    FixMessage msg;

    std::string make_heartbeat(uint64_t seq = 1) {
        FixBuilder b;
        b.set_msg_type(MsgType::Heartbeat);
        b.set_sender_comp_id("SENDER");
        b.set_target_comp_id("TARGET");
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    std::string make_logon(uint64_t seq = 1) {
        FixBuilder b;
        b.set_msg_type(MsgType::Logon);
        b.set_sender_comp_id("SENDER");
        b.set_target_comp_id("TARGET");
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        b.set_int(Tag::EncryptMethod, 0);
        b.set_int(Tag::HeartBtInt, 30);
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Complete delivery
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixFramerTest, SingleCompleteMessage) {
    auto raw = make_heartbeat();
    framer.feed(raw.data(), raw.size());

    const char* data = nullptr;
    size_t len = 0;
    EXPECT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_NE(data, nullptr);
    EXPECT_EQ(len, raw.size());

    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_type(), MsgType::Heartbeat);
}

TEST_F(FixFramerTest, TwoMessagesBackToBack) {
    std::string combined = make_heartbeat(1) + make_heartbeat(2);
    framer.feed(combined.data(), combined.size());

    const char* data = nullptr;
    size_t len = 0;

    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_seq_num().value(), 1);

    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_seq_num().value(), 2);

    EXPECT_EQ(framer.extract(data, len), FrameResult::Incomplete);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fragmented delivery
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixFramerTest, FragmentedDelivery) {
    auto raw = make_heartbeat();
    size_t chunk = 5;
    for (size_t i = 0; i < raw.size(); i += chunk) {
        size_t n = std::min(chunk, raw.size() - i);
        framer.feed(raw.data() + i, n);
    }

    const char* data = nullptr;
    size_t len = 0;
    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_type(), MsgType::Heartbeat);
}

TEST_F(FixFramerTest, ByteByByteDelivery) {
    auto raw = make_heartbeat();
    const char* data = nullptr;
    size_t len = 0;

    for (size_t i = 0; i < raw.size() - 1; ++i) {
        framer.feed(raw.data() + i, 1);
        EXPECT_NE(framer.extract(data, len), FrameResult::Complete);
    }

    framer.feed(raw.data() + raw.size() - 1, 1);
    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
}

TEST_F(FixFramerTest, IncompleteMessage) {
    auto raw = make_heartbeat();
    framer.feed(raw.data(), raw.size() / 2);

    const char* data = nullptr;
    size_t len = 0;
    EXPECT_EQ(framer.extract(data, len), FrameResult::Incomplete);
    EXPECT_EQ(framer.buffered(), raw.size() / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mixed message types
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixFramerTest, DifferentMessageTypes) {
    std::string combined = make_heartbeat(1) + make_logon(2) + make_heartbeat(3);
    framer.feed(combined.data(), combined.size());

    const char* data = nullptr;
    size_t len = 0;

    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_type(), MsgType::Heartbeat);

    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_type(), MsgType::Logon);

    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_type(), MsgType::Heartbeat);
    EXPECT_EQ(msg.msg_seq_num().value(), 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset & large messages
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixFramerTest, ResetClearsState) {
    auto raw = make_heartbeat();
    framer.feed(raw.data(), raw.size() / 2);
    EXPECT_GT(framer.buffered(), 0u);

    framer.reset();
    EXPECT_EQ(framer.buffered(), 0u);

    framer.feed(raw.data(), raw.size());
    const char* data = nullptr;
    size_t len = 0;
    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
}

TEST_F(FixFramerTest, LargeMessage) {
    FixBuilder b;
    b.set_msg_type(MsgType::NewOrderSingle);
    b.set_sender_comp_id("CLIENT");
    b.set_target_comp_id("EXCHANGE");
    b.set_msg_seq_num(1);
    b.set_sending_time("20260712-12:00:00.000");
    b.set_string(Tag::ClOrdID, "ORD-0000000001");
    b.set_string(Tag::Symbol, "VERYLONGSYMBOLNAME");
    b.set_char(Tag::Side, FixSide::Buy);
    b.set_char(Tag::OrdType, FixOrdType::Limit);
    b.set_double(Tag::Price, 99999.99, 2);
    b.set_int(Tag::OrderQty, 1000000);
    b.set_string(Tag::TransactTime, "20260712-12:00:00.000");
    b.set_string(Tag::Account, "ACCT-12345-LONGNAME");
    b.set_string(Tag::Text, "This is a test order with a long text field for testing purposes");
    auto sv = b.finalize();
    std::string raw(sv.data(), sv.size());

    framer.feed(raw.data(), raw.size());
    const char* data = nullptr;
    size_t len = 0;
    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.get_string(Tag::Symbol), "VERYLONGSYMBOLNAME");
}

TEST_F(FixFramerTest, ManyMessages) {
    for (uint64_t i = 1; i <= 100; ++i) {
        auto raw = make_heartbeat(i);
        framer.feed(raw.data(), raw.size());
    }

    const char* data = nullptr;
    size_t len = 0;
    for (uint64_t i = 1; i <= 100; ++i) {
        ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
        ASSERT_TRUE(msg.parse(data, len));
        EXPECT_EQ(msg.msg_seq_num().value(), static_cast<int64_t>(i));
    }
    EXPECT_EQ(framer.extract(data, len), FrameResult::Incomplete);
}

