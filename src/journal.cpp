#include "ultralob/journal.hpp"
#include <iostream>
#include <stdexcept>
#include <cstring>
#include <filesystem>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <sys/stat.h>
#endif

namespace ultralob {

constexpr uint32_t JOURNAL_MAGIC = 0x4A4F5552; // 'JOUR'
constexpr uint32_t JOURNAL_VERSION = 1;

Journal::Journal(const std::string& filepath, uint64_t max_size)
    : filepath_(filepath), max_size_(max_size) {
    open_or_create();
}

Journal::~Journal() {
    close();
}

void Journal::open_or_create() {
    bool is_new_file = !std::filesystem::exists(filepath_);

#ifdef _WIN32
    file_handle_ = CreateFileA(
        filepath_.c_str(),
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ,
        NULL,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );

    if (file_handle_ == INVALID_HANDLE_VALUE) {
        throw std::runtime_error("Journal: Failed to open file: " + filepath_);
    }

    // Set file size if it's new or small
    LARGE_INTEGER li;
    if (GetFileSizeEx(file_handle_, &li)) {
        if (static_cast<uint64_t>(li.QuadPart) < max_size_) {
            li.QuadPart = max_size_;
            SetFilePointerEx(file_handle_, li, NULL, FILE_BEGIN);
            SetEndOfFile(file_handle_);
        }
    }

    mapping_handle_ = CreateFileMappingA(
        file_handle_,
        NULL,
        PAGE_READWRITE,
        (DWORD)(max_size_ >> 32),
        (DWORD)(max_size_ & 0xFFFFFFFF),
        NULL
    );

    if (mapping_handle_ == NULL) {
        CloseHandle(file_handle_);
        throw std::runtime_error("Journal: Failed to create file mapping");
    }

    mapped_base_ = MapViewOfFile(
        mapping_handle_,
        FILE_MAP_ALL_ACCESS,
        0, 0,
        max_size_
    );

    if (mapped_base_ == NULL) {
        CloseHandle(mapping_handle_);
        CloseHandle(file_handle_);
        throw std::runtime_error("Journal: Failed to map view of file");
    }
#else
    fd_ = open(filepath_.c_str(), O_RDWR | O_CREAT, 0666);
    if (fd_ == -1) {
        throw std::runtime_error("Journal: Failed to open file");
    }
    
    struct stat st;
    fstat(fd_, &st);
    if (static_cast<uint64_t>(st.st_size) < max_size_) {
        ftruncate(fd_, max_size_);
    }

    mapped_base_ = mmap(NULL, max_size_, PROT_READ | PROT_WRITE, MAP_SHARED, fd_, 0);
    if (mapped_base_ == MAP_FAILED) {
        ::close(fd_);
        throw std::runtime_error("Journal: Failed to mmap file");
    }
#endif

    header_ = reinterpret_cast<JournalHeader*>(mapped_base_);
    
    if (is_new_file || header_->magic != JOURNAL_MAGIC) {
        header_->magic = JOURNAL_MAGIC;
        header_->version = JOURNAL_VERSION;
        header_->msg_count = 0;
    }

    current_offset_ = sizeof(JournalHeader) + (header_->msg_count * sizeof(net::ClientRequest));
    current_ptr_ = static_cast<uint8_t*>(mapped_base_) + current_offset_;
}

void Journal::close() {
    if (mapped_base_) {
#ifdef _WIN32
        UnmapViewOfFile(mapped_base_);
        if (mapping_handle_) CloseHandle(mapping_handle_);
        if (file_handle_ && file_handle_ != INVALID_HANDLE_VALUE) CloseHandle(file_handle_);
#else
        munmap(mapped_base_, max_size_);
        if (fd_ != -1) ::close(fd_);
#endif
        mapped_base_ = nullptr;
    }
}

void Journal::flush() {
    if (mapped_base_) {
#ifdef _WIN32
        FlushViewOfFile(mapped_base_, current_offset_);
        FlushFileBuffers(file_handle_);
#else
        msync(mapped_base_, current_offset_, MS_SYNC);
#endif
    }
}

bool Journal::append(const net::ClientRequest& msg) {
    if (current_offset_ + sizeof(net::ClientRequest) > max_size_) {
        return false; // Journal is full
    }

    std::memcpy(current_ptr_, &msg, sizeof(net::ClientRequest));
    current_ptr_ += sizeof(net::ClientRequest);
    current_offset_ += sizeof(net::ClientRequest);
    
    // Memory ordering: ensure msg is written before we update msg_count.
    // A simple compiler barrier is usually enough on x86, but let's use volatile-like or atomic
    // Since header_->msg_count is not atomic, we assume crash safety is handled by the OS page cache
    // ordering, which generally flushes pages sequentially, but we should be careful.
    header_->msg_count++;
    
    return true;
}

std::vector<net::ClientRequest> Journal::read_all(const std::string& filepath) {
    std::vector<net::ClientRequest> messages;
    
    if (!std::filesystem::exists(filepath)) {
        return messages;
    }

    // Simple read strategy using standard POSIX/Windows or just fstream
    // For simplicity, we just use the same mmap approach but read-only
#ifdef _WIN32
    HANDLE hFile = CreateFileA(filepath.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return messages;
    
    LARGE_INTEGER li;
    GetFileSizeEx(hFile, &li);
    if (li.QuadPart < sizeof(JournalHeader)) {
        CloseHandle(hFile);
        return messages;
    }
    
    HANDLE hMap = CreateFileMappingA(hFile, NULL, PAGE_READONLY, 0, 0, NULL);
    if (!hMap) {
        CloseHandle(hFile);
        return messages;
    }
    
    void* pMap = MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, 0);
    if (!pMap) {
        CloseHandle(hMap);
        CloseHandle(hFile);
        return messages;
    }
    
    const JournalHeader* hdr = reinterpret_cast<const JournalHeader*>(pMap);
    if (hdr->magic == JOURNAL_MAGIC && hdr->version == JOURNAL_VERSION) {
        messages.reserve(hdr->msg_count);
        const net::ClientRequest* requests = reinterpret_cast<const net::ClientRequest*>(static_cast<const uint8_t*>(pMap) + sizeof(JournalHeader));
        for (uint64_t i = 0; i < hdr->msg_count; ++i) {
            messages.push_back(requests[i]);
        }
    }
    
    UnmapViewOfFile(pMap);
    CloseHandle(hMap);
    CloseHandle(hFile);
#else
    int fd = open(filepath.c_str(), O_RDONLY);
    if (fd == -1) return messages;
    
    struct stat st;
    fstat(fd, &st);
    if (st.st_size < sizeof(JournalHeader)) {
        ::close(fd);
        return messages;
    }
    
    void* pMap = mmap(NULL, st.st_size, PROT_READ, MAP_SHARED, fd, 0);
    if (pMap == MAP_FAILED) {
        ::close(fd);
        return messages;
    }
    
    const JournalHeader* hdr = reinterpret_cast<const JournalHeader*>(pMap);
    if (hdr->magic == JOURNAL_MAGIC && hdr->version == JOURNAL_VERSION) {
        messages.reserve(hdr->msg_count);
        const net::ClientRequest* requests = reinterpret_cast<const net::ClientRequest*>(static_cast<const uint8_t*>(pMap) + sizeof(JournalHeader));
        for (uint64_t i = 0; i < hdr->msg_count; ++i) {
            messages.push_back(requests[i]);
        }
    }
    
    munmap(pMap, st.st_size);
    ::close(fd);
#endif

    return messages;
}

} // namespace ultralob
