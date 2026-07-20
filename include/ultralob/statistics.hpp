#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Statistics Engine
//
// Computes real-time market microstructure statistics from the order book.
//
// All statistics are designed for O(1) or SIMD-batched computation with
// no dynamic allocation.
//
// SIMD path: AVX2 (256-bit) integer/float vectors for imbalance and depth VWAP.
// ─────────────────────────────────────────────────────────────────────────────

#include "types.hpp"
#include "order_book.hpp"
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <array>

#if defined(__AVX2__)
#  include <immintrin.h>
#endif

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// Depth snapshot (N price levels each side) used by SIMD stats
// ─────────────────────────────────────────────────────────────────────────────

inline constexpr size_t MAX_DEPTH_LEVELS = 32;

struct DepthSnapshot {
    // bid[0] = best bid, bid[1] = second-best, ...
    std::array<Price, MAX_DEPTH_LEVELS> bid_prices = {};
    std::array<Qty,   MAX_DEPTH_LEVELS> bid_qtys   = {};
    std::array<Price, MAX_DEPTH_LEVELS> ask_prices = {};
    std::array<Qty,   MAX_DEPTH_LEVELS> ask_qtys   = {};
    size_t bid_levels = 0;
    size_t ask_levels = 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// VWAP accumulator (maintained per session via fills)
// ─────────────────────────────────────────────────────────────────────────────

struct VWAPAccumulator {
    int64_t  price_qty_sum = 0;   // Σ(price × qty) — fixed-point
    uint64_t qty_sum       = 0;   // Σqty

    void update(Price price, Qty qty) noexcept {
        price_qty_sum += static_cast<int64_t>(price) * static_cast<int64_t>(qty);
        qty_sum       += qty;
    }

    void reset() noexcept { price_qty_sum = 0; qty_sum = 0; }

    [[nodiscard]] std::optional<Price> vwap() const noexcept {
        if (qty_sum == 0) return std::nullopt;
        return static_cast<Price>(price_qty_sum / static_cast<int64_t>(qty_sum));
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Statistics Engine
// ─────────────────────────────────────────────────────────────────────────────

class Statistics {
public:
    explicit Statistics(const OrderBook& book) noexcept : book_(book) {}

    // ── O(1) stats ────────────────────────────────────────────────────────────

    /// Best ask − best bid (nullopt if either side is empty)
    [[nodiscard]] std::optional<Price> spread() const noexcept;

    /// (best_ask + best_bid) / 2 — fixed-point mid
    [[nodiscard]] std::optional<Price> mid_price() const noexcept;

    // ── VWAP ─────────────────────────────────────────────────────────────────

    /// Update running VWAP accumulator after a fill (called by matching engine)
    void on_fill(Price exec_price, Qty exec_qty) noexcept {
        vwap_acc_.update(exec_price, exec_qty);
    }

    /// Current session VWAP (nullopt if no fills yet)
    [[nodiscard]] std::optional<Price> vwap() const noexcept {
        return vwap_acc_.vwap();
    }

    void reset_vwap() noexcept { vwap_acc_.reset(); }

    // ── SIMD stats ───────────────────────────────────────────────────────────

    /// Order imbalance = (bid_qty − ask_qty) / (bid_qty + ask_qty) over N levels
    /// Returns value in [-1.0, 1.0]. Positive = more bids (buying pressure).
    /// Uses AVX2 for the summation if available.
    [[nodiscard]] double order_imbalance(size_t depth = MAX_DEPTH_LEVELS) const noexcept;

    /// VWAP of the depth snapshot (bid-side weighted, ask-side weighted, mid)
    struct DepthVWAP {
        double bid_vwap;
        double ask_vwap;
        double mid_vwap;
    };
    [[nodiscard]] DepthVWAP depth_vwap(size_t depth = MAX_DEPTH_LEVELS) const noexcept;

    // ── Queue position ────────────────────────────────────────────────────────

    /// Number of orders ahead of `order_id` at its price level.
    /// Returns nullopt if order is not in the book.
    [[nodiscard]] std::optional<size_t> queue_position(OrderId order_id) const noexcept;

    /// Total quantity ahead of `order_id` in its price queue.
    [[nodiscard]] std::optional<Qty> qty_ahead(OrderId order_id) const noexcept;

    // ── Snapshot ──────────────────────────────────────────────────────────────

    /// Build a depth snapshot (copies prices/qtys) for SIMD processing.
    [[nodiscard]] DepthSnapshot snapshot(size_t depth = MAX_DEPTH_LEVELS) const noexcept;

private:
    // SIMD-accelerated summation of qty arrays
    [[nodiscard]] static uint64_t sum_qty_avx2(
        const Qty* data, size_t n) noexcept;

    // SIMD-accelerated dot product (price × qty)
    [[nodiscard]] static double dot_price_qty_avx2(
        const Price* prices, const Qty* qtys, size_t n) noexcept;

    const OrderBook&  book_;
    VWAPAccumulator   vwap_acc_;
};

} // namespace ultralob
