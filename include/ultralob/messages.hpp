#pragma once

#include "types.hpp"
#include "matching_engine.hpp" // for OrderRequest, ModifyRequest

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────────────────────────────────────
enum class MsgType : uint8_t {
    SubmitOrder,
    CancelOrder,
    ModifyOrder,
    StopEngine
};

// ─────────────────────────────────────────────────────────────────────────────
// Cancel Request
// ─────────────────────────────────────────────────────────────────────────────
struct CancelRequest {
    Symbol  symbol;
    OrderId order_id;
};

// ─────────────────────────────────────────────────────────────────────────────
// InboundMessage — Payload pushed from Gateways to Engine
// ─────────────────────────────────────────────────────────────────────────────
struct alignas(64) InboundMessage {
    MsgType type;
    union {
        OrderRequest  submit;
        CancelRequest cancel;
        ModifyRequest modify;
    };

    // Constructors for the union
    InboundMessage() noexcept : type(MsgType::StopEngine) {}

    explicit InboundMessage(const OrderRequest& req) noexcept
        : type(MsgType::SubmitOrder), submit(req) {}

    explicit InboundMessage(const CancelRequest& req) noexcept
        : type(MsgType::CancelOrder), cancel(req) {}

    explicit InboundMessage(const ModifyRequest& req) noexcept
        : type(MsgType::ModifyOrder), modify(req) {}

    // Factory for stopping
    static InboundMessage create_stop() noexcept {
        return InboundMessage();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// OutboundMessage — Payload pushed from Engine to Gateways
// ─────────────────────────────────────────────────────────────────────────────
struct alignas(64) OutboundMessage {
    ExecutionReport report;
};

} // namespace ultralob
