#include <gtest/gtest.h>
#include "ultralob/fix/fix_builder.hpp"
#include "ultralob/fix/fix_message.hpp"
#include <string>

using namespace ultralob::fix;

class FixBuilderTest : public ::testing::Test {
protected:
    FixBuilder builder;
    FixMessage msg;   // for round-trip validation
};

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixBuilderTest, BuildHeartbeat) {
    builder.set_msg_type(MsgType::Heartbeat);
    builder.set_sender_comp_id("SENDER");
    builder.set_target_comp_id("TARGET");
    builder.set_msg_seq_num(1);
    builder.set_sending_time("20260712-12:00:00.000");

    auto result = builder.finalize();
    ASSERT_GT(result.size(), 0u);
    EXPECT_TRUE(result.substr(0, 10) == std::string_view("8=FIX.4.4\x01", 10));
    EXPECT_EQ(result.back(), SOH);

    ASSERT_TRUE(msg.parse(result.data(), result.size()));
    EXPECT_EQ(msg.msg_type(), MsgType::Heartbeat);
    EXPECT_EQ(msg.sender_comp_id(), "SENDER");
    EXPECT_EQ(msg.target_comp_id(), "TARGET");
    EXPECT_EQ(msg.msg_seq_num().value(), 1);
}

TEST_F(FixBuilderTest, BuildNewOrder) {
    builder.set_msg_type(MsgType::NewOrderSingle);
    builder.set_sender_comp_id("CLIENT");
    builder.set_target_comp_id("EXCHANGE");
    builder.set_msg_seq_num(42);
    builder.set_sending_time("20260712-12:00:00.000");
    builder.set_string(Tag::ClOrdID, "ORD-12345");
    builder.set_string(Tag::Symbol, "AAPL");
    builder.set_char(Tag::Side, FixSide::Buy);
    builder.set_char(Tag::OrdType, FixOrdType::Limit);
    builder.set_double(Tag::Price, 150.25, 2);
    builder.set_int(Tag::OrderQty, 100);
    builder.set_string(Tag::TransactTime, "20260712-12:00:00.000");

    auto result = builder.finalize();
    ASSERT_TRUE(msg.parse(result.data(), result.size()));

    EXPECT_EQ(msg.msg_type(), MsgType::NewOrderSingle);
    EXPECT_EQ(msg.get_string(Tag::ClOrdID), "ORD-12345");
    EXPECT_EQ(msg.get_string(Tag::Symbol), "AAPL");
    EXPECT_EQ(msg.get_char(Tag::Side).value(), FixSide::Buy);
    EXPECT_NEAR(msg.get_double(Tag::Price).value(), 150.25, 0.001);
    EXPECT_EQ(msg.get_int(Tag::OrderQty).value(), 100);
}

