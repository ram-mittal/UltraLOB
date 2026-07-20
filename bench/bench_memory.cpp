#include "ultralob/order_pool.hpp"
#include "ultralob/price_level.hpp"
#include "ultralob/order_book.hpp"
#include <iostream>
#include <windows.h>
#include <psapi.h>

using namespace ultralob;

int main() {
    std::cout << "--- Memory Profile ---" << std::endl;
    std::cout << "sizeof(Order): " << sizeof(Order) << " bytes" << std::endl;
    std::cout << "sizeof(PriceLevel): " << sizeof(PriceLevel) << " bytes" << std::endl;

    size_t order_pool_bytes = sizeof(OrderPool) + (sizeof(Order) * OrderPool::DEFAULT_CAPACITY);
    
    std::cout << "OrderPool (1M Orders): " << (order_pool_bytes / 1024 / 1024) << " MB" << std::endl;
    std::cout << "Journal Map Size: 1024 MB (1 GB Virtual)" << std::endl;
    
    // Total working set size
    PROCESS_MEMORY_COUNTERS pmc;
    if (GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc))) {
        std::cout << "Working Set Size (RAM): " << (pmc.WorkingSetSize / 1024 / 1024) << " MB" << std::endl;
        std::cout << "Peak Working Set Size (RAM): " << (pmc.PeakWorkingSetSize / 1024 / 1024) << " MB" << std::endl;
        std::cout << "Pagefile Usage: " << (pmc.PagefileUsage / 1024 / 1024) << " MB" << std::endl;
    }
    
    return 0;
}
