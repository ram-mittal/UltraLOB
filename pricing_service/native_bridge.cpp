#include "native_bridge.hpp"
#include "ultralob/quant/monte_carlo.hpp"

#include <cstdio>
#include <exception>

extern "C" int ultralob_monte_carlo_price(
    const UltraLOBMonteCarloRequest* request,
    UltraLOBMonteCarloResult* output,
    char* error_buffer,
    std::size_t error_buffer_size) noexcept {
    if (!request || !output) {
        if (error_buffer && error_buffer_size)
            std::snprintf(error_buffer, error_buffer_size, "request and result pointers are required");
        return 1;
    }

    try {
        ultralob::quant::MonteCarloConfig config;
        config.spot = request->spot;
        config.strike = request->strike;
        config.risk_free_rate = request->risk_free_rate;
        config.dividend_yield = request->dividend_yield;
        config.volatility = request->volatility;
        config.maturity_years = request->maturity_years;
        config.paths = request->paths;
        config.seed = request->seed;

        switch (request->backend) {
            case 0: config.backend = ultralob::quant::PricingBackend::Auto; break;
            case 1: config.backend = ultralob::quant::PricingBackend::CPU; break;
            case 2: config.backend = ultralob::quant::PricingBackend::CUDA; break;
            default: throw std::invalid_argument("backend must be auto, cpu, or cuda");
        }

        const ultralob::quant::MonteCarloPricer pricer;
        const auto result = pricer.price(config);
        const auto analytic = ultralob::quant::MonteCarloPricer::black_scholes(config);

        output->call_price = result.call.price;
        output->call_black_scholes = analytic.call;
        output->call_standard_error = result.call.standard_error;
        output->call_confidence_low_95 = result.call.confidence_low_95;
        output->call_confidence_high_95 = result.call.confidence_high_95;
        output->put_price = result.put.price;
        output->put_black_scholes = analytic.put;
        output->put_standard_error = result.put.standard_error;
        output->put_confidence_low_95 = result.put.confidence_low_95;
        output->put_confidence_high_95 = result.put.confidence_high_95;
        output->elapsed_ms = result.elapsed_milliseconds;
        output->paths_per_second = result.elapsed_milliseconds > 0.0
            ? static_cast<double>(result.paths) / (result.elapsed_milliseconds / 1000.0)
            : 0.0;
        output->paths = result.paths;
        output->seed = config.seed;
        output->backend = result.backend == ultralob::quant::PricingBackend::CUDA ? 2 : 1;
        return 0;
    } catch (const std::exception& error) {
        if (error_buffer && error_buffer_size)
            std::snprintf(error_buffer, error_buffer_size, "%s", error.what());
        return 2;
    } catch (...) {
        if (error_buffer && error_buffer_size)
            std::snprintf(error_buffer, error_buffer_size, "unknown native pricing error");
        return 3;
    }
}
