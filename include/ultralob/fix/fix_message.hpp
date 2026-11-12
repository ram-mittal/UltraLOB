#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// Zero-Copy FIX Message Parser
//
// All string_views reference the original raw buffer — caller must keep the
// buffer alive for the lifetime of the parsed message.  No heap allocation.
// ─────────────────────────────────────────────────────────────────────────────

#include "fix_types.hpp"
#include <array>
#include <cstdint>
#include <optional>
#include <string_view>

namespace ultralob::fix {

// A single parsed FIX field — tag number + string_view into the raw buffer
struct FixField {
    uint32_t tag = 0;
    std::string_view value;
};

class FixMessage {
public:
    // Parse a complete FIX message (must include 8=...10=xxx\x01).
    // Returns true on success.  Validates BeginString, BodyLength, CheckSum.
    [[nodiscard]] bool parse(const char* data, size_t len) noexcept;

    // Field lookup — linear scan, cache-friendly for typical 10–30 field messages
    [[nodiscard]] std::string_view get_string(uint32_t tag) const noexcept;
    [[nodiscard]] std::optional<int64_t> get_int(uint32_t tag) const noexcept;
    [[nodiscard]] std::optional<char> get_char(uint32_t tag) const noexcept;
    [[nodiscard]] std::optional<double> get_double(uint32_t tag) const noexcept;
    [[nodiscard]] bool has_tag(uint32_t tag) const noexcept;

    // Convenience accessors
    [[nodiscard]] std::string_view msg_type() const noexcept       { return get_string(Tag::MsgType); }
    [[nodiscard]] std::optional<int64_t> msg_seq_num() const noexcept { return get_int(Tag::MsgSeqNum); }
    [[nodiscard]] std::string_view sender_comp_id() const noexcept { return get_string(Tag::SenderCompID); }
    [[nodiscard]] std::string_view target_comp_id() const noexcept { return get_string(Tag::TargetCompID); }

    // State
    [[nodiscard]] bool   is_valid()    const noexcept { return valid_; }
    [[nodiscard]] size_t field_count() const noexcept { return field_count_; }
    [[nodiscard]] const FixField& field(size_t idx) const noexcept { return fields_[idx]; }
    [[nodiscard]] const char* raw_data() const noexcept { return raw_data_; }
    [[nodiscard]] size_t raw_len()     const noexcept { return raw_len_; }

    // Reset for reuse
    void reset() noexcept;

private:
    std::array<FixField, MAX_FIX_FIELDS> fields_{};
    size_t field_count_ = 0;
    bool valid_          = false;
    const char* raw_data_ = nullptr;
    size_t raw_len_       = 0;
};

// Fast hand-written parsers (no strtol / strtod, no locale, no allocation)
int64_t parse_fix_int(std::string_view sv) noexcept;
double  parse_fix_double(std::string_view sv) noexcept;

} // namespace ultralob::fix

