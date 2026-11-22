#pragma once
#include "ultralob/quant/monte_carlo.hpp"
namespace ultralob::quant::detail {
struct Accumulators { double call_sum=0, call_square_sum=0, put_sum=0, put_square_sum=0; };
void run_cpu(const MonteCarloConfig&, Accumulators&);
#ifdef ULTRALOB_HAS_CUDA
[[nodiscard]] bool cuda_available() noexcept;
void run_cuda(const MonteCarloConfig&, Accumulators&);
#endif
}
