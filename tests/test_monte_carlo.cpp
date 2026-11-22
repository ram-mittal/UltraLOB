#include "ultralob/quant/monte_carlo.hpp"
#include <gtest/gtest.h>
#include <cmath>
#include <stdexcept>
using namespace ultralob::quant;
TEST(MonteCarlo, ZeroVolatilityMatchesDiscountedForwardIntrinsic){
 MonteCarloConfig c;c.spot=105;c.strike=100;c.risk_free_rate=.04;c.dividend_yield=.01;c.volatility=0;c.paths=1000;c.backend=PricingBackend::CPU;
 MonteCarloPricer p;auto mc=p.price(c);auto bs=MonteCarloPricer::black_scholes(c);
 EXPECT_NEAR(mc.call.price,bs.call,1e-10);EXPECT_NEAR(mc.put.price,bs.put,1e-10);
 EXPECT_NEAR(mc.call.standard_error,0,1e-12);EXPECT_NEAR(mc.put.standard_error,0,1e-12);
}
TEST(MonteCarlo, PricesAgreeWithBlackScholesWithinStatisticalTolerance){
 MonteCarloConfig c;c.spot=100;c.strike=105;c.risk_free_rate=.03;c.dividend_yield=.01;c.volatility=.25;c.maturity_years=.75;c.paths=500000;c.seed=2026;c.backend=PricingBackend::CPU;
 MonteCarloPricer p;auto mc=p.price(c);auto bs=MonteCarloPricer::black_scholes(c);
 EXPECT_LE(std::abs(mc.call.price-bs.call),5*mc.call.standard_error+.01);
 EXPECT_LE(std::abs(mc.put.price-bs.put),5*mc.put.standard_error+.01);
 EXPECT_LT(mc.call.confidence_low_95,mc.call.price);EXPECT_GT(mc.call.confidence_high_95,mc.call.price);
 EXPECT_EQ(mc.backend,PricingBackend::CPU);
}
TEST(MonteCarlo, FixedSeedIsReproducibleOnCpu){
 MonteCarloConfig c;c.paths=20000;c.seed=7;c.backend=PricingBackend::CPU;MonteCarloPricer p;
 auto a=p.price(c),b=p.price(c);EXPECT_DOUBLE_EQ(a.call.price,b.call.price);EXPECT_DOUBLE_EQ(a.put.price,b.put.price);
}
TEST(MonteCarlo, RejectsOddOrTooFewPaths){
 MonteCarloConfig c;c.paths=99;c.backend=PricingBackend::CPU;MonteCarloPricer p;
 EXPECT_THROW(p.price(c),std::invalid_argument);c.paths=2;EXPECT_THROW(p.price(c),std::invalid_argument);
}
TEST(MonteCarlo, BlackScholesSatisfiesPutCallParity){
 MonteCarloConfig c;c.spot=110;c.strike=100;c.risk_free_rate=.06;c.dividend_yield=.02;c.volatility=.30;c.maturity_years=1.5;
 auto p=MonteCarloPricer::black_scholes(c);
 double rhs=c.spot*std::exp(-c.dividend_yield*c.maturity_years)-c.strike*std::exp(-c.risk_free_rate*c.maturity_years);
 EXPECT_NEAR(p.call-p.put,rhs,1e-10);
}
