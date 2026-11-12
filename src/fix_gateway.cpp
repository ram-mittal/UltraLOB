#include "ultralob/fix/fix_gateway.hpp"
#include <iostream>

#if defined(_WIN32)
#include <windows.h>
#elif defined(__x86_64__) || defined(_M_X64)
#include <immintrin.h>
#endif

namespace ultralob::fix {

static inline void pause_cpu() noexcept {
#if defined(_WIN32)
    YieldProcessor();
#elif defined(__aarch64__)
    __asm__ volatile("yield" ::: "memory");
#elif defined(__x86_64__) || defined(_M_X64)
    _mm_pause();
#endif
}

static Symbol resolve_symbol_string(std::string_view sym) noexcept {
    if (sym == "AAPL") return 1;
    if (sym == "MSFT") return 2;
    if (sym == "GOOG" || sym == "GOOGL") return 3;
    if (sym == "TSLA") return 4;
    if (sym == "NVDA") return 5;
    // Fallback: simple hash for unknown symbol
    uint32_t h = 5381;
    for (char c : sym) h = ((h << 5) + h) + static_cast<uint32_t>(c);
    return (h % 1000) + 10;
}

static std::string resolve_symbol_id(Symbol id) {
    switch (id) {
        case 1: return "AAPL";
        case 2: return "MSFT";
        case 3: return "GOOGL";
        case 4: return "TSLA";
        case 5: return "NVDA";
        default: return "SYM-" + std::to_string(id);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FixServerSession Implementation
// ─────────────────────────────────────────────────────────────────────────────

FixServerSession::FixServerSession(tcp::socket socket,
                                   FixGateway& gateway,
                                   ExchangeNode& exchange,
                                   RiskEngine& risk_engine,
                                   uint32_t client_id,
                                   const std::string& store_dir)
    : socket_(std::move(socket)),
      gateway_(gateway),
      exchange_(exchange),
      risk_engine_(risk_engine),
      client_id_(client_id),
      store_dir_(store_dir) {
    risk_account_ = risk_engine_.get_or_create_account(client_id_);
}

FixServerSession::~FixServerSession() {
    stop();
}

void FixServerSession::start() {
    do_read();
}

void FixServerSession::stop() {
    asio::error_code ec;
    if (socket_.is_open()) {
        socket_.close(ec);
    }
    gateway_.remove_session(client_id_);
}

void FixServerSession::do_read() {
    auto self(shared_from_this());
    socket_.async_read_some(asio::buffer(read_buf_),
        [this, self](const asio::error_code& ec, size_t bytes_read) {
            if (!ec) {
                framer_.feed(read_buf_, bytes_read);
                const char* data = nullptr;
                size_t len = 0;

                while (framer_.extract(data, len) == FrameResult::Complete) {
                    if (in_msg_.parse(data, len)) {
                        handle_fix_message(in_msg_);
                    }
                }
                do_read();
            } else {
                stop();
            }
        });
}

void FixServerSession::handle_fix_message(const FixMessage& msg) {
    auto mt = msg.msg_type();

    // ── 1. Logon Handshake ───────────────────────────────────────────────
    if (mt == MsgType::Logon) {
        sender_comp_id_ = std::string(msg.sender_comp_id());
        auto incoming_target = msg.target_comp_id();
        if (!incoming_target.empty()) {
            target_comp_id_ = std::string(incoming_target);
        }

        SessionConfig config;
        config.set_sender(target_comp_id_);
        config.set_target(sender_comp_id_);
        config.heartbeat_interval_sec = static_cast<int>(msg.get_int(Tag::HeartBtInt).value_or(30));

        // Persistent message store per session
        std::string store_path = store_dir_ + "/fix_server_session_" + std::to_string(client_id_) + ".store";
        try {
            store_ = std::make_unique<FixStore>(store_path, 64ULL * 1024 * 1024);
            store_->set_session_ids(target_comp_id_, sender_comp_id_);
        } catch (...) {
            // Memory-mapped file creation fallback
        }

        session_ = std::make_unique<FixSession>(config);
        if (store_) {
            session_->set_store(store_.get());
        }
        session_->set_send_callback(on_session_send, this);
        session_->on_connected();
        session_->on_message_received(msg);
        return;
    }

    if (!session_) return;

    // Pass session-level messages to FixSession state machine
    session_->on_message_received(msg);

    // ── 2. Application-Level Messages ────────────────────────────────────
    if (session_->is_active()) {
        if (mt == MsgType::NewOrderSingle) {
            handle_new_order_single(msg);
        }
        else if (mt == MsgType::OrderCancelRequest) {
            handle_order_cancel_request(msg);
        }
        else if (mt == MsgType::OrderCancelReplaceRequest) {
            handle_order_cancel_replace_request(msg);
        }
    }
}

void FixServerSession::handle_new_order_single(const FixMessage& msg) {
    FixNewOrderSingle nos;
    if (!parse_new_order_single(msg, nos)) {
        auto seq = msg.msg_seq_num().value_or(0);
        send_reject(static_cast<uint64_t>(seq), "Malformed NewOrderSingle");
        return;
    }

    Symbol sym = resolve_symbol_string(nos.symbol);
    OrderId internal_id = (static_cast<OrderId>(client_id_) << 32) | next_order_id_seq_++;

    {
        std::lock_guard<std::mutex> lock(map_mutex_);
        cl_to_order_id_[nos.cl_ord_id] = internal_id;
        order_to_cl_ord_id_[internal_id] = nos.cl_ord_id;
        order_to_symbol_[internal_id] = nos.symbol;
    }

    OrderRequest req = to_order_request(nos, sym, internal_id, client_id_);

    // Pre-trade risk check
    RejectReason reason = RejectReason::None;
    if (!risk_engine_.check_and_hold(risk_account_, req, reason)) {
        // Pre-trade risk rejected: send immediate ExecutionReport(Rejected)
        ExecutionReport rej_rep{};
        rej_rep.order_id   = internal_id;
        rej_rep.client_id  = client_id_;
        rej_rep.symbol     = sym;
        rej_rep.side       = req.side;
        rej_rep.order_type = req.type;
        rej_rep.status     = OrderStatus::Rejected;
        rej_rep.leaves_qty = req.qty;
        send_execution_report(rej_rep);
        return;
    }

    // Submit order to UltraLOB matching engine sequencer thread (lock-free)
    InboundMessage in_req(req);
    while (!exchange_.push_inbound(in_req)) {
        pause_cpu();
    }
}

void FixServerSession::handle_order_cancel_request(const FixMessage& msg) {
    FixOrderCancelRequest cxl;
    if (!parse_order_cancel_request(msg, cxl)) {
        auto seq = msg.msg_seq_num().value_or(0);
        send_reject(static_cast<uint64_t>(seq), "Malformed OrderCancelRequest");
        return;
    }

    OrderId internal_id = 0;
    std::string sym_str;
    {
        std::lock_guard<std::mutex> lock(map_mutex_);
        auto it = cl_to_order_id_.find(cxl.orig_cl_ord_id);
        if (it != cl_to_order_id_.end()) {
            internal_id = it->second;
            sym_str = order_to_symbol_[internal_id];
        }
    }

    if (internal_id == 0) {
        send_order_cancel_reject(cxl.cl_ord_id, cxl.orig_cl_ord_id, "UNKNOWN",
                                 1, "Unknown OrigClOrdID or order already filled");
        return;
    }

    Symbol sym = resolve_symbol_string(sym_str.empty() ? cxl.symbol : sym_str);
    CancelRequest req = to_cancel_request(cxl, sym, internal_id);

    InboundMessage in_req(req);
    while (!exchange_.push_inbound(in_req)) {
        pause_cpu();
    }
}

void FixServerSession::handle_order_cancel_replace_request(const FixMessage& msg) {
    FixOrderCancelReplaceRequest rep;
    if (!parse_order_cancel_replace_request(msg, rep)) {
        auto seq = msg.msg_seq_num().value_or(0);
        send_reject(static_cast<uint64_t>(seq), "Malformed OrderCancelReplaceRequest");
        return;
    }

    OrderId internal_id = 0;
    std::string sym_str;
    {
        std::lock_guard<std::mutex> lock(map_mutex_);
        auto it = cl_to_order_id_.find(rep.orig_cl_ord_id);
        if (it != cl_to_order_id_.end()) {
            internal_id = it->second;
            sym_str = order_to_symbol_[internal_id];
        }
    }

    if (internal_id == 0) {
        send_order_cancel_reject(rep.cl_ord_id, rep.orig_cl_ord_id, "UNKNOWN",
                                 1, "Unknown OrigClOrdID or order already filled");
        return;
    }

    Symbol sym = resolve_symbol_string(sym_str.empty() ? rep.symbol : sym_str);
    ModifyRequest req = to_modify_request(rep, sym, internal_id);

    InboundMessage in_req(req);
    while (!exchange_.push_inbound(in_req)) {
        pause_cpu();
    }
}

void FixServerSession::send_execution_report(const ExecutionReport& report) {
    if (!session_ || !session_->is_active()) return;

    std::string cl_ord_id;
    std::string sym_str;
    {
        std::lock_guard<std::mutex> lock(map_mutex_);
        auto it = order_to_cl_ord_id_.find(report.order_id);
        if (it != order_to_cl_ord_id_.end()) {
            cl_ord_id = it->second;
        } else {
            cl_ord_id = "ORD-" + std::to_string(report.order_id);
        }
        auto s_it = order_to_symbol_.find(report.order_id);
        if (s_it != order_to_symbol_.end()) {
            sym_str = s_it->second;
        } else {
            sym_str = resolve_symbol_id(report.symbol);
        }
    }

    std::string order_id_str = "EX-" + std::to_string(report.order_id);
    std::string exec_id_str  = "EXEC-" + std::to_string(report.order_id) + "-" + std::to_string(report.cum_qty);

    FixExecutionReport fix_rep = to_fix_execution_report(
        report, cl_ord_id, "", sym_str, order_id_str, exec_id_str);

    serialize_execution_report(out_builder_, fix_rep);
    (void)session_->send_app_message(out_builder_);
}

void FixServerSession::send_order_cancel_reject(std::string_view cl_ord_id,
                                                std::string_view orig_cl_ord_id,
                                                std::string_view order_id,
                                                int reason,
                                                std::string_view text) {
    if (!session_ || !session_->is_active()) return;

    FixOrderCancelReject rej;
    rej.set_cl_ord_id(cl_ord_id);
    rej.set_orig_cl_ord_id(orig_cl_ord_id);
    rej.set_order_id(order_id);
    rej.cxl_rej_reason = reason;
    rej.set_text(text);

    serialize_order_cancel_reject(out_builder_, rej);
    (void)session_->send_app_message(out_builder_);
}

void FixServerSession::send_reject(uint64_t ref_seq, std::string_view text) {
    if (!session_) return;
    out_builder_.reset();
    out_builder_.set_msg_type(MsgType::Reject);
    out_builder_.set_int(45, static_cast<int64_t>(ref_seq)); // RefSeqNum
    if (!text.empty()) {
        out_builder_.set_string(Tag::Text, text);
    }
    (void)session_->send_app_message(out_builder_);
}

void FixServerSession::send_raw(const char* data, size_t len) {
    if (!socket_.is_open()) return;

    auto self(shared_from_this());
    bool write_in_progress = !write_queue_.empty();
    write_queue_.emplace_back(data, len);

    if (!write_in_progress) {
        asio::async_write(socket_,
            asio::buffer(write_queue_.front().data(), write_queue_.front().size()),
            [this, self](const asio::error_code& ec, size_t /*bytes*/) {
                if (!ec) {
                    write_queue_.pop_front();
                    while (!write_queue_.empty()) {
                        asio::error_code write_ec;
                        asio::write(socket_,
                            asio::buffer(write_queue_.front().data(), write_queue_.front().size()),
                            write_ec);
                        if (write_ec) {
                            stop();
                            return;
                        }
                        write_queue_.pop_front();
                    }
                } else {
                    stop();
                }
            });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FixGateway Implementation
// ─────────────────────────────────────────────────────────────────────────────

FixGateway::FixGateway(asio::io_context& io_context,
                       uint16_t port,
                       ExchangeNode& exchange,
                       RiskEngine& risk_engine,
                       const std::string& store_dir)
    : io_context_(io_context),
      acceptor_(io_context, tcp::endpoint(tcp::v4(), port)),
      exchange_(exchange),
      risk_engine_(risk_engine),
      store_dir_(store_dir) {
    do_accept();
}

FixGateway::~FixGateway() {
    stop();
}

void FixGateway::start_routing() {
    if (running_.exchange(true)) return;

    router_thread_ = std::thread([this] {
        while (running_.load(std::memory_order_relaxed)) {
            if (auto msg = exchange_.poll_outbound()) {
                route_report(msg->report);
            } else {
                pause_cpu();
            }
        }
    });
}

void FixGateway::stop() {
    running_.store(false, std::memory_order_release);
    if (router_thread_.joinable()) {
        router_thread_.join();
    }

    std::lock_guard<std::mutex> lock(sessions_mutex_);
    for (auto& [id, s] : sessions_) {
        if (s) s->stop();
    }
    sessions_.clear();
}

size_t FixGateway::session_count() const noexcept {
    return sessions_.size();
}

void FixGateway::remove_session(uint32_t client_id) {
    std::lock_guard<std::mutex> lock(sessions_mutex_);
    sessions_.erase(client_id);
}

void FixGateway::do_accept() {
    acceptor_.async_accept(
        [this](const asio::error_code& ec, tcp::socket socket) {
            if (!ec) {
                uint32_t client_id = next_client_id_++;
                auto session = std::make_shared<FixServerSession>(
                    std::move(socket), *this, exchange_, risk_engine_, client_id, store_dir_);

                {
                    std::lock_guard<std::mutex> lock(sessions_mutex_);
                    sessions_[client_id] = session;
                }

                session->start();
            }
            if (acceptor_.is_open()) {
                do_accept();
            }
        });
}

void FixGateway::route_report(const ExecutionReport& report) {
    std::shared_ptr<FixServerSession> target_session;

    uint32_t cid = report.client_id;
    if (cid == 0) {
        cid = static_cast<uint32_t>(report.order_id >> 32);
    }

    {
        std::lock_guard<std::mutex> lock(sessions_mutex_);
        if (cid != 0) {
            auto it = sessions_.find(cid);
            if (it != sessions_.end()) {
                target_session = it->second;
                risk_engine_.process_execution_report(target_session->risk_account(), report);
            }
        }
    }

    if (target_session) {
        asio::post(io_context_, [session = std::move(target_session), report] {
            session->send_execution_report(report);
        });
    }
}

} // namespace ultralob::fix
