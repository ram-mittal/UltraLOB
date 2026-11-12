// ─────────────────────────────────────────────────────────────────────────────
// FIX Application & Order Interface Tests
//
// Tests serialization, parsing, core UltraLOB type translation, callback
// routing, and lock-free inter-thread queue bridging.
// ─────────────────────────────────────────────────────────────────────────────

#include <gtest/gtest.h>
#include "ultralob/fix/fix_application.hpp"
#include "ultralob/fix/fix_session.hpp"
#include "ultralob/fix/fix_message.hpp"

#include <string>
#include <vector>

using namespace ultralob;
using namespace ultralob::fix;

// ═══════════════════════════════════════════════════════════════════════════
// SERIALIZATION & PARSING ROUNDTRIP TESTS
// ═══════════════════════════════════════════════════════════════════════════

TEST(FixApplicationTest, NewOrderSingleRoundtrip) {
    FixNewOrderSingle original;
    original.set_cl_ord_id("ORD-1001");
    original.set_symbol("AAPL");
    original.side = FixSide::Buy;
    original.ord_type = FixOrdType::Limit;
    original.time_in_force = FixTimeInForce::Day;
    original.price = 150.25;
    original.order_qty = 500;
    std::strcpy(original.account, "ACCT-1");
    std::strcpy(original.transact_time, "20260712-12:00:00.000");

    FixBuilder b;
    b.set_sender_comp_id("TRADER");
    b.set_target_comp_id("EXCHANGE");
    b.set_msg_seq_num(1);
    b.set_sending_time("20260712-12:00:00.000");
    serialize_new_order_single(b, original);
    auto wire = b.finalize();

    FixMessage msg;
    ASSERT_TRUE(msg.parse(wire.data(), wire.size()));
    EXPECT_EQ(msg.msg_type(), fix::MsgType::NewOrderSingle);

    FixNewOrderSingle parsed;
    ASSERT_TRUE(parse_new_order_single(msg, parsed));
    EXPECT_STREQ(parsed.cl_ord_id, "ORD-1001");
    EXPECT_STREQ(parsed.symbol, "AAPL");
    EXPECT_EQ(parsed.side, FixSide::Buy);
    EXPECT_EQ(parsed.ord_type, FixOrdType::Limit);
    EXPECT_EQ(parsed.time_in_force, FixTimeInForce::Day);
    EXPECT_NEAR(parsed.price, 150.25, 0.001);
    EXPECT_EQ(parsed.order_qty, 500u);
    EXPECT_STREQ(parsed.account, "ACCT-1");
    EXPECT_STREQ(parsed.transact_time, "20260712-12:00:00.000");
}

TEST(FixApplicationTest, OrderCancelRequestRoundtrip) {
    FixOrderCancelRequest original;
    original.set_cl_ord_id("CXL-2001");
    original.set_orig_cl_ord_id("ORD-1001");
    original.set_symbol("MSFT");
    original.side = FixSide::Sell;
    original.order_qty = 200;
    std::strcpy(original.transact_time, "20260712-12:01:00.000");

    FixBuilder b;
    b.set_sender_comp_id("TRADER");
    b.set_target_comp_id("EXCHANGE");
    b.set_msg_seq_num(2);
    b.set_sending_time("20260712-12:01:00.000");
    serialize_order_cancel_request(b, original);
    auto wire = b.finalize();

    FixMessage msg;
    ASSERT_TRUE(msg.parse(wire.data(), wire.size()));
    EXPECT_EQ(msg.msg_type(), fix::MsgType::OrderCancelRequest);

    FixOrderCancelRequest parsed;
    ASSERT_TRUE(parse_order_cancel_request(msg, parsed));
    EXPECT_STREQ(parsed.cl_ord_id, "CXL-2001");
    EXPECT_STREQ(parsed.orig_cl_ord_id, "ORD-1001");
    EXPECT_STREQ(parsed.symbol, "MSFT");
    EXPECT_EQ(parsed.side, FixSide::Sell);
    EXPECT_EQ(parsed.order_qty, 200u);
    EXPECT_STREQ(parsed.transact_time, "20260712-12:01:00.000");
}

