// ─────────────────────────────────────────────────────────────────────────────
// End-to-end integration test: in-process mock FIX server + client
// Tests the full Logon → NewOrderSingle → ExecutionReport → Logout lifecycle
// using FixFramer + FixMessage + FixBuilder over a real TCP connection.
// ─────────────────────────────────────────────────────────────────────────────

#include <gtest/gtest.h>
#include "ultralob/fix/fix_framer.hpp"
#include "ultralob/fix/fix_builder.hpp"
#include "ultralob/fix/fix_message.hpp"
#include "ultralob/fix/fix_initiator.hpp"
#include "ultralob/fix/fix_store.hpp"

#include <asio.hpp>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <thread>
#include <vector>

using namespace ultralob::fix;
using asio::ip::tcp;

// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-process mock FIX server
// ─────────────────────────────────────────────────────────────────────────────

class MockFixAcceptor {
public:
    explicit MockFixAcceptor(uint16_t port)
        : acceptor_(io_, tcp::endpoint(tcp::v4(), port)), port_(port) {}

    void start() { thread_ = std::thread([this] { run(); }); }

    void stop() {
        running_.store(false, std::memory_order_release);
        io_.stop();
        if (thread_.joinable()) thread_.join();
    }

private:
    void run() {
        running_.store(true, std::memory_order_release);

        tcp::socket sock(io_);
        acceptor_.accept(sock);

        FixFramer  framer;
        FixMessage msg;
        FixBuilder builder;
        uint64_t   seq = 1;
        char       read_buf[4096];

        while (running_.load(std::memory_order_acquire)) {
            asio::error_code ec;
            size_t n = sock.read_some(asio::buffer(read_buf), ec);
            if (ec) break;

            framer.feed(read_buf, n);
            const char* data = nullptr;
            size_t len = 0;

            while (framer.extract(data, len) == FrameResult::Complete) {
                if (!msg.parse(data, len)) continue;
                auto mt = msg.msg_type();

                if (mt == MsgType::Logon) {
                    // Respond with Logon
                    builder.reset();
                    builder.set_msg_type(MsgType::Logon);
                    builder.set_sender_comp_id(msg.target_comp_id());
                    builder.set_target_comp_id(msg.sender_comp_id());
                    builder.set_msg_seq_num(seq++);
                    builder.set_sending_time("20260712-12:00:00.000");
                    builder.set_int(Tag::EncryptMethod, 0);
                    builder.set_int(Tag::HeartBtInt, 30);
                    auto resp = builder.finalize();
                    asio::write(sock, asio::buffer(resp.data(), resp.size()), ec);
                }
                else if (mt == MsgType::NewOrderSingle) {
                    auto cl_ord_id = std::string(msg.get_string(Tag::ClOrdID));
                    auto symbol    = std::string(msg.get_string(Tag::Symbol));
                    auto side      = msg.get_char(Tag::Side);
                    auto qty       = msg.get_int(Tag::OrderQty);
                    auto px        = msg.get_double(Tag::Price);

                    // Ack (New)
                    builder.reset();
                    builder.set_msg_type(MsgType::ExecutionReport);
                    builder.set_sender_comp_id("MOCK");
                    builder.set_target_comp_id("TRADER");
                    builder.set_msg_seq_num(seq++);
                    builder.set_sending_time("20260712-12:00:00.000");
                    builder.set_string(Tag::OrderID, "MOCK-001");
                    builder.set_string(Tag::ExecID, "EXEC-001");
                    builder.set_string(Tag::ClOrdID, cl_ord_id);
                    builder.set_char(Tag::ExecType, FixExecType::New);
                    builder.set_char(Tag::OrdStatus, FixOrdStatus::New);
                    builder.set_string(Tag::Symbol, symbol);
                    if (side) builder.set_char(Tag::Side, *side);
                    if (qty)  { builder.set_int(Tag::LeavesQty, *qty);
                                builder.set_int(Tag::CumQty, 0); }
                    builder.set_double(Tag::AvgPx, 0.0, 2);
                    auto ack = builder.finalize();
                    asio::write(sock, asio::buffer(ack.data(), ack.size()), ec);

                    // Fill
                    builder.reset();
                    builder.set_msg_type(MsgType::ExecutionReport);
                    builder.set_sender_comp_id("MOCK");
                    builder.set_target_comp_id("TRADER");
                    builder.set_msg_seq_num(seq++);
                    builder.set_sending_time("20260712-12:00:01.000");
                    builder.set_string(Tag::OrderID, "MOCK-001");
                    builder.set_string(Tag::ExecID, "EXEC-002");
                    builder.set_string(Tag::ClOrdID, cl_ord_id);
                    builder.set_char(Tag::ExecType, FixExecType::Fill);
                    builder.set_char(Tag::OrdStatus, FixOrdStatus::Filled);
                    builder.set_string(Tag::Symbol, symbol);
                    if (side) builder.set_char(Tag::Side, *side);
                    if (qty)  { builder.set_int(Tag::LastQty, *qty);
                                builder.set_int(Tag::LeavesQty, 0);
                                builder.set_int(Tag::CumQty, *qty); }
                    if (px)   { builder.set_double(Tag::LastPx, *px, 2);
                                builder.set_double(Tag::AvgPx, *px, 2); }
                    auto fill = builder.finalize();
                    asio::write(sock, asio::buffer(fill.data(), fill.size()), ec);
                }
                else if (mt == MsgType::Heartbeat) {
                    builder.reset();
                    builder.set_msg_type(MsgType::Heartbeat);
                    builder.set_sender_comp_id(msg.target_comp_id());
                    builder.set_target_comp_id(msg.sender_comp_id());
                    builder.set_msg_seq_num(seq++);
                    builder.set_sending_time("20260712-12:00:00.000");
                    auto resp = builder.finalize();
                    asio::write(sock, asio::buffer(resp.data(), resp.size()), ec);
                }
                else if (mt == MsgType::Logout) {
                    builder.reset();
                    builder.set_msg_type(MsgType::Logout);
                    builder.set_sender_comp_id(msg.target_comp_id());
                    builder.set_target_comp_id(msg.sender_comp_id());
                    builder.set_msg_seq_num(seq++);
                    builder.set_sending_time("20260712-12:00:00.000");
                    auto resp = builder.finalize();
                    asio::write(sock, asio::buffer(resp.data(), resp.size()), ec);
                    running_.store(false);
                }
            }
        }
    }

