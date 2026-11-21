#include "ultralob/quant/monte_carlo.hpp"
#include <cstdint>
#include <exception>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
using namespace ultralob::quant;
namespace {
void help(){std::cout<<"UltraLOB Monte Carlo option pricer\nUsage: ultralob_pricer [--spot P] [--strike K] [--rate R] [--dividend Q] [--vol SIGMA] [--maturity YEARS] [--paths EVEN_N] [--seed N] [--backend auto|cpu|cuda]\n";}
double pd(const std::string& s){std::size_t n=0;double x=std::stod(s,&n);if(n!=s.size())throw std::invalid_argument("invalid numeric argument");return x;}
std::uint64_t pu(const std::string& s){std::size_t n=0;auto x=std::stoull(s,&n);if(n!=s.size())throw std::invalid_argument("invalid integer argument");return x;}
void print(const char* label,const PriceEstimate& e,double ref){std::cout<<std::left<<std::setw(5)<<label<<" MC=$"<<std::setw(11)<<e.price<<" Black-Scholes=$"<<std::setw(11)<<ref<<" SE=$"<<e.standard_error<<" 95% CI=[$"<<e.confidence_low_95<<", $"<<e.confidence_high_95<<"]\n";}
}
int main(int argc,char** argv){try{
 MonteCarloConfig c;
 for(int i=1;i<argc;++i){std::string a=argv[i];if(a=="--help"||a=="-h"){help();return 0;}if(i+1>=argc)throw std::invalid_argument("missing value after "+a);std::string v=argv[++i];
 if(a=="--spot")c.spot=pd(v);else if(a=="--strike")c.strike=pd(v);else if(a=="--rate")c.risk_free_rate=pd(v);else if(a=="--dividend")c.dividend_yield=pd(v);else if(a=="--vol")c.volatility=pd(v);else if(a=="--maturity")c.maturity_years=pd(v);else if(a=="--paths")c.paths=pu(v);else if(a=="--seed")c.seed=pu(v);else if(a=="--backend"){if(v=="auto")c.backend=PricingBackend::Auto;else if(v=="cpu")c.backend=PricingBackend::CPU;else if(v=="cuda")c.backend=PricingBackend::CUDA;else throw std::invalid_argument("backend must be auto, cpu, cuda");}else throw std::invalid_argument("unknown option: "+a);
 }
 MonteCarloPricer p;auto result=p.price(c);auto ref=MonteCarloPricer::black_scholes(c);
 std::cout<<std::fixed<<std::setprecision(6)<<"UltraLOB Monte Carlo Pricing Engine\nBackend: "<<backend_name(result.backend)<<" | paths: "<<result.paths<<" | elapsed: "<<result.elapsed_milliseconds<<" ms\n";
 print("CALL",result.call,ref.call);print("PUT",result.put,ref.put);return 0;
 }catch(const std::exception& e){std::cerr<<"Pricing error: "<<e.what()<<'\n';return 1;}}