TEST_F(FixBuilderTest, BuildLogon) {
    builder.set_msg_type(MsgType::Logon);
    builder.set_sender_comp_id("SENDER");
    builder.set_target_comp_id("TARGET");
    builder.set_msg_seq_num(1);
    builder.set_sending_time("20260712-12:00:00.000");
    builder.set_int(Tag::EncryptMethod, 0);
    builder.set_int(Tag::HeartBtInt, 30);

    auto result = builder.finalize();
    ASSERT_TRUE(msg.parse(result.data(), result.size()));
    EXPECT_EQ(msg.msg_type(), MsgType::Logon);
    EXPECT_EQ(msg.get_int(Tag::HeartBtInt).value(), 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// BodyLength / CheckSum correctness
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixBuilderTest, CorrectBodyLength) {
    builder.set_msg_type(MsgType::Heartbeat);
    builder.set_sender_comp_id("S");
    builder.set_target_comp_id("T");
    builder.set_msg_seq_num(1);
    builder.set_sending_time("20260712-12:00:00.000");

    auto result = builder.finalize();
    ASSERT_TRUE(msg.parse(result.data(), result.size()));
    EXPECT_GT(msg.get_int(Tag::BodyLength).value(), 0);
}

TEST_F(FixBuilderTest, CorrectChecksum) {
    builder.set_msg_type(MsgType::Logon);
    builder.set_sender_comp_id("SENDER");
    builder.set_target_comp_id("TARGET");
    builder.set_msg_seq_num(1);
    builder.set_sending_time("20260712-12:00:00.000");
    builder.set_int(Tag::EncryptMethod, 0);
    builder.set_int(Tag::HeartBtInt, 30);

    auto result = builder.finalize();
    std::string s(result.data(), result.size());
    auto pos = s.rfind("10=");
    ASSERT_NE(pos, std::string::npos);

    uint8_t expected = fix_checksum(s.data(), pos);
    std::string cs_str = s.substr(pos + 3, 3);
    int actual = std::stoi(cs_str);
    EXPECT_EQ(expected, static_cast<uint8_t>(actual));
}

// ─────────────────────────────────────────────────────────────────────────────
// Reuse
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixBuilderTest, ResetAndReuse) {
    builder.set_msg_type(MsgType::Heartbeat);
    builder.set_sender_comp_id("S");
    builder.set_target_comp_id("T");
    builder.set_msg_seq_num(1);
    builder.set_sending_time("20260712-12:00:00.000");
    auto r1 = builder.finalize();
    std::string msg1(r1.data(), r1.size());

    builder.reset();
    builder.set_msg_type(MsgType::Logon);
    builder.set_sender_comp_id("X");
    builder.set_target_comp_id("Y");
    builder.set_msg_seq_num(2);
    builder.set_sending_time("20260712-12:00:01.000");
    builder.set_int(Tag::EncryptMethod, 0);
    builder.set_int(Tag::HeartBtInt, 30);
    auto r2 = builder.finalize();

    ASSERT_TRUE(msg.parse(msg1.data(), msg1.size()));
    EXPECT_EQ(msg.msg_type(), MsgType::Heartbeat);

    ASSERT_TRUE(msg.parse(r2.data(), r2.size()));
    EXPECT_EQ(msg.msg_type(), MsgType::Logon);
    EXPECT_EQ(msg.msg_seq_num().value(), 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Number formatting
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixBuilderTest, IntegerFormatting) {
    builder.set_msg_type(MsgType::Heartbeat);
    builder.set_sender_comp_id("S");
    builder.set_target_comp_id("T");
    builder.set_msg_seq_num(999999);
    builder.set_sending_time("20260712-12:00:00.000");
    builder.set_int(Tag::OrderQty, -500);

    auto result = builder.finalize();
    ASSERT_TRUE(msg.parse(result.data(), result.size()));
    EXPECT_EQ(msg.msg_seq_num().value(), 999999);
    EXPECT_EQ(msg.get_int(Tag::OrderQty).value(), -500);
}

TEST_F(FixBuilderTest, DoubleFormatting) {
    builder.set_msg_type(MsgType::Heartbeat);
    builder.set_sender_comp_id("S");
    builder.set_target_comp_id("T");
    builder.set_msg_seq_num(1);
    builder.set_sending_time("20260712-12:00:00.000");
    builder.set_double(Tag::Price, 99.99, 2);
    builder.set_double(Tag::AvgPx, 100.5, 4);

    auto result = builder.finalize();
    ASSERT_TRUE(msg.parse(result.data(), result.size()));
    EXPECT_NEAR(msg.get_double(Tag::Price).value(), 99.99, 0.001);
    EXPECT_NEAR(msg.get_double(Tag::AvgPx).value(), 100.5, 0.0001);
}

TEST_F(FixBuilderTest, LargeSequenceNumber) {
    builder.set_msg_type(MsgType::Heartbeat);
    builder.set_sender_comp_id("S");
    builder.set_target_comp_id("T");
    builder.set_msg_seq_num(1234567890);
    builder.set_sending_time("20260712-12:00:00.000");

    auto result = builder.finalize();
    ASSERT_TRUE(msg.parse(result.data(), result.size()));
    EXPECT_EQ(msg.msg_seq_num().value(), 1234567890);
}

