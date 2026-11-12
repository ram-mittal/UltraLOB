#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// FIX 4.4 Application & Order Interface
//
// Defines clean internal application structs, zero-allocation serialization,
// parsing, and bidirectional translation between FIX 4.4 wire messages and
// UltraLOB's core types (OrderRequest, CancelRequest, ModifyRequest, ExecutionReport).
//
// Includes lock-free queue integration points for thread-safe cross-thread
// communication between the FIX session/network thread and strategy/engine threads.
// ─────────────────────────────────────────────────────────────────────────────

#include "fix_types.hpp"
#include "fix_message.hpp"
#include "fix_builder.hpp"
#include "fix_session.hpp"
#include "ultralob/types.hpp"
#include "ultralob/matching_engine.hpp"
#include "ultralob/messages.hpp"
#include "ultralob/util/mpsc_queue.hpp"

#include <cstdint>
#include <cstring>
#include <string_view>
#include <optional>

namespace ultralob::fix {

// ─────────────────────────────────────────────────────────────────────────────
// Internal Application Structs (POD, fixed-size, stack-allocatable)
// ─────────────────────────────────────────────────────────────────────────────

struct FixNewOrderSingle {
    char        cl_ord_id[32]   = {};
    char        symbol[16]      = {};
    char        side            = FixSide::Buy;
    char        ord_type        = FixOrdType::Limit;
    char        time_in_force   = FixTimeInForce::Day;
    double      price           = 0.0;
    uint64_t    order_qty       = 0;
    char        account[32]     = {};
    char        transact_time[32] = {};

    void set_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(cl_ord_id) - 1) ? sv.size() : sizeof(cl_ord_id) - 1;
        std::memcpy(cl_ord_id, sv.data(), n);
        cl_ord_id[n] = '\0';
    }

    void set_symbol(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(symbol) - 1) ? sv.size() : sizeof(symbol) - 1;
        std::memcpy(symbol, sv.data(), n);
        symbol[n] = '\0';
    }
};

struct FixOrderCancelRequest {
    char        cl_ord_id[32]       = {};
    char        orig_cl_ord_id[32]  = {};
    char        symbol[16]          = {};
    char        side                = FixSide::Buy;
    uint64_t    order_qty           = 0;
    char        transact_time[32]   = {};

    void set_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(cl_ord_id) - 1) ? sv.size() : sizeof(cl_ord_id) - 1;
        std::memcpy(cl_ord_id, sv.data(), n);
        cl_ord_id[n] = '\0';
    }

    void set_orig_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(orig_cl_ord_id) - 1) ? sv.size() : sizeof(orig_cl_ord_id) - 1;
        std::memcpy(orig_cl_ord_id, sv.data(), n);
        orig_cl_ord_id[n] = '\0';
    }

    void set_symbol(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(symbol) - 1) ? sv.size() : sizeof(symbol) - 1;
        std::memcpy(symbol, sv.data(), n);
        symbol[n] = '\0';
    }
};

struct FixOrderCancelReplaceRequest {
    char        cl_ord_id[32]       = {};
    char        orig_cl_ord_id[32]  = {};
    char        symbol[16]          = {};
    char        side                = FixSide::Buy;
    char        ord_type            = FixOrdType::Limit;
    char        time_in_force       = FixTimeInForce::Day;
    double      price               = 0.0;
    uint64_t    order_qty           = 0;
    char        transact_time[32]   = {};

    void set_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(cl_ord_id) - 1) ? sv.size() : sizeof(cl_ord_id) - 1;
        std::memcpy(cl_ord_id, sv.data(), n);
        cl_ord_id[n] = '\0';
    }

    void set_orig_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(orig_cl_ord_id) - 1) ? sv.size() : sizeof(orig_cl_ord_id) - 1;
        std::memcpy(orig_cl_ord_id, sv.data(), n);
        orig_cl_ord_id[n] = '\0';
    }

    void set_symbol(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(symbol) - 1) ? sv.size() : sizeof(symbol) - 1;
        std::memcpy(symbol, sv.data(), n);
        symbol[n] = '\0';
    }
};

