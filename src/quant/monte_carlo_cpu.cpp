#include "monte_carlo_backend.hpp"
#include <algorithm>
#include <cmath>
#include <random>
namespace ultralob::quant::detail {
void run_cpu(const MonteCarloConfig& c, Accumulators& out) {
 const auto pairs=c.paths/2;
 const double drift=(c.risk_free_rate-c.dividend_yield-0.5*c.volatility*c.volatility)*c.maturity_years;
 const double diffusion=c.volatility*std::sqrt(c.maturity_years);
 std::mt19937_64 rng(c.seed); std::normal_distribution<double> normal(0.0,1.0);
 for(std::uint64_t i=0;i<pairs;++i) {
  const double z=normal(rng), up=c.spot*std::exp(drift+diffusion*z), down=c.spot*std::exp(drift-diffusion*z);
  const double call=0.5*(std::max(up-c.strike,0.0)+std::max(down-c.strike,0.0));
  const double put=0.5*(std::max(c.strike-up,0.0)+std::max(c.strike-down,0.0));
  out.call_sum+=call; out.call_square_sum+=call*call; out.put_sum+=put; out.put_square_sum+=put*put;
 }
}
}
