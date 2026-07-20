#pragma once

#include "session.hpp"
#include "risk_engine.hpp"
#include <asio.hpp>
#include <unordered_map>
#include <mutex>
#include <thread>
#include <atomic>
#include <iostream>

namespace ultralob::net {

class Gateway {
public:
    Gateway(asio::io_context& io_context, short port, ExchangeNode& exchange)
        : io_context_(io_context),
          acceptor_(io_context, asio::ip::tcp::endpoint(asio::ip::tcp::v4(), port)),
          exchange_(exchange),
          next_client_id_(1),
          running_(false)
    {
        do_accept();
    }

    ~Gateway() {
        stop();
    }

    uint16_t port() const {
        return acceptor_.local_endpoint().port();
    }

    void start_routing() {
        if (running_.exchange(true)) return;
        
        router_thread_ = std::thread([this]() {
            while (running_.load(std::memory_order_relaxed)) {
                if (auto msg = exchange_.poll_outbound()) {
                    route_report(msg->report);
                } else {
#if defined(_WIN32)
                    YieldProcessor();
#elif defined(__aarch64__)
                    __asm__ volatile("yield" ::: "memory");
#else
                    _mm_pause();
#endif
                }
            }
        });
    }

    void stop() {
        running_.store(false, std::memory_order_release);
        if (router_thread_.joinable()) {
            router_thread_.join();
        }
    }

private:
    void do_accept() {
        acceptor_.async_accept(
            [this](std::error_code ec, asio::ip::tcp::socket socket) {
                if (!ec) {
                    uint32_t client_id = next_client_id_++;
                    std::cout << "New client connected. Assigned ID: " << client_id << "\n";
                    
                    auto session = std::make_shared<Session>(std::move(socket), exchange_, client_id, risk_engine_);
                    
                    {
                        std::lock_guard<std::mutex> lock(sessions_mutex_);
                        sessions_[client_id] = session;
                    }
                    
                    session->start();
                }
                do_accept();
            });
    }

    void route_report(const ExecutionReport& report) {
        std::shared_ptr<Session> target_session;
        
        {
            std::lock_guard<std::mutex> lock(sessions_mutex_);
            if (report.client_id != 0) {
                auto it = sessions_.find(report.client_id);
                if (it != sessions_.end()) {
                    target_session = it->second;
                    risk_engine_.process_execution_report(target_session->risk_account(), report);
                }
            }
        }
        
        if (target_session) {
            // Post to the io_context to ensure thread-safety of session->send_report
            asio::post(io_context_, [session = std::move(target_session), report]() {
                session->send_report(report);
            });
        }
        
        // In a real system, we might also broadcast trade data to all sessions here
        // (if report.is_fill()). For this MVP, we just route to the owner.
    }

    asio::io_context& io_context_;
    asio::ip::tcp::acceptor acceptor_;
    ExchangeNode& exchange_;
    
    std::atomic<uint32_t> next_client_id_;
    
    std::mutex sessions_mutex_;
    std::unordered_map<uint32_t, std::shared_ptr<Session>> sessions_;
    
    RiskEngine risk_engine_;
    std::atomic<bool> running_;
    std::thread router_thread_;
};

} // namespace ultralob::net
