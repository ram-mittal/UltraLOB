# Contributing to UltraLOB

Thank you for your interest in contributing to UltraLOB! We welcome contributions that improve latency, expand exchange features, or enhance test coverage.

---

## Systems Architecture Guidelines

UltraLOB is built for sub-microsecond financial exchange simulation. When submitting code to the core engine, please adhere to these core rules:

1. **Zero Allocations on the Hot Path**: Never call `malloc`, `new`, or methods that allocate dynamically (such as resizing `std::vector` or constructing `std::string`) during order entry, matching, or cancellation. Use the pre-allocated `OrderPool` and fixed buffers.
2. **Deterministic Arithmetic**: Use fixed-point 64-bit integer arithmetic (`Price` as `int64_t`). Avoid floating-point types in core order calculations.
3. **Data Structure Alignment**: Keep critical structs cache-line aligned (`alignas(64)`) to prevent false sharing and optimize CPU cache line utilization.
4. **C++20 Compliance**: Code must compile cleanly under modern C++20 standard using Clang, GCC, and MSVC with all warnings enabled (`-Wall -Wextra`).

---

## Development Workflow

### 1. Build from Source
```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

### 2. Verify Tests
Run the entire test suite before opening a pull request:
```bash
ctest --test-dir build --output-on-failure
```
Ensure all 16 test targets pass with zero failures.

### 3. Run Microbenchmarks
When modifying order book or matching logic, run benchmarks to verify there is no latency regression:
```bash
./build/bench/bench_matching
```

---

## Submitting Pull Requests

1. Fork the repository and create your feature branch: `git checkout -b feature/my-feature`.
2. Commit your changes with concise and descriptive commit messages.
3. Push to your branch and open a Pull Request referencing relevant issues.
4. Fill out the Pull Request template completely.
