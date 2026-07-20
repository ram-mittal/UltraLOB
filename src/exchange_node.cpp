#include "ultralob/exchange_node.hpp"

#ifdef _WIN32
    #include <windows.h>
#endif

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
ExchangeNode::ExchangeNode(size_t order_pool_capacity)
    : engine_(order_pool_capacity)
{
}

// ─────────────────────────────────────────────────────────────────────────────
ExchangeNode::~ExchangeNode() {
    stop();
}

// ─────────────────────────────────────────────────────────────────────────────
void ExchangeNode::enable_journaling(const std::string& filepath) {
    journal_ = std::make_unique<Journal>(filepath);
}

// ─────────────────────────────────────────────────────────────────────────────
void ExchangeNode::recover_from_journal(const std::string& filepath) {
    auto messages = Journal::read_all(filepath);
    for (const auto& msg : messages) {
        if (msg.type == MsgType::SubmitOrder) {
            engine_.submit(msg.submit);
        } else if (msg.type == MsgType::CancelOrder) {
            engine_.cancel(msg.cancel.symbol, msg.cancel.order_id);
        } else if (msg.type == MsgType::ModifyOrder) {
            engine_.modify(msg.modify.symbol, msg.modify);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
bool ExchangeNode::start(int core_id) {
    if (running_.exchange(true)) {
        return false; // Already running
    }

    thread_ = std::thread([this, core_id]() {
        if (core_id >= 0) {
            pin_current_thread_to_core(core_id);
        }
        
        // Spin-wait logic
        spin_loop();
    });

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
void ExchangeNode::stop() {
    if (running_.exchange(false)) {
        // Push a stop message to unblock the spin loop instantly
        push_inbound(InboundMessage::create_stop());
        if (thread_.joinable()) {
            thread_.join();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
void ExchangeNode::on_execution_report(const ExecutionReport& report, void* ctx) noexcept {
    auto* self = static_cast<ExchangeNode*>(ctx);
    
    OutboundMessage msg;
    msg.report = report;
    
    while (!self->outbound_queue_.try_push(msg)) {
#if defined(_WIN32)
        YieldProcessor(); // _mm_pause()
#elif defined(__aarch64__)
        asm volatile("yield" ::: "memory");
#else
        asm volatile("pause" ::: "memory");
#endif
    }

    if (self->md_publisher_) {
        net::MDMessage md;
        md.type = net::MDType::AddOrder; // Default init
        
        switch(report.status) {
            case OrderStatus::New:
                md.type = net::MDType::AddOrder;
                md.add.timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                md.add.order_id = report.order_id;
                md.add.symbol = report.symbol;
                md.add.side = report.side;
                md.add.qty = report.leaves_qty;
                md.add.price = report.exec_price; // limit price
                self->md_publisher_->publish(md);
                break;
            case OrderStatus::Filled:
            case OrderStatus::PartiallyFilled:
                md.type = net::MDType::ExecuteOrder;
                md.exec.timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                md.exec.order_id = report.contra_order_id == INVALID_ORDER_ID ? report.order_id : report.contra_order_id;
                md.exec.exec_qty = report.exec_qty;
                md.exec.exec_price = report.exec_price;
                md.exec.match_id = 0; // Or seq_num
                self->md_publisher_->publish(md);
                break;
            case OrderStatus::Cancelled:
                md.type = net::MDType::CancelOrder;
                md.cancel.timestamp = std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                md.cancel.order_id = report.order_id;
                md.cancel.cancelled_qty = 0; // Typically delta, but leaves_qty is 0 for Cancelled
                self->md_publisher_->publish(md);
                break;
            default:
                break;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
void ExchangeNode::spin_loop() {
    // Note: Symbols must be pre-registered (via engine().add_symbol())
    // before starting the node, or handled via a special control message.
    // For simplicity, we assume pre-registration.

    while (running_.load(std::memory_order_relaxed)) {
        auto opt_msg = inbound_queue_.try_pop();
        if (opt_msg) {
            const InboundMessage& msg = *opt_msg;
            
            // Journal before execution if enabled
            if (journal_ && msg.type != MsgType::StopEngine) {
                net::ClientRequest req;
                req.type = msg.type;
                if (msg.type == MsgType::SubmitOrder) {
                    req.submit = msg.submit;
                } else if (msg.type == MsgType::CancelOrder) {
                    req.cancel = msg.cancel;
                } else if (msg.type == MsgType::ModifyOrder) {
                    req.modify = msg.modify;
                }
                journal_->append(req);
            }

            switch (msg.type) {
                case MsgType::SubmitOrder:
                    engine_.submit(msg.submit);
                    break;
                case MsgType::CancelOrder:
                    engine_.cancel(msg.cancel.symbol, msg.cancel.order_id);
                    break;
                case MsgType::ModifyOrder:
                    engine_.modify(msg.modify.symbol, msg.modify);
                    break;
                case MsgType::StopEngine:
                    running_.store(false, std::memory_order_relaxed);
                    break;
            }
        } else {
            // Backoff strategy (PAUSE instruction) to reduce CPU power 
            // consumption without context switching.
#if defined(_WIN32)
            YieldProcessor(); // _mm_pause()
#elif defined(__aarch64__)
            asm volatile("yield" ::: "memory");
#else
            asm volatile("pause" ::: "memory");
#endif
        }
    }
}

} // namespace ultralob
