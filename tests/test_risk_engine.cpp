#include <gtest/gtest.h>
#include "ultralob/net/risk_engine.hpp"

using namespace ultralob;
using namespace ultralob::net;

TEST(RiskEngineTest, BuyFatFinger) {
    RiskEngine risk;
    auto* account = risk.get_or_create_account(1);
    
    OrderRequest req;
    req.id = 1;
    req.client_id = 1;
    req.symbol = 1;
    req.side = Side::Buy;
    req.type = OrderType::Limit;
    req.qty = 2'000'000; // Over max_order_qty (1,000,000)
    req.price = from_double(10.0);
    
    RejectReason reason;
    EXPECT_FALSE(risk.check_and_hold(account, req, reason));
    EXPECT_EQ(reason, RejectReason::InvalidQty);
}

TEST(RiskEngineTest, BuyingPowerHold) {
    RiskEngine risk;
    auto* account = risk.get_or_create_account(1, from_double(100.0)); // $100 buying power
    
    OrderRequest req;
    req.id = 1;
    req.client_id = 1;
    req.symbol = 1;
    req.side = Side::Buy;
    req.type = OrderType::Limit;
    req.qty = 10; 
    req.price = from_double(15.0); // 10 * 15 = $150
    
    RejectReason reason;
    EXPECT_FALSE(risk.check_and_hold(account, req, reason)); // Not enough buying power
    
    req.price = from_double(9.0); // 10 * 9 = $90
    EXPECT_TRUE(risk.check_and_hold(account, req, reason));
    EXPECT_EQ(account->buying_power.load(), from_double(10.0)); // $100 - $90 = $10
    EXPECT_EQ(account->held_buying_power.load(), from_double(90.0));
}

TEST(RiskEngineTest, NakedShortPrevention) {
    RiskEngine risk;
    auto* account = risk.get_or_create_account(1, from_double(1000.0));
    account->positions[1].store(0);
    
    OrderRequest req;
    req.id = 1;
    req.client_id = 1;
    req.symbol = 1;
    req.side = Side::Sell;
    req.type = OrderType::Limit;
    req.qty = 10; 
    req.price = from_double(15.0); 
    
    RejectReason reason;
    EXPECT_FALSE(risk.check_and_hold(account, req, reason)); // 0 inventory
    
    // Give them inventory
    account->positions[1].store(20);
    EXPECT_TRUE(risk.check_and_hold(account, req, reason)); // allowed
    EXPECT_EQ(account->held_short_positions[1].load(), 10);
}
