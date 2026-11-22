#pragma once
#include <cstddef>
#include <cstdint>

struct UltraLOBMonteCarloRequest {
    double spot;
    double strike;
    double risk_free_rate;
    double dividend_yield;
    double volatility;
    double maturity_years;
    std::uint64_t paths;
    std::uint64_t seed;
    int backend; // 0 = auto, 1 = CPU, 2 = CUDA
};

struct UltraLOBMonteCarloResult {
    double call_price;
    double call_black_scholes;
    double call_standard_error;
    double call_confidence_low_95;
    double call_confidence_high_95;
    double put_price;
    double put_black_scholes;
    double put_standard_error;
    double put_confidence_low_95;
    double put_confidence_high_95;
    double elapsed_ms;
    double paths_per_second;
    std::uint64_t paths;
    std::uint64_t seed;
    int backend; // 1 = CPU, 2 = CUDA
};

extern "C" int ultralob_monte_carlo_price(
    const UltraLOBMonteCarloRequest* request,
    UltraLOBMonteCarloResult* result,
    char* error_buffer,
    std::size_t error_buffer_size) noexcept;
