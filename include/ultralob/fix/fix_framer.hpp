#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// FIX TCP Stream Framer
//
// Extracts complete FIX messages from a TCP byte stream using a pre-allocated
// 64 KB linear buffer with compaction.  Validates BeginString, BodyLength,
// and CheckSum before yielding a message.
// ─────────────────────────────────────────────────────────────────────────────

#include "fix_types.hpp"
#include <array>
#include <cstdint>

namespace ultralob::fix {

// Result of a frame extraction attempt
enum class FrameResult : uint8_t {
    Complete,      // A complete valid message was extracted
    Incomplete,    // Need more data
    Error          // Framing error (corrupt data, bad checksum)
};

class FixFramer {
public:
    static constexpr size_t RECV_BUF_SIZE = 65536;

    FixFramer() noexcept { reset(); }

    // Feed raw bytes from TCP read.  Returns the number of bytes consumed.
    size_t feed(const char* data, size_t len) noexcept;

    // Try to extract the next complete FIX message.
    // On Complete: msg_data / msg_len point to the message inside the internal
    // buffer.  Valid until the next feed() call.
    [[nodiscard]] FrameResult extract(const char*& msg_data, size_t& msg_len) noexcept;

    // Reset state (e.g., on reconnect)
    void reset() noexcept;

    [[nodiscard]] size_t      buffered()   const noexcept { return write_pos_ - read_pos_; }
    [[nodiscard]] const char* last_error() const noexcept { return error_; }

private:
    std::array<char, RECV_BUF_SIZE> buf_{};
    size_t read_pos_  = 0;
    size_t write_pos_ = 0;
    const char* error_ = nullptr;

    [[nodiscard]] bool find_begin_string(size_t& pos) const noexcept;
    [[nodiscard]] bool parse_body_length(size_t start, size_t& body_len,
                                         size_t& body_start) const noexcept;
    [[nodiscard]] bool validate_checksum(const char* msg, size_t len) const noexcept;
    void compact() noexcept;
};

} // namespace ultralob::fix

