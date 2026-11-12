// ─────────────────────────────────────────────────────────────────────────────
// FIX Message Store Tests
//
// Tests memory-mapped persistence: store/retrieve, sequence tracking,
// crash recovery (close + reopen), reset, and capacity handling.
// ─────────────────────────────────────────────────────────────────────────────

#include <gtest/gtest.h>
#include "ultralob/fix/fix_store.hpp"
#include "ultralob/fix/fix_builder.hpp"
#include "ultralob/fix/fix_message.hpp"

#include <filesystem>
#include <string>

using namespace ultralob::fix;

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixture — creates a temp file and cleans up after
// ─────────────────────────────────────────────────────────────────────────────

class FixStoreTest : public ::testing::Test {
protected:
    // Use 64 MB for tests (32 MB index + 32 MB data)
    static constexpr uint64_t TEST_STORE_SIZE = 64ULL * 1024 * 1024;

    void SetUp() override {
        store_path_ = (std::filesystem::temp_directory_path() / "test_fix_store.dat").string();
        // Clean up any leftover file
        std::filesystem::remove(store_path_);
    }

    void TearDown() override {
        std::filesystem::remove(store_path_);
    }

    // Build a sample FIX message for testing
    static std::string build_sample_msg(std::string_view msg_type, uint64_t seq) {
        FixBuilder b;
        b.set_msg_type(msg_type);
        b.set_sender_comp_id("TRADER");
        b.set_target_comp_id("EXCHANGE");
        b.set_msg_seq_num(seq);
        b.set_sending_time("20260712-12:00:00.000");
        if (msg_type == MsgType::NewOrderSingle) {
            b.set_string(Tag::ClOrdID, "ORD-" + std::to_string(seq));
            b.set_string(Tag::Symbol, "AAPL");
            b.set_char(Tag::Side, FixSide::Buy);
            b.set_char(Tag::OrdType, FixOrdType::Limit);
            b.set_double(Tag::Price, 150.25, 2);
            b.set_int(Tag::OrderQty, 100);
            b.set_string(Tag::TransactTime, "20260712-12:00:00.000");
        }
        auto sv = b.finalize();
        return std::string(sv.data(), sv.size());
    }

    std::string store_path_;
};

// ═══════════════════════════════════════════════════════════════════════════
// BASIC STORE / RETRIEVE
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixStoreTest, CreateAndOpen) {
    FixStore store(store_path_, TEST_STORE_SIZE);
    EXPECT_TRUE(store.is_open());
    EXPECT_EQ(store.message_count(), 0u);
    EXPECT_EQ(store.get_sender_seq(), 1u);
    EXPECT_EQ(store.get_target_seq(), 1u);
}

TEST_F(FixStoreTest, StoreAndRetrieveOutbound) {
    FixStore store(store_path_, TEST_STORE_SIZE);

    auto msg = build_sample_msg(MsgType::NewOrderSingle, 1);
    EXPECT_TRUE(store.store(1, msg.data(), msg.size(), StoreDirection::Outbound));
    EXPECT_EQ(store.message_count(), 1u);

    auto retrieved = store.retrieve(1, StoreDirection::Outbound);
    ASSERT_FALSE(retrieved.empty());
    EXPECT_EQ(retrieved, msg);
}

TEST_F(FixStoreTest, StoreAndRetrieveInbound) {
    FixStore store(store_path_, TEST_STORE_SIZE);

    auto msg = build_sample_msg(MsgType::ExecutionReport, 1);
    EXPECT_TRUE(store.store(1, msg.data(), msg.size(), StoreDirection::Inbound));

    auto retrieved = store.retrieve(1, StoreDirection::Inbound);
    ASSERT_FALSE(retrieved.empty());
    EXPECT_EQ(retrieved, msg);
}

TEST_F(FixStoreTest, RetrieveNonexistent) {
    FixStore store(store_path_, TEST_STORE_SIZE);
    auto retrieved = store.retrieve(42, StoreDirection::Outbound);
    EXPECT_TRUE(retrieved.empty());
}

TEST_F(FixStoreTest, StoreMultipleMessages) {
    FixStore store(store_path_, TEST_STORE_SIZE);

    for (uint64_t i = 1; i <= 10; ++i) {
        auto msg = build_sample_msg(MsgType::NewOrderSingle, i);
        EXPECT_TRUE(store.store(i, msg.data(), msg.size(), StoreDirection::Outbound));
    }
    EXPECT_EQ(store.message_count(), 10u);

    // Verify all messages can be retrieved
    for (uint64_t i = 1; i <= 10; ++i) {
        auto expected = build_sample_msg(MsgType::NewOrderSingle, i);
        auto retrieved = store.retrieve(i, StoreDirection::Outbound);
        EXPECT_EQ(retrieved, expected) << "Mismatch at seq " << i;
    }
}

TEST_F(FixStoreTest, StoreOutboundAndInboundSeparately) {
    FixStore store(store_path_, TEST_STORE_SIZE);

    auto out_msg = build_sample_msg(MsgType::NewOrderSingle, 1);
    auto in_msg  = build_sample_msg(MsgType::ExecutionReport, 1);

    EXPECT_TRUE(store.store(1, out_msg.data(), out_msg.size(), StoreDirection::Outbound));
    EXPECT_TRUE(store.store(1, in_msg.data(),  in_msg.size(),  StoreDirection::Inbound));

    // Same sequence number, different directions — should be independent
    auto ret_out = store.retrieve(1, StoreDirection::Outbound);
    auto ret_in  = store.retrieve(1, StoreDirection::Inbound);
    EXPECT_EQ(ret_out, out_msg);
    EXPECT_EQ(ret_in, in_msg);
    EXPECT_NE(ret_out, ret_in);  // They should be different messages
}

