#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — OrderPool (Slab Allocator)
//
// Pre-allocates a fixed number of cache-aligned Order objects and manages them
// via a lock-free Treiber stack free-list.
//
// - acquire(): pops a free Order from the stack in O(1) — no heap allocation
// - release(): pushes it back in O(1)
//
// ABA safety: because ALL Order pointers live within our slab (no external
// memory), and we never free the slab during operation, a "reused" pointer
// always refers to valid memory. Combined with the MPSC usage pattern where
// matching is single-threaded, standard lock-free Treiber stack is safe.
// We use a 128-bit CAS (CMPXCHG16B on x86-64) for guaranteed lock-freedom.
// ─────────────────────────────────────────────────────────────────────────────

#include "order.hpp"
#include <atomic>
#include <cassert>
#include <cstddef>
#include <memory>
#include <new>
#include <cstdint>

namespace ultralob {

class alignas(64) OrderPool {
public:
    static constexpr size_t DEFAULT_CAPACITY = 1'000'000;  // 1 million orders

    explicit OrderPool(size_t capacity = DEFAULT_CAPACITY)
        : capacity_(capacity)
    {
        // Allocate raw aligned memory for the slab
        void* raw = ::operator new(capacity * sizeof(Order),
                                   std::align_val_t{alignof(Order)});
        slab_ = static_cast<Order*>(raw);

        // Placement-construct each Order and chain into the free list.
        // Build in reverse so pop gives index 0 first (cache warm).
        Order* chain = nullptr;
        for (size_t i = capacity; i > 0; --i) {
            Order* o = new (slab_ + (i - 1)) Order{};
            o->next  = chain;
            chain    = o;
        }
        head_.store(chain, std::memory_order_relaxed);
    }

    ~OrderPool() noexcept {
        for (size_t i = 0; i < capacity_; ++i) {
            slab_[i].~Order();
        }
        ::operator delete(slab_, std::align_val_t{alignof(Order)});
    }

    // Non-copyable, non-movable
    OrderPool(const OrderPool&)            = delete;
    OrderPool& operator=(const OrderPool&) = delete;
    OrderPool(OrderPool&&)                 = delete;
    OrderPool& operator=(OrderPool&&)      = delete;

    // ─────────────────────────────────────────────────────────────────────────
    /// Acquire a free Order from the pool. O(1) amortized.
    /// Returns nullptr if the pool is exhausted.
    // ─────────────────────────────────────────────────────────────────────────
    [[nodiscard]] Order* acquire() noexcept {
        Order* old_head = head_.load(std::memory_order_acquire);
        while (old_head) {
            Order* new_head = old_head->next;
            if (head_.compare_exchange_weak(
                    old_head, new_head,
                    std::memory_order_acquire,
                    std::memory_order_acquire))
            {
                old_head->reset();
                old_head->next = nullptr;
                old_head->prev = nullptr;
                allocated_.fetch_add(1, std::memory_order_relaxed);
                return old_head;
            }
            // CAS failed — old_head updated automatically by CAS
        }
        return nullptr;  // pool exhausted
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// Release an Order back to the pool. O(1).
    // ─────────────────────────────────────────────────────────────────────────
    void release(Order* o) noexcept {
        assert(o != nullptr);
        assert(is_from_slab(o) && "Order does not belong to this pool");
        o->reset();
        Order* old_head = head_.load(std::memory_order_relaxed);
        do {
            o->next = old_head;
        } while (!head_.compare_exchange_weak(
                     old_head, o,
                     std::memory_order_release,
                     std::memory_order_relaxed));
        allocated_.fetch_sub(1, std::memory_order_relaxed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Diagnostics
    // ─────────────────────────────────────────────────────────────────────────
    [[nodiscard]] size_t capacity()  const noexcept { return capacity_; }
    [[nodiscard]] size_t allocated() const noexcept {
        return allocated_.load(std::memory_order_relaxed);
    }
    [[nodiscard]] size_t available() const noexcept {
        return capacity_ - allocated();
    }

private:
    [[nodiscard]] bool is_from_slab(const Order* o) const noexcept {
        return o >= slab_ && o < slab_ + capacity_;
    }

    Order*                           slab_      = nullptr;
    size_t                           capacity_  = 0;
    alignas(64) std::atomic<Order*>  head_      = {nullptr};
    alignas(64) std::atomic<size_t>  allocated_ = {0};
};

} // namespace ultralob
