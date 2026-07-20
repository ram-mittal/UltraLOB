#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Lock-Free MPSC Queue (Multiple Producers, Single Consumer)
//
// Power-of-2 ring buffer. Producers claim slots via fetch_add on a shared
// head counter; the consumer reads from a private tail.
//
// Producers:  O(1) — atomic fetch_add + sequenced store
// Consumer:   O(1) — non-atomic tail read + sequenced load
// Capacity:   must be power-of-2 (compile-time template param)
// No dynamic allocation.
//
// Protocol:
//   1. Producer atomically claims slot: idx = head_.fetch_add(1)
//   2. Producer writes payload to slots_[idx & mask_]
//   3. Producer sets sequence_[idx & mask_] = idx + 1 (signals ready)
//   4. Consumer checks sequence_[tail_ & mask_] == tail_ + 1
//   5. Consumer reads payload, advances tail_
// ─────────────────────────────────────────────────────────────────────────────

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <new>
#include <type_traits>
#include <cassert>

namespace ultralob {

template <typename T, size_t Capacity>
class MPSCQueue {
    static_assert((Capacity & (Capacity - 1)) == 0,
                  "MPSCQueue Capacity must be a power of 2");
    static_assert(std::is_trivially_copyable_v<T>,
                  "MPSCQueue requires trivially copyable element type");

    static constexpr size_t MASK = Capacity - 1;

    static constexpr int pad_size = 64 - static_cast<int>(sizeof(std::atomic<uint64_t>)) - static_cast<int>(sizeof(T));

    struct alignas(64) Slot {
        std::atomic<uint64_t> sequence{0};
        T                     data{};
        uint8_t               _pad[pad_size > 0 ? pad_size : 1] = {};
    };

public:
    MPSCQueue() noexcept {
        // Initialize sequence numbers: slot[i] starts at i
        for (size_t i = 0; i < Capacity; ++i) {
            slots_[i].sequence.store(i, std::memory_order_relaxed);
        }
    }

    MPSCQueue(const MPSCQueue&)            = delete;
    MPSCQueue& operator=(const MPSCQueue&) = delete;

    // ─────────────────────────────────────────────────────────────────────────
    /// Try to push (producer-side). Returns false if the queue is full.
    /// Thread-safe — multiple producers can call concurrently.
    // ─────────────────────────────────────────────────────────────────────────
    [[nodiscard]] bool try_push(const T& item) noexcept {
        uint64_t head = head_.load(std::memory_order_relaxed);
        for (;;) {
            Slot& slot = slots_[head & MASK];
            uint64_t seq = slot.sequence.load(std::memory_order_acquire);
            int64_t  diff = static_cast<int64_t>(seq) - static_cast<int64_t>(head);

            if (diff == 0) {
                // Slot is free — try to claim it
                if (head_.compare_exchange_weak(head, head + 1,
                        std::memory_order_relaxed))
                {
                    slot.data = item;
                    // Signal that this slot is ready for the consumer
                    slot.sequence.store(head + 1, std::memory_order_release);
                    return true;
                }
                // CAS failed — head changed, retry with updated head
            } else if (diff < 0) {
                // Queue is full
                return false;
            } else {
                // Another producer is ahead — re-load head
                head = head_.load(std::memory_order_relaxed);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// Try to pop (consumer-side). Returns nullopt if empty.
    /// NOT thread-safe — only a single consumer thread may call this.
    // ─────────────────────────────────────────────────────────────────────────
    [[nodiscard]] std::optional<T> try_pop() noexcept {
        Slot& slot = slots_[tail_ & MASK];
        uint64_t seq = slot.sequence.load(std::memory_order_acquire);
        int64_t diff = static_cast<int64_t>(seq) - static_cast<int64_t>(tail_ + 1);

        if (diff == 0) {
            // Slot is ready
            T item = slot.data;
            // Release the slot back to producers
            slot.sequence.store(tail_ + Capacity, std::memory_order_release);
            ++tail_;
            return item;
        }
        // diff < 0: queue is empty (slot not yet written)
        return std::nullopt;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Diagnostics (approximate — producers may be in-flight)
    // ─────────────────────────────────────────────────────────────────────────
    [[nodiscard]] bool   empty()    const noexcept {
        return head_.load(std::memory_order_relaxed) == tail_;
    }
    [[nodiscard]] size_t capacity() const noexcept { return Capacity; }
    [[nodiscard]] size_t size_approx() const noexcept {
        uint64_t h = head_.load(std::memory_order_relaxed);
        return (h > tail_) ? static_cast<size_t>(h - tail_) : 0;
    }

private:
    alignas(64) std::atomic<uint64_t> head_{0};
    alignas(64) uint64_t              tail_{0};          // consumer-private
    Slot                              slots_[Capacity];
};

} // namespace ultralob