TEST(FixApplicationTest, OrderCancelReplaceRequestRoundtrip) {
    FixOrderCancelReplaceRequest original;
    original.set_cl_ord_id("REP-3001");
    original.set_orig_cl_ord_id("ORD-1001");
    original.set_symbol("GOOGL");
    original.side = FixSide::Buy;
    original.ord_type = FixOrdType::Limit;
    original.time_in_force = FixTimeInForce::IOC;
    original.price = 2800.50;
    original.order_qty = 100;
    std::strcpy(original.transact_time, "20260712-12:02:00.000");

    FixBuilder b;
    b.set_sender_comp_id("TRADER");
    b.set_target_comp_id("EXCHANGE");
    b.set_msg_seq_num(3);
    b.set_sending_time("20260712-12:02:00.000");
    serialize_order_cancel_replace_request(b, original);
    auto wire = b.finalize();

    FixMessage msg;
    ASSERT_TRUE(msg.parse(wire.data(), wire.size()));
    EXPECT_EQ(msg.msg_type(), fix::MsgType::OrderCancelReplaceRequest);

    FixOrderCancelReplaceRequest parsed;
    ASSERT_TRUE(parse_order_cancel_replace_request(msg, parsed));
    EXPECT_STREQ(parsed.cl_ord_id, "REP-3001");
    EXPECT_STREQ(parsed.orig_cl_ord_id, "ORD-1001");
    EXPECT_STREQ(parsed.symbol, "GOOGL");
    EXPECT_EQ(parsed.side, FixSide::Buy);
    EXPECT_EQ(parsed.ord_type, FixOrdType::Limit);
    EXPECT_EQ(parsed.time_in_force, FixTimeInForce::IOC);
    EXPECT_NEAR(parsed.price, 2800.50, 0.001);
    EXPECT_EQ(parsed.order_qty, 100u);
}

TEST(FixApplicationTest, ExecutionReportRoundtrip) {
    FixExecutionReport original;
    original.set_order_id("EX-9999");
    original.set_cl_ord_id("ORD-1001");
    original.set_orig_cl_ord_id("ORD-1000");
    original.set_exec_id("EXEC-001");
    original.exec_type = FixExecType::Fill;
    original.ord_status = FixOrdStatus::Filled;
    original.set_symbol("TSLA");
    original.side = FixSide::Sell;
    original.order_qty = 50;
    original.price = 700.0;
    original.last_px = 700.0;
    original.last_qty = 50;
    original.leaves_qty = 0;
    original.cum_qty = 50;
    original.avg_px = 700.0;
    original.set_text("Fully filled");

    FixBuilder b;
    b.set_sender_comp_id("EXCHANGE");
    b.set_target_comp_id("TRADER");
    b.set_msg_seq_num(4);
    b.set_sending_time("20260712-12:03:00.000");
    serialize_execution_report(b, original);
    auto wire = b.finalize();

    FixMessage msg;
    ASSERT_TRUE(msg.parse(wire.data(), wire.size()));
    EXPECT_EQ(msg.msg_type(), fix::MsgType::ExecutionReport);

    FixExecutionReport parsed;
    ASSERT_TRUE(parse_execution_report(msg, parsed));
    EXPECT_STREQ(parsed.order_id, "EX-9999");
    EXPECT_STREQ(parsed.cl_ord_id, "ORD-1001");
    EXPECT_STREQ(parsed.orig_cl_ord_id, "ORD-1000");
    EXPECT_STREQ(parsed.exec_id, "EXEC-001");
    EXPECT_EQ(parsed.exec_type, FixExecType::Fill);
    EXPECT_EQ(parsed.ord_status, FixOrdStatus::Filled);
    EXPECT_STREQ(parsed.symbol, "TSLA");
    EXPECT_EQ(parsed.side, FixSide::Sell);
    EXPECT_EQ(parsed.order_qty, 50u);
    EXPECT_NEAR(parsed.price, 700.0, 0.001);
    EXPECT_NEAR(parsed.last_px, 700.0, 0.001);
    EXPECT_EQ(parsed.last_qty, 50u);
    EXPECT_EQ(parsed.leaves_qty, 0u);
    EXPECT_EQ(parsed.cum_qty, 50u);
    EXPECT_NEAR(parsed.avg_px, 700.0, 0.001);
    EXPECT_STREQ(parsed.text, "Fully filled");
}

