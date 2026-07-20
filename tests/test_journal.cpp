#include <gtest/gtest.h>
#include "ultralob/journal.hpp"
#include <filesystem>

using namespace ultralob;

class JournalTest : public ::testing::Test {
protected:
    void SetUp() override {
        // Ensure clean state
        if (std::filesystem::exists(test_file)) {
            std::filesystem::remove(test_file);
        }
    }

    void TearDown() override {
        if (std::filesystem::exists(test_file)) {
            std::filesystem::remove(test_file);
        }
    }

    std::string test_file = "test_events.journal";
};

TEST_F(JournalTest, AppendAndRecover) {
    // 1. Create a journal and write messages
    {
        Journal journal(test_file, 1024 * 1024); // 1 MB file
        
        net::ClientRequest req1;
        req1.type = MsgType::SubmitOrder;
        req1.submit.id = 1;
        req1.submit.symbol = 1;
        req1.submit.side = Side::Buy;
        req1.submit.type = OrderType::Limit;
        req1.submit.price = from_double(100.0);
        req1.submit.qty = 10;
        
        net::ClientRequest req2;
        req2.type = MsgType::CancelOrder;
        req2.cancel.symbol = 1;
        req2.cancel.order_id = 1;

        EXPECT_TRUE(journal.append(req1));
        EXPECT_TRUE(journal.append(req2));
        
        journal.flush();
    }

    // 2. Read messages back and verify
    auto messages = Journal::read_all(test_file);
    ASSERT_EQ(messages.size(), 2);

    EXPECT_EQ(messages[0].type, MsgType::SubmitOrder);
    EXPECT_EQ(messages[0].submit.id, 1);
    EXPECT_EQ(messages[0].submit.side, Side::Buy);
    EXPECT_EQ(messages[0].submit.price, from_double(100.0));
    EXPECT_EQ(messages[0].submit.qty, 10);

    EXPECT_EQ(messages[1].type, MsgType::CancelOrder);
    EXPECT_EQ(messages[1].cancel.symbol, 1);
    EXPECT_EQ(messages[1].cancel.order_id, 1);
}
