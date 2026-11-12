#include "ultralob/fix/fix_initiator.hpp"
#include <iostream>

namespace ultralob::fix {

FixInitiator::FixInitiator(const SessionConfig& config,
                           const std::string& host,
                           uint16_t port,
                           FixStore* store) noexcept
    : host_(host),
      port_(port),
      store_(store),
      session_(config),
      timer_(io_) {
    session_.set_send_callback(on_session_send, this);
    session_.set_app_msg_callback(on_session_app_msg, this);

    if (store_) {
        session_.set_store(store_);
        session_.recover_from_store();
    }
}

FixInitiator::~FixInitiator() {
    stop();
}

bool FixInitiator::start() {
    if (running_.exchange(true)) return false;

    network_thread_ = std::thread([this] {
        run_network_loop();
    });
    return true;
}

void FixInitiator::stop() {
    if (!running_.exchange(false)) return;

    // Request session logout on the network thread
    asio::post(io_, [this] {
        if (session_.is_active()) {
            session_.initiate_logout();
        }
    });

    // Give logout message a moment to transmit
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    // Stop io context and close socket
    asio::post(io_, [this] {
        connected_.store(false, std::memory_order_release);
        if (socket_ && socket_->is_open()) {
            asio::error_code ec;
            socket_->close(ec);
        }
        timer_.cancel();
        io_.stop();
    });

    if (network_thread_.joinable()) {
        network_thread_.join();
    }
}

void FixInitiator::run_network_loop() {
    socket_ = std::make_unique<tcp::socket>(io_);
    do_connect();
    start_timer();

    io_.run();

    connected_.store(false, std::memory_order_release);
    session_.on_disconnected();
}

void FixInitiator::do_connect() {
    asio::error_code ec;
    auto addr = asio::ip::make_address(host_, ec);
    tcp::endpoint ep;

    if (!ec) {
        ep = tcp::endpoint(addr, port_);
    } else {
        // Resolve hostname
        tcp::resolver resolver(io_);
        auto endpoints = resolver.resolve(host_, std::to_string(port_), ec);
        if (ec || endpoints.empty()) {
            session_.on_disconnected();
            return;
        }
        ep = *endpoints.begin();
    }

    socket_->async_connect(ep, [this](const asio::error_code& ec) {
        if (!ec) {
            connected_.store(true, std::memory_order_release);
            session_.on_connected();
            session_.initiate_logon();
            do_read();
        } else {
            connected_.store(false, std::memory_order_release);
            session_.on_disconnected();
        }
    });
}

void FixInitiator::do_read() {
    socket_->async_read_some(asio::buffer(recv_buf_),
        [this](const asio::error_code& ec, size_t bytes_read) {
            if (!ec) {
                framer_.feed(recv_buf_, bytes_read);
                const char* data = nullptr;
                size_t len = 0;

                while (framer_.extract(data, len) == FrameResult::Complete) {
                    if (in_msg_.parse(data, len)) {
                        session_.on_message_received(in_msg_);
                    }
                }
                do_read();
            } else {
                connected_.store(false, std::memory_order_release);
                session_.on_disconnected();
            }
        });
}

void FixInitiator::start_timer() {
    timer_.expires_after(std::chrono::milliseconds(250));
    timer_.async_wait([this](const asio::error_code& ec) {
        if (!ec && running_.load(std::memory_order_relaxed)) {
            session_.on_timer_tick();
            start_timer();
        }
    });
}

void FixInitiator::on_send_raw(const char* data, size_t len) noexcept {
    if (!connected_.load(std::memory_order_acquire) || !socket_ || !socket_->is_open()) {
        return;
    }
    asio::error_code ec;
    asio::write(*socket_, asio::buffer(data, len), ec);
    if (ec) {
        connected_.store(false, std::memory_order_release);
        session_.on_disconnected();
    }
}

bool FixInitiator::send_new_order_single(const FixNewOrderSingle& nos) noexcept {
    if (!session_.is_active()) return false;

    asio::post(io_, [this, nos] {
        app_.send_new_order_single(session_, nos);
    });
    return true;
}

bool FixInitiator::send_order_cancel(const FixOrderCancelRequest& cxl) noexcept {
    if (!session_.is_active()) return false;

    asio::post(io_, [this, cxl] {
        app_.send_order_cancel(session_, cxl);
    });
    return true;
}

bool FixInitiator::send_order_replace(const FixOrderCancelReplaceRequest& replace) noexcept {
    if (!session_.is_active()) return false;

    asio::post(io_, [this, replace] {
        app_.send_order_replace(session_, replace);
    });
    return true;
}

} // namespace ultralob::fix