struct FixExecutionReport {
    char        order_id[32]        = {};
    char        cl_ord_id[32]       = {};
    char        orig_cl_ord_id[32]  = {};
    char        exec_id[32]         = {};
    char        exec_type           = FixExecType::New;
    char        ord_status          = FixOrdStatus::New;
    char        symbol[16]          = {};
    char        side                = FixSide::Buy;
    uint64_t    order_qty           = 0;
    double      price               = 0.0;
    double      last_px             = 0.0;
    uint64_t    last_qty            = 0;
    uint64_t    leaves_qty          = 0;
    uint64_t    cum_qty             = 0;
    double      avg_px              = 0.0;
    char        text[64]            = {};

    void set_order_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(order_id) - 1) ? sv.size() : sizeof(order_id) - 1;
        std::memcpy(order_id, sv.data(), n);
        order_id[n] = '\0';
    }

    void set_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(cl_ord_id) - 1) ? sv.size() : sizeof(cl_ord_id) - 1;
        std::memcpy(cl_ord_id, sv.data(), n);
        cl_ord_id[n] = '\0';
    }

    void set_orig_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(orig_cl_ord_id) - 1) ? sv.size() : sizeof(orig_cl_ord_id) - 1;
        std::memcpy(orig_cl_ord_id, sv.data(), n);
        orig_cl_ord_id[n] = '\0';
    }

    void set_exec_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(exec_id) - 1) ? sv.size() : sizeof(exec_id) - 1;
        std::memcpy(exec_id, sv.data(), n);
        exec_id[n] = '\0';
    }

    void set_symbol(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(symbol) - 1) ? sv.size() : sizeof(symbol) - 1;
        std::memcpy(symbol, sv.data(), n);
        symbol[n] = '\0';
    }

    void set_text(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(text) - 1) ? sv.size() : sizeof(text) - 1;
        std::memcpy(text, sv.data(), n);
        text[n] = '\0';
    }
};

struct FixOrderCancelReject {
    char        order_id[32]        = {};
    char        cl_ord_id[32]       = {};
    char        orig_cl_ord_id[32]  = {};
    char        ord_status          = FixOrdStatus::Rejected;
    char        cxl_rej_response_to = '1'; // '1'=Cancel, '2'=Replace
    int32_t     cxl_rej_reason      = 0;
    char        text[64]            = {};

