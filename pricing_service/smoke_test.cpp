#include "native_bridge.hpp"

#include <cmath>
#include <iostream>

int main() {
    const UltraLOBMonteCarloRequest request{
        100.0, 100.0, 0.05, 0.0, 0.20, 1.0,
        20000, 42, 1
    };
    UltraLOBMonteCarloResult result{};
    char error[512]{};

    const int status = ultralob_monte_carlo_price(
        &request, &result, error, sizeof(error));
    if (status != 0) {
        std::cerr << "Native pricing failed: " << error << "\n";
        return 1;
    }
    if (result.backend != 1 || result.paths != request.paths) {
        std::cerr << "Unexpected backend or path count\n";
        return 2;
    }
    if (!std::isfinite(result.call_price) || !std::isfinite(result.put_price) ||
        result.call_price <= 0.0 || result.put_price <= 0.0) {
        std::cerr << "Invalid Monte Carlo output\n";
        return 3;
    }
    if (result.call_confidence_low_95 > result.call_confidence_high_95 ||
        result.put_confidence_low_95 > result.put_confidence_high_95) {
        std::cerr << "Invalid confidence interval\n";
        return 4;
    }
    std::cout << "Native pricing bridge smoke test passed.\n";
    return 0;
}
