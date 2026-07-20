import socket
import ctypes
import time
import sys

# Constants
PRICE_SCALE = 100_000_000

class MsgType:
    SubmitOrder = 0
    CancelOrder = 1
    ModifyOrder = 2
    StopEngine  = 3

class Side:
    Buy = 0
    Sell = 1

class OrderType:
    Market = 0
    Limit = 1
    Stop = 2
    StopLimit = 3
    IOC = 4
    FOK = 5
    GTC = 6

class OrderStatus:
    New = 0
    PartiallyFilled = 1
    Filled = 2
    Cancelled = 3
    Rejected = 4
    PendingActivation = 5

def status_str(s):
    return {0:"New", 1:"PartiallyFilled", 2:"Filled", 3:"Cancelled", 4:"Rejected", 5:"PendingActivation"}.get(s, "Unknown")

def type_str(t):
    return {0:"Market", 1:"Limit", 2:"Stop", 3:"StopLimit", 4:"IOC", 5:"FOK", 6:"GTC"}.get(t, "Unknown")

class OrderRequest(ctypes.Structure):
    _fields_ = [
        ("id", ctypes.c_uint64),
        ("client_id", ctypes.c_uint32),
        ("symbol", ctypes.c_uint32),
        ("side", ctypes.c_uint8),
        ("type", ctypes.c_uint8),
        # 6 bytes padding inserted automatically by ctypes
        ("price", ctypes.c_int64),
        ("stop_price", ctypes.c_int64),
        ("limit_price", ctypes.c_int64),
        ("qty", ctypes.c_uint64),
        ("timestamp", ctypes.c_int64),
    ]

class CancelRequest(ctypes.Structure):
    _fields_ = [
        ("symbol", ctypes.c_uint32),
        ("order_id", ctypes.c_uint64),
    ]

class ModifyRequest(ctypes.Structure):
    _fields_ = [
        ("order_id", ctypes.c_uint64),
        ("symbol", ctypes.c_uint32),
        ("new_price", ctypes.c_int64),
        ("new_qty", ctypes.c_uint64),
    ]

class ClientRequestUnion(ctypes.Union):
    _fields_ = [
        ("submit", OrderRequest),
        ("cancel", CancelRequest),
        ("modify", ModifyRequest),
    ]

class ClientRequest(ctypes.Structure):
    _pack_ = 1  # #pragma pack(push, 1) in C++
    _fields_ = [
        ("type", ctypes.c_uint8),
        ("payload", ClientRequestUnion),
    ]

class ExecutionReport(ctypes.Structure):
    _fields_ = [
        ("order_id", ctypes.c_uint64),
        ("contra_order_id", ctypes.c_uint64),
        ("client_id", ctypes.c_uint32),
        ("symbol", ctypes.c_uint32),
        ("side", ctypes.c_uint8),
        ("order_type", ctypes.c_uint8),
        ("status", ctypes.c_uint8),
        # 5 bytes padding automatically
        ("exec_price", ctypes.c_int64),
        ("exec_qty", ctypes.c_uint64),
        ("leaves_qty", ctypes.c_uint64),
        ("cum_qty", ctypes.c_uint64),
        ("timestamp", ctypes.c_int64),
    ]

class ServerResponse(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("report", ExecutionReport),
    ]

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "stop":
        # Send a stop message
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect(("127.0.0.1", 8080))
        req = ClientRequest()
        req.type = MsgType.StopEngine
        sock.send(bytes(req))
        sock.close()
        print("Sent StopEngine command.")
        return

    print(f"Size of ClientRequest: {ctypes.sizeof(ClientRequest)} bytes")
    print(f"Size of ServerResponse: {ctypes.sizeof(ServerResponse)} bytes")

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.connect(("127.0.0.1", 8080))
        print("Connected to UltraLOB Gateway on port 8080")
    except ConnectionRefusedError:
        print("Connection refused. Make sure ultralob_server.exe is running!")
        return

    # Send a buy order
    req = ClientRequest()
    req.type = MsgType.SubmitOrder
    # Use a unique order ID based on timestamp to avoid DuplicateId rejections from journal replays
    base_id = time.time_ns() % 1000000000 
    req.payload.submit.id = base_id
    req.payload.submit.client_id = 999
    req.payload.submit.symbol = 1 # AAPL
    req.payload.submit.side = Side.Buy
    req.payload.submit.type = OrderType.Limit
    req.payload.submit.price = int(150.25 * PRICE_SCALE)
    req.payload.submit.qty = 100
    req.payload.submit.timestamp = time.time_ns()

    print("\nSending Buy Order: 100 AAPL @ $150.25")
    sock.send(bytes(req))

    # Wait for the ExecutionReport
    resp = ServerResponse()
    data = sock.recv(ctypes.sizeof(ServerResponse))
    if data:
        ctypes.memmove(ctypes.addressof(resp), data, len(data))
        rpt = resp.report
        print(f"Received Execution Report: Status={status_str(rpt.status)}")
        print(f"  OrderID: {rpt.order_id}, Leaves Qty: {rpt.leaves_qty}, Cum Qty: {rpt.cum_qty}")

    # Send a crossing sell order to match it!
    req2 = ClientRequest()
    req2.type = MsgType.SubmitOrder
    req2.payload.submit.id = base_id + 1
    req2.payload.submit.client_id = 999
    req2.payload.submit.symbol = 1
    req2.payload.submit.side = Side.Sell
    req2.payload.submit.type = OrderType.Limit
    req2.payload.submit.price = int(150.25 * PRICE_SCALE) # Matches the buy!
    req2.payload.submit.qty = 50
    req2.payload.submit.timestamp = time.time_ns()

    print("\nSending Sell Order: 50 AAPL @ $150.25 (Should Match or Reject due to PTRM!)")
    sock.send(bytes(req2))

    sock.settimeout(1.0)
    try:
        while True:
            data = sock.recv(ctypes.sizeof(ServerResponse))
            if data:
                ctypes.memmove(ctypes.addressof(resp), data, len(data))
                rpt = resp.report
                print(f"Received Execution Report: Status={status_str(rpt.status)}")
                print(f"  OrderID: {rpt.order_id}, ExecQty: {rpt.exec_qty}, ExecPrice: ${rpt.exec_price/PRICE_SCALE:.2f}, Leaves Qty: {rpt.leaves_qty}")
            else:
                break
    except socket.timeout:
        pass

    sock.close()

if __name__ == "__main__":
    main()
