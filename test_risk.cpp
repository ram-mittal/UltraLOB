#include "ultralob/net/risk_engine.hpp"
#include <iostream>

using namespace ultralob;
using namespace ultralob::net;

int main() {
    RiskEngine risk;
    RiskAccount* acc = risk.get_or_create_account(999, 10'000'000'000'000LL);
    
    OrderRequest req;
    req.id = 101;
    req.client_id = 999;
    req.symbol = 1;
    req.side = Side::Buy;
    req.type = OrderType::Limit;
    req.price = 15025000000LL;
    req.qty = 100;
    
    RejectReason reason = RejectReason::None;
    bool ok = risk.check_and_hold(acc, req, reason);
    if (!ok) {
        std::cout << "Rejected by PTRM. Reason=" << (int)reason << std::endl;
    } else {
        std::cout << "Accepted by PTRM!" << std::endl;
    }
    return 0;
}
