#include "ultralob/fix/fix_application.hpp"

namespace ultralob::fix {

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

void serialize_new_order_single(FixBuilder& b, const FixNewOrderSingle& req) noexcept {
    b.reset();
    b.set_msg_type(MsgType::NewOrderSingle);
    b.set_string(Tag::ClOrdID, req.cl_ord_id);
    b.set_string(Tag::Symbol, req.symbol);
    b.set_char(Tag::Side, req.side);
    b.set_char(Tag::OrdType, req.ord_type);
    b.set_char(Tag::TimeInForce, req.time_in_force);
    if (req.price > 0.0) {
        b.set_double(Tag::Price, req.price, 2);
    }
    b.set_int(Tag::OrderQty, static_cast<int64_t>(req.order_qty));
    if (req.account[0] != '\0') {
        b.set_string(Tag::Account, req.account);
    }
    if (req.transact_time[0] != '\0') {
        b.set_string(Tag::TransactTime, req.transact_time);
    }
}

void serialize_order_cancel_request(FixBuilder& b, const FixOrderCancelRequest& req) noexcept {
    b.reset();
    b.set_msg_type(MsgType::OrderCancelRequest);
    b.set_string(Tag::ClOrdID, req.cl_ord_id);
    b.set_string(Tag::OrigClOrdID, req.orig_cl_ord_id);
    b.set_string(Tag::Symbol, req.symbol);
    b.set_char(Tag::Side, req.side);
    if (req.order_qty > 0) {
        b.set_int(Tag::OrderQty, static_cast<int64_t>(req.order_qty));
    }
    if (req.transact_time[0] != '\0') {
        b.set_string(Tag::TransactTime, req.transact_time);
    }
}

void serialize_order_cancel_replace_request(FixBuilder& b, const FixOrderCancelReplaceRequest& req) noexcept {
    b.reset();
    b.set_msg_type(MsgType::OrderCancelReplaceRequest);
    b.set_string(Tag::ClOrdID, req.cl_ord_id);
    b.set_string(Tag::OrigClOrdID, req.orig_cl_ord_id);
    b.set_string(Tag::Symbol, req.symbol);
    b.set_char(Tag::Side, req.side);
    b.set_char(Tag::OrdType, req.ord_type);
    b.set_char(Tag::TimeInForce, req.time_in_force);
    if (req.price > 0.0) {
        b.set_double(Tag::Price, req.price, 2);
    }
    b.set_int(Tag::OrderQty, static_cast<int64_t>(req.order_qty));
    if (req.transact_time[0] != '\0') {
        b.set_string(Tag::TransactTime, req.transact_time);
    }
}

void serialize_execution_report(FixBuilder& b, const FixExecutionReport& rep) noexcept {
    b.reset();
    b.set_msg_type(MsgType::ExecutionReport);
    b.set_string(Tag::OrderID, rep.order_id);
    b.set_string(Tag::ClOrdID, rep.cl_ord_id);
    if (rep.orig_cl_ord_id[0] != '\0') {
        b.set_string(Tag::OrigClOrdID, rep.orig_cl_ord_id);
    }
    b.set_string(Tag::ExecID, rep.exec_id);
    b.set_char(Tag::ExecType, rep.exec_type);
    b.set_char(Tag::OrdStatus, rep.ord_status);
    b.set_string(Tag::Symbol, rep.symbol);
    b.set_char(Tag::Side, rep.side);
    if (rep.order_qty > 0) {
        b.set_int(Tag::OrderQty, static_cast<int64_t>(rep.order_qty));
    }
    if (rep.price > 0.0) {
        b.set_double(Tag::Price, rep.price, 2);
    }
    if (rep.last_px > 0.0) {
        b.set_double(Tag::LastPx, rep.last_px, 2);
    }
    b.set_int(Tag::LastQty, static_cast<int64_t>(rep.last_qty));
    b.set_int(Tag::LeavesQty, static_cast<int64_t>(rep.leaves_qty));
    b.set_int(Tag::CumQty, static_cast<int64_t>(rep.cum_qty));
    b.set_double(Tag::AvgPx, rep.avg_px, 2);
    if (rep.text[0] != '\0') {
        b.set_string(Tag::Text, rep.text);
    }
}

void serialize_order_cancel_reject(FixBuilder& b, const FixOrderCancelReject& rej) noexcept {
    b.reset();
    b.set_msg_type(MsgType::OrderCancelReject);
    b.set_string(Tag::OrderID, rej.order_id);
    b.set_string(Tag::ClOrdID, rej.cl_ord_id);
    b.set_string(Tag::OrigClOrdID, rej.orig_cl_ord_id);
    b.set_char(Tag::OrdStatus, rej.ord_status);
    b.set_char(Tag::CxlRejResponseTo, rej.cxl_rej_response_to);
    if (rej.cxl_rej_reason != 0) {
        b.set_int(Tag::CxlRejReason, rej.cxl_rej_reason);
    }
    if (rej.text[0] != '\0') {
        b.set_string(Tag::Text, rej.text);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

bool parse_new_order_single(const FixMessage& msg, FixNewOrderSingle& out) noexcept {
    if (!msg.is_valid()) return false;

    auto cl_ord_id = msg.get_string(Tag::ClOrdID);
    auto symbol    = msg.get_string(Tag::Symbol);
    auto side      = msg.get_char(Tag::Side);
    auto ord_type  = msg.get_char(Tag::OrdType);
    auto qty       = msg.get_int(Tag::OrderQty);

    if (cl_ord_id.empty() || symbol.empty() || !side.has_value() ||
        !ord_type.has_value() || !qty.has_value() || *qty <= 0) {
        return false;
    }

    out.set_cl_ord_id(cl_ord_id);
    out.set_symbol(symbol);
    out.side      = *side;
    out.ord_type  = *ord_type;
    out.order_qty = static_cast<uint64_t>(*qty);

    auto tif = msg.get_char(Tag::TimeInForce);
    out.time_in_force = tif.value_or(FixTimeInForce::Day);

    auto px = msg.get_double(Tag::Price);
    out.price = px.value_or(0.0);

    auto acct = msg.get_string(Tag::Account);
    if (!acct.empty()) {
        auto n = (acct.size() < sizeof(out.account) - 1) ? acct.size() : sizeof(out.account) - 1;
        std::memcpy(out.account, acct.data(), n);
        out.account[n] = '\0';
    }

    auto tt = msg.get_string(Tag::TransactTime);
    if (!tt.empty()) {
        auto n = (tt.size() < sizeof(out.transact_time) - 1) ? tt.size() : sizeof(out.transact_time) - 1;
        std::memcpy(out.transact_time, tt.data(), n);
        out.transact_time[n] = '\0';
    }

    return true;
}

bool parse_order_cancel_request(const FixMessage& msg, FixOrderCancelRequest& out) noexcept {
    if (!msg.is_valid()) return false;

    auto cl_ord_id      = msg.get_string(Tag::ClOrdID);
    auto orig_cl_ord_id = msg.get_string(Tag::OrigClOrdID);
    auto symbol         = msg.get_string(Tag::Symbol);
    auto side           = msg.get_char(Tag::Side);

    if (cl_ord_id.empty() || orig_cl_ord_id.empty() || symbol.empty() || !side.has_value()) {
        return false;
    }

    out.set_cl_ord_id(cl_ord_id);
    out.set_orig_cl_ord_id(orig_cl_ord_id);
    out.set_symbol(symbol);
    out.side = *side;

    auto qty = msg.get_int(Tag::OrderQty);
    out.order_qty = qty.has_value() && *qty > 0 ? static_cast<uint64_t>(*qty) : 0;

    auto tt = msg.get_string(Tag::TransactTime);
    if (!tt.empty()) {
        auto n = (tt.size() < sizeof(out.transact_time) - 1) ? tt.size() : sizeof(out.transact_time) - 1;
        std::memcpy(out.transact_time, tt.data(), n);
        out.transact_time[n] = '\0';
    }

    return true;
}

bool parse_order_cancel_replace_request(const FixMessage& msg, FixOrderCancelReplaceRequest& out) noexcept {
    if (!msg.is_valid()) return false;

    auto cl_ord_id      = msg.get_string(Tag::ClOrdID);
    auto orig_cl_ord_id = msg.get_string(Tag::OrigClOrdID);
    auto symbol         = msg.get_string(Tag::Symbol);
    auto side           = msg.get_char(Tag::Side);
    auto ord_type       = msg.get_char(Tag::OrdType);
    auto qty            = msg.get_int(Tag::OrderQty);

    if (cl_ord_id.empty() || orig_cl_ord_id.empty() || symbol.empty() ||
        !side.has_value() || !ord_type.has_value() || !qty.has_value() || *qty <= 0) {
        return false;
    }

    out.set_cl_ord_id(cl_ord_id);
    out.set_orig_cl_ord_id(orig_cl_ord_id);
    out.set_symbol(symbol);
    out.side      = *side;
    out.ord_type  = *ord_type;
    out.order_qty = static_cast<uint64_t>(*qty);

    auto tif = msg.get_char(Tag::TimeInForce);
    out.time_in_force = tif.value_or(FixTimeInForce::Day);

    auto px = msg.get_double(Tag::Price);
    out.price = px.value_or(0.0);

    auto tt = msg.get_string(Tag::TransactTime);
    if (!tt.empty()) {
        auto n = (tt.size() < sizeof(out.transact_time) - 1) ? tt.size() : sizeof(out.transact_time) - 1;
        std::memcpy(out.transact_time, tt.data(), n);
        out.transact_time[n] = '\0';
    }

    return true;
}

bool parse_execution_report(const FixMessage& msg, FixExecutionReport& out) noexcept {
    if (!msg.is_valid()) return false;

    auto order_id   = msg.get_string(Tag::OrderID);
    auto cl_ord_id  = msg.get_string(Tag::ClOrdID);
    auto exec_id    = msg.get_string(Tag::ExecID);
    auto exec_type  = msg.get_char(Tag::ExecType);
    auto ord_status = msg.get_char(Tag::OrdStatus);
    auto symbol     = msg.get_string(Tag::Symbol);
    auto side       = msg.get_char(Tag::Side);

    if (order_id.empty() || cl_ord_id.empty() || exec_id.empty() ||
        !exec_type.has_value() || !ord_status.has_value() || symbol.empty() || !side.has_value()) {
        return false;
    }

    out.set_order_id(order_id);
    out.set_cl_ord_id(cl_ord_id);
    out.set_exec_id(exec_id);
    out.exec_type  = *exec_type;
    out.ord_status = *ord_status;
    out.set_symbol(symbol);
    out.side       = *side;

    auto orig_cl = msg.get_string(Tag::OrigClOrdID);
    if (!orig_cl.empty()) out.set_orig_cl_ord_id(orig_cl);

    auto qty = msg.get_int(Tag::OrderQty);
    out.order_qty = qty.has_value() && *qty > 0 ? static_cast<uint64_t>(*qty) : 0;

    auto px = msg.get_double(Tag::Price);
    out.price = px.value_or(0.0);

    auto last_px = msg.get_double(Tag::LastPx);
    out.last_px = last_px.value_or(0.0);

    auto last_qty = msg.get_int(Tag::LastQty);
    out.last_qty = last_qty.has_value() && *last_qty > 0 ? static_cast<uint64_t>(*last_qty) : 0;

    auto leaves = msg.get_int(Tag::LeavesQty);
    out.leaves_qty = leaves.has_value() && *leaves >= 0 ? static_cast<uint64_t>(*leaves) : 0;

    auto cum = msg.get_int(Tag::CumQty);
    out.cum_qty = cum.has_value() && *cum >= 0 ? static_cast<uint64_t>(*cum) : 0;

    auto avg = msg.get_double(Tag::AvgPx);
    out.avg_px = avg.value_or(0.0);

    auto txt = msg.get_string(Tag::Text);
    if (!txt.empty()) out.set_text(txt);

    return true;
}

bool parse_order_cancel_reject(const FixMessage& msg, FixOrderCancelReject& out) noexcept {
    if (!msg.is_valid()) return false;

    auto order_id   = msg.get_string(Tag::OrderID);
    auto cl_ord_id  = msg.get_string(Tag::ClOrdID);
    auto orig_cl    = msg.get_string(Tag::OrigClOrdID);
    auto ord_status = msg.get_char(Tag::OrdStatus);
    auto resp_to    = msg.get_char(Tag::CxlRejResponseTo);

    if (order_id.empty() || cl_ord_id.empty() || orig_cl.empty() ||
        !ord_status.has_value() || !resp_to.has_value()) {
        return false;
    }

    out.set_order_id(order_id);
    out.set_cl_ord_id(cl_ord_id);
    out.set_orig_cl_ord_id(orig_cl);
    out.ord_status          = *ord_status;
    out.cxl_rej_response_to = *resp_to;

    auto reason = msg.get_int(Tag::CxlRejReason);
    out.cxl_rej_reason = reason.has_value() ? static_cast<int32_t>(*reason) : 0;

    auto txt = msg.get_string(Tag::Text);
    if (!txt.empty()) out.set_text(txt);

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Type Translation
// ─────────────────────────────────────────────────────────────────────────────

Side to_core_side(char fix_side) noexcept {
    return (fix_side == FixSide::Sell) ? Side::Sell : Side::Buy;
}

char from_core_side(Side side) noexcept {
    return (side == Side::Sell) ? FixSide::Sell : FixSide::Buy;
}

OrderType to_core_order_type(char fix_type, char fix_tif) noexcept {
    if (fix_type == FixOrdType::Market) return OrderType::Market;
    if (fix_type == FixOrdType::Stop) return OrderType::Stop;
    if (fix_type == FixOrdType::StopLimit) return OrderType::StopLimit;

    // Limit orders can be IOC, FOK, GTC, or Day Limit
    if (fix_tif == FixTimeInForce::IOC) return OrderType::IOC;
    if (fix_tif == FixTimeInForce::FOK) return OrderType::FOK;
    if (fix_tif == FixTimeInForce::GTC) return OrderType::GTC;
    return OrderType::Limit;
}

char from_core_order_type(OrderType type) noexcept {
    switch (type) {
        case OrderType::Market:    return FixOrdType::Market;
        case OrderType::Limit:     return FixOrdType::Limit;
        case OrderType::Stop:      return FixOrdType::Stop;
        case OrderType::StopLimit: return FixOrdType::StopLimit;
        case OrderType::IOC:       return FixOrdType::Limit;
        case OrderType::FOK:       return FixOrdType::Limit;
        case OrderType::GTC:       return FixOrdType::Limit;
    }
    return FixOrdType::Limit;
}

OrderStatus to_core_order_status(char fix_status) noexcept {
    switch (fix_status) {
        case FixOrdStatus::New:             return OrderStatus::New;
        case FixOrdStatus::PartiallyFilled: return OrderStatus::PartiallyFilled;
        case FixOrdStatus::Filled:          return OrderStatus::Filled;
        case FixOrdStatus::Cancelled:       return OrderStatus::Cancelled;
        case FixOrdStatus::Rejected:        return OrderStatus::Rejected;
        case FixOrdStatus::PendingNew:      return OrderStatus::PendingActivation;
        default:                            return OrderStatus::New;
    }
}

char from_core_order_status(OrderStatus status) noexcept {
    switch (status) {
        case OrderStatus::New:               return FixOrdStatus::New;
        case OrderStatus::PartiallyFilled:   return FixOrdStatus::PartiallyFilled;
        case OrderStatus::Filled:            return FixOrdStatus::Filled;
        case OrderStatus::Cancelled:         return FixOrdStatus::Cancelled;
        case OrderStatus::Rejected:          return FixOrdStatus::Rejected;
        case OrderStatus::PendingActivation: return FixOrdStatus::PendingNew;
    }
    return FixOrdStatus::New;
}

char from_core_exec_type(OrderStatus status) noexcept {
    switch (status) {
        case OrderStatus::New:               return FixExecType::New;
        case OrderStatus::PartiallyFilled:   return FixExecType::PartialFill;
        case OrderStatus::Filled:            return FixExecType::Fill;
        case OrderStatus::Cancelled:         return FixExecType::Cancelled;
        case OrderStatus::Rejected:          return FixExecType::Rejected;
        case OrderStatus::PendingActivation: return FixExecType::New;
    }
    return FixExecType::New;
}

OrderRequest to_order_request(const FixNewOrderSingle& fix_req,
                             Symbol symbol,
                             OrderId id,
                             uint32_t client_id) noexcept {
    OrderRequest req;
    req.id          = id;
    req.client_id   = client_id;
    req.symbol      = symbol;
    req.side        = to_core_side(fix_req.side);
    req.type        = to_core_order_type(fix_req.ord_type, fix_req.time_in_force);
    req.price       = from_double(fix_req.price);
    req.stop_price  = PRICE_NONE;
    req.limit_price = (req.type == OrderType::StopLimit) ? req.price : PRICE_NONE;
    req.qty         = fix_req.order_qty;
    req.timestamp   = 0;
    return req;
}

CancelRequest to_cancel_request(const FixOrderCancelRequest& fix_cxl,
                               Symbol symbol,
                               OrderId id) noexcept {
    (void)fix_cxl;
    CancelRequest req;
    req.symbol   = symbol;
    req.order_id = id;
    return req;
}

ModifyRequest to_modify_request(const FixOrderCancelReplaceRequest& fix_rep,
                               Symbol symbol,
                               OrderId id) noexcept {
    ModifyRequest req;
    req.symbol    = symbol;
    req.order_id  = id;
    req.new_price = from_double(fix_rep.price);
    req.new_qty   = fix_rep.order_qty;
    return req;
}

FixExecutionReport to_fix_execution_report(const ExecutionReport& report,
                                          std::string_view cl_ord_id,
                                          std::string_view orig_cl_ord_id,
                                          std::string_view symbol_str,
                                          std::string_view order_id_str,
                                          std::string_view exec_id_str) noexcept {
    FixExecutionReport fix_rep;
    fix_rep.set_order_id(order_id_str);
    fix_rep.set_cl_ord_id(cl_ord_id);
    if (!orig_cl_ord_id.empty()) {
        fix_rep.set_orig_cl_ord_id(orig_cl_ord_id);
    }
    fix_rep.set_exec_id(exec_id_str);
    fix_rep.exec_type  = from_core_exec_type(report.status);
    fix_rep.ord_status = from_core_order_status(report.status);
    fix_rep.set_symbol(symbol_str);
    fix_rep.side       = from_core_side(report.side);
    fix_rep.order_qty  = report.cum_qty + report.leaves_qty;
    fix_rep.last_px    = to_double(report.exec_price);
    fix_rep.last_qty   = report.exec_qty;
    fix_rep.leaves_qty = report.leaves_qty;
    fix_rep.cum_qty    = report.cum_qty;
    fix_rep.avg_px     = (report.cum_qty > 0) ? to_double(report.exec_price) : 0.0;
    return fix_rep;
}

// ─────────────────────────────────────────────────────────────────────────────
// FixApplication Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

void FixApplication::on_application_message(const FixMessage& msg) noexcept {
    auto mt = msg.msg_type();

    if (mt == MsgType::ExecutionReport) {
        if (!on_exec_) return;
        FixExecutionReport rep;
        if (parse_execution_report(msg, rep)) {
            on_exec_(rep, exec_ctx_);
        }
    }
    else if (mt == MsgType::OrderCancelReject) {
        if (!on_cxl_rej_) return;
        FixOrderCancelReject rej;
        if (parse_order_cancel_reject(msg, rej)) {
            on_cxl_rej_(rej, cxl_rej_ctx_);
        }
    }
    else if (mt == MsgType::NewOrderSingle) {
        if (!on_nos_) return;
        FixNewOrderSingle nos;
        if (parse_new_order_single(msg, nos)) {
            on_nos_(nos, nos_ctx_);
        }
    }
    else if (mt == MsgType::OrderCancelRequest) {
        if (!on_cancel_) return;
        FixOrderCancelRequest cxl;
        if (parse_order_cancel_request(msg, cxl)) {
            on_cancel_(cxl, cancel_ctx_);
        }
    }
    else if (mt == MsgType::OrderCancelReplaceRequest) {
        if (!on_replace_) return;
        FixOrderCancelReplaceRequest rep;
        if (parse_order_cancel_replace_request(msg, rep)) {
            on_replace_(rep, replace_ctx_);
        }
    }
}

bool FixApplication::send_new_order_single(FixSession& session, const FixNewOrderSingle& nos) noexcept {
    serialize_new_order_single(app_builder_, nos);
    return session.send_app_message(app_builder_);
}

bool FixApplication::send_order_cancel(FixSession& session, const FixOrderCancelRequest& cxl) noexcept {
    serialize_order_cancel_request(app_builder_, cxl);
    return session.send_app_message(app_builder_);
}

bool FixApplication::send_order_replace(FixSession& session, const FixOrderCancelReplaceRequest& replace) noexcept {
    serialize_order_cancel_replace_request(app_builder_, replace);
    return session.send_app_message(app_builder_);
}

bool FixApplication::send_execution_report(FixSession& session, const FixExecutionReport& rep) noexcept {
    serialize_execution_report(app_builder_, rep);
    return session.send_app_message(app_builder_);
}

bool FixApplication::send_order_cancel_reject(FixSession& session, const FixOrderCancelReject& rej) noexcept {
    serialize_order_cancel_reject(app_builder_, rej);
    return session.send_app_message(app_builder_);
}

} // namespace ultralob::fix