    asio::io_context io_;
    tcp::acceptor    acceptor_;
    std::thread      thread_;
    std::atomic<bool> running_{false};
    uint16_t         port_;  // NOLINT(clang-diagnostic-unused-private-field)
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixture
// ─────────────────────────────────────────────────────────────────────────────

class FixIntegrationTest : public ::testing::Test {
protected:
    static constexpr uint16_t TEST_PORT = 19876;

    void SetUp() override {
        server_ = std::make_unique<MockFixAcceptor>(TEST_PORT);
        server_->start();
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    void TearDown() override { if (server_) server_->stop(); }

    std::unique_ptr<MockFixAcceptor> server_;
};

// ─────────────────────────────────────────────────────────────────────────────
// Logon Handshake
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixIntegrationTest, LogonHandshake) {
    asio::io_context io;
    tcp::socket sock(io);
    sock.connect(tcp::endpoint(asio::ip::make_address("127.0.0.1"), TEST_PORT));

    FixBuilder builder;
    builder.set_msg_type(MsgType::Logon);
    builder.set_sender_comp_id("CLIENT");
    builder.set_target_comp_id("SERVER");
    builder.set_msg_seq_num(1);
    builder.set_sending_time("20260712-12:00:00.000");
    builder.set_int(Tag::EncryptMethod, 0);
    builder.set_int(Tag::HeartBtInt, 30);
    auto logon_sv = builder.finalize();
    asio::write(sock, asio::buffer(logon_sv.data(), logon_sv.size()));

    char buf[4096];
    size_t n = sock.read_some(asio::buffer(buf));

    FixFramer framer;
    framer.feed(buf, n);
    const char* data = nullptr;
    size_t len = 0;
    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);

