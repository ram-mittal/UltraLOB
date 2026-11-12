## Description
<!-- Provide a concise summary of the proposed changes or feature additions. -->

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking addition to engine or gateway)
- [ ] Performance optimization (latency or throughput improvement)
- [ ] Refactoring (code cleanup without behavior changes)
- [ ] Documentation update

## Verification & Testing
- [ ] Built cleanly under C++20 with Release optimizations (`-O3`).
- [ ] All 16 unit and integration test suites pass (`ctest --test-dir build --output-on-failure`).
- [ ] Benchmarked critical path changes to verify no latency regression.
- [ ] Confirmed zero heap allocations on the matching path.

## Related Issues
<!-- Reference any related issue numbers (e.g. Closes #12) -->
