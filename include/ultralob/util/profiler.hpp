#pragma once

#include <chrono>
#include <cstdio>
#include <string>
#include <vector>
#include <mutex>
#include <thread>
#include <iostream>

namespace ultralob::util {

struct ProfileResult {
    std::string name;
    long long start, end;
    uint32_t thread_id;
};

class Profiler {
private:
    std::vector<ProfileResult> results_;
    std::mutex m_lock;
    Profiler() {
        results_.reserve(5000000);
    }
public:
    static Profiler& get() {
        static Profiler instance;
        return instance;
    }
    void write_profile(const ProfileResult& result) {
        std::lock_guard<std::mutex> lock(m_lock);
        results_.push_back(result);
    }
    void dump(const std::string& filepath = "trace.json") {
        FILE* f = fopen(filepath.c_str(), "w");
        if (!f) return;
        fprintf(f, "{\"otherData\": {},\"traceEvents\":[");
        bool first = true;
        for (const auto& r : results_) {
            if (!first) fprintf(f, ",");
            first = false;
            fprintf(f, "{");
            fprintf(f, "\"cat\":\"function\",");
            fprintf(f, "\"dur\":%f,", (r.end - r.start) / 1000.0);
            fprintf(f, "\"name\":\"%s\",", r.name.c_str());
            fprintf(f, "\"ph\":\"X\",");
            fprintf(f, "\"pid\":0,");
            fprintf(f, "\"tid\":%u,", r.thread_id);
            fprintf(f, "\"ts\":%f", r.start / 1000.0);
            fprintf(f, "}");
        }
        fprintf(f, "]}");
        fclose(f);
        printf("Chrome Trace written to %s\n", filepath.c_str());
    }
};

class ScopedTimer {
    std::string m_name;
    std::chrono::time_point<std::chrono::high_resolution_clock> m_start;
    bool m_stopped;
public:
    ScopedTimer(const char* name) : m_name(name), m_stopped(false) {
        m_start = std::chrono::high_resolution_clock::now();
    }
    ~ScopedTimer() {
        if (!m_stopped) stop();
    }
    void stop() {
        auto end_time = std::chrono::high_resolution_clock::now();
        // Trace event requires microseconds (but we need higher resolution for sub-us tracing, we'll write nanoseconds but Chrome trace expects microseconds for "ts" and "dur", wait, trace.json allows decimals or we scale. Actually standard chrome tracing ts/dur are in microseconds. Since we have 300ns events, we need to pass microseconds as floats! Wait, standard JSON doesn't mind decimals).
        // Let's use microseconds as float:
        auto start = std::chrono::time_point_cast<std::chrono::nanoseconds>(m_start).time_since_epoch().count();
        auto end = std::chrono::time_point_cast<std::chrono::nanoseconds>(end_time).time_since_epoch().count();
        uint32_t thread_id = std::hash<std::thread::id>{}(std::this_thread::get_id());
        Profiler::get().write_profile({m_name, start, end, thread_id});
        m_stopped = true;
    }
};

} // namespace ultralob::util

#ifdef ULTRALOB_PROFILING
  #define TRACE_EVENT(name) ultralob::util::ScopedTimer timer##__LINE__(name)
#else
  #define TRACE_EVENT(name)
#endif
