#pragma once

#include "ultralob/messages.hpp"
#include <cstdint>

namespace ultralob::net {

// ─────────────────────────────────────────────────────────────────────────────
// ClientRequest 
// 
// Fixed-size binary message representing a command from the client.
// To keep things zero-allocation and fast, this maps closely to InboundMessage.
// ─────────────────────────────────────────────────────────────────────────────
#pragma pack(push, 1)
struct ClientRequest {
    MsgType type;
    union {
        OrderRequest  submit;
        CancelRequest cancel;
        ModifyRequest modify;
    };
    
    ClientRequest() : type(MsgType::StopEngine), submit{} {}
};
#pragma pack(pop)

// ─────────────────────────────────────────────────────────────────────────────
// ServerResponse
// 
// Fixed-size binary message representing an execution report from the engine.
// ─────────────────────────────────────────────────────────────────────────────
#pragma pack(push, 1)
struct ServerResponse {
    ExecutionReport report;
    
    ServerResponse() : report{} {}
    ServerResponse(const ExecutionReport& rpt) : report(rpt) {}
};
#pragma pack(pop)

} // namespace ultralob::net
