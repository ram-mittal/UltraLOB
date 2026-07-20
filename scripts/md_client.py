import socket
import struct
import ctypes

MCAST_GRP = '239.255.0.1'
MCAST_PORT = 9001

PRICE_SCALE = 1_000_000_00

class MDAddOrder(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("timestamp", ctypes.c_uint64),
        ("order_id", ctypes.c_uint64),
        ("symbol", ctypes.c_uint32),
        ("side", ctypes.c_uint8),
        # 3 bytes padding (since qty is 8-byte, wait, _pack_=1 means NO padding!)
        ("qty", ctypes.c_uint64),
        ("price", ctypes.c_int64),
    ]

class MDExecuteOrder(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("timestamp", ctypes.c_uint64),
        ("order_id", ctypes.c_uint64),
        ("exec_qty", ctypes.c_uint64),
        ("exec_price", ctypes.c_int64),
        ("match_id", ctypes.c_uint64),
    ]

class MDCancelOrder(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("timestamp", ctypes.c_uint64),
        ("order_id", ctypes.c_uint64),
        ("cancelled_qty", ctypes.c_uint64),
    ]

class MDMessageUnion(ctypes.Union):
    _pack_ = 1
    _fields_ = [
        ("add", MDAddOrder),
        ("exec", MDExecuteOrder),
        ("cancel", MDCancelOrder),
    ]

class MDMessage(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("type", ctypes.c_uint8),
        ("payload", MDMessageUnion)
    ]

def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    # Bind to the port
    sock.bind(('', MCAST_PORT))
    
    # Join multicast group
    mreq = struct.pack("4sl", socket.inet_aton(MCAST_GRP), socket.INADDR_ANY)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    
    print(f"Listening for Market Data on {MCAST_GRP}:{MCAST_PORT}...")
    
    msg = MDMessage()
    
    while True:
        try:
            data, addr = sock.recvfrom(1024)
            if len(data) >= ctypes.sizeof(MDMessage):
                ctypes.memmove(ctypes.addressof(msg), data, ctypes.sizeof(MDMessage))
                
                msg_type = chr(msg.type)
                if msg_type == 'A':
                    side_str = "Buy" if msg.payload.add.side == 0 else "Sell"
                    print(f"[MD] ADD: Order={msg.payload.add.order_id} {side_str} {msg.payload.add.qty} @ ${msg.payload.add.price / PRICE_SCALE:.2f}")
                elif msg_type == 'E':
                    print(f"[MD] EXEC: Order={msg.payload.exec.order_id} filled {msg.payload.exec.exec_qty} @ ${msg.payload.exec.exec_price / PRICE_SCALE:.2f}")
                elif msg_type == 'X':
                    print(f"[MD] CANCEL: Order={msg.payload.cancel.order_id}")
                else:
                    print(f"[MD] UNKNOWN TYPE: {msg_type}")
        except KeyboardInterrupt:
            break

if __name__ == "__main__":
    main()
