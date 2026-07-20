// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Statistics Implementation
//
// SIMD paths use AVX2 (256-bit) integer intrinsics.
// Scalar fallback provided for non-AVX2 environments.
// ─────────────────────────────────────────────────────────────────────────────

#include "ultralob/statistics.hpp"

#include <cmath>
#include <cassert>
#include <algorithm>

#if defined(__AVX2__)
#  include <immintrin.h>
#endif

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// snapshot — build depth snapshot from live book
// ─────────────────────────────────────────────────────────────────────────────
DepthSnapshot Statistics::snapshot(size_t depth) const noexcept {
    DepthSnapshot snap;
    size_t n = std::min(depth, MAX_DEPTH_LEVELS);

    size_t i = 0;
    for (auto& [price, level] : book_.bids().levels()) {
        if (i >= n) break;
        snap.bid_prices[i] = price;
        snap.bid_qtys[i]   = level.total_qty();
        ++i;
    }
    snap.bid_levels = i;

    i = 0;
    for (auto& [price, level] : book_.asks().levels()) {
        if (i >= n) break;
        snap.ask_prices[i] = price;
        snap.ask_qtys[i]   = level.total_qty();
        ++i;
    }
    snap.ask_levels = i;

    return snap;
}

// ─────────────────────────────────────────────────────────────────────────────
// spread — O(1)
// ─────────────────────────────────────────────────────────────────────────────
std::optional<Price> Statistics::spread() const noexcept {
    auto bid = book_.best_bid();
    auto ask = book_.best_ask();
    if (!bid || !ask) return std::nullopt;
    return *ask - *bid;
}

