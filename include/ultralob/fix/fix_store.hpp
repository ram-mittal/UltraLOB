#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// FIX Message Store — Memory-Mapped Append-Only Log
//
// Stores outbound and inbound FIX messages indexed by sequence number for:
//   1. Gap-fill / ResendRequest handling (replay stored outbound messages)
//   2. Crash recovery (restore sequence numbers and replay on restart)
//
// Follows the existing Journal pattern: memory-mapped file with a fixed header
// and variable-length message records.  O(1) lookup by sequence number via
// an index array embedded in the mapped region.
//
// Zero allocation on the hot path — all writes go directly to the mmap region.
// ─────────────────────────────────────────────────────────────────────────────

#include "fix_types.hpp"
#include <cstdint>
#include <string>
#include <string_view>

namespace ultralob::fix {

// ─────────────────────────────────────────────────────────────────────────────
// On-disk layout
// ─────────────────────────────────────────────────────────────────────────────

#pragma pack(push, 1)

struct FixStoreHeader {
    uint32_t magic;              // 'FXST' = 0x46585354
    uint32_t version;            // 1
    uint64_t next_sender_seq;    // Next outbound MsgSeqNum to use
    uint64_t next_target_seq;    // Next expected inbound MsgSeqNum
    uint64_t msg_count;          // Total messages stored
    uint64_t data_offset;        // Current write position in data region
    char     sender_comp_id[32]; // SenderCompID for this session
    char     target_comp_id[32]; // TargetCompID for this session
    uint8_t  reserved[64];       // Future use
};

// Each stored message has a small header followed by the raw FIX bytes
struct FixStoreEntry {
    uint64_t sequence;           // MsgSeqNum
    uint32_t length;             // Length of the FIX message body
    uint8_t  direction;          // 0 = outbound, 1 = inbound
    uint8_t  reserved[3];
    // Followed by `length` bytes of raw FIX message data
};

#pragma pack(pop)

// ─────────────────────────────────────────────────────────────────────────────
// Index entry — maps sequence number to file offset for O(1) lookup
// ─────────────────────────────────────────────────────────────────────────────

inline constexpr size_t MAX_STORED_SEQUENCES = 1024 * 1024;  // 1M messages

struct FixStoreIndex {
    uint64_t offset;    // Byte offset from data region start (0 = not stored)
    uint32_t length;    // Message length
};

// ─────────────────────────────────────────────────────────────────────────────
// Direction enum
// ─────────────────────────────────────────────────────────────────────────────

enum class StoreDirection : uint8_t {
    Outbound = 0,
    Inbound  = 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// FixStore
// ─────────────────────────────────────────────────────────────────────────────

class FixStore {
public:
    // Default size: 256 MB (header + index + data)
    static constexpr uint64_t DEFAULT_MAX_SIZE = 256ULL * 1024 * 1024;

    // Create or open a message store.
    // filepath: path to the store file
    // max_size: maximum size of the memory-mapped region
    FixStore(const std::string& filepath, uint64_t max_size = DEFAULT_MAX_SIZE);
    ~FixStore();

    FixStore(const FixStore&)            = delete;
    FixStore& operator=(const FixStore&) = delete;

    // ── Store a message ──────────────────────────────────────────────────
    // data/len: the complete serialized FIX message
    // seq: the MsgSeqNum of this message
    // dir: outbound or inbound
    // Returns true on success, false if store is full
    [[nodiscard]] bool store(uint64_t seq, const char* data, size_t len,
                             StoreDirection dir) noexcept;

    // ── Retrieve a message ───────────────────────────────────────────────
    // Returns a view into the mapped region, or empty if not found.
    // The returned view is valid as long as the store is open.
    [[nodiscard]] std::string_view retrieve(uint64_t seq, StoreDirection dir) const noexcept;

    // ── Sequence Number Persistence ──────────────────────────────────────
    void set_sender_seq(uint64_t seq) noexcept;
    void set_target_seq(uint64_t seq) noexcept;
    [[nodiscard]] uint64_t get_sender_seq() const noexcept;
    [[nodiscard]] uint64_t get_target_seq() const noexcept;

    // ── Session Identity ─────────────────────────────────────────────────
    void set_session_ids(std::string_view sender, std::string_view target) noexcept;
    [[nodiscard]] std::string_view get_sender_id() const noexcept;
    [[nodiscard]] std::string_view get_target_id() const noexcept;

    // ── Diagnostics ──────────────────────────────────────────────────────
    [[nodiscard]] uint64_t message_count() const noexcept;
    [[nodiscard]] bool     is_open()       const noexcept { return mapped_base_ != nullptr; }

    // ── Flush & Reset ────────────────────────────────────────────────────
    void flush() noexcept;

    // Reset the store (clear all messages, reset sequences to 1)
    void reset_store() noexcept;

private:
    void open_or_create();
    void close();

    // Compute the start of the index region (after header)
    FixStoreIndex* outbound_index() noexcept;
    FixStoreIndex* inbound_index()  noexcept;
    const FixStoreIndex* outbound_index() const noexcept;
    const FixStoreIndex* inbound_index()  const noexcept;

    // Compute the start of the data region (after header + indices)
    uint8_t* data_region() noexcept;
    const uint8_t* data_region() const noexcept;

    std::string filepath_;
    uint64_t    max_size_;

    void*            mapped_base_ = nullptr;
    FixStoreHeader*  header_      = nullptr;

    // Platform-specific handles
#ifdef _WIN32
    void* file_handle_    = nullptr;
    void* mapping_handle_ = nullptr;
#else
    int fd_ = -1;
#endif

    // Computed region offsets
    static constexpr uint64_t INDEX_REGION_OFFSET = sizeof(FixStoreHeader);
    static constexpr uint64_t OUTBOUND_INDEX_SIZE = MAX_STORED_SEQUENCES * sizeof(FixStoreIndex);
    static constexpr uint64_t INBOUND_INDEX_OFFSET = INDEX_REGION_OFFSET + OUTBOUND_INDEX_SIZE;
    static constexpr uint64_t INBOUND_INDEX_SIZE   = MAX_STORED_SEQUENCES * sizeof(FixStoreIndex);
    static constexpr uint64_t DATA_REGION_OFFSET   = INBOUND_INDEX_OFFSET + INBOUND_INDEX_SIZE;
};

} // namespace ultralob::fix

