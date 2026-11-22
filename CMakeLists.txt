cmake_minimum_required(VERSION 3.28)

# ─────────────────────────────────────────────────────────────────────────────
# Zig C++ compiler wrapper support
# Set ZIG_CC / ZIG_CXX environment variables before configuring if using Zig.
# Example (PowerShell):
#   $env:ZIG="C:\...\zig.exe"
#   $env:CC="$env:ZIG cc"; $env:CXX="$env:ZIG c++"
# ─────────────────────────────────────────────────────────────────────────────

project(UltraLOB VERSION 1.0.0 LANGUAGES CXX C)

option(ULTRALOB_ENABLE_CUDA "Build the GPU Monte Carlo pricing backend" OFF)
if(ULTRALOB_ENABLE_CUDA)
  include(CheckLanguage)
  check_language(CUDA)
  if(NOT CMAKE_CUDA_COMPILER)
    message(FATAL_ERROR "ULTRALOB_ENABLE_CUDA=ON, but no CUDA compiler was found. Install the NVIDIA CUDA Toolkit.")
  endif()
  enable_language(CUDA)
  find_package(CUDAToolkit REQUIRED)
endif()

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
    $<$<COMPILE_LANGUAGE:CXX>:/W4>
    $<$<COMPILE_LANGUAGE:CXX>:/O2>
    $<$<COMPILE_LANGUAGE:CXX>:/Oi>
    $<$<COMPILE_LANGUAGE:CXX>:/Ot>
    $<$<COMPILE_LANGUAGE:CXX>:/arch:AVX2>
    $<$<COMPILE_LANGUAGE:CXX>:/EHsc>
    $<$<COMPILE_LANGUAGE:CXX>:/D_CRT_SECURE_NO_WARNINGS>
    $<$<COMPILE_LANGUAGE:CXX>:/DNOMINMAX>
    $<$<COMPILE_LANGUAGE:CXX>:/wd4100>
    $<$<COMPILE_LANGUAGE:CXX>:/wd4702>
  )
else()
  # GCC / Clang / Zig-cc
  add_compile_options(
    $<$<COMPILE_LANGUAGE:CXX>:-Wall>
    $<$<COMPILE_LANGUAGE:CXX>:-Wextra>
    $<$<COMPILE_LANGUAGE:CXX>:-O3>
    $<$<COMPILE_LANGUAGE:CXX>:-mavx2>
    $<$<COMPILE_LANGUAGE:CXX>:-mfma>
    $<$<COMPILE_LANGUAGE:CXX>:-fno-rtti>
  )
  # Zig-cc doesn't support all gcc diagnostics — suppress unknown warnings
  if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    add_compile_options(
      $<$<COMPILE_LANGUAGE:CXX>:-Wno-unused-parameter>
      $<$<COMPILE_LANGUAGE:CXX>:-Wno-missing-field-initializers>
      $<$<COMPILE_LANGUAGE:CXX>:-Wno-c2y-extensions>
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
set(BENCHMARK_ENABLE_WERROR     OFF CACHE BOOL "" FORCE)
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
  src/fix_message.cpp
  src/fix_builder.cpp
  src/fix_framer.cpp
  src/fix_session.cpp
  src/fix_store.cpp
  src/fix_application.cpp
  src/fix_initiator.cpp
  src/fix_gateway.cpp
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
# Quantitative Monte Carlo pricing library (kept off the matching hot path)
# ─────────────────────────────────────────────────────────────────────────────
add_library(ultralob_quant STATIC
  src/quant/monte_carlo.cpp
  src/quant/monte_carlo_cpu.cpp
)
target_include_directories(ultralob_quant PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)
target_compile_features(ultralob_quant PUBLIC cxx_std_20)

if(ULTRALOB_ENABLE_CUDA)
  target_sources(ultralob_quant PRIVATE src/quant/monte_carlo_cuda.cu)
  target_compile_definitions(ultralob_quant PUBLIC ULTRALOB_HAS_CUDA=1)
  target_link_libraries(ultralob_quant PRIVATE CUDA::cudart CUDA::curand)
  set_target_properties(ultralob_quant PROPERTIES
    CUDA_STANDARD 17
    CUDA_STANDARD_REQUIRED ON
    CUDA_EXTENSIONS OFF
  )
endif()

add_executable(ultralob_pricer server/monte_carlo_demo.cpp)
target_link_libraries(ultralob_pricer PRIVATE ultralob_quant)

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
# Mock FIX Server & Client Demo
# ─────────────────────────────────────────────────────────────────────────────
add_executable(mock_fix_server server/mock_fix_server.cpp)
target_link_libraries(mock_fix_server PRIVATE ultralob)
if(NOT MSVC)
  target_link_libraries(mock_fix_server PRIVATE pthread)
endif()
if(WIN32)
  target_link_libraries(mock_fix_server PRIVATE ws2_32 mswsock)
endif()

add_executable(fix_client_demo server/fix_client_demo.cpp)
target_link_libraries(fix_client_demo PRIVATE ultralob)
if(NOT MSVC)
  target_link_libraries(fix_client_demo PRIVATE pthread)
endif()
if(WIN32)
  target_link_libraries(fix_client_demo PRIVATE ws2_32 mswsock)
endif()

# ─────────────────────────────────────────────────────────────────────────────
# Tests & Benchmarks
# ─────────────────────────────────────────────────────────────────────────────
enable_testing()
add_subdirectory(tests)
add_subdirectory(bench)
