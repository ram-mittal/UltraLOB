#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// Pre-Allocated FIX Message Builder / Serializer
//
// Writes body fields into a staging buffer, then finalize() prepends the
// header (8=, 9=) and appends the trailer (10=).  Zero heap allocation —
// call reset() to reuse for the next message.
// ─────────────────────────────────────────────────────────────────────────────

#include "fix_types.hpp"
#include <array>
#include <cstdint>
#include <string_view>

namespace ultralob::fix {

class FixBuilder {
public:
    FixBuilder() noexcept { reset(); }

    // Reset for reuse (zero-allocation cycle)
    void reset() noexcept;

    // Set standard header body fields (35, 49, 56, 34, 52)
    void set_msg_type(std::string_view type) noexcept;
    void set_sender_comp_id(std::string_view id) noexcept;
    void set_target_comp_id(std::string_view id) noexcept;
    void set_msg_seq_num(uint64_t seq) noexcept;
    void set_sending_time(std::string_view time) noexcept;

    // Append arbitrary body fields
    void set_string(uint32_t tag, std::string_view value) noexcept;
    void set_int(uint32_t tag, int64_t value) noexcept;
    void set_char(uint32_t tag, char value) noexcept;
    void set_double(uint32_t tag, double value, int precision = 2) noexcept;

    // Finalize: calculates BodyLength and CheckSum, returns view of the
    // complete message.  Valid until the next reset() or finalize() call.
    [[nodiscard]] std::string_view finalize() noexcept;

    [[nodiscard]] size_t      size() const noexcept { return out_len_; }
    [[nodiscard]] const char* data() const noexcept { return out_buf_.data(); }

private:
    // Body staging area (body fields written here before finalize)
    std::array<char, MAX_FIX_MSG_SIZE> body_buf_{};
    size_t body_len_ = 0;

    // Output buffer (header + body + trailer)
    std::array<char, MAX_FIX_MSG_SIZE + MAX_HEADER_SIZE + 16> out_buf_{};
    size_t out_len_ = 0;

    // Append "tag=value\x01" to body buffer
    void append_field(uint32_t tag, std::string_view value) noexcept;

    // Fast number-to-string (no allocation, no locale)
    static size_t utoa(uint64_t value, char* buf) noexcept;
    static size_t itoa(int64_t value, char* buf) noexcept;
    static size_t dtoa(double value, int precision, char* buf) noexcept;
    static void   format_checksum(uint8_t cs, char* buf) noexcept;
};

} // namespace ultralob::fix

