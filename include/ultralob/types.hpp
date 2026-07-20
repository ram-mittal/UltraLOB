#pragma once

// ─────────────────────────────────────────────────────────────────────────────
// UltraLOB — Core Types
//
// Fixed-point price representation: int64_t with PRICE_SCALE implied decimals.
// Example: $1.23 → 123_000_000 (8 decimal places)
// This eliminates all floating-point comparison hazards on the hot path.
// ─────────────────────────────────────────────────────────────────────────────

#include <cstdint>
#include <cstddef>
#include <limits>
#include <functional>
#include <string_view>

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// Primitive aliases
// ─────────────────────────────────────────────────────────────────────────────

/// Fixed-point price: int64 with 8 implied decimal places.
using Price    = int64_t;
using Qty      = uint64_t;
using OrderId  = uint64_t;
using Symbol   = uint32_t;   // instrument identifier
using Nanos    = int64_t;    // nanoseconds since epoch

/// Price scale: 10^8 (100_000_000 units per dollar)
inline constexpr Price PRICE_SCALE  = 100'000'000LL;
inline constexpr Price PRICE_MAX    = std::numeric_limits<Price>::max();
inline constexpr Price PRICE_MIN    = std::numeric_limits<Price>::min();
inline constexpr Price PRICE_NONE   = 0;

inline constexpr OrderId INVALID_ORDER_ID = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations
// ─────────────────────────────────────────────────────────────────────────────

enum class Side : uint8_t {
    Buy  = 0,
    Sell = 1,
};

[[nodiscard]] inline constexpr Side opposite(Side s) noexcept {
    return (s == Side::Buy) ? Side::Sell : Side::Buy;
}

[[nodiscard]] inline constexpr std::string_view to_string(Side s) noexcept {
    return (s == Side::Buy) ? "Buy" : "Sell";
}

// ─────────────────────────────────────────────────────────────────────────────

enum class OrderType : uint8_t {
    Market    = 0,
    Limit     = 1,
    Stop      = 2,
    StopLimit = 3,
    IOC       = 4,   // Immediate-Or-Cancel
    FOK       = 5,   // Fill-Or-Kill
    GTC       = 6,   // Good-Till-Cancelled (alias for Limit persisting across sessions)
};

[[nodiscard]] inline constexpr std::string_view to_string(OrderType t) noexcept {
    switch (t) {
        case OrderType::Market:    return "Market";
        case OrderType::Limit:     return "Limit";
        case OrderType::Stop:      return "Stop";
        case OrderType::StopLimit: return "StopLimit";
        case OrderType::IOC:       return "IOC";
        case OrderType::FOK:       return "FOK";
        case OrderType::GTC:       return "GTC";
    }
    return "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────

enum class OrderStatus : uint8_t {
    New              = 0,
    PartiallyFilled  = 1,
    Filled           = 2,
    Cancelled        = 3,
    Rejected         = 4,
    PendingActivation = 5,  // Stop/StopLimit waiting for trigger
};

[[nodiscard]] inline constexpr std::string_view to_string(OrderStatus s) noexcept {
    switch (s) {
        case OrderStatus::New:               return "New";
        case OrderStatus::PartiallyFilled:   return "PartiallyFilled";
        case OrderStatus::Filled:            return "Filled";
        case OrderStatus::Cancelled:         return "Cancelled";
        case OrderStatus::Rejected:          return "Rejected";
        case OrderStatus::PendingActivation: return "PendingActivation";
    }
    return "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Report
// Emitted on every fill (partial or full) and on cancels/rejects.
// ─────────────────────────────────────────────────────────────────────────────

struct ExecutionReport {
    OrderId     order_id;
    OrderId     contra_order_id;  // the order on the other side
    uint32_t    client_id;        // client who owns this order
    Symbol      symbol;
    Side        side;
    OrderType   order_type;
    OrderStatus status;
    Price       exec_price;       // price at which fill occurred
    Qty         exec_qty;         // qty filled in this report
    Qty         leaves_qty;       // remaining unfilled qty
    Qty         cum_qty;          // total filled so far
    Nanos       timestamp;        // nanoseconds since epoch

    [[nodiscard]] bool is_fill() const noexcept {
        return status == OrderStatus::PartiallyFilled ||
               status == OrderStatus::Filled;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Callback types — zero-overhead std::function alternatives using raw fn ptr
// ─────────────────────────────────────────────────────────────────────────────

using ExecCallback = void(*)(const ExecutionReport&, void* ctx);

// ─────────────────────────────────────────────────────────────────────────────
// Price helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Convert a double price to fixed-point (for convenience at boundaries only)
[[nodiscard]] inline constexpr Price from_double(double d) noexcept {
    return static_cast<Price>(d * PRICE_SCALE + 0.5);
}

/// Convert fixed-point price back to double (for display only)
[[nodiscard]] inline constexpr double to_double(Price p) noexcept {
    return static_cast<double>(p) / static_cast<double>(PRICE_SCALE);
}

} // namespace ultralob
