cmake_minimum_required(VERSION 3.28)

# ─────────────────────────────────────────────────────────────────────────────
# Zig C++ compiler wrapper support
# Set ZIG_CC / ZIG_CXX environment variables before configuring if using Zig.
# Example (PowerShell):
#   $env:ZIG="C:\...\zig.exe"
#   $env:CC="$env:ZIG cc"; $env:CXX="$env:ZIG c++"
# ─────────────────────────────────────────────────────────────────────────────

project(UltraLOB VERSION 1.0.0 LANGUAGES CXX C)

# ─────────────────────────────────────────────────────────────────────────────
# C++ Standard
# ─────────────────────────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Disable C++ module scanning — zig c++ doesn't bundle clang-scan-deps
# (only needed for C++20 modules / C++23, not for header-only includes)
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)

# ─────────────────────────────────────────────────────────────────────────────
# Build type default
# ─────────────────────────────────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# ─────────────────────────────────────────────────────────────────────────────
# Detect compiler and set appropriate flags
# ─────────────────────────────────────────────────────────────────────────────
if(MSVC)
  add_compile_options(
    /W4
    /O2 /Oi /Ot
    /arch:AVX2
    /EHsc
    /D_CRT_SECURE_NO_WARNINGS
    /DNOMINMAX
    /wd4100  # unused parameter
    /wd4702  # unreachable code (can fire after [[fallthrough]])
  )
else()
  # GCC / Clang / Zig-cc
  add_compile_options(
    -Wall -Wextra
    -O3
    -mavx2 -mfma
    -fno-rtti
  )
  # Zig-cc doesn't support all gcc diagnostics — suppress unknown warnings
  if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    add_compile_options(
      -Wno-unused-parameter
      -Wno-missing-field-initializers
    )
  endif()
endif()

# ─────────────────────────────────────────────────────────────────────────────
# Dependencies via FetchContent
# ─────────────────────────────────────────────────────────────────────────────
include(FetchContent)

# Google Test — downloaded as tarball (no git required)
FetchContent_Declare(
  googletest
  URL      https://github.com/google/googletest/archive/refs/tags/v1.15.2.tar.gz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
set(BUILD_GMOCK OFF CACHE BOOL "" FORCE)
set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
set(CMAKE_POLICY_DEFAULT_CMP0048 NEW)
FetchContent_MakeAvailable(googletest)

# Google Benchmark — downloaded as tarball (no git required)
FetchContent_Declare(
  benchmark
  URL      https://github.com/google/benchmark/archive/refs/tags/v1.9.1.tar.gz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
set(BENCHMARK_ENABLE_TESTING   OFF CACHE BOOL "" FORCE)
set(BENCHMARK_ENABLE_INSTALL   OFF CACHE BOOL "" FORCE)
set(BENCHMARK_ENABLE_EXCEPTIONS ON  CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(benchmark)

# Standalone ASIO (header only)
FetchContent_Declare(
  asio
  URL      https://github.com/chriskohlhoff/asio/archive/refs/tags/asio-1-30-2.tar.gz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(asio)

# ─────────────────────────────────────────────────────────────────────────────
# UltraLOB core library
# ─────────────────────────────────────────────────────────────────────────────
add_library(ultralob STATIC
  src/order_book.cpp
  src/matching_engine.cpp
  src/statistics.cpp
  src/exchange_node.cpp
  src/journal.cpp
  src/risk_engine.cpp
)

target_include_directories(ultralob PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
  ${asio_SOURCE_DIR}/asio/include
)

target_compile_definitions(ultralob PUBLIC 
  ASIO_STANDALONE 
  ASIO_NO_TYPEID
  ULTRALOB_PROFILING=1
)

if(WIN32)
  target_compile_definitions(ultralob PUBLIC WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0601)
  target_link_libraries(ultralob PUBLIC ws2_32 mswsock)
endif()

# Core library doesn't need C++ exceptions, except maybe for networking
# but asio can work without exceptions. We will enable it just in case for ASIO.
if(NOT MSVC)
  # Remove -fno-exceptions for the core library so ASIO works well.
  # ASIO relies heavily on exceptions.
  # target_compile_options(ultralob PRIVATE -fno-exceptions)
endif()

# ─────────────────────────────────────────────────────────────────────────────
# Server Executable
# ─────────────────────────────────────────────────────────────────────────────
add_executable(ultralob_server server/main.cpp)
target_link_libraries(ultralob_server PRIVATE ultralob)
if(NOT MSVC)
  target_link_libraries(ultralob_server PRIVATE pthread)
endif()
if(WIN32)
  target_link_libraries(ultralob_server PRIVATE ws2_32 mswsock)
endif()

# ─────────────────────────────────────────────────────────────────────────────
# Tests & Benchmarks
# ─────────────────────────────────────────────────────────────────────────────
enable_testing()
add_subdirectory(tests)
add_subdirectory(bench)
