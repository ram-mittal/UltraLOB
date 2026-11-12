#include "ultralob/fix/fix_framer.hpp"
#include <cstring>
#include <algorithm>

namespace ultralob::fix {

static constexpr char   BEGIN_TAG[]   = "8=FIX.4.4\x01";
static constexpr size_t BEGIN_TAG_LEN = 10;
static constexpr size_t CHECKSUM_FIELD_LEN = 7;   // "10=XXX\x01"

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

void FixFramer::reset() noexcept {
    read_pos_  = 0;
    write_pos_ = 0;
    error_     = nullptr;
}

size_t FixFramer::feed(const char* data, size_t len) noexcept {
    if (write_pos_ + len > RECV_BUF_SIZE)
        compact();

    size_t room    = RECV_BUF_SIZE - write_pos_;
    size_t to_copy = std::min(len, room);
    std::memcpy(buf_.data() + write_pos_, data, to_copy);
    write_pos_ += to_copy;
    return to_copy;
}

FrameResult FixFramer::extract(const char*& msg_data, size_t& msg_len) noexcept {
    error_ = nullptr;

    if (buffered() < BEGIN_TAG_LEN)
        return FrameResult::Incomplete;

    // ── Locate "8=FIX.4.4\x01" ─────────────────────────────────────────
    size_t msg_start = 0;
    if (!find_begin_string(msg_start)) {
        // Skip forward to next '8' to resync
        size_t scan = read_pos_;
        while (scan < write_pos_ && buf_[scan] != '8') ++scan;
        if (scan > read_pos_) read_pos_ = scan;
        return FrameResult::Incomplete;
    }
    if (msg_start > read_pos_)
        read_pos_ = msg_start;

    // ── Parse BodyLength (tag 9) ────────────────────────────────────────
    size_t tag9_start = read_pos_ + BEGIN_TAG_LEN;
    if (tag9_start + 3 > write_pos_)          // need at least "9=X\x01"
        return FrameResult::Incomplete;

    size_t body_len  = 0;
    size_t body_start = 0;
    if (!parse_body_length(tag9_start, body_len, body_start)) {
        // Check if SOH is present — if so, the value is corrupt
        size_t scan = tag9_start;
        while (scan < write_pos_ && buf_[scan] != SOH) ++scan;
        if (scan >= write_pos_) return FrameResult::Incomplete;

        error_ = "invalid BodyLength (tag 9)";
        read_pos_ = scan + 1;
        return FrameResult::Error;
    }

    // ── Check we have the full message ──────────────────────────────────
    size_t msg_end = body_start + body_len + CHECKSUM_FIELD_LEN;
    if (msg_end > write_pos_)
        return FrameResult::Incomplete;

    // ── Validate "10=" at expected offset ───────────────────────────────
    size_t cs_pos = body_start + body_len;
    if (buf_[cs_pos] != '1' || buf_[cs_pos + 1] != '0' || buf_[cs_pos + 2] != '=') {
        error_ = "expected tag 10 (CheckSum) at body end";
        read_pos_ = cs_pos;
        return FrameResult::Error;
    }

    // ── Validate checksum ───────────────────────────────────────────────
    const char* msg_ptr   = buf_.data() + read_pos_;
    size_t      total_len = msg_end - read_pos_;

    if (!validate_checksum(msg_ptr, total_len)) {
        error_ = "checksum mismatch";
        read_pos_ = msg_end;
        return FrameResult::Error;
    }

    // ── Yield the complete message ──────────────────────────────────────
    msg_data  = msg_ptr;
    msg_len   = total_len;
    read_pos_ = msg_end;
    return FrameResult::Complete;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

bool FixFramer::find_begin_string(size_t& pos) const noexcept {
    if (write_pos_ < read_pos_ + BEGIN_TAG_LEN) return false;
    size_t search_end = write_pos_ - BEGIN_TAG_LEN + 1;
    for (size_t i = read_pos_; i < search_end; ++i) {
        if (std::memcmp(buf_.data() + i, BEGIN_TAG, BEGIN_TAG_LEN) == 0) {
            pos = i;
            return true;
        }
    }
    return false;
}

bool FixFramer::parse_body_length(size_t start, size_t& body_len,
                                   size_t& body_start) const noexcept {
    if (start + 2 >= write_pos_) return false;
    if (buf_[start] != '9' || buf_[start + 1] != '=') return false;

    size_t p = start + 2;
    uint64_t val = 0;
    bool has_digits = false;

    while (p < write_pos_ && buf_[p] != SOH) {
        char c = buf_[p];
        if (c < '0' || c > '9') return false;
        val = val * 10 + static_cast<uint64_t>(c - '0');
        has_digits = true;
        ++p;
    }
    if (p >= write_pos_ || !has_digits) return false;

    body_len  = static_cast<size_t>(val);
    body_start = p + 1;   // first byte after tag 9's SOH
    return true;
}

bool FixFramer::validate_checksum(const char* msg, size_t len) const noexcept {
    if (len < CHECKSUM_FIELD_LEN) return false;

    size_t cs_body_len = len - CHECKSUM_FIELD_LEN;
    uint8_t expected   = fix_checksum(msg, cs_body_len);

    const char* cs_val = msg + cs_body_len + 3;   // skip "10="
    uint8_t actual = static_cast<uint8_t>(
        (cs_val[0] - '0') * 100 + (cs_val[1] - '0') * 10 + (cs_val[2] - '0'));
    return expected == actual;
}

void FixFramer::compact() noexcept {
    if (read_pos_ == 0) return;
    size_t remaining = write_pos_ - read_pos_;
    if (remaining > 0)
        std::memmove(buf_.data(), buf_.data() + read_pos_, remaining);
    write_pos_ = remaining;
    read_pos_  = 0;
}

} // namespace ultralob::fix

