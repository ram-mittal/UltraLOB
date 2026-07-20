#pragma once

#include "ultralob/net/market_data_protocol.hpp"
#include "ultralob/util/mpsc_queue.hpp"
#include <asio.hpp>
#include <thread>
#include <atomic>
#include <string>
#include <iostream>

#if defined(_WIN32)
#include <windows.h>
#endif

namespace ultralob::net {

class MarketDataPublisher {
public:
    MarketDataPublisher(const std::string& multicast_ip = "239.255.0.1", uint16_t port = 9001)
        : endpoint_(asio::ip::address::from_string(multicast_ip), port)
        , socket_(io_context_, endpoint_.protocol())
        , running_(false) 
    {
        socket_.set_option(asio::ip::multicast::join_group(endpoint_.address()));
    }

    ~MarketDataPublisher() {
        stop();
    }

    void start() {
        if (running_.exchange(true)) return;

        thread_ = std::thread([this]() {
            publish_loop();
        });
    }

    void stop() {
        if (!running_.exchange(false)) return;
        
        // Push a dummy message to wake up the loop if it's spinning or just let it exit on running_ == false
        io_context_.stop();
        if (thread_.joinable()) {
            thread_.join();
        }
    }

    void publish(const MDMessage& msg) {
        // Since it's a lock-free queue, we try_push until it succeeds or drops depending on strategy.
        // For market data, dropping is bad, so we'll spin wait if queue is full.
        while (!queue_.try_push(msg)) {
#if defined(_WIN32)
            YieldProcessor();
#elif defined(__aarch64__)
            asm volatile("yield" ::: "memory");
#else
            asm volatile("pause" ::: "memory");
#endif
        }
    }

private:
    void publish_loop() {
        while (running_.load(std::memory_order_relaxed)) {
            auto opt_msg = queue_.try_pop();
            if (opt_msg) {
                const MDMessage& msg = *opt_msg;
                std::error_code ec;
                socket_.send_to(asio::buffer(&msg, sizeof(MDMessage)), endpoint_, 0, ec);
                if (ec) {
                    std::cerr << "UDP Multicast Error: " << ec.message() << "\n";
                }
            } else {
                // Simple backoff / yield to avoid 100% CPU on empty queue (unless pinned)
                std::this_thread::yield();
            }
        }
    }

    asio::io_context io_context_;
    asio::ip::udp::endpoint endpoint_;
    asio::ip::udp::socket socket_;
    
    MPSCQueue<MDMessage, 65536> queue_;
    std::atomic<bool> running_;
    std::thread thread_;
};

} // namespace ultralob::net
