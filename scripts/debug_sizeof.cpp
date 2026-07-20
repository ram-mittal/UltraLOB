#include "ultralob/net/wire_protocol.hpp"
#include <iostream>

using namespace ultralob;
using namespace ultralob::net;

int main() {
    std::cout << "sizeof(ClientRequest) = " << sizeof(ClientRequest) << "\n";
    std::cout << "offsetof(ClientRequest, type) = " << offsetof(ClientRequest, type) << "\n";
    
    // offsetof on union member is not standard but we can use pointer math
    ClientRequest req;
    
    std::cout << "offset of submit = " << (size_t)((char*)&req.submit - (char*)&req) << "\n";
    std::cout << "offset of submit.id = " << (size_t)((char*)&req.submit.id - (char*)&req) << "\n";
    std::cout << "offset of submit.client_id = " << (size_t)((char*)&req.submit.client_id - (char*)&req) << "\n";
    std::cout << "offset of submit.symbol = " << (size_t)((char*)&req.submit.symbol - (char*)&req) << "\n";
    std::cout << "offset of submit.side = " << (size_t)((char*)&req.submit.side - (char*)&req) << "\n";
    std::cout << "offset of submit.type = " << (size_t)((char*)&req.submit.type - (char*)&req) << "\n";
    std::cout << "offset of submit.price = " << (size_t)((char*)&req.submit.price - (char*)&req) << "\n";
    std::cout << "offset of submit.qty = " << (size_t)((char*)&req.submit.qty - (char*)&req) << "\n";
    
    return 0;
}
