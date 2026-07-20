#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — PriceLevel
//
// Represents all resting orders at a single price point on one side of the book.
//
// Data structure: intrusive doubly-linked FIFO list of Order*.
//
//   head → [Order A] ↔ [Order B] ↔ [Order C] ← tail
//            (oldest)                 (newest)
//
// FIFO matching: always consume from head.
// Insertion: always push to tail → O(1).
// Removal:   splice via intrusive pointers → O(1) anywhere in list.
//
// total_qty is maintained incrementally for O(1) book depth queries.
// ─────────────────────────────────────────────────────────────────────────────

#include "order.hpp"
#include <cassert>

namespace ultralob {

class PriceLevel {
public:
    PriceLevel() noexcept = default;

    // Non-copyable — contains raw pointers into the order pool
    PriceLevel(const PriceLevel&)            = delete;
    PriceLevel& operator=(const PriceLevel&) = delete;

    // Movable (for std::map emplace)
    PriceLevel(PriceLevel&& o) noexcept
        : head_(o.head_), tail_(o.tail_)
        , count_(o.count_), total_qty_(o.total_qty_)
    {
        o.head_ = o.tail_ = nullptr;
        o.count_ = 0;
        o.total_qty_ = 0;
    }

    PriceLevel& operator=(PriceLevel&& o) noexcept {
        head_      = o.head_;
        tail_      = o.tail_;
        count_     = o.count_;
        total_qty_ = o.total_qty_;
        o.head_ = o.tail_ = nullptr;
        o.count_ = 0;
        o.total_qty_ = 0;
        return *this;
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// Add an order to the back of the FIFO queue. O(1).
    // ─────────────────────────────────────────────────────────────────────────
    void add(Order* o) noexcept {
        assert(o != nullptr);
        assert(o->prev == nullptr && o->next == nullptr);

        o->prev = tail_;
        o->next = nullptr;
        if (tail_) {
            tail_->next = o;
        } else {
            head_ = o;  // first order in level
        }
        tail_ = o;
        ++count_;
        total_qty_ += o->leaves_qty;
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// Remove a specific order from anywhere in the queue. O(1).
    /// NOTE: Does NOT adjust total_qty — caller must call reduce_qty() first.
    // ─────────────────────────────────────────────────────────────────────────
    void remove(Order* o) noexcept {
        assert(o != nullptr);
        assert(count_ > 0);

        if (o->prev) o->prev->next = o->next;
        else         head_         = o->next;  // o was head

        if (o->next) o->next->prev = o->prev;
        else         tail_         = o->prev;  // o was tail

        o->prev = nullptr;
        o->next = nullptr;
        --count_;
        // total_qty is maintained by the caller via reduce_qty()
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// Reduce total_qty by delta (called after a partial fill on the head order).
    // ─────────────────────────────────────────────────────────────────────────
    void reduce_qty(Qty delta) noexcept {
        assert(total_qty_ >= delta);
        total_qty_ -= delta;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Accessors
    // ─────────────────────────────────────────────────────────────────────────

    [[nodiscard]] Order*  front()     const noexcept { return head_; }
    [[nodiscard]] Order*  back()      const noexcept { return tail_; }
    [[nodiscard]] bool    empty()     const noexcept { return head_ == nullptr; }
    [[nodiscard]] size_t  count()     const noexcept { return count_; }
    [[nodiscard]] Qty     total_qty() const noexcept { return total_qty_; }

    // ─────────────────────────────────────────────────────────────────────────
    // Iteration support (read-only forward walk for statistics)
    // ─────────────────────────────────────────────────────────────────────────
    struct Iterator {
        Order* current;
        Iterator& operator++() noexcept { current = current->next; return *this; }
        bool operator!=(const Iterator& o) const noexcept { return current != o.current; }
        Order& operator*() const noexcept { return *current; }
    };

    [[nodiscard]] Iterator begin() const noexcept { return {head_}; }
    [[nodiscard]] Iterator end()   const noexcept { return {nullptr}; }

private:
    Order*  head_      = nullptr;
    Order*  tail_      = nullptr;
    size_t  count_     = 0;
    Qty     total_qty_ = 0;
};

} // namespace ultralob
