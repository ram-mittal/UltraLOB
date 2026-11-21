#include "monte_carlo_backend.hpp"
#include <cuda_runtime.h>
#include <curand_kernel.h>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>
namespace ultralob::quant::detail {
namespace {
constexpr unsigned int kBlockSize=256;
struct DeviceAccum { double call_sum,call_square_sum,put_sum,put_square_sum; };
void check_cuda(cudaError_t s,const char* op){if(s!=cudaSuccess)throw std::runtime_error(std::string(op)+": "+cudaGetErrorString(s));}
template<class T> class DeviceBuffer {
public:
 explicit DeviceBuffer(std::size_t n){check_cuda(cudaMalloc(reinterpret_cast<void**>(&ptr_),n*sizeof(T)),"cudaMalloc");}
 ~DeviceBuffer(){if(ptr_)cudaFree(ptr_);}
 DeviceBuffer(const DeviceBuffer&)=delete; DeviceBuffer& operator=(const DeviceBuffer&)=delete;
 T* get() noexcept{return ptr_;}
private:T* ptr_=nullptr;
};
__global__ void monte_carlo_kernel(double spot,double strike,double drift,double diffusion,
 std::uint64_t pairs,std::uint64_t seed,DeviceAccum* partials){
 extern __shared__ double shared[];
 double* cs=shared; double* cs2=shared+blockDim.x;
 double* ps=shared+2*blockDim.x; double* ps2=shared+3*blockDim.x;
 const unsigned int tid=threadIdx.x;
 const std::uint64_t idx=static_cast<std::uint64_t>(blockIdx.x)*blockDim.x+tid;
 double c=0,c2=0,p=0,p2=0;
 if(idx<pairs){
  curandStatePhilox4_32_10_t state;
  curand_init(static_cast<unsigned long long>(seed),static_cast<unsigned long long>(idx),0ULL,&state);
  const double z=curand_normal_double(&state);
  const double up=spot*exp(drift+diffusion*z),down=spot*exp(drift-diffusion*z);
  c=0.5*(fmax(up-strike,0.0)+fmax(down-strike,0.0));
  p=0.5*(fmax(strike-up,0.0)+fmax(strike-down,0.0)); c2=c*c;p2=p*p;
 }
 cs[tid]=c;cs2[tid]=c2;ps[tid]=p;ps2[tid]=p2;__syncthreads();
 for(unsigned int stride=blockDim.x/2;stride>0;stride>>=1){
  if(tid<stride){cs[tid]+=cs[tid+stride];cs2[tid]+=cs2[tid+stride];ps[tid]+=ps[tid+stride];ps2[tid]+=ps2[tid+stride];}
  __syncthreads();
 }
 if(tid==0)partials[blockIdx.x]={cs[0],cs2[0],ps[0],ps2[0]};
}
}
bool cuda_available() noexcept{int count=0;const auto s=cudaGetDeviceCount(&count);if(s!=cudaSuccess){cudaGetLastError();return false;}return count>0;}
void run_cuda(const MonteCarloConfig& c,Accumulators& out){
 const std::uint64_t pairs=c.paths/2, blocks64=(pairs+kBlockSize-1)/kBlockSize;
 if(blocks64>2'147'483'647ULL)throw std::invalid_argument("path count exceeds CUDA 1D grid limit");
 const unsigned int blocks=static_cast<unsigned int>(blocks64);
 const double drift=(c.risk_free_rate-c.dividend_yield-0.5*c.volatility*c.volatility)*c.maturity_years;
 const double diffusion=c.volatility*std::sqrt(c.maturity_years);
 DeviceBuffer<DeviceAccum> device_partials(blocks);
 monte_carlo_kernel<<<blocks,kBlockSize,4*kBlockSize*sizeof(double)>>>(c.spot,c.strike,drift,diffusion,pairs,c.seed,device_partials.get());
 check_cuda(cudaGetLastError(),"Monte Carlo kernel launch");
 check_cuda(cudaDeviceSynchronize(),"Monte Carlo kernel execution");
 std::vector<DeviceAccum> host(blocks);
 check_cuda(cudaMemcpy(host.data(),device_partials.get(),host.size()*sizeof(DeviceAccum),cudaMemcpyDeviceToHost),"copy partial sums");
 for(const auto& a:host){out.call_sum+=a.call_sum;out.call_square_sum+=a.call_square_sum;out.put_sum+=a.put_sum;out.put_square_sum+=a.put_square_sum;}
}
}
