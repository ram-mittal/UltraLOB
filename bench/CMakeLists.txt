cmake_minimum_required(VERSION 3.28)

function(add_ultralob_bench name src)
  add_executable(${name} ${src})
  target_link_libraries(${name} PRIVATE ultralob benchmark::benchmark)
  if(NOT MSVC)
    target_compile_options(${name} PRIVATE -fexceptions)
  endif()
endfunction()

add_ultralob_bench(bench_throughput bench_throughput.cpp)
add_ultralob_bench(bench_latency    bench_latency.cpp)
add_ultralob_bench(bench_sequencer  bench_sequencer.cpp)
add_ultralob_bench(bench_journal    bench_journal.cpp)
