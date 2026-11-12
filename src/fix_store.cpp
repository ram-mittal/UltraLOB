#include "ultralob/fix/fix_store.hpp"
#include <cstring>
#include <filesystem>
#include <stdexcept>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <sys/stat.h>
#endif

namespace ultralob::fix {

static constexpr uint32_t FIXSTORE_MAGIC   = 0x46585354;  // 'FXST'
static constexpr uint32_t FIXSTORE_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Construction / Destruction
// ─────────────────────────────────────────────────────────────────────────────

FixStore::FixStore(const std::string& filepath, uint64_t max_size)
    : filepath_(filepath), max_size_(max_size) {
    // Ensure we have enough space for header + indices + some data
    uint64_t min_size = DATA_REGION_OFFSET + 4096;
    if (max_size_ < min_size) max_size_ = min_size;
    open_or_create();
}

FixStore::~FixStore() {
    close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Store a message
// ─────────────────────────────────────────────────────────────────────────────

bool FixStore::store(uint64_t seq, const char* data, size_t len,
                     StoreDirection dir) noexcept {
    if (!mapped_base_ || !data || len == 0) return false;
    if (seq == 0 || seq >= MAX_STORED_SEQUENCES) return false;

    // Check if we have room in the data region
    uint64_t entry_size = sizeof(FixStoreEntry) + len;
    uint64_t write_pos = DATA_REGION_OFFSET + header_->data_offset;
    if (write_pos + entry_size > max_size_) return false;

    // Write the entry header
    auto* entry = reinterpret_cast<FixStoreEntry*>(
        static_cast<uint8_t*>(mapped_base_) + write_pos);
    entry->sequence  = seq;
    entry->length    = static_cast<uint32_t>(len);
    entry->direction = static_cast<uint8_t>(dir);
    std::memset(entry->reserved, 0, sizeof(entry->reserved));

    // Write the message data
    std::memcpy(
        static_cast<uint8_t*>(mapped_base_) + write_pos + sizeof(FixStoreEntry),
        data, len);

    // Update the index
    FixStoreIndex* idx = (dir == StoreDirection::Outbound)
        ? outbound_index() : inbound_index();
    idx[seq].offset = header_->data_offset;
    idx[seq].length = static_cast<uint32_t>(len);

    // Advance data offset and message count
    header_->data_offset += entry_size;
    header_->msg_count++;

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieve a message
// ─────────────────────────────────────────────────────────────────────────────

std::string_view FixStore::retrieve(uint64_t seq, StoreDirection dir) const noexcept {
    if (!mapped_base_ || seq == 0 || seq >= MAX_STORED_SEQUENCES) return {};

    const FixStoreIndex* idx = (dir == StoreDirection::Outbound)
        ? outbound_index() : inbound_index();

    if (idx[seq].length == 0) return {};  // Not stored

    uint64_t abs_offset = DATA_REGION_OFFSET + idx[seq].offset + sizeof(FixStoreEntry);
    if (abs_offset + idx[seq].length > max_size_) return {};

    return std::string_view(
        reinterpret_cast<const char*>(
            static_cast<const uint8_t*>(mapped_base_) + abs_offset),
        idx[seq].length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequence Number Persistence
// ─────────────────────────────────────────────────────────────────────────────

void FixStore::set_sender_seq(uint64_t seq) noexcept {
    if (header_) header_->next_sender_seq = seq;
}

void FixStore::set_target_seq(uint64_t seq) noexcept {
    if (header_) header_->next_target_seq = seq;
}

uint64_t FixStore::get_sender_seq() const noexcept {
    return header_ ? header_->next_sender_seq : 1;
}

uint64_t FixStore::get_target_seq() const noexcept {
    return header_ ? header_->next_target_seq : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Identity
// ─────────────────────────────────────────────────────────────────────────────

void FixStore::set_session_ids(std::string_view sender, std::string_view target) noexcept {
    if (!header_) return;
    auto sn = (sender.size() < 31) ? sender.size() : 31;
    auto tn = (target.size() < 31) ? target.size() : 31;
    std::memcpy(header_->sender_comp_id, sender.data(), sn);
    header_->sender_comp_id[sn] = '\0';
    std::memcpy(header_->target_comp_id, target.data(), tn);
    header_->target_comp_id[tn] = '\0';
}

std::string_view FixStore::get_sender_id() const noexcept {
    if (!header_) return {};
    return header_->sender_comp_id;
}

std::string_view FixStore::get_target_id() const noexcept {
    if (!header_) return {};
    return header_->target_comp_id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

uint64_t FixStore::message_count() const noexcept {
    return header_ ? header_->msg_count : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flush
// ─────────────────────────────────────────────────────────────────────────────

void FixStore::flush() noexcept {
    if (!mapped_base_) return;
#ifdef _WIN32
    FlushViewOfFile(mapped_base_, 0);
    if (file_handle_ && file_handle_ != INVALID_HANDLE_VALUE)
        FlushFileBuffers(file_handle_);
#else
    msync(mapped_base_, max_size_, MS_SYNC);
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset Store
// ─────────────────────────────────────────────────────────────────────────────

void FixStore::reset_store() noexcept {
    if (!mapped_base_) return;

    // Zero out everything after the magic/version
    header_->next_sender_seq = 1;
    header_->next_target_seq = 1;
    header_->msg_count       = 0;
    header_->data_offset     = 0;

    // Zero the index regions
    std::memset(outbound_index(), 0, OUTBOUND_INDEX_SIZE);
    std::memset(inbound_index(),  0, INBOUND_INDEX_SIZE);
}

// ─────────────────────────────────────────────────────────────────────────────
// Index/Data Region Accessors
// ─────────────────────────────────────────────────────────────────────────────

FixStoreIndex* FixStore::outbound_index() noexcept {
    return reinterpret_cast<FixStoreIndex*>(
        static_cast<uint8_t*>(mapped_base_) + INDEX_REGION_OFFSET);
}

FixStoreIndex* FixStore::inbound_index() noexcept {
    return reinterpret_cast<FixStoreIndex*>(
        static_cast<uint8_t*>(mapped_base_) + INBOUND_INDEX_OFFSET);
}

const FixStoreIndex* FixStore::outbound_index() const noexcept {
    return reinterpret_cast<const FixStoreIndex*>(
        static_cast<const uint8_t*>(mapped_base_) + INDEX_REGION_OFFSET);
}

const FixStoreIndex* FixStore::inbound_index() const noexcept {
    return reinterpret_cast<const FixStoreIndex*>(
        static_cast<const uint8_t*>(mapped_base_) + INBOUND_INDEX_OFFSET);
}

uint8_t* FixStore::data_region() noexcept {
    return static_cast<uint8_t*>(mapped_base_) + DATA_REGION_OFFSET;
}

const uint8_t* FixStore::data_region() const noexcept {
    return static_cast<const uint8_t*>(mapped_base_) + DATA_REGION_OFFSET;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform-Specific File Mapping
// ─────────────────────────────────────────────────────────────────────────────

void FixStore::open_or_create() {
    bool is_new = !std::filesystem::exists(filepath_);

#ifdef _WIN32
    file_handle_ = CreateFileA(
        filepath_.c_str(),
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ,
        NULL,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL);

    if (file_handle_ == INVALID_HANDLE_VALUE) {
        throw std::runtime_error("FixStore: Failed to open file: " + filepath_);
    }

    // Set file size
    LARGE_INTEGER li;
    if (GetFileSizeEx(file_handle_, &li)) {
        if (static_cast<uint64_t>(li.QuadPart) < max_size_) {
            li.QuadPart = static_cast<LONGLONG>(max_size_);
            SetFilePointerEx(file_handle_, li, NULL, FILE_BEGIN);
            SetEndOfFile(file_handle_);
        }
    }

    mapping_handle_ = CreateFileMappingA(
        file_handle_, NULL, PAGE_READWRITE,
        static_cast<DWORD>(max_size_ >> 32),
        static_cast<DWORD>(max_size_ & 0xFFFFFFFF),
        NULL);

    if (mapping_handle_ == NULL) {
        CloseHandle(file_handle_);
        throw std::runtime_error("FixStore: Failed to create file mapping");
    }

    mapped_base_ = MapViewOfFile(
        mapping_handle_, FILE_MAP_ALL_ACCESS,
        0, 0, max_size_);

    if (mapped_base_ == NULL) {
        CloseHandle(mapping_handle_);
        CloseHandle(file_handle_);
        throw std::runtime_error("FixStore: Failed to map view of file");
    }
#else
    fd_ = open(filepath_.c_str(), O_RDWR | O_CREAT, 0666);
    if (fd_ == -1) {
        throw std::runtime_error("FixStore: Failed to open file: " + filepath_);
    }

    struct stat st;
    fstat(fd_, &st);
    if (static_cast<uint64_t>(st.st_size) < max_size_) {
        ftruncate(fd_, static_cast<off_t>(max_size_));
    }

    mapped_base_ = mmap(NULL, max_size_, PROT_READ | PROT_WRITE, MAP_SHARED, fd_, 0);
    if (mapped_base_ == MAP_FAILED) {
        ::close(fd_);
        mapped_base_ = nullptr;
        throw std::runtime_error("FixStore: Failed to mmap file");
    }
#endif

    header_ = reinterpret_cast<FixStoreHeader*>(mapped_base_);

    if (is_new || header_->magic != FIXSTORE_MAGIC) {
        // Initialize fresh store
        std::memset(mapped_base_, 0, DATA_REGION_OFFSET);  // zero header + indices
        header_->magic           = FIXSTORE_MAGIC;
        header_->version         = FIXSTORE_VERSION;
        header_->next_sender_seq = 1;
        header_->next_target_seq = 1;
        header_->msg_count       = 0;
        header_->data_offset     = 0;
    }
}

void FixStore::close() {
    if (mapped_base_) {
#ifdef _WIN32
        UnmapViewOfFile(mapped_base_);
        if (mapping_handle_) CloseHandle(mapping_handle_);
        if (file_handle_ && file_handle_ != INVALID_HANDLE_VALUE) CloseHandle(file_handle_);
        mapping_handle_ = nullptr;
        file_handle_    = nullptr;
#else
        munmap(mapped_base_, max_size_);
        if (fd_ != -1) ::close(fd_);
        fd_ = -1;
#endif
        mapped_base_ = nullptr;
        header_      = nullptr;
    }
}

} // namespace ultralob::fix

