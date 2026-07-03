from __future__ import annotations

import json
import socket
import threading
from collections.abc import Callable
from queue import Queue

HOST_BIND = "0.0.0.0"
BACKLOG = 50
ENC = "utf-8"
HEADER_LEN = 4


def _send(sock: socket.socket, obj: dict):
    raw = json.dumps(obj, ensure_ascii=False).encode(ENC)
    sock.sendall(len(raw).to_bytes(HEADER_LEN, "big") + raw)


def _recv(sock: socket.socket) -> dict:
    hdr = sock.recv(HEADER_LEN)
    if not hdr:
        raise ConnectionError("closed")
    length = int.from_bytes(hdr, "big")
    buf = b""
    while len(buf) < length:
        chunk = sock.recv(max(4096, length - len(buf)))
        if not chunk:
            raise ConnectionError("closed")
        buf += chunk
    return json.loads(buf.decode(ENC))


class PeerConnection:
    def __init__(self, pid: str, sock: socket.socket, addr):
        self.pid = pid
        self.sock = sock
        self.addr = addr
        self._queue: Queue[dict] = Queue()
        self._alive = True
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()

    def _loop(self):
        while self._alive:
            try:
                msg = _recv(self.sock)
                self._queue.put(msg)
            except Exception:
                break
        self._alive = False

    def iter_messages(self):
        while self._alive or not self._queue.empty():
            try:
                yield self._queue.get(timeout=0.1)
            except Exception:
                if not self._alive:
                    break

    def send(self, obj: dict):
        if self._alive:
            try:
                _send(self.sock, obj)
            except Exception:
                self._alive = False

    def close(self):
        self._alive = False
        try:
            self.sock.close()
        except Exception:
            pass


class PeerServer:
    def __init__(self, port: int, on_message: Callable[[dict, PeerConnection], None]):
        self.port = port
        self.on_message = on_message
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._stop = threading.Event()
        self._conns: dict[str, PeerConnection] = {}

    def start(self):
        self._sock.bind((HOST_BIND, self.port))
        self._sock.listen(BACKLOG)
        threading.Thread(target=self._accept_loop, daemon=True).start()

    def _accept_loop(self):
        while not self._stop.is_set():
            try:
                s, addr = self._sock.accept()
                try:
                    hello = _recv(s)
                except Exception:
                    s.close()
                    continue
                pid = hello.get("from") or hello.get("pid") or "unknown"
                if pid == "unknown":
                    s.close()
                    continue
                conn = PeerConnection(pid, s, addr)
                self._conns[pid] = conn
                threading.Thread(target=self._reader, args=(pid, conn), daemon=True).start()
            except Exception:
                break

    def _reader(self, pid: str, conn: PeerConnection):
        for msg in conn.iter_messages():
            self.on_message(msg, conn)
        self._conns.pop(pid, None)

    def send_to(self, pid: str, obj: dict):
        conn = self._conns.get(pid)
        if conn:
            conn.send(obj)
        else:
            raise RuntimeError("peer_not_connected")

    def stop(self):
        self._stop.set()
        try:
            self._sock.close()
        except Exception:
            pass
        for c in list(self._conns.values()):
            c.close()
