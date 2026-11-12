// ─────────────────────────────────────────────────────────────────────────────
// Mock FIX 4.4 Server for UltraLOB
//
// Usage: mock_fix_server [port]   (default: 9876)
//
// Handles:  Logon (A), Heartbeat (0), TestRequest (1),
//           NewOrderSingle (D), OrderCancelRequest (F), Logout (5)
//
// NewOrderSingle → responds with ExecutionReport(New) then ExecutionReport(Fill)
// OrderCancelRequest → responds with ExecutionReport(Cancelled)
// ─────────────────────────────────────────────────────────────────────────────

#include "ultralob/fix/fix_framer.hpp"
#include "ultralob/fix/fix_builder.hpp"
#include "ultralob/fix/fix_message.hpp"

#include <asio.hpp>
#include <iostream>
#include <string>
#include <atomic>
#include <cstdint>

using namespace ultralob::fix;
using asio::ip::tcp;

static const char* COMP_ID = "ULTRALOB-MOCK";

class MockFixSession {
public:
    MockFixSession(tcp::socket socket)
        : socket_(std::move(socket)) {}

    void run() {
        std::cout << "[MOCK] Client connected from "
                  << socket_.remote_endpoint() << "\n";

        char read_buf[4096];
        while (running_) {
            asio::error_code ec;
            size_t n = socket_.read_some(asio::buffer(read_buf), ec);
            if (ec) {
                std::cout << "[MOCK] Connection closed: " << ec.message() << "\n";
                break;
            }

            framer_.feed(read_buf, n);
            const char* data = nullptr;
            size_t len = 0;

            while (framer_.extract(data, len) == FrameResult::Complete) {
                if (!msg_.parse(data, len)) {
                    std::cout << "[MOCK] Failed to parse message, skipping\n";
                    continue;
                }
                handle_message();
            }
        }
        std::cout << "[MOCK] Session ended\n";
    }

private:
    void handle_message() {
        auto mt = msg_.msg_type();
        auto sender = std::string(msg_.sender_comp_id());

        if (mt == MsgType::Logon) {
            std::cout << "[MOCK] << Logon from " << sender << "\n";
            builder_.reset();
            builder_.set_msg_type(MsgType::Logon);
            builder_.set_sender_comp_id(COMP_ID);
            builder_.set_target_comp_id(sender);
            builder_.set_msg_seq_num(out_seq_++);
            builder_.set_sending_time("20260712-12:00:00.000");
            builder_.set_int(Tag::EncryptMethod, 0);
            builder_.set_int(Tag::HeartBtInt, 30);
            send(builder_.finalize());
            std::cout << "[MOCK] >> Logon response\n";
        }
        else if (mt == MsgType::NewOrderSingle) {
            auto cl_ord_id = std::string(msg_.get_string(Tag::ClOrdID));
            auto symbol    = std::string(msg_.get_string(Tag::Symbol));
            auto side      = msg_.get_char(Tag::Side);
            auto qty       = msg_.get_int(Tag::OrderQty);
            auto px        = msg_.get_double(Tag::Price);
            auto ord_id    = "MOCK-" + std::to_string(order_id_++);
            auto exec_id_1 = "EXEC-" + std::to_string(exec_id_++);
            auto exec_id_2 = "EXEC-" + std::to_string(exec_id_++);

            std::cout << "[MOCK] << NewOrderSingle  ClOrdID=" << cl_ord_id
                      << " " << symbol << " " << (side && *side == '1' ? "BUY" : "SELL")
                      << " " << (qty ? *qty : 0)
                      << " @ " << (px ? *px : 0.0) << "\n";

            // Ack (New)
            builder_.reset();
            builder_.set_msg_type(MsgType::ExecutionReport);
            builder_.set_sender_comp_id(COMP_ID);
            builder_.set_target_comp_id(sender);
            builder_.set_msg_seq_num(out_seq_++);
            builder_.set_sending_time("20260712-12:00:00.000");
            builder_.set_string(Tag::OrderID, ord_id);
            builder_.set_string(Tag::ExecID, exec_id_1);
            builder_.set_string(Tag::ClOrdID, cl_ord_id);
            builder_.set_char(Tag::ExecType, FixExecType::New);
            builder_.set_char(Tag::OrdStatus, FixOrdStatus::New);
            builder_.set_string(Tag::Symbol, symbol);
            if (side) builder_.set_char(Tag::Side, *side);
            if (qty)  { builder_.set_int(Tag::LeavesQty, *qty);
                        builder_.set_int(Tag::CumQty, 0); }
            builder_.set_double(Tag::AvgPx, 0.0, 2);
            send(builder_.finalize());
            std::cout << "[MOCK] >> ExecutionReport  ExecType=New\n";

            // Fill
            builder_.reset();
            builder_.set_msg_type(MsgType::ExecutionReport);
            builder_.set_sender_comp_id(COMP_ID);
            builder_.set_target_comp_id(sender);
            builder_.set_msg_seq_num(out_seq_++);
            builder_.set_sending_time("20260712-12:00:01.000");
            builder_.set_string(Tag::OrderID, ord_id);
            builder_.set_string(Tag::ExecID, exec_id_2);
            builder_.set_string(Tag::ClOrdID, cl_ord_id);
            builder_.set_char(Tag::ExecType, FixExecType::Fill);
            builder_.set_char(Tag::OrdStatus, FixOrdStatus::Filled);
            builder_.set_string(Tag::Symbol, symbol);
            if (side) builder_.set_char(Tag::Side, *side);
            if (qty)  { builder_.set_int(Tag::LastQty, *qty);
                        builder_.set_int(Tag::LeavesQty, 0);
                        builder_.set_int(Tag::CumQty, *qty); }
            if (px)   { builder_.set_double(Tag::LastPx, *px, 2);
                        builder_.set_double(Tag::AvgPx, *px, 2); }
            send(builder_.finalize());
            std::cout << "[MOCK] >> ExecutionReport  ExecType=Fill  "
                      << (qty ? *qty : 0) << " @ " << (px ? *px : 0.0) << "\n";
        }
        else if (mt == MsgType::OrderCancelRequest) {
            auto orig_cl_ord_id = std::string(msg_.get_string(Tag::OrigClOrdID));
            auto cl_ord_id      = std::string(msg_.get_string(Tag::ClOrdID));
            auto symbol         = std::string(msg_.get_string(Tag::Symbol));
            auto exec_id        = "EXEC-" + std::to_string(exec_id_++);

            std::cout << "[MOCK] << OrderCancelRequest  OrigClOrdID=" << orig_cl_ord_id << "\n";

            builder_.reset();
            builder_.set_msg_type(MsgType::ExecutionReport);
            builder_.set_sender_comp_id(COMP_ID);
            builder_.set_target_comp_id(sender);
            builder_.set_msg_seq_num(out_seq_++);
            builder_.set_sending_time("20260712-12:00:00.000");
            builder_.set_string(Tag::OrderID, "MOCK-CANCEL");
            builder_.set_string(Tag::ExecID, exec_id);
            builder_.set_string(Tag::ClOrdID, cl_ord_id);
            builder_.set_string(Tag::OrigClOrdID, orig_cl_ord_id);
            builder_.set_char(Tag::ExecType, FixExecType::Cancelled);
            builder_.set_char(Tag::OrdStatus, FixOrdStatus::Cancelled);
            builder_.set_string(Tag::Symbol, symbol);
            builder_.set_int(Tag::LeavesQty, 0);
            builder_.set_int(Tag::CumQty, 0);
            builder_.set_double(Tag::AvgPx, 0.0, 2);
            send(builder_.finalize());
            std::cout << "[MOCK] >> ExecutionReport  ExecType=Cancelled\n";
        }
        else if (mt == MsgType::Heartbeat) {
            builder_.reset();
            builder_.set_msg_type(MsgType::Heartbeat);
            builder_.set_sender_comp_id(COMP_ID);
            builder_.set_target_comp_id(sender);
            builder_.set_msg_seq_num(out_seq_++);
            builder_.set_sending_time("20260712-12:00:00.000");
            if (msg_.has_tag(Tag::TestReqID))
                builder_.set_string(Tag::TestReqID, msg_.get_string(Tag::TestReqID));
            send(builder_.finalize());
        }
        else if (mt == MsgType::TestRequest) {
            auto test_req_id = std::string(msg_.get_string(Tag::TestReqID));
            std::cout << "[MOCK] << TestRequest  ID=" << test_req_id << "\n";
            builder_.reset();
            builder_.set_msg_type(MsgType::Heartbeat);
            builder_.set_sender_comp_id(COMP_ID);
            builder_.set_target_comp_id(sender);
            builder_.set_msg_seq_num(out_seq_++);
            builder_.set_sending_time("20260712-12:00:00.000");
            builder_.set_string(Tag::TestReqID, test_req_id);
            send(builder_.finalize());
            std::cout << "[MOCK] >> Heartbeat (TestReqID echo)\n";
        }
        else if (mt == MsgType::Logout) {
            std::cout << "[MOCK] << Logout from " << sender << "\n";
            builder_.reset();
            builder_.set_msg_type(MsgType::Logout);
            builder_.set_sender_comp_id(COMP_ID);
            builder_.set_target_comp_id(sender);
            builder_.set_msg_seq_num(out_seq_++);
            builder_.set_sending_time("20260712-12:00:00.000");
            send(builder_.finalize());
            std::cout << "[MOCK] >> Logout response\n";
            running_ = false;
        }
        else {
            std::cout << "[MOCK] << Unknown MsgType=" << mt << " (ignoring)\n";
        }
    }

