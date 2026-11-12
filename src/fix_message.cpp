#include "ultralob/fix/fix_message.hpp"

namespace ultralob::fix {

// ─────────────────────────────────────────────────────────────────────────────
// FixMessage
// ─────────────────────────────────────────────────────────────────────────────

void FixMessage::reset() noexcept {
    field_count_ = 0;
    valid_       = false;
    raw_data_    = nullptr;
    raw_len_     = 0;
}

bool FixMessage::parse(const char* data, size_t len) noexcept {
    reset();
    if (!data || len < 20) return false;   // minimum viable message

    raw_data_ = data;
    raw_len_  = len;

    const char* p   = data;
    const char* end = data + len;

    // ── Extract all tag=value\x01 fields ────────────────────────────────
    while (p < end && field_count_ < MAX_FIX_FIELDS) {
        // Parse tag digits
        uint32_t tag = 0;
        while (p < end && *p != '=' && *p != SOH) {
            if (*p < '0' || *p > '9') return false;
            tag = tag * 10 + static_cast<uint32_t>(*p - '0');
            ++p;
        }
        if (p >= end || *p != '=') return false;
        ++p;  // skip '='

        // Parse value bytes until SOH
        const char* val_start = p;
        while (p < end && *p != SOH) ++p;
        if (p >= end) return false;

        fields_[field_count_++] = FixField{
            tag, std::string_view(val_start, static_cast<size_t>(p - val_start))
        };
        ++p;  // skip SOH
    }

    // ── Structural validation ───────────────────────────────────────────
    if (field_count_ < 4) return false;                              // 8, 9, 35, 10 minimum
    if (fields_[0].tag != Tag::BeginString)        return false;
    if (fields_[0].value != FIX_BEGIN_STRING)       return false;
    if (fields_[1].tag != Tag::BodyLength)          return false;
    if (fields_[field_count_ - 1].tag != Tag::CheckSum) return false;

    // ── BodyLength validation ───────────────────────────────────────────
    int64_t expected_body_len = parse_fix_int(fields_[1].value);
    if (expected_body_len < 0) return false;

    // Body starts right after tag 9's SOH delimiter
    const char* body_start = fields_[1].value.data() + fields_[1].value.size() + 1;
    // Body ends just before "10=" (3 chars before tag 10's value)
    const char* cs_tag_start = fields_[field_count_ - 1].value.data() - 3;
    int64_t actual_body_len  = cs_tag_start - body_start;
    if (actual_body_len != expected_body_len) return false;

    // ── CheckSum validation ─────────────────────────────────────────────
    size_t cs_offset  = static_cast<size_t>(cs_tag_start - data);
    uint8_t expected_cs = fix_checksum(data, cs_offset);
    int64_t actual_cs   = parse_fix_int(fields_[field_count_ - 1].value);
    if (actual_cs < 0 || static_cast<uint8_t>(actual_cs) != expected_cs) return false;

    valid_ = true;
    return true;
}

std::string_view FixMessage::get_string(uint32_t tag) const noexcept {
    for (size_t i = 0; i < field_count_; ++i) {
        if (fields_[i].tag == tag) return fields_[i].value;
    }
    return {};
}

std::optional<int64_t> FixMessage::get_int(uint32_t tag) const noexcept {
    auto sv = get_string(tag);
    if (sv.empty()) return std::nullopt;
    return parse_fix_int(sv);
}

std::optional<char> FixMessage::get_char(uint32_t tag) const noexcept {
    auto sv = get_string(tag);
    if (sv.size() != 1) return std::nullopt;
    return sv[0];
}

std::optional<double> FixMessage::get_double(uint32_t tag) const noexcept {
    auto sv = get_string(tag);
    if (sv.empty()) return std::nullopt;
    return parse_fix_double(sv);
}

bool FixMessage::has_tag(uint32_t tag) const noexcept {
    for (size_t i = 0; i < field_count_; ++i) {
        if (fields_[i].tag == tag) return true;
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fast hand-written parsers — no strtol, no locale, no allocation
// ─────────────────────────────────────────────────────────────────────────────

int64_t parse_fix_int(std::string_view sv) noexcept {
    if (sv.empty()) return 0;

    bool negative = false;
    size_t i = 0;
    if (sv[0] == '-') { negative = true; i = 1; }

    int64_t result = 0;
    for (; i < sv.size(); ++i) {
        char c = sv[i];
        if (c < '0' || c > '9') break;
        result = result * 10 + (c - '0');
    }
    return negative ? -result : result;
}

double parse_fix_double(std::string_view sv) noexcept {
    if (sv.empty()) return 0.0;

    bool negative = false;
    size_t i = 0;
    if (sv[0] == '-') { negative = true; i = 1; }

    double integer_part = 0.0;
    for (; i < sv.size() && sv[i] != '.'; ++i)
        integer_part = integer_part * 10.0 + (sv[i] - '0');

    double frac_part = 0.0;
    if (i < sv.size() && sv[i] == '.') {
        ++i;
        double place = 0.1;
        for (; i < sv.size(); ++i) {
            frac_part += (sv[i] - '0') * place;
            place *= 0.1;
        }
    }

    double result = integer_part + frac_part;
    return negative ? -result : result;
}

} // namespace ultralob::fix

