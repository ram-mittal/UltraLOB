cmake_minimum_required(VERSION 3.28)
project(UltraLOBQuantService LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ULTRALOB_ENABLE_CUDA "Build CUDA Monte Carlo backend" OFF)

add_executable(ultralob_pricer
    ${CMAKE_CURRENT_LIST_DIR}/../server/monte_carlo_demo.cpp
    ${CMAKE_CURRENT_LIST_DIR}/../src/quant/monte_carlo.cpp
    ${CMAKE_CURRENT_LIST_DIR}/../src/quant/monte_carlo_cpu.cpp
)
target_include_directories(ultralob_pricer PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/../include
    ${CMAKE_CURRENT_LIST_DIR}/../src/quant
)
target_compile_options(ultralob_pricer PRIVATE
    $<$<COMPILE_LANGUAGE:CXX>:-O3>
    $<$<COMPILE_LANGUAGE:CXX>:-Wall>
    $<$<COMPILE_LANGUAGE:CXX>:-Wextra>
)

if(ULTRALOB_ENABLE_CUDA)
    enable_language(CUDA)
    find_package(CUDAToolkit REQUIRED)
    target_sources(ultralob_pricer PRIVATE
        ${CMAKE_CURRENT_LIST_DIR}/../src/quant/monte_carlo_cuda.cu
    )
    target_compile_definitions(ultralob_pricer PRIVATE ULTRALOB_HAS_CUDA=1)
    target_link_libraries(ultralob_pricer PRIVATE CUDA::cudart CUDA::curand)
    set_target_properties(ultralob_pricer PROPERTIES
        CUDA_STANDARD 17
        CUDA_STANDARD_REQUIRED ON
        CUDA_EXTENSIONS OFF
    )
endif()
