#include <gtest/gtest.h>
#include "ultralob/fix/fix_message.hpp"
#include "ultralob/fix/fix_builder.hpp"

using namespace ultralob::fix;

class FixMessageTest : public ::testing::Test {
protected:
    FixMessage msg;

    // Helper: build a valid Heartbeat via FixBuilder
    std::string build_heartbeat(uint64_t seq = 1) {
        FixBuilder b;
        b.set_msg_type(MsgType::Heartbeat);
        b.set_sender_comp_id("SENDER");
        b.set_target_comp_id("TARGET");
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    std::string build_new_order(uint64_t seq = 1) {
        FixBuilder b;
        b.set_msg_type(MsgType::NewOrderSingle);
        b.set_sender_comp_id("CLIENT");
        b.set_target_comp_id("EXCHANGE");
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        b.set_string(Tag::ClOrdID, "ORD001");
        b.set_string(Tag::Symbol, "AAPL");
        b.set_char(Tag::Side, FixSide::Buy);
        b.set_char(Tag::OrdType, FixOrdType::Limit);
        b.set_double(Tag::Price, 150.25, 2);
        b.set_int(Tag::OrderQty, 100);
        b.set_string(Tag::TransactTime, "20260712-12:00:00.000");
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixMessageTest, ParseHeartbeat) {
    auto raw = build_heartbeat(42);
    ASSERT_TRUE(msg.parse(raw.data(), raw.size()));
    EXPECT_TRUE(msg.is_valid());

    EXPECT_EQ(msg.msg_type(), MsgType::Heartbeat);
    EXPECT_EQ(msg.sender_comp_id(), "SENDER");
    EXPECT_EQ(msg.target_comp_id(), "TARGET");
    EXPECT_EQ(msg.msg_seq_num().value(), 42);
}

TEST_F(FixMessageTest, ParseNewOrder) {
    auto raw = build_new_order(7);
    ASSERT_TRUE(msg.parse(raw.data(), raw.size()));
    EXPECT_TRUE(msg.is_valid());

    EXPECT_EQ(msg.msg_type(), MsgType::NewOrderSingle);
    EXPECT_EQ(msg.get_string(Tag::ClOrdID), "ORD001");
    EXPECT_EQ(msg.get_string(Tag::Symbol), "AAPL");
    EXPECT_EQ(msg.get_char(Tag::Side).value(), FixSide::Buy);
    EXPECT_EQ(msg.get_char(Tag::OrdType).value(), FixOrdType::Limit);
    EXPECT_NEAR(msg.get_double(Tag::Price).value(), 150.25, 0.001);
    EXPECT_EQ(msg.get_int(Tag::OrderQty).value(), 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation / rejection
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixMessageTest, RejectTruncated) {
    auto raw = build_heartbeat();
    EXPECT_FALSE(msg.parse(raw.data(), raw.size() - 5));
    EXPECT_FALSE(msg.is_valid());
}

TEST_F(FixMessageTest, RejectBadChecksum) {
    auto raw = build_heartbeat();
    raw[raw.size() - 2] = static_cast<char>((raw[raw.size() - 2] - '0' + 1) % 10 + '0');
    EXPECT_FALSE(msg.parse(raw.data(), raw.size()));
}

TEST_F(FixMessageTest, RejectBadBeginString) {
    std::string bad = "8=FIX.4.2" "\x01" "35=0" "\x01" "10=000" "\x01";
    EXPECT_FALSE(msg.parse(bad.data(), bad.size()));
}

TEST_F(FixMessageTest, RejectEmpty) {
    EXPECT_FALSE(msg.parse(nullptr, 0));
    EXPECT_FALSE(msg.parse("", 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Field lookup
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixMessageTest, HasTag) {
    auto raw = build_new_order();
    ASSERT_TRUE(msg.parse(raw.data(), raw.size()));

    EXPECT_TRUE(msg.has_tag(Tag::MsgType));
    EXPECT_TRUE(msg.has_tag(Tag::Symbol));
    EXPECT_FALSE(msg.has_tag(Tag::Account));
}

TEST_F(FixMessageTest, GetMissingTag) {
    auto raw = build_heartbeat();
    ASSERT_TRUE(msg.parse(raw.data(), raw.size()));

    EXPECT_EQ(msg.get_string(Tag::Symbol), "");
    EXPECT_FALSE(msg.get_int(Tag::OrderQty).has_value());
    EXPECT_FALSE(msg.get_char(Tag::Side).has_value());
    EXPECT_FALSE(msg.get_double(Tag::Price).has_value());
}

TEST_F(FixMessageTest, FieldCount) {
    auto raw = build_heartbeat();
    ASSERT_TRUE(msg.parse(raw.data(), raw.size()));
    // 8, 9, 35, 49, 56, 34, 52, 10 = 8 fields
    EXPECT_EQ(msg.field_count(), 8u);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reuse
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixMessageTest, ResetAndReuse) {
    auto raw1 = build_heartbeat(1);
    ASSERT_TRUE(msg.parse(raw1.data(), raw1.size()));
    EXPECT_EQ(msg.msg_seq_num().value(), 1);

    auto raw2 = build_heartbeat(99);
    ASSERT_TRUE(msg.parse(raw2.data(), raw2.size()));
    EXPECT_EQ(msg.msg_seq_num().value(), 99);
}

// ─────────────────────────────────────────────────────────────────────────────
// Number parsers
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixMessageTest, ParseFixInt) {
    EXPECT_EQ(parse_fix_int("-42"), -42);
    EXPECT_EQ(parse_fix_int("0"), 0);
    EXPECT_EQ(parse_fix_int("12345"), 12345);
}

TEST_F(FixMessageTest, ParseFixDouble) {
    EXPECT_NEAR(parse_fix_double("150.25"), 150.25, 0.001);
    EXPECT_NEAR(parse_fix_double("-3.14"), -3.14, 0.001);
    EXPECT_NEAR(parse_fix_double("0.0"), 0.0, 0.001);
    EXPECT_NEAR(parse_fix_double("100"), 100.0, 0.001);
}