// ═══════════════════════════════════════════════════════════════════════════
// SEQUENCE NUMBER PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixStoreTest, PersistSequenceNumbers) {
    {
        FixStore store(store_path_, TEST_STORE_SIZE);
        store.set_sender_seq(42);
        store.set_target_seq(99);
        store.flush();
    }
    // Reopen
    {
        FixStore store(store_path_, TEST_STORE_SIZE);
        EXPECT_EQ(store.get_sender_seq(), 42u);
        EXPECT_EQ(store.get_target_seq(), 99u);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION IDENTITY
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixStoreTest, PersistSessionIds) {
    {
        FixStore store(store_path_, TEST_STORE_SIZE);
        store.set_session_ids("TRADER-X", "EXCHANGE-Y");
        store.flush();
    }
    {
        FixStore store(store_path_, TEST_STORE_SIZE);
        EXPECT_EQ(store.get_sender_id(), "TRADER-X");
        EXPECT_EQ(store.get_target_id(), "EXCHANGE-Y");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRASH RECOVERY
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixStoreTest, CrashRecovery) {
    // Write messages, close (simulating crash), reopen and verify
    {
        FixStore store(store_path_, TEST_STORE_SIZE);
        store.set_sender_seq(5);
        store.set_target_seq(3);

        for (uint64_t i = 1; i <= 4; ++i) {
            auto msg = build_sample_msg(MsgType::NewOrderSingle, i);
            store.store(i, msg.data(), msg.size(), StoreDirection::Outbound);
        }
        for (uint64_t i = 1; i <= 2; ++i) {
            auto msg = build_sample_msg(MsgType::ExecutionReport, i);
            store.store(i, msg.data(), msg.size(), StoreDirection::Inbound);
        }
        store.flush();
    }

    // Reopen — should recover everything
    {
        FixStore store(store_path_, TEST_STORE_SIZE);
        EXPECT_EQ(store.get_sender_seq(), 5u);
        EXPECT_EQ(store.get_target_seq(), 3u);
        EXPECT_EQ(store.message_count(), 6u);

        // Verify outbound messages
        for (uint64_t i = 1; i <= 4; ++i) {
            auto expected = build_sample_msg(MsgType::NewOrderSingle, i);
            auto retrieved = store.retrieve(i, StoreDirection::Outbound);
            EXPECT_EQ(retrieved, expected) << "Outbound seq " << i << " mismatch";
        }

        // Verify inbound messages
        for (uint64_t i = 1; i <= 2; ++i) {
            auto expected = build_sample_msg(MsgType::ExecutionReport, i);
            auto retrieved = store.retrieve(i, StoreDirection::Inbound);
            EXPECT_EQ(retrieved, expected) << "Inbound seq " << i << " mismatch";
        }
    }
}

TEST_F(FixStoreTest, RetrievedMessageParseable) {
    FixStore store(store_path_, TEST_STORE_SIZE);

    auto msg = build_sample_msg(MsgType::NewOrderSingle, 1);
    store.store(1, msg.data(), msg.size(), StoreDirection::Outbound);

    auto retrieved = store.retrieve(1, StoreDirection::Outbound);
    FixMessage parsed;
    ASSERT_TRUE(parsed.parse(retrieved.data(), retrieved.size()));
    EXPECT_EQ(parsed.msg_type(), MsgType::NewOrderSingle);
    EXPECT_EQ(parsed.get_string(Tag::ClOrdID), "ORD-1");
    EXPECT_EQ(parsed.get_string(Tag::Symbol), "AAPL");
}

// ═══════════════════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixStoreTest, ResetStore) {
    FixStore store(store_path_, TEST_STORE_SIZE);

    auto msg = build_sample_msg(MsgType::NewOrderSingle, 1);
    store.store(1, msg.data(), msg.size(), StoreDirection::Outbound);
    store.set_sender_seq(42);
    store.set_target_seq(99);

    store.reset_store();

    EXPECT_EQ(store.message_count(), 0u);
    EXPECT_EQ(store.get_sender_seq(), 1u);
    EXPECT_EQ(store.get_target_seq(), 1u);
    EXPECT_TRUE(store.retrieve(1, StoreDirection::Outbound).empty());
}

// ═══════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

TEST_F(FixStoreTest, RejectZeroSequence) {
    FixStore store(store_path_, TEST_STORE_SIZE);
    auto msg = build_sample_msg(MsgType::Heartbeat, 0);
    EXPECT_FALSE(store.store(0, msg.data(), msg.size(), StoreDirection::Outbound));
}

TEST_F(FixStoreTest, RejectNullData) {
    FixStore store(store_path_, TEST_STORE_SIZE);
    EXPECT_FALSE(store.store(1, nullptr, 0, StoreDirection::Outbound));
}

TEST_F(FixStoreTest, ManyMessages) {
    FixStore store(store_path_, TEST_STORE_SIZE);

    // Store 1000 messages
    for (uint64_t i = 1; i <= 1000; ++i) {
        auto msg = build_sample_msg(MsgType::Heartbeat, i);
        ASSERT_TRUE(store.store(i, msg.data(), msg.size(), StoreDirection::Outbound))
            << "Failed to store seq " << i;
    }
    EXPECT_EQ(store.message_count(), 1000u);

    // Spot-check retrieval
    for (uint64_t i : {1ULL, 500ULL, 999ULL, 1000ULL}) {
        auto expected = build_sample_msg(MsgType::Heartbeat, i);
        auto retrieved = store.retrieve(i, StoreDirection::Outbound);
        EXPECT_EQ(retrieved, expected) << "Mismatch at seq " << i;
    }
}

