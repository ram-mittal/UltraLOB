#pragma once

#include "wire_protocol.hpp"
#include "risk_engine.hpp"
#include "ultralob/exchange_node.hpp"
#include <asio.hpp>
#include <memory>
#include <iostream>
#include <deque>

namespace ultralob::net {

class Session : public std::enable_shared_from_this<Session> {
public:
    Session(asio::ip::tcp::socket socket, ExchangeNode& exchange, uint32_t client_id, RiskEngine& risk_engine)
        : socket_(std::move(socket)), exchange_(exchange), client_id_(client_id), risk_engine_(risk_engine) {
        risk_account_ = risk_engine.get_or_create_account(client_id);
    }

    void start() {
        do_read();
    }

    void send_report(const ExecutionReport& report) {
        ServerResponse resp{report};
        
        bool write_in_progress = !write_queue_.empty();
        write_queue_.push_back(resp);
        
        if (!write_in_progress) {
            do_write();
        }
    }

    [[nodiscard]] uint32_t client_id() const noexcept { return client_id_; }
    [[nodiscard]] RiskAccount* risk_account() const noexcept { return risk_account_; }

private:
    void do_read() {
        auto self(shared_from_this());
        asio::async_read(socket_,
            asio::buffer(&read_msg_, sizeof(ClientRequest)),
            [this, self](std::error_code ec, std::size_t /*length*/) {
                if (!ec) {
                    process_request();
                    do_read();
                } else {
                    // Client disconnected or error
                    std::cerr << "Client " << client_id_ << " disconnected: " << ec.message() << "\n";
                }
            });
    }

    void process_request() {
        InboundMessage msg;
        msg.type = read_msg_.type;
        
        switch (msg.type) {
            case MsgType::SubmitOrder: {
                msg.submit = read_msg_.submit;
                msg.submit.client_id = client_id_; // Ensure client ID is injected by gateway
                
                // Pre-trade risk check
                RejectReason reason = RejectReason::None;
                if (!risk_engine_.check_and_hold(risk_account_, msg.submit, reason)) {
                    // Send synthetic reject
                    ExecutionReport rep{};
                    rep.order_id = msg.submit.id;
                    rep.client_id = client_id_;
                    rep.symbol = msg.submit.symbol;
                    rep.side = msg.submit.side;
                    rep.order_type = msg.submit.type;
                    rep.status = OrderStatus::Rejected;
                    rep.leaves_qty = msg.submit.qty;
                    send_report(rep);
                    return; // Skip sending to ExchangeNode
                }
                break;
            }
            case MsgType::CancelOrder:
                msg.cancel = read_msg_.cancel;
                break;
            case MsgType::ModifyOrder:
                msg.modify = read_msg_.modify;
                break;
            case MsgType::StopEngine:
                // Gateway shouldn't allow clients to stop the engine directly.
                return; 
        }
        
        // Spin until pushed (backpressure)
        while (!exchange_.push_inbound(msg)) {
#if defined(_WIN32)
            YieldProcessor();
#elif defined(__aarch64__)
            __asm__ volatile("yield" ::: "memory");
#else
            _mm_pause();
#endif
        }
    }

    void do_write() {
        auto self(shared_from_this());
        asio::async_write(socket_,
            asio::buffer(&write_queue_.front(), sizeof(ServerResponse)),
            [this, self](std::error_code ec, std::size_t /*length*/) {
                if (!ec) {
                    write_queue_.pop_front();
                    if (!write_queue_.empty()) {
                        do_write();
                    }
                } else {
                    std::cerr << "Write error to client " << client_id_ << ": " << ec.message() << "\n";
                }
            });
    }

    asio::ip::tcp::socket socket_;
    ExchangeNode&         exchange_;
    uint32_t              client_id_;
    RiskEngine&           risk_engine_;
    RiskAccount*          risk_account_{nullptr};
    
    ClientRequest                 read_msg_;
    std::deque<ServerResponse>    write_queue_;
};

} // namespace ultralob::net