    void set_order_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(order_id) - 1) ? sv.size() : sizeof(order_id) - 1;
        std::memcpy(order_id, sv.data(), n);
        order_id[n] = '\0';
    }

    void set_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(cl_ord_id) - 1) ? sv.size() : sizeof(cl_ord_id) - 1;
        std::memcpy(cl_ord_id, sv.data(), n);
        cl_ord_id[n] = '\0';
    }

    void set_orig_cl_ord_id(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(orig_cl_ord_id) - 1) ? sv.size() : sizeof(orig_cl_ord_id) - 1;
        std::memcpy(orig_cl_ord_id, sv.data(), n);
        orig_cl_ord_id[n] = '\0';
    }

    void set_text(std::string_view sv) noexcept {
        auto n = (sv.size() < sizeof(text) - 1) ? sv.size() : sizeof(text) - 1;
        std::memcpy(text, sv.data(), n);
        text[n] = '\0';
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Serialization Functions (zero-allocation builder population)
// ─────────────────────────────────────────────────────────────────────────────

void serialize_new_order_single(FixBuilder& b, const FixNewOrderSingle& req) noexcept;
void serialize_order_cancel_request(FixBuilder& b, const FixOrderCancelRequest& req) noexcept;
void serialize_order_cancel_replace_request(FixBuilder& b, const FixOrderCancelReplaceRequest& req) noexcept;
void serialize_execution_report(FixBuilder& b, const FixExecutionReport& rep) noexcept;
void serialize_order_cancel_reject(FixBuilder& b, const FixOrderCancelReject& rej) noexcept;

// ─────────────────────────────────────────────────────────────────────────────
// Parsing Functions (zero-copy extraction from FixMessage)
// ─────────────────────────────────────────────────────────────────────────────

[[nodiscard]] bool parse_new_order_single(const FixMessage& msg, FixNewOrderSingle& out) noexcept;
[[nodiscard]] bool parse_order_cancel_request(const FixMessage& msg, FixOrderCancelRequest& out) noexcept;
[[nodiscard]] bool parse_order_cancel_replace_request(const FixMessage& msg, FixOrderCancelReplaceRequest& out) noexcept;
[[nodiscard]] bool parse_execution_report(const FixMessage& msg, FixExecutionReport& out) noexcept;
[[nodiscard]] bool parse_order_cancel_reject(const FixMessage& msg, FixOrderCancelReject& out) noexcept;

// ─────────────────────────────────────────────────────────────────────────────
// Core UltraLOB Type Translation
// ─────────────────────────────────────────────────────────────────────────────

[[nodiscard]] Side to_core_side(char fix_side) noexcept;
[[nodiscard]] char from_core_side(Side side) noexcept;

[[nodiscard]] OrderType to_core_order_type(char fix_type, char fix_tif = FixTimeInForce::Day) noexcept;
[[nodiscard]] char from_core_order_type(OrderType type) noexcept;

[[nodiscard]] OrderStatus to_core_order_status(char fix_status) noexcept;
[[nodiscard]] char from_core_order_status(OrderStatus status) noexcept;
[[nodiscard]] char from_core_exec_type(OrderStatus status) noexcept;

[[nodiscard]] OrderRequest to_order_request(const FixNewOrderSingle& fix_req,
                                           Symbol symbol,
                                           OrderId id,
                                           uint32_t client_id = 0) noexcept;

[[nodiscard]] CancelRequest to_cancel_request(const FixOrderCancelRequest& fix_cxl,
                                             Symbol symbol,
                                             OrderId id) noexcept;

[[nodiscard]] ModifyRequest to_modify_request(const FixOrderCancelReplaceRequest& fix_rep,
                                             Symbol symbol,
                                             OrderId id) noexcept;

[[nodiscard]] FixExecutionReport to_fix_execution_report(const ExecutionReport& report,
                                                        std::string_view cl_ord_id,
                                                        std::string_view orig_cl_ord_id,
                                                        std::string_view symbol_str,
                                                        std::string_view order_id_str,
                                                        std::string_view exec_id_str) noexcept;

// ─────────────────────────────────────────────────────────────────────────────
// Application Interface & Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

using OnExecutionReportFn   = void(*)(const FixExecutionReport&, void* ctx);
using OnOrderCancelRejectFn = void(*)(const FixOrderCancelReject&, void* ctx);
using OnNewOrderSingleFn    = void(*)(const FixNewOrderSingle&, void* ctx);
using OnOrderCancelFn       = void(*)(const FixOrderCancelRequest&, void* ctx);
using OnOrderReplaceFn      = void(*)(const FixOrderCancelReplaceRequest&, void* ctx);

class FixApplication {
public:
    FixApplication() noexcept = default;

    // Callbacks
    void set_on_execution_report(OnExecutionReportFn fn, void* ctx) noexcept {
        on_exec_ = fn; exec_ctx_ = ctx;
    }
    void set_on_order_cancel_reject(OnOrderCancelRejectFn fn, void* ctx) noexcept {
        on_cxl_rej_ = fn; cxl_rej_ctx_ = ctx;
    }
    void set_on_new_order_single(OnNewOrderSingleFn fn, void* ctx) noexcept {
        on_nos_ = fn; nos_ctx_ = ctx;
    }
    void set_on_order_cancel(OnOrderCancelFn fn, void* ctx) noexcept {
        on_cancel_ = fn; cancel_ctx_ = ctx;
    }
    void set_on_order_replace(OnOrderReplaceFn fn, void* ctx) noexcept {
        on_replace_ = fn; replace_ctx_ = ctx;
    }

    // Process an application message received from FixSession
    void on_application_message(const FixMessage& msg) noexcept;

    // Convenience outbound senders (formats builder and calls session.send_app_message)
    bool send_new_order_single(FixSession& session, const FixNewOrderSingle& nos) noexcept;
    bool send_order_cancel(FixSession& session, const FixOrderCancelRequest& cxl) noexcept;
    bool send_order_replace(FixSession& session, const FixOrderCancelReplaceRequest& replace) noexcept;
    bool send_execution_report(FixSession& session, const FixExecutionReport& rep) noexcept;
    bool send_order_cancel_reject(FixSession& session, const FixOrderCancelReject& rej) noexcept;

private:
    FixBuilder app_builder_;

    OnExecutionReportFn   on_exec_        = nullptr;
    void*                 exec_ctx_       = nullptr;
    OnOrderCancelRejectFn on_cxl_rej_     = nullptr;
    void*                 cxl_rej_ctx_    = nullptr;
    OnNewOrderSingleFn    on_nos_         = nullptr;
    void*                 nos_ctx_        = nullptr;
    OnOrderCancelFn       on_cancel_      = nullptr;
    void*                 cancel_ctx_     = nullptr;
    OnOrderReplaceFn      on_replace_     = nullptr;
    void*                 replace_ctx_    = nullptr;
};

// ─────────────────────────────────────────────────────────────────────────────
// Inter-Thread Queue Bridge
//
// Shows how the FIX network thread and the Strategy/Engine thread communicate
// completely lock-free via UltraLOB's MPSCQueue ring buffers:
//
//   [FIX Network Thread] ── push ──> [Inbound MPSCQueue]  ── pop ──> [Strategy / Matching Thread]
//   [FIX Network Thread] <── pop ──  [Outbound MPSCQueue] <── push ── [Strategy / Matching Thread]
// ─────────────────────────────────────────────────────────────────────────────

template <size_t InboundCap = 65536, size_t OutboundCap = 65536>
class FixQueueBridge {
public:
    using InQueue  = MPSCQueue<InboundMessage, InboundCap>;
    using OutQueue = MPSCQueue<OutboundMessage, OutboundCap>;

    // Network thread pushes an inbound submit order to the matching engine queue
    bool push_inbound_order(const OrderRequest& req) noexcept {
        return inbound_queue_.try_push(InboundMessage(req));
    }

    // Network thread pushes an inbound cancel to the matching engine queue
    bool push_inbound_cancel(const CancelRequest& req) noexcept {
        return inbound_queue_.try_push(InboundMessage(req));
    }

    // Network thread pushes an inbound modify to the matching engine queue
    bool push_inbound_modify(const ModifyRequest& req) noexcept {
        return inbound_queue_.try_push(InboundMessage(req));
    }

    // Strategy / matching thread pops inbound requests
    std::optional<InboundMessage> poll_inbound() noexcept {
        return inbound_queue_.try_pop();
    }

    // Strategy / matching thread pushes outbound execution reports
    bool push_outbound_report(const ExecutionReport& rep) noexcept {
        OutboundMessage msg;
        msg.report = rep;
        return outbound_queue_.try_push(msg);
    }

    // Network thread polls outbound execution reports to send via FIX
    std::optional<OutboundMessage> poll_outbound() noexcept {
        return outbound_queue_.try_pop();
    }

private:
    InQueue  inbound_queue_;
    OutQueue outbound_queue_;
};

} // namespace ultralob::fix

