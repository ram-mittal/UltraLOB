#include "ultralob/quant/monte_carlo.hpp"
#include <cstdint>
#include <exception>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>

using namespace ultralob::quant;

namespace {
void help() {
    std::cout
        << "UltraLOB Monte Carlo option pricer\n\n"
        << "Usage: ultralob_pricer [options]\n\n"
        << "Pricing inputs:\n"
        << "  --spot <price>          Underlying spot price S0 (default: 100)\n"
        << "  --strike <price>        Option strike K (default: 100)\n"
        << "  --rate <decimal>        Annual risk-free rate r (default: 0.05)\n"
        << "  --dividend <decimal>    Annual continuous dividend yield q (default: 0.00)\n"
        << "  --vol <decimal>         Annualized volatility (default: 0.20; 0.20 = 20%)\n"
        << "  --maturity <years>      Time to expiry in years (default: 1.0)\n\n"
        << "Simulation inputs:\n"
        << "  --paths <count>         Total paths; even integer >= 4 (default: 1000000)\n"
        << "  --seed <integer>        Random-number seed (default: 42)\n"
        << "  --backend <mode>        auto, cpu, or cuda (default: auto)\n"
        << "  --json                  Emit machine-readable JSON for the pricing API\n"
        << "  --help                  Show this help\n";
}

double parse_double(const std::string& value, const char* name) {
    std::size_t consumed = 0;
    const double parsed = std::stod(value, &consumed);
    if (consumed != value.size())
        throw std::invalid_argument(std::string("invalid value for ") + name);
    return parsed;
}

std::uint64_t parse_u64(const std::string& value, const char* name) {
    if (value.empty() || value.front() == '-')
        throw std::invalid_argument(std::string("invalid unsigned value for ") + name);
    std::size_t consumed = 0;
    const auto parsed = std::stoull(value, &consumed);
    if (consumed != value.size())
        throw std::invalid_argument(std::string("invalid value for ") + name);
    return static_cast<std::uint64_t>(parsed);
}

void print_estimate(const char* label, const PriceEstimate& estimate,
                    double reference_price) {
    std::cout << std::left << std::setw(5) << label
              << " MC=$" << std::setw(11) << estimate.price
              << " Black-Scholes=$" << std::setw(11) << reference_price
              << " SE=$" << estimate.standard_error
              << " 95% CI=[$" << estimate.confidence_low_95
              << ", $" << estimate.confidence_high_95 << "]\n";
}
} // namespace

int main(int argc, char** argv) {
    try {
        MonteCarloConfig config;
        bool json_output = false;

        for (int i = 1; i < argc; ++i) {
            const std::string argument = argv[i];
            if (argument == "--help" || argument == "-h") {
                help();
                return 0;
            }
            if (argument == "--json") {
                json_output = true;
                continue;
            }
            if (i + 1 >= argc)
                throw std::invalid_argument("missing value after " + argument);

            const std::string value = argv[++i];
            if (argument == "--spot") config.spot = parse_double(value, "spot");
            else if (argument == "--strike") config.strike = parse_double(value, "strike");
            else if (argument == "--rate") config.risk_free_rate = parse_double(value, "rate");
            else if (argument == "--dividend") config.dividend_yield = parse_double(value, "dividend");
            else if (argument == "--vol") config.volatility = parse_double(value, "volatility");
            else if (argument == "--maturity") config.maturity_years = parse_double(value, "maturity");
            else if (argument == "--paths") config.paths = parse_u64(value, "paths");
            else if (argument == "--seed") config.seed = parse_u64(value, "seed");
            else if (argument == "--backend") {
                if (value == "auto") config.backend = PricingBackend::Auto;
                else if (value == "cpu") config.backend = PricingBackend::CPU;
                else if (value == "cuda") config.backend = PricingBackend::CUDA;
                else throw std::invalid_argument("backend must be auto, cpu, or cuda");
            } else {
                throw std::invalid_argument("unknown option: " + argument);
            }
        }

        const MonteCarloPricer pricer;
        const auto result = pricer.price(config);
        const auto black_scholes = MonteCarloPricer::black_scholes(config);

        if (json_output) {
            const double paths_per_second = result.elapsed_milliseconds > 0.0
                ? static_cast<double>(result.paths) / (result.elapsed_milliseconds / 1000.0)
                : 0.0;
            std::cout << std::setprecision(17)
                      << "{"
                      << "\\"backend\\":\\"" << backend_name(result.backend) << "\\","
                      << "\\"paths\\":" << result.paths << ","
                      << "\\"seed\\":" << config.seed << ","
                      << "\\"elapsed_ms\\":" << result.elapsed_milliseconds << ","
                      << "\\"paths_per_second\\":" << paths_per_second << ","
                      << "\\"inputs\\":{"
                      << "\\"spot\\":" << config.spot << ","
                      << "\\"strike\\":" << config.strike << ","
                      << "\\"risk_free_rate\\":" << config.risk_free_rate << ","
                      << "\\"dividend_yield\\":" << config.dividend_yield << ","
                      << "\\"volatility\\":" << config.volatility << ","
                      << "\\"maturity_years\\":" << config.maturity_years
                      << "},"
                      << "\\"call\\":{"
                      << "\\"price\\":" << result.call.price << ","
                      << "\\"black_scholes\\":" << black_scholes.call << ","
                      << "\\"standard_error\\":" << result.call.standard_error << ","
                      << "\\"confidence_low_95\\":" << result.call.confidence_low_95 << ","
                      << "\\"confidence_high_95\\":" << result.call.confidence_high_95
                      << "},"
                      << "\\"put\\":{"
                      << "\\"price\\":" << result.put.price << ","
                      << "\\"black_scholes\\":" << black_scholes.put << ","
                      << "\\"standard_error\\":" << result.put.standard_error << ","
                      << "\\"confidence_low_95\\":" << result.put.confidence_low_95 << ","
                      << "\\"confidence_high_95\\":" << result.put.confidence_high_95
                      << "}}\\n";
        } else {
            std::cout << std::fixed << std::setprecision(6)
                      << "UltraLOB Monte Carlo Pricing Engine\\n"
                      << "Backend: " << backend_name(result.backend)
                      << " | Paths: " << result.paths
                      << " | Seed: " << config.seed
                      << " | Elapsed: " << result.elapsed_milliseconds << " ms\\n"
                      << "Spot: $" << config.spot
                      << " | Strike: $" << config.strike
                      << " | Rate: " << config.risk_free_rate
                      << " | Dividend: " << config.dividend_yield
                      << " | Volatility: " << config.volatility
                      << " | Maturity: " << config.maturity_years << " years\\n\\n";

            print_estimate("CALL", result.call, black_scholes.call);
            print_estimate("PUT", result.put, black_scholes.put);
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Pricing error: " << error.what() << '\n';
        return 1;
    }
}
