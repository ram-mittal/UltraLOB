#include "ultralob/fix/fix_builder.hpp"
#include <cstring>

namespace ultralob::fix {

void FixBuilder::reset() noexcept {
    body_len_ = 0;
    out_len_  = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard header body fields
// ─────────────────────────────────────────────────────────────────────────────

void FixBuilder::set_msg_type(std::string_view type) noexcept       { append_field(Tag::MsgType, type); }
void FixBuilder::set_sender_comp_id(std::string_view id) noexcept   { append_field(Tag::SenderCompID, id); }
void FixBuilder::set_target_comp_id(std::string_view id) noexcept   { append_field(Tag::TargetCompID, id); }
void FixBuilder::set_sending_time(std::string_view time) noexcept   { append_field(Tag::SendingTime, time); }

void FixBuilder::set_msg_seq_num(uint64_t seq) noexcept {
    char buf[24];
    size_t n = utoa(seq, buf);
    append_field(Tag::MsgSeqNum, std::string_view(buf, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed field setters
// ─────────────────────────────────────────────────────────────────────────────

void FixBuilder::set_string(uint32_t tag, std::string_view value) noexcept {
    append_field(tag, value);
}

void FixBuilder::set_int(uint32_t tag, int64_t value) noexcept {
    char buf[24];
    size_t n = itoa(value, buf);
    append_field(tag, std::string_view(buf, n));
}

void FixBuilder::set_char(uint32_t tag, char value) noexcept {
    append_field(tag, std::string_view(&value, 1));
}

void FixBuilder::set_double(uint32_t tag, double value, int precision) noexcept {
    char buf[32];
    size_t n = dtoa(value, precision, buf);
    append_field(tag, std::string_view(buf, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize() — assemble header + body + trailer
// ─────────────────────────────────────────────────────────────────────────────

std::string_view FixBuilder::finalize() noexcept {
    // ── Header: "8=FIX.4.4\x019=<body_len>\x01" ────────────────────────
    char header[MAX_HEADER_SIZE];
    size_t hdr_len = 0;

    std::memcpy(header, "8=FIX.4.4\x01", 10);
    hdr_len = 10;

    header[hdr_len++] = '9';
    header[hdr_len++] = '=';
    char len_buf[12];
    size_t len_digits = utoa(body_len_, len_buf);
    std::memcpy(header + hdr_len, len_buf, len_digits);
    hdr_len += len_digits;
    header[hdr_len++] = SOH;

    // ── Assemble into output buffer ─────────────────────────────────────
    std::memcpy(out_buf_.data(), header, hdr_len);
    std::memcpy(out_buf_.data() + hdr_len, body_buf_.data(), body_len_);
    size_t msg_len = hdr_len + body_len_;

    // ── Trailer: "10=XXX\x01" ───────────────────────────────────────────
    uint8_t cs = fix_checksum(out_buf_.data(), msg_len);
    out_buf_[msg_len++] = '1';
    out_buf_[msg_len++] = '0';
    out_buf_[msg_len++] = '=';
    format_checksum(cs, out_buf_.data() + msg_len);
    msg_len += 3;
    out_buf_[msg_len++] = SOH;

    out_len_ = msg_len;
    return std::string_view(out_buf_.data(), out_len_);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

void FixBuilder::append_field(uint32_t tag, std::string_view value) noexcept {
    char tag_buf[12];
    size_t tag_len = utoa(tag, tag_buf);

    size_t field_len = tag_len + 1 + value.size() + 1;   // "tag=value\x01"
    if (body_len_ + field_len > body_buf_.size()) return; // overflow guard

    char* dst = body_buf_.data() + body_len_;
    std::memcpy(dst, tag_buf, tag_len);  dst += tag_len;
    *dst++ = '=';
    std::memcpy(dst, value.data(), value.size());  dst += value.size();
    *dst++ = SOH;
    body_len_ += field_len;
}

size_t FixBuilder::utoa(uint64_t value, char* buf) noexcept {
    if (value == 0) { buf[0] = '0'; return 1; }

    char tmp[24];
    size_t len = 0;
    while (value > 0) {
        tmp[len++] = '0' + static_cast<char>(value % 10);
        value /= 10;
    }
    for (size_t i = 0; i < len; ++i)
        buf[i] = tmp[len - 1 - i];
    return len;
}

size_t FixBuilder::itoa(int64_t value, char* buf) noexcept {
    if (value < 0) {
        buf[0] = '-';
        return 1 + utoa(static_cast<uint64_t>(-value), buf + 1);
    }
    return utoa(static_cast<uint64_t>(value), buf);
}

size_t FixBuilder::dtoa(double value, int precision, char* buf) noexcept {
    if (value < 0.0) {
        buf[0] = '-';
        return 1 + dtoa(-value, precision, buf + 1);
    }

    // Round to the requested precision to avoid truncation artifacts
    double rounding = 0.5;
    for (int i = 0; i < precision; ++i) rounding *= 0.1;
    value += rounding;

    auto int_part = static_cast<uint64_t>(value);
    size_t len = utoa(int_part, buf);

    buf[len++] = '.';
    double frac = value - static_cast<double>(int_part);
    for (int i = 0; i < precision; ++i) {
        frac *= 10.0;
        int digit = static_cast<int>(frac);
        buf[len++] = '0' + static_cast<char>(digit);
        frac -= digit;
    }
    return len;
}

void FixBuilder::format_checksum(uint8_t cs, char* buf) noexcept {
    buf[0] = '0' + static_cast<char>((cs / 100) % 10);
    buf[1] = '0' + static_cast<char>((cs / 10) % 10);
    buf[2] = '0' + static_cast<char>(cs % 10);
}

} // namespace ultralob::fix

