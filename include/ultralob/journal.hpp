#pragma once

#include "ultralob/net/wire_protocol.hpp"
#include <string>
#include <cstdint>
#include <vector>

namespace ultralob {

// Header placed at the beginning of the journal file
#pragma pack(push, 1)
struct JournalHeader {
    uint32_t magic;       // e.g., 0x4A4F5552 ('JOUR')
    uint32_t version;     // e.g., 1
    uint64_t msg_count;   // number of messages written
};
#pragma pack(pop)

class Journal {
public:
    // Create or open a journal file. 
    // max_size defines how much memory to pre-allocate (e.g., 1GB).
    Journal(const std::string& filepath, uint64_t max_size = 1024 * 1024 * 1024);
    ~Journal();

    // Prevent copying
    Journal(const Journal&) = delete;
    Journal& operator=(const Journal&) = delete;

    // Append a message to the journal.
    // Returns true on success, false if the journal is full.
    bool append(const net::ClientRequest& msg);

    // Read all messages from a journal file for recovery.
    // This is typically called on startup before the engine starts accepting new orders.
    static std::vector<net::ClientRequest> read_all(const std::string& filepath);

    // Explicitly flush memory mapped pages to disk (synchronous).
    void flush();

private:
    std::string filepath_;
    uint64_t    max_size_;
    
    void*       mapped_base_{nullptr};
    uint8_t*    current_ptr_{nullptr};
    uint64_t    current_offset_{0};
    
    JournalHeader* header_{nullptr};

    // Platform-specific handles
#ifdef _WIN32
    void* file_handle_{nullptr};
    void* mapping_handle_{nullptr};
#else
    int fd_{-1};
#endif

    void open_or_create();
    void close();
};

} // namespace ultralob
