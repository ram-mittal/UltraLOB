# UltraLOB Benchmark Results

This document contains the automated Google Benchmark results for the UltraLOB matching engine.

## Throughput Benchmark

```text
---------------------------------------------------------------------------------------------------

Benchmark                                         Time             CPU   Iterations UserCounters...

---------------------------------------------------------------------------------------------------

BM_LimitOrderRain/iterations:5000000            690 ns          638 ns      5000000 items_per_second=1.56863M/s orders/sec

BM_AggressiveCrossing/iterations:2000000       1179 ns         1078 ns      2000000 items_per_second=927.536k/s

BM_AddCancelStorm/iterations:2000000           1585 ns         1508 ns      2000000 items_per_second=663.212k/s

BM_MarketOrderFlood/iterations:1000000          907 ns          844 ns      1000000 items_per_second=1.18519M/s

BM_MixedWorkload/iterations:3000000            1380 ns         1286 ns      3000000 items_per_second=777.328k/s


```

## Latency Benchmark

```text
------------------------------------------------------------------------------------------------------

Benchmark                                            Time             CPU   Iterations UserCounters...

------------------------------------------------------------------------------------------------------

BM_Latency_LimitAdd/iterations:500000              999 ns          969 ns       500000 cycles_max=28.3753M cycles_min=1.095k cycles_p50=1.418k cycles_p99=4.428k cycles_p999=67.14k

BM_Latency_AddCancel/iterations:200000            1210 ns         1094 ns       200000 cycles_p50=2.028k cycles_p99=3.901k cycles_p999=47.704k

BM_Latency_ImmediateFill/iterations:1000000       1379 ns         1312 ns      1000000 cycles_p50=1.768k cycles_p99=6.676k cycles_p999=32.617k

BM_Latency_MarketOrder/iterations:500000          1081 ns         1094 ns       500000 cycles_min=1.233k cycles_p50=1.638k cycles_p99=4.041k cycles_p999=28.695k


```

## Scaling Benchmark

```text
----------------------------------------------------------------------------------------

Benchmark                              Time             CPU   Iterations UserCounters...

----------------------------------------------------------------------------------------

BM_Scaling_Threads/threads:1        1076 ns         1025 ns       640000 items_per_second=975.238k/s

BM_Scaling_Threads/threads:2        1369 ns         1318 ns       497778 items_per_second=758.519k/s

BM_Scaling_Threads/threads:4        4739 ns         3139 ns       298668 items_per_second=318.579k/s

BM_Scaling_Threads/threads:8        5129 ns         3662 ns       149336 items_per_second=273.072k/s

BM_Scaling_Threads/threads:16      12899 ns         5341 ns       102400 items_per_second=187.246k/s

BM_Scaling_Symbols/1                 806 ns          732 ns       746667 items_per_second=1.36533M/s

BM_Scaling_Symbols/10               1666 ns         1639 ns       896000 items_per_second=610.043k/s

BM_Scaling_Symbols/100              1180 ns         1172 ns       746667 items_per_second=853.334k/s

BM_Scaling_Symbols/1000             1056 ns         1046 ns       896000 items_per_second=955.733k/s

BM_Scaling_Symbols/10000            1282 ns         1221 ns       448000 items_per_second=819.2k/s


```

## Sequencer Benchmark

```text
------------------------------------------------------------------

Benchmark                        Time             CPU   Iterations

------------------------------------------------------------------

BM_Sequencer_RoundTrip         932 ns          921 ns       746667

BM_Sequencer_Throughput    1073958 ns      1024933 ns          747 items_per_second=975.673k/s


```

## Memory Benchmark

```text
--- Memory Profile ---

sizeof(Order): 128 bytes

sizeof(PriceLevel): 32 bytes

OrderPool (1M Orders): 122 MB

Journal Map Size: 1024 MB (1 GB Virtual)

Working Set Size (RAM): 3 MB

Peak Working Set Size (RAM): 3 MB

Pagefile Usage: 0 MB


```

## Journal Benchmark

```text
------------------------------------------------------------------------

Benchmark              Time             CPU   Iterations UserCounters...

------------------------------------------------------------------------

JournalAppend       63.3 ns         57.2 ns     11200000 items_per_second=17.4829M/s


```

