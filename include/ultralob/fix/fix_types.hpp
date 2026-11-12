#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// FIX 4.4 Protocol Constants, Tag Numbers, and Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

#include <cstdint>
#include <string_view>

namespace ultralob::fix {

// ─────────────────────────────────────────────────────────────────────────────
// Protocol Constants
// ─────────────────────────────────────────────────────────────────────────────

inline constexpr std::string_view FIX_BEGIN_STRING = "FIX.4.4";
inline constexpr char SOH = '\x01';

// Buffer sizing — matches UltraLOB's pre-allocation philosophy
inline constexpr size_t MAX_FIX_FIELDS   = 128;
inline constexpr size_t MAX_FIX_MSG_SIZE = 4096;
inline constexpr size_t MAX_HEADER_SIZE  = 32;  // "8=FIX.4.4\x019=XXXXX\x01"

// ─────────────────────────────────────────────────────────────────────────────
// FIX Tag Numbers
// ─────────────────────────────────────────────────────────────────────────────

namespace Tag {
    // Header / Trailer
    inline constexpr uint32_t BeginString     = 8;
    inline constexpr uint32_t BodyLength      = 9;
    inline constexpr uint32_t CheckSum        = 10;
    inline constexpr uint32_t MsgSeqNum       = 34;
    inline constexpr uint32_t MsgType         = 35;
    inline constexpr uint32_t SenderCompID    = 49;
    inline constexpr uint32_t SendingTime     = 52;
    inline constexpr uint32_t TargetCompID    = 56;

    // Session
    inline constexpr uint32_t BeginSeqNo      = 7;
    inline constexpr uint32_t EndSeqNo        = 16;
    inline constexpr uint32_t NewSeqNo        = 36;
    inline constexpr uint32_t PossDupFlag     = 43;
    inline constexpr uint32_t EncryptMethod   = 98;
    inline constexpr uint32_t HeartBtInt      = 108;
    inline constexpr uint32_t TestReqID       = 112;
    inline constexpr uint32_t GapFillFlag     = 123;
    inline constexpr uint32_t Text            = 58;

    // Order Entry
    inline constexpr uint32_t Account         = 1;
    inline constexpr uint32_t AvgPx           = 6;
    inline constexpr uint32_t ClOrdID         = 11;
    inline constexpr uint32_t CumQty          = 14;
    inline constexpr uint32_t ExecID          = 17;
    inline constexpr uint32_t LastPx          = 31;
    inline constexpr uint32_t LastQty         = 32;
    inline constexpr uint32_t OrderID         = 37;
    inline constexpr uint32_t OrderQty        = 38;
    inline constexpr uint32_t OrdStatus       = 39;
    inline constexpr uint32_t OrdType         = 40;
    inline constexpr uint32_t OrigClOrdID     = 41;
    inline constexpr uint32_t Price           = 44;
    inline constexpr uint32_t Side            = 54;
    inline constexpr uint32_t Symbol          = 55;
    inline constexpr uint32_t TimeInForce     = 59;
    inline constexpr uint32_t TransactTime    = 60;
    inline constexpr uint32_t CxlRejReason    = 102;
    inline constexpr uint32_t ExecType        = 150;
    inline constexpr uint32_t LeavesQty       = 151;
    inline constexpr uint32_t CxlRejResponseTo = 434;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX Message Type Values (tag 35)
// ─────────────────────────────────────────────────────────────────────────────

namespace MsgType {
    inline constexpr std::string_view Heartbeat                  = "0";
    inline constexpr std::string_view TestRequest                = "1";
    inline constexpr std::string_view ResendRequest              = "2";
    inline constexpr std::string_view Reject                     = "3";
    inline constexpr std::string_view SequenceReset              = "4";
    inline constexpr std::string_view Logout                     = "5";
    inline constexpr std::string_view Logon                      = "A";
    inline constexpr std::string_view NewOrderSingle             = "D";
    inline constexpr std::string_view OrderCancelRequest         = "F";
    inline constexpr std::string_view OrderCancelReplaceRequest  = "G";
    inline constexpr std::string_view ExecutionReport            = "8";
    inline constexpr std::string_view OrderCancelReject          = "9";
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX Field Value Constants
// ─────────────────────────────────────────────────────────────────────────────

namespace FixSide {
    inline constexpr char Buy  = '1';
    inline constexpr char Sell = '2';
}

namespace FixOrdType {
    inline constexpr char Market    = '1';
    inline constexpr char Limit     = '2';
    inline constexpr char Stop      = '3';
    inline constexpr char StopLimit = '4';
}

namespace FixTimeInForce {
    inline constexpr char Day = '0';
    inline constexpr char GTC = '1';
    inline constexpr char IOC = '3';
    inline constexpr char FOK = '4';
}

namespace FixExecType {
    inline constexpr char New         = '0';
    inline constexpr char PartialFill = '1';
    inline constexpr char Fill        = '2';
    inline constexpr char Cancelled   = '4';
    inline constexpr char Rejected    = '8';
}

namespace FixOrdStatus {
    inline constexpr char New             = '0';
    inline constexpr char PartiallyFilled = '1';
    inline constexpr char Filled          = '2';
    inline constexpr char Cancelled       = '4';
    inline constexpr char Rejected        = '8';
    inline constexpr char PendingNew      = 'A';
}

// ─────────────────────────────────────────────────────────────────────────────
// Checksum — modulo-256 sum of all bytes
// ─────────────────────────────────────────────────────────────────────────────

inline uint8_t fix_checksum(const char* data, size_t len) noexcept {
    uint32_t sum = 0;
    for (size_t i = 0; i < len; ++i) {
        sum += static_cast<uint8_t>(data[i]);
    }
    return static_cast<uint8_t>(sum & 0xFF);
}

} // namespace ultralob::fix

