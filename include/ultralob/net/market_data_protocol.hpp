#pragma once

#include "ultralob/types.hpp"
#include <cstdint>

namespace ultralob::net {

// Market Data Protocol (ITCH-like)
// Broadcast over UDP Multicast.
// All fields must be properly packed.

enum class MDType : uint8_t {
    AddOrder = 'A',
    ExecuteOrder = 'E',
    CancelOrder = 'X'
};

#pragma pack(push, 1)

struct MDAddOrder {
    uint64_t timestamp; // nanoseconds since epoch
    OrderId  order_id;
    Symbol   symbol;
    Side     side;
    Qty      qty;
    Price    price;
};

struct MDExecuteOrder {
    uint64_t timestamp;
    OrderId  order_id;
    Qty      exec_qty;
    Price    exec_price;
    uint64_t match_id; // Unique identifier for the match
};

struct MDCancelOrder {
    uint64_t timestamp;
    OrderId  order_id;
    Qty      cancelled_qty;
};

struct MDMessage {
    MDType type;
    union {
        MDAddOrder     add;
        MDExecuteOrder exec;
        MDCancelOrder  cancel;
    };
};

#pragma pack(pop)

} // namespace ultralob::net