    FixMessage msg;
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_type(), MsgType::Logon);
    EXPECT_EQ(msg.get_int(Tag::HeartBtInt).value(), 30);

    // Logout
    builder.reset();
    builder.set_msg_type(MsgType::Logout);
    builder.set_sender_comp_id("CLIENT");
    builder.set_target_comp_id("SERVER");
    builder.set_msg_seq_num(2);
    builder.set_sending_time("20260712-12:00:01.000");
    auto logout_sv = builder.finalize();
    asio::write(sock, asio::buffer(logout_sv.data(), logout_sv.size()));
    sock.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Order-to-Fill Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixIntegrationTest, OrderToFillLifecycle) {
    asio::io_context io;
    tcp::socket sock(io);
    sock.connect(tcp::endpoint(asio::ip::make_address("127.0.0.1"), TEST_PORT));

    FixBuilder builder;
    FixFramer  framer;
    FixMessage msg;
    char buf[8192];

    // ── 1. Logon ────────────────────────────────────────────────────────
    builder.set_msg_type(MsgType::Logon);
    builder.set_sender_comp_id("TRADER");
    builder.set_target_comp_id("MOCK");
    builder.set_msg_seq_num(1);
    builder.set_sending_time("20260712-12:00:00.000");
    builder.set_int(Tag::EncryptMethod, 0);
    builder.set_int(Tag::HeartBtInt, 30);
    auto logon_sv = builder.finalize();
    asio::write(sock, asio::buffer(logon_sv.data(), logon_sv.size()));

    size_t n = sock.read_some(asio::buffer(buf));
    framer.feed(buf, n);
    const char* data = nullptr;
    size_t len = 0;
    ASSERT_EQ(framer.extract(data, len), FrameResult::Complete);
    ASSERT_TRUE(msg.parse(data, len));
    EXPECT_EQ(msg.msg_type(), MsgType::Logon);

    // ── 2. NewOrderSingle ───────────────────────────────────────────────
    builder.reset();
    builder.set_msg_type(MsgType::NewOrderSingle);
    builder.set_sender_comp_id("TRADER");
    builder.set_target_comp_id("MOCK");
    builder.set_msg_seq_num(2);
    builder.set_sending_time("20260712-12:00:01.000");
    builder.set_string(Tag::ClOrdID, "ORDER-001");
    builder.set_string(Tag::Symbol, "AAPL");
    builder.set_char(Tag::Side, FixSide::Buy);
    builder.set_char(Tag::OrdType, FixOrdType::Limit);
    builder.set_double(Tag::Price, 150.25, 2);
    builder.set_int(Tag::OrderQty, 100);
    builder.set_string(Tag::TransactTime, "20260712-12:00:01.000");
    auto order_sv = builder.finalize();
    asio::write(sock, asio::buffer(order_sv.data(), order_sv.size()));

    // ── 3. Read Ack (New) + Fill ────────────────────────────────────────
    bool got_new  = false;
    bool got_fill = false;
    int  reports  = 0;

    for (int attempt = 0; attempt < 5 && reports < 2; ++attempt) {
        n = sock.read_some(asio::buffer(buf));
        framer.feed(buf, n);

        while (framer.extract(data, len) == FrameResult::Complete) {
            ASSERT_TRUE(msg.parse(data, len));
            EXPECT_EQ(msg.msg_type(), MsgType::ExecutionReport);
            EXPECT_EQ(msg.get_string(Tag::ClOrdID), "ORDER-001");
            EXPECT_EQ(msg.get_string(Tag::Symbol), "AAPL");

            auto et = msg.get_char(Tag::ExecType);
            ASSERT_TRUE(et.has_value());
            if (*et == FixExecType::New)  got_new = true;
            if (*et == FixExecType::Fill) {
                got_fill = true;
                EXPECT_NEAR(msg.get_double(Tag::LastPx).value(), 150.25, 0.01);
                EXPECT_EQ(msg.get_int(Tag::LastQty).value(), 100);
                EXPECT_EQ(msg.get_int(Tag::LeavesQty).value(), 0);
            }
            ++reports;
        }
    }

    EXPECT_TRUE(got_new)  << "Expected ExecutionReport with ExecType=New";
    EXPECT_TRUE(got_fill) << "Expected ExecutionReport with ExecType=Fill";
    EXPECT_EQ(reports, 2);

    // ── 4. Logout ───────────────────────────────────────────────────────
    builder.reset();
    builder.set_msg_type(MsgType::Logout);
    builder.set_sender_comp_id("TRADER");
    builder.set_target_comp_id("MOCK");
    builder.set_msg_seq_num(3);
    builder.set_sending_time("20260712-12:00:02.000");
    auto logout_sv = builder.finalize();
    asio::write(sock, asio::buffer(logout_sv.data(), logout_sv.size()));
    sock.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// FixInitiator End-to-End Test (Full Lifecycle via Transport Layer)
// ─────────────────────────────────────────────────────────────────────────────

struct InitiatorTestContext {
    std::vector<FixExecutionReport> reports;
    std::atomic<int> report_count{0};

    static void on_exec_report(const FixExecutionReport& rep, void* ctx) {
        auto* self = static_cast<InitiatorTestContext*>(ctx);
        self->reports.push_back(rep);
        self->report_count.fetch_add(1, std::memory_order_release);
    }
};

TEST_F(FixIntegrationTest, InitiatorFullOrderLifecycle) {
    SessionConfig config;
    config.set_sender("TRADER");
    config.set_target("MOCK");
    config.heartbeat_interval_sec = 30;

    InitiatorTestContext ctx;
    FixInitiator initiator(config, "127.0.0.1", TEST_PORT);
    initiator.set_on_execution_report(InitiatorTestContext::on_exec_report, &ctx);

    ASSERT_TRUE(initiator.start());

    // Wait for connection and Logon handshake to complete
    for (int i = 0; i < 50 && !initiator.is_active(); ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    ASSERT_TRUE(initiator.is_active()) << "Initiator failed to reach Active state";

    // Send NewOrderSingle
    FixNewOrderSingle nos;
    nos.set_cl_ord_id("INIT-001");
    nos.set_symbol("MSFT");
    nos.side = FixSide::Buy;
    nos.ord_type = FixOrdType::Limit;
    nos.price = 310.50;
    nos.order_qty = 200;
    ASSERT_TRUE(initiator.send_new_order_single(nos));

    // Wait for Ack (New) + Fill reports
    for (int i = 0; i < 50 && ctx.report_count.load(std::memory_order_acquire) < 2; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }

    EXPECT_GE(ctx.report_count.load(), 2);
    ASSERT_GE(ctx.reports.size(), 2u);

    EXPECT_STREQ(ctx.reports[0].cl_ord_id, "INIT-001");
    EXPECT_EQ(ctx.reports[0].exec_type, FixExecType::New);
    EXPECT_STREQ(ctx.reports[0].symbol, "MSFT");

    EXPECT_STREQ(ctx.reports[1].cl_ord_id, "INIT-001");
    EXPECT_EQ(ctx.reports[1].exec_type, FixExecType::Fill);
    EXPECT_EQ(ctx.reports[1].last_qty, 200u);
    EXPECT_NEAR(ctx.reports[1].last_px, 310.50, 0.01);

    initiator.stop();
}

// ─────────────────────────────────────────────────────────────────────────────
// FixInitiator with Persistent Message Store Test
// ─────────────────────────────────────────────────────────────────────────────

TEST_F(FixIntegrationTest, InitiatorWithStorePersistence) {
    auto path = (std::filesystem::temp_directory_path() / "test_fix_init_store.dat").string();
    std::filesystem::remove(path);

    {
        FixStore store(path, 64ULL * 1024 * 1024);
        SessionConfig config;
        config.set_sender("TRADER");
        config.set_target("MOCK");
        config.heartbeat_interval_sec = 30;

        InitiatorTestContext ctx;
        FixInitiator initiator(config, "127.0.0.1", TEST_PORT, &store);
        initiator.set_on_execution_report(InitiatorTestContext::on_exec_report, &ctx);

        ASSERT_TRUE(initiator.start());

        for (int i = 0; i < 50 && !initiator.is_active(); ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        ASSERT_TRUE(initiator.is_active());

        FixNewOrderSingle nos;
        nos.set_cl_ord_id("INIT-002");
        nos.set_symbol("NVDA");
        nos.side = FixSide::Sell;
        nos.ord_type = FixOrdType::Limit;
        nos.price = 450.00;
        nos.order_qty = 50;
        ASSERT_TRUE(initiator.send_new_order_single(nos));

        for (int i = 0; i < 50 && ctx.report_count.load(std::memory_order_acquire) < 2; ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }

        EXPECT_GE(ctx.report_count.load(), 2);

        // Verify store captured messages
        // Outbound: seq 1 (Logon), seq 2 (NewOrderSingle)
        auto out1 = store.retrieve(1, StoreDirection::Outbound);
        auto out2 = store.retrieve(2, StoreDirection::Outbound);
        EXPECT_FALSE(out1.empty());
        EXPECT_FALSE(out2.empty());

        FixMessage m2;
        ASSERT_TRUE(m2.parse(out2.data(), out2.size()));
        EXPECT_EQ(m2.msg_type(), MsgType::NewOrderSingle);
        EXPECT_EQ(m2.get_string(Tag::ClOrdID), "INIT-002");

        initiator.stop();
    }

    std::filesystem::remove(path);
}

