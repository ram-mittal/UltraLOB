#include <gtest/gtest.h>
#include "ultralob/exchange_node.hpp"
#include "ultralob/net/gateway.hpp"
#include <asio.hpp>
#include <thread>
#include <chrono>

using namespace ultralob;
using namespace ultralob::net;
using namespace std::chrono_literals;

class GatewayTest : public ::testing::Test {
protected:
    void SetUp() override {
        exchange.add_symbol(1);
        exchange.start(-1);
    }
    
    void TearDown() override {
        exchange.stop();
    }

    ExchangeNode exchange;
};

TEST_F(GatewayTest, ClientConnectionAndOrderSubmission) {
    asio::io_context io_context;
    
    // Start gateway on a dynamic/random port
    Gateway gateway(io_context, 0, exchange);
    gateway.start_routing();
    uint16_t port = gateway.port();
    
    // Run io_context in a background thread so the server processes accept/read/write
    std::thread io_thread([&io_context]() {
        io_context.run();
    });
    
    // Client connection
    asio::io_context client_io;
    asio::ip::tcp::socket client_socket(client_io);
    client_socket.connect(asio::ip::tcp::endpoint(asio::ip::address::from_string("127.0.0.1"), port));
    
    // Prepare a ClientRequest (New Order)
    ClientRequest req;
    req.type = MsgType::SubmitOrder;
    req.submit = OrderRequest{
        .id = 101,
        .client_id = 0, // Ignored by client, server will overwrite
        .symbol = 1,
        .side = Side::Buy,
        .type = OrderType::Limit,
        .price = from_double(150.0),
        .qty = 100,
        .stop_price = PRICE_NONE,
        .limit_price = PRICE_NONE,
        .timestamp = 0
    };
    
    // Send request
    asio::write(client_socket, asio::buffer(&req, sizeof(ClientRequest)));
    
    // Wait for the Acknowledgment (OrderStatus::New)
    ServerResponse resp;
    asio::error_code ec;
    size_t length = asio::read(client_socket, asio::buffer(&resp, sizeof(ServerResponse)), ec);
    
    EXPECT_FALSE(ec);
    EXPECT_EQ(length, sizeof(ServerResponse));
    EXPECT_EQ(resp.report.order_id, 101);
    EXPECT_EQ(resp.report.status, OrderStatus::New);
    
    // Note: The assigned client_id should be 1 because it's the first connection
    EXPECT_EQ(resp.report.client_id, 1);
    
    // Cleanup
    gateway.stop();
    io_context.stop();
    if (io_thread.joinable()) {
        io_thread.join();
    }
}
