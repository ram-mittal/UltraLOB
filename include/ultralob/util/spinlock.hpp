#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — SpinLock
//
// A pause-based test-and-test-and-set spinlock.
// Emits x86 PAUSE instructions during spin to reduce bus traffic and power.
// Suitable for short critical sections (< 100ns) where mutex overhead is
// unacceptable.
// ─────────────────────────────────────────────────────────────────────────────

#include <atomic>
#include <cstdint>

#if defined(_MSC_VER)
#  include <intrin.h>
#  define UL_PAUSE() _mm_pause()
#elif defined(__x86_64__) || defined(__i386__)
#  include <immintrin.h>
#  define UL_PAUSE() _mm_pause()
#elif defined(__aarch64__)
#  define UL_PAUSE() __asm__ volatile("yield" ::: "memory")
#else
#  define UL_PAUSE() ((void)0)
#endif

namespace ultralob {

class alignas(64) SpinLock {
public:
    SpinLock() noexcept = default;

    SpinLock(const SpinLock&)            = delete;
    SpinLock& operator=(const SpinLock&) = delete;

    void lock() noexcept {
        for (;;) {
            // Optimistic fast path: try to acquire without invalidating cache line
            if (!flag_.load(std::memory_order_relaxed) &&
                !flag_.exchange(true, std::memory_order_acquire))
            {
                return;
            }
            // Backoff: spin without writing (avoids cache coherence traffic)
            do {
                UL_PAUSE();
            } while (flag_.load(std::memory_order_relaxed));
        }
    }

    bool try_lock() noexcept {
        return !flag_.load(std::memory_order_relaxed) &&
               !flag_.exchange(true, std::memory_order_acquire);
    }

    void unlock() noexcept {
        flag_.store(false, std::memory_order_release);
    }

private:
    std::atomic<bool> flag_{false};
    // Padding to fill a full cache line (avoid false sharing)
    [[maybe_unused]] uint8_t _pad[63] = {};
};

// ─────────────────────────────────────────────────────────────────────────────
// RAII guard
// ─────────────────────────────────────────────────────────────────────────────
class SpinGuard {
public:
    explicit SpinGuard(SpinLock& sl) noexcept : sl_(sl) { sl_.lock(); }
    ~SpinGuard() noexcept { sl_.unlock(); }

    SpinGuard(const SpinGuard&)            = delete;
    SpinGuard& operator=(const SpinGuard&) = delete;

private:
    SpinLock& sl_;
};

} // namespace ultralob
