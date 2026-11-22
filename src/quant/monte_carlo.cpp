#include "ultralob/quant/monte_carlo.hpp"
#include "monte_carlo_backend.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <stdexcept>
namespace ultralob::quant {
namespace {
constexpr double kSqrtTwo=1.4142135623730950488, kNormal95=1.959963984540054;
void validate(const MonteCarloConfig& c) {
 auto finite=[](double x){return std::isfinite(x);};
 if(!finite(c.spot)||c.spot<=0) throw std::invalid_argument("spot must be finite and > 0");
 if(!finite(c.strike)||c.strike<=0) throw std::invalid_argument("strike must be finite and > 0");
 if(!finite(c.risk_free_rate)) throw std::invalid_argument("risk-free rate must be finite");
 if(!finite(c.dividend_yield)) throw std::invalid_argument("dividend yield must be finite");
 if(!finite(c.volatility)||c.volatility<0) throw std::invalid_argument("volatility must be finite and >= 0");
 if(!finite(c.maturity_years)||c.maturity_years<=0) throw std::invalid_argument("maturity must be finite and > 0");
 if(c.paths<4||(c.paths%2)) throw std::invalid_argument("paths must be even and >= 4");
}
PriceEstimate estimate(double sum,double square_sum,std::uint64_t n_obs,double discount) {
 const double n=static_cast<double>(n_obs), mean=sum/n;
 const double centered=std::max(0.0,square_sum-sum*sum/n);
 const double variance=centered/(n-1.0), se=discount*std::sqrt(variance/n);
 const double price=discount*mean, margin=kNormal95*se;
 return {price,se,price-margin,price+margin};
}
}
MonteCarloResult MonteCarloPricer::price(const MonteCarloConfig& c) const {
 validate(c); const auto start=std::chrono::steady_clock::now();
 detail::Accumulators sums{}; PricingBackend selected=PricingBackend::CPU;
#ifdef ULTRALOB_HAS_CUDA
 const bool has_cuda=detail::cuda_available();
 if(c.backend==PricingBackend::CUDA&&!has_cuda) throw std::runtime_error("CUDA requested but no CUDA device is available");
 if(c.backend!=PricingBackend::CPU&&has_cuda) { detail::run_cuda(c,sums); selected=PricingBackend::CUDA; }
 else detail::run_cpu(c,sums);
#else
 if(c.backend==PricingBackend::CUDA) throw std::runtime_error("Built without CUDA; configure with -DULTRALOB_ENABLE_CUDA=ON");
 detail::run_cpu(c,sums);
#endif
 const auto stop=std::chrono::steady_clock::now();
 const double discount=std::exp(-c.risk_free_rate*c.maturity_years);
 MonteCarloResult result;
 result.call=estimate(sums.call_sum,sums.call_square_sum,c.paths/2,discount);
 result.put=estimate(sums.put_sum,sums.put_square_sum,c.paths/2,discount);
 result.paths=c.paths; result.backend=selected;
 result.elapsed_milliseconds=std::chrono::duration<double,std::milli>(stop-start).count();
 return result;
}
BlackScholesPrices MonteCarloPricer::black_scholes(const MonteCarloConfig& c) {
 validate(c); const double t=c.maturity_years;
 const double dr=std::exp(-c.risk_free_rate*t), dq=std::exp(-c.dividend_yield*t);
 if(c.volatility==0.0) {
  const double f=c.spot*std::exp((c.risk_free_rate-c.dividend_yield)*t);
  return {dr*std::max(f-c.strike,0.0),dr*std::max(c.strike-f,0.0)};
 }
 const double st=c.volatility*std::sqrt(t);
 const double d1=(std::log(c.spot/c.strike)+(c.risk_free_rate-c.dividend_yield+0.5*c.volatility*c.volatility)*t)/st;
 const double d2=d1-st;
 auto cdf=[](double x){return 0.5*std::erfc(-x/kSqrtTwo);};
 return {c.spot*dq*cdf(d1)-c.strike*dr*cdf(d2),c.strike*dr*cdf(-d2)-c.spot*dq*cdf(-d1)};
}
const char* backend_name(PricingBackend b) noexcept {
 switch(b){case PricingBackend::Auto:return "AUTO";case PricingBackend::CPU:return "CPU";case PricingBackend::CUDA:return "CUDA";}
 return "UNKNOWN";
}
}
