#pragma once
#include <cstdint>
namespace ultralob::quant {
enum class PricingBackend { Auto, CPU, CUDA };
struct MonteCarloConfig {
 double spot=100.0, strike=100.0, risk_free_rate=0.05, dividend_yield=0.0;
 double volatility=0.20, maturity_years=1.0;
 std::uint64_t paths=1'000'000; // even total path count; antithetic pairs
 std::uint64_t seed=42;
 PricingBackend backend=PricingBackend::Auto;
};
struct PriceEstimate { double price=0.0, standard_error=0.0, confidence_low_95=0.0, confidence_high_95=0.0; };
struct BlackScholesPrices { double call=0.0, put=0.0; };
struct MonteCarloResult { PriceEstimate call, put; std::uint64_t paths=0; PricingBackend backend=PricingBackend::CPU; double elapsed_milliseconds=0.0; };
class MonteCarloPricer {
public:
 [[nodiscard]] MonteCarloResult price(const MonteCarloConfig& config) const;
 [[nodiscard]] static BlackScholesPrices black_scholes(const MonteCarloConfig& config);
};
[[nodiscard]] const char* backend_name(PricingBackend backend) noexcept;
}