    void send(std::string_view sv) {
        asio::error_code ec;
        asio::write(socket_, asio::buffer(sv.data(), sv.size()), ec);
        if (ec) {
            std::cout << "[MOCK] Write error: " << ec.message() << "\n";
            running_ = false;
        }
    }

    tcp::socket socket_;
    FixFramer   framer_;
    FixMessage  msg_;
    FixBuilder  builder_;
    uint64_t    out_seq_  = 1;
    uint64_t    order_id_ = 1000;
    uint64_t    exec_id_  = 1;
    bool        running_  = true;
};

int main(int argc, char* argv[]) {
    try {
        uint16_t port = 9876;
        if (argc > 1) port = static_cast<uint16_t>(std::stoi(argv[1]));

        std::cout << "─────────────────────────────────────────────────\n"
                  << " UltraLOB Mock FIX 4.4 Server — port " << port << "\n"
                  << "─────────────────────────────────────────────────\n"
                  << " Waiting for FIX Initiator connection...\n\n";

        asio::io_context io;
        tcp::acceptor acceptor(io, tcp::endpoint(tcp::v4(), port));

        while (true) {
            tcp::socket socket(io);
            acceptor.accept(socket);
            MockFixSession session(std::move(socket));
            session.run();
            std::cout << "\n[MOCK] Ready for next connection...\n";
        }
    }
    catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << "\n";
        return 1;
    }
    return 0;
}