TEST(FixApplicationTest, OrderCancelRejectRoundtrip) {
    FixOrderCancelReject original;
    original.set_order_id("EX-9999");
    original.set_cl_ord_id("CXL-2002");
    original.set_orig_cl_ord_id("ORD-1001");
    original.ord_status = FixOrdStatus::Filled;
    original.cxl_rej_response_to = '1'; // Cancel
    original.cxl_rej_reason = 1; // Order already in Pending Cancel or Done
    original.set_text("Order already filled");

    FixBuilder b;
    b.set_sender_comp_id("EXCHANGE");
    b.set_target_comp_id("TRADER");
    b.set_msg_seq_num(5);
    b.set_sending_time("20260712-12:04:00.000");
    serialize_order_cancel_reject(b, original);
    auto wire = b.finalize();

    FixMessage msg;
    ASSERT_TRUE(msg.parse(wire.data(), wire.size()));
    EXPECT_EQ(msg.msg_type(), fix::MsgType::OrderCancelReject);

    FixOrderCancelReject parsed;
    ASSERT_TRUE(parse_order_cancel_reject(msg, parsed));
    EXPECT_STREQ(parsed.order_id, "EX-9999");
    EXPECT_STREQ(parsed.cl_ord_id, "CXL-2002");
    EXPECT_STREQ(parsed.orig_cl_ord_id, "ORD-1001");
    EXPECT_EQ(parsed.ord_status, FixOrdStatus::Filled);
    EXPECT_EQ(parsed.cxl_rej_response_to, '1');
    EXPECT_EQ(parsed.cxl_rej_reason, 1);
    EXPECT_STREQ(parsed.text, "Order already filled");
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE TRANSLATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

TEST(FixApplicationTest, ToOrderRequestTranslation) {
    FixNewOrderSingle fix_nos;
    fix_nos.set_cl_ord_id("ORD-10");
    fix_nos.set_symbol("AAPL");
    fix_nos.side = FixSide::Buy;
    fix_nos.ord_type = FixOrdType::Limit;
    fix_nos.time_in_force = FixTimeInForce::Day;
    fix_nos.price = 150.00;
    fix_nos.order_qty = 250;

    Symbol numeric_symbol = 101;
    OrderId numeric_id = 999;
    uint32_t client_id = 7;

    OrderRequest core_req = to_order_request(fix_nos, numeric_symbol, numeric_id, client_id);
    EXPECT_EQ(core_req.id, 999u);
    EXPECT_EQ(core_req.client_id, 7u);
    EXPECT_EQ(core_req.symbol, 101u);
    EXPECT_EQ(core_req.side, Side::Buy);
    EXPECT_EQ(core_req.type, OrderType::Limit);
    EXPECT_EQ(core_req.price, from_double(150.00));
    EXPECT_EQ(core_req.qty, 250u);
}

TEST(FixApplicationTest, TimeInForceOrderTypeMapping) {
    FixNewOrderSingle fix_nos;
    fix_nos.side = FixSide::Sell;
    fix_nos.price = 100.0;
    fix_nos.order_qty = 10;

    // IOC mapping
    fix_nos.ord_type = FixOrdType::Limit;
    fix_nos.time_in_force = FixTimeInForce::IOC;
    auto req1 = to_order_request(fix_nos, 1, 1);
    EXPECT_EQ(req1.type, OrderType::IOC);

    // FOK mapping
    fix_nos.time_in_force = FixTimeInForce::FOK;
    auto req2 = to_order_request(fix_nos, 1, 1);
    EXPECT_EQ(req2.type, OrderType::FOK);

    // Market mapping
    fix_nos.ord_type = FixOrdType::Market;
    fix_nos.time_in_force = FixTimeInForce::Day;
    auto req3 = to_order_request(fix_nos, 1, 1);
    EXPECT_EQ(req3.type, OrderType::Market);
}

TEST(FixApplicationTest, ToCancelRequestTranslation) {
    FixOrderCancelRequest fix_cxl;
    fix_cxl.set_cl_ord_id("CXL-1");
    fix_cxl.set_orig_cl_ord_id("ORD-1");
    fix_cxl.set_symbol("AAPL");

    CancelRequest core_cxl = to_cancel_request(fix_cxl, 101, 999);
    EXPECT_EQ(core_cxl.symbol, 101u);
    EXPECT_EQ(core_cxl.order_id, 999u);
}

TEST(FixApplicationTest, ToModifyRequestTranslation) {
    FixOrderCancelReplaceRequest fix_rep;
    fix_rep.set_cl_ord_id("REP-1");
    fix_rep.set_orig_cl_ord_id("ORD-1");
    fix_rep.set_symbol("AAPL");
    fix_rep.price = 155.50;
    fix_rep.order_qty = 300;

    ModifyRequest core_mod = to_modify_request(fix_rep, 101, 999);
    EXPECT_EQ(core_mod.symbol, 101u);
    EXPECT_EQ(core_mod.order_id, 999u);
    EXPECT_EQ(core_mod.new_price, from_double(155.50));
    EXPECT_EQ(core_mod.new_qty, 300u);
}

TEST(FixApplicationTest, ToFixExecutionReportTranslation) {
    ExecutionReport core_report{};
    core_report.order_id = 12345;
    core_report.contra_order_id = 67890;
    core_report.client_id = 1;
    core_report.symbol = 101;
    core_report.side = Side::Buy;
    core_report.order_type = OrderType::Limit;
    core_report.status = OrderStatus::Filled;
    core_report.exec_price = from_double(149.50);
    core_report.exec_qty = 100;
    core_report.leaves_qty = 0;
    core_report.cum_qty = 100;
    core_report.timestamp = 1700000000;

    FixExecutionReport fix_rep = to_fix_execution_report(
        core_report, "CL-101", "", "AAPL", "ORD-12345", "EXEC-001");

    EXPECT_STREQ(fix_rep.order_id, "ORD-12345");
    EXPECT_STREQ(fix_rep.cl_ord_id, "CL-101");
    EXPECT_STREQ(fix_rep.exec_id, "EXEC-001");
    EXPECT_EQ(fix_rep.exec_type, FixExecType::Fill);
    EXPECT_EQ(fix_rep.ord_status, FixOrdStatus::Filled);
    EXPECT_STREQ(fix_rep.symbol, "AAPL");
    EXPECT_EQ(fix_rep.side, FixSide::Buy);
    EXPECT_NEAR(fix_rep.last_px, 149.50, 0.001);
    EXPECT_EQ(fix_rep.last_qty, 100u);
    EXPECT_EQ(fix_rep.leaves_qty, 0u);
    EXPECT_EQ(fix_rep.cum_qty, 100u);
}

// ═══════════════════════════════════════════════════════════════════════════
// APPLICATION DISPATCHER & CALLBACK TESTS
// ═══════════════════════════════════════════════════════════════════════════

struct AppHarness {
    std::vector<FixExecutionReport> exec_reports;
    std::vector<FixOrderCancelReject> cancel_rejects;
    std::vector<FixNewOrderSingle> new_orders;
    std::vector<FixOrderCancelRequest> cancel_orders;
    std::vector<FixOrderCancelReplaceRequest> replace_orders;

    static void on_exec(const FixExecutionReport& r, void* ctx) {
        static_cast<AppHarness*>(ctx)->exec_reports.push_back(r);
    }
    static void on_cxl_rej(const FixOrderCancelReject& r, void* ctx) {
        static_cast<AppHarness*>(ctx)->cancel_rejects.push_back(r);
    }
    static void on_nos(const FixNewOrderSingle& r, void* ctx) {
        static_cast<AppHarness*>(ctx)->new_orders.push_back(r);
    }
    static void on_cancel(const FixOrderCancelRequest& r, void* ctx) {
        static_cast<AppHarness*>(ctx)->cancel_orders.push_back(r);
    }
    static void on_replace(const FixOrderCancelReplaceRequest& r, void* ctx) {
        static_cast<AppHarness*>(ctx)->replace_orders.push_back(r);
    }
};

TEST(FixApplicationTest, DispatcherRoutesCorrectly) {
    AppHarness harness;
    FixApplication app;
    app.set_on_execution_report(AppHarness::on_exec, &harness);
    app.set_on_order_cancel_reject(AppHarness::on_cxl_rej, &harness);
    app.set_on_new_order_single(AppHarness::on_nos, &harness);
    app.set_on_order_cancel(AppHarness::on_cancel, &harness);
    app.set_on_order_replace(AppHarness::on_replace, &harness);

    // 1. Dispatch ExecutionReport
    FixBuilder b1;
    FixExecutionReport er;
    er.set_order_id("1"); er.set_cl_ord_id("C1"); er.set_exec_id("E1");
    er.exec_type = FixExecType::New; er.ord_status = FixOrdStatus::New;
    er.set_symbol("AAPL"); er.side = FixSide::Buy;
    serialize_execution_report(b1, er);
    b1.set_sender_comp_id("EX"); b1.set_target_comp_id("TR");
    b1.set_msg_seq_num(1); b1.set_sending_time("20260712-12:00:00.000");
    auto s1 = b1.finalize();
    FixMessage m1;
    ASSERT_TRUE(m1.parse(s1.data(), s1.size()));
    app.on_application_message(m1);
    ASSERT_EQ(harness.exec_reports.size(), 1u);
    EXPECT_STREQ(harness.exec_reports[0].cl_ord_id, "C1");

    // 2. Dispatch OrderCancelReject
    FixBuilder b2;
    FixOrderCancelReject cr;
    cr.set_order_id("1"); cr.set_cl_ord_id("C2"); cr.set_orig_cl_ord_id("C1");
    cr.ord_status = FixOrdStatus::Filled; cr.cxl_rej_response_to = '1';
    serialize_order_cancel_reject(b2, cr);
    b2.set_sender_comp_id("EX"); b2.set_target_comp_id("TR");
    b2.set_msg_seq_num(2); b2.set_sending_time("20260712-12:00:00.000");
    auto s2 = b2.finalize();
    FixMessage m2;
    ASSERT_TRUE(m2.parse(s2.data(), s2.size()));
    app.on_application_message(m2);
    ASSERT_EQ(harness.cancel_rejects.size(), 1u);
    EXPECT_STREQ(harness.cancel_rejects[0].cl_ord_id, "C2");
}

// ═══════════════════════════════════════════════════════════════════════════
// INTER-THREAD LOCK-FREE QUEUE BRIDGE TESTS
// ═══════════════════════════════════════════════════════════════════════════

TEST(FixApplicationTest, QueueBridgeCrossThreadCommunication) {
    FixQueueBridge<1024, 1024> bridge;

    // Simulate Network Thread pushing an inbound order
    OrderRequest in_req;
    in_req.id = 100;
    in_req.symbol = 1;
    in_req.side = Side::Buy;
    in_req.qty = 50;
    in_req.price = from_double(150.0);
    EXPECT_TRUE(bridge.push_inbound_order(in_req));

    // Simulate Strategy / Matching Engine Thread polling the order
    auto polled_in = bridge.poll_inbound();
    ASSERT_TRUE(polled_in.has_value());
    EXPECT_EQ(polled_in->type, ultralob::MsgType::SubmitOrder);
    EXPECT_EQ(polled_in->submit.id, 100u);
    EXPECT_EQ(polled_in->submit.price, from_double(150.0));

    // Queue should now be empty
    EXPECT_FALSE(bridge.poll_inbound().has_value());

    // Simulate Strategy / Matching Engine Thread generating an execution report
    ExecutionReport out_rep{};
    out_rep.order_id = 100;
    out_rep.status = OrderStatus::Filled;
    out_rep.exec_price = from_double(150.0);
    out_rep.exec_qty = 50;
    EXPECT_TRUE(bridge.push_outbound_report(out_rep));

    // Simulate Network Thread polling outbound reports
    auto polled_out = bridge.poll_outbound();
    ASSERT_TRUE(polled_out.has_value());
    EXPECT_EQ(polled_out->report.order_id, 100u);
    EXPECT_EQ(polled_out->report.status, OrderStatus::Filled);
    EXPECT_EQ(polled_out->report.exec_qty, 50u);

    // Outbound queue should now be empty
    EXPECT_FALSE(bridge.poll_outbound().has_value());
}