// ─────────────────────────────────────────────────────────────────────────────
// mid_price — O(1)
// ─────────────────────────────────────────────────────────────────────────────
std::optional<Price> Statistics::mid_price() const noexcept {
    auto bid = book_.best_bid();
    auto ask = book_.best_ask();
    if (!bid || !ask) return std::nullopt;
    return (*bid + *ask) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMD: sum_qty_avx2
// Sums an array of Qty (uint64_t) values using AVX2 256-bit vectors.
// Processes 4 uint64_t per cycle.
// ─────────────────────────────────────────────────────────────────────────────
uint64_t Statistics::sum_qty_avx2(const Qty* data, size_t n) noexcept {
#if defined(__AVX2__)
    __m256i acc = _mm256_setzero_si256();
    size_t i = 0;

    // Process 4 uint64 at a time (256 / 64 = 4)
    for (; i + 4 <= n; i += 4) {
        __m256i v = _mm256_loadu_si256(
            reinterpret_cast<const __m256i*>(data + i));
        acc = _mm256_add_epi64(acc, v);
    }

    // Horizontal sum of acc (4 × uint64 → scalar)
    uint64_t result = 0;
    alignas(32) uint64_t tmp[4];
    _mm256_store_si256(reinterpret_cast<__m256i*>(tmp), acc);
    result = tmp[0] + tmp[1] + tmp[2] + tmp[3];

    // Scalar tail
    for (; i < n; ++i) result += data[i];
    return result;
#else
    uint64_t result = 0;
    for (size_t i = 0; i < n; ++i) result += data[i];
    return result;
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMD: dot_price_qty_avx2
// Computes Σ(price[i] × qty[i]) as a double (to avoid int64 overflow on
// very large books). Uses AVX2 64-bit multiply via manual widening.
// ─────────────────────────────────────────────────────────────────────────────
double Statistics::dot_price_qty_avx2(
    const Price* prices, const Qty* qtys, size_t n) noexcept
{
    // Note: AVX2 lacks native 64-bit multiply (_mm256_mullo_epi64 needs AVX512).
    // We convert to double for the dot product — sufficient for depth VWAP
    // (prices and qtys at depth level, not per-fill).
#if defined(__AVX2__)
    __m256d acc = _mm256_setzero_pd();
    size_t i = 0;

    for (; i + 4 <= n; i += 4) {
        // Load 4 int64 prices and 4 uint64 qtys, convert to double
        __m256i vp_i = _mm256_loadu_si256(
            reinterpret_cast<const __m256i*>(prices + i));
        __m256i vq_i = _mm256_loadu_si256(
            reinterpret_cast<const __m256i*>(qtys + i));

        // Convert int64 → double (requires custom approach for AVX2)
        alignas(32) int64_t  p_tmp[4];
        alignas(32) uint64_t q_tmp[4];
        _mm256_store_si256(reinterpret_cast<__m256i*>(p_tmp), vp_i);
        _mm256_store_si256(reinterpret_cast<__m256i*>(q_tmp), vq_i);

        __m256d vp = _mm256_set_pd(
            static_cast<double>(p_tmp[3]), static_cast<double>(p_tmp[2]),
            static_cast<double>(p_tmp[1]), static_cast<double>(p_tmp[0]));
        __m256d vq = _mm256_set_pd(
            static_cast<double>(q_tmp[3]), static_cast<double>(q_tmp[2]),
            static_cast<double>(q_tmp[1]), static_cast<double>(q_tmp[0]));

        acc = _mm256_fmadd_pd(vp, vq, acc);
    }

    // Horizontal sum
    alignas(32) double tmp[4];
    _mm256_store_pd(tmp, acc);
    double result = tmp[0] + tmp[1] + tmp[2] + tmp[3];

    // Scalar tail
    for (; i < n; ++i) {
        result += static_cast<double>(prices[i]) * static_cast<double>(qtys[i]);
    }
    return result;
#else
    double result = 0.0;
    for (size_t i = 0; i < n; ++i) {
        result += static_cast<double>(prices[i]) * static_cast<double>(qtys[i]);
    }
    return result;
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
// order_imbalance
// OI = (Σ bid_qty - Σ ask_qty) / (Σ bid_qty + Σ ask_qty)   ∈ [-1, 1]
// ─────────────────────────────────────────────────────────────────────────────
double Statistics::order_imbalance(size_t depth) const noexcept {
    DepthSnapshot snap = snapshot(depth);

    uint64_t total_bid = sum_qty_avx2(snap.bid_qtys.data(), snap.bid_levels);
    uint64_t total_ask = sum_qty_avx2(snap.ask_qtys.data(), snap.ask_levels);

    uint64_t denom = total_bid + total_ask;
    if (denom == 0) return 0.0;

    return (static_cast<double>(total_bid) - static_cast<double>(total_ask)) /
            static_cast<double>(denom);
}

// ─────────────────────────────────────────────────────────────────────────────
// depth_vwap
// ─────────────────────────────────────────────────────────────────────────────
Statistics::DepthVWAP Statistics::depth_vwap(size_t depth) const noexcept {
    DepthSnapshot snap = snapshot(depth);

    double bid_pq  = dot_price_qty_avx2(snap.bid_prices.data(),
                                         snap.bid_qtys.data(),
                                         snap.bid_levels);
    double ask_pq  = dot_price_qty_avx2(snap.ask_prices.data(),
                                         snap.ask_qtys.data(),
                                         snap.ask_levels);

    uint64_t bid_q = sum_qty_avx2(snap.bid_qtys.data(), snap.bid_levels);
    uint64_t ask_q = sum_qty_avx2(snap.ask_qtys.data(), snap.ask_levels);

    double bid_vwap = (bid_q > 0) ? (bid_pq / static_cast<double>(bid_q)) : 0.0;
    double ask_vwap = (ask_q > 0) ? (ask_pq / static_cast<double>(ask_q)) : 0.0;
    double mid_vwap = ((bid_q + ask_q) > 0)
        ? ((bid_pq + ask_pq) / static_cast<double>(bid_q + ask_q))
        : 0.0;

    return {bid_vwap, ask_vwap, mid_vwap};
}

// ─────────────────────────────────────────────────────────────────────────────
// queue_position — O(k) walk through price level
// ─────────────────────────────────────────────────────────────────────────────
std::optional<size_t> Statistics::queue_position(OrderId order_id) const noexcept {
    Order* target = book_.find(order_id);
    if (!target || target->status == OrderStatus::PendingActivation) {
        return std::nullopt;
    }

    size_t pos = 0;
    Order* p = target->prev;
    while (p) {
        ++pos;
        p = p->prev;
    }
    return pos;
}

// ─────────────────────────────────────────────────────────────────────────────
// qty_ahead — total qty of orders ahead in queue
// ─────────────────────────────────────────────────────────────────────────────
std::optional<Qty> Statistics::qty_ahead(OrderId order_id) const noexcept {
    Order* target = book_.find(order_id);
    if (!target || target->status == OrderStatus::PendingActivation) {
        return std::nullopt;
    }

    Qty ahead = 0;
    Order* p = target->prev;
    while (p) {
        ahead += p->leaves_qty;
        p = p->prev;
    }
    return ahead;
}

} // namespace ultralob
