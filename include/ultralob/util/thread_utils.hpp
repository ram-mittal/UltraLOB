#pragma once

#include <thread>
#include <system_error>

#if defined(_WIN32)
    #include <windows.h>
#elif defined(__linux__) || defined(__APPLE__)
    #include <pthread.h>
#endif

namespace ultralob {

// ─────────────────────────────────────────────────────────────────────────────
// Pin a std::thread to a specific CPU core to maximize cache locality
// and prevent the OS scheduler from migrating the thread.
// Returns true on success, false on failure.
// ─────────────────────────────────────────────────────────────────────────────
inline bool pin_thread_to_core(std::thread& t, int core_id) noexcept {
    if (core_id < 0) return false;

#if defined(_WIN32)
    HANDLE handle = t.native_handle();
    DWORD_PTR mask = (static_cast<DWORD_PTR>(1) << core_id);
    if (SetThreadAffinityMask(handle, mask) == 0) {
        return false;
    }
    return true;

#elif defined(__linux__)
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(core_id, &cpuset);
    
    pthread_t handle = t.native_handle();
    if (pthread_setaffinity_np(handle, sizeof(cpu_set_t), &cpuset) != 0) {
        return false;
    }
    return true;

#elif defined(__APPLE__)
    // macOS thread pinning is more complex (requires THREAD_AFFINITY_POLICY)
    // For simplicity, we just return false here or ignore it.
    (void)t;
    return false;
#else
    (void)t;
    return false;
#endif
}

// ─────────────────────────────────────────────────────────────────────────────
// Pin the CURRENT thread to a specific CPU core.
// ─────────────────────────────────────────────────────────────────────────────
inline bool pin_current_thread_to_core(int core_id) noexcept {
    if (core_id < 0) return false;

#if defined(_WIN32)
    DWORD_PTR mask = (static_cast<DWORD_PTR>(1) << core_id);
    if (SetThreadAffinityMask(GetCurrentThread(), mask) == 0) {
        return false;
    }
    return true;

#elif defined(__linux__)
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(core_id, &cpuset);
    if (pthread_setaffinity_np(pthread_self(), sizeof(cpu_set_t), &cpuset) != 0) {
        return false;
    }
    return true;
#else
    return false;
#endif
}

} // namespace ultralob
