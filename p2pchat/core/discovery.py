from __future__ import annotations

import socket
from collections.abc import Callable

import zeroconf

SERVICE_TYPE = "_nurchat._tcp.local."
SEARCH_TIMEOUT = 5.0
HELLO_INTERVAL = 20.0


class Discovery:
    def __init__(self, my_id: str, my_name: str, port: int, on_peer: Callable[[dict], None]):
        self.my_id = my_id
        self.my_name = my_name
        self.port = port
        self.on_peer = on_peer
        self._zc: zeroconf.Zeroconf | None = None
        self._srv: zeroconf.ServiceInfo | None = None
        self._browser: zeroconf.ServiceBrowser | None = None
        self._peers: dict[str, dict] = {}

    def start(self):
        self._zc = zeroconf.Zeroconf()
        props = {"id": self.my_id, "name": self.my_name, "port": str(self.port)}
        encoded = {k: v.encode("utf-8") for k, v in props.items()}
        self._srv = zeroconf.ServiceInfo(
            SERVICE_TYPE,
            name=f"{self.my_id}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(self._resolve_my_ip())],
            port=self.port,
            properties=encoded,
            server=f"{self.my_id}.local.",
        )
        self._zc.register_service(self._srv)
        self._browser = zeroconf.ServiceBrowser(self._zc, SERVICE_TYPE, self)

    def stop(self):
        try:
            if self._browser:
                self._browser.cancel()
            if self._srv and self._zc:
                self._zc.unregister_service(self._srv)
            if self._zc:
                self._zc.close()
        except Exception:
            pass

    def peers(self) -> list[dict]:
        return list(self._peers.values())

    def _resolve_my_ip(self) -> str:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    def remove_service(self, zc: zeroconf.Zeroconf, srv_type: str, name: str):
        pid = name.split(".")[0]
        self._peers.pop(pid, None)

    def add_service(self, zc: zeroconf.Zeroconf, srv_type: str, name: str):
        info = zc.get_service_info(srv_type, name)
        if not info:
            return
        pid = info.properties.get(b"id", name.encode()).decode("utf-8", "replace")
        peer = {
            "id": pid,
            "name": info.properties.get(b"name", b"").decode("utf-8", "replace"),
            "host": socket.inet_ntoa(info.addresses[0]) if info.addresses else "127.0.0.1",
            "port": info.port,
            "public_key": info.properties.get(b"public_key", b"").decode("utf-8", "replace"),
        }
        self._peers[pid] = peer
        self.on_peer(peer)

    def update_service(self, zc: zeroconf.Zeroconf, srv_type: str, name: str):
        self.add_service(zc, srv_type, name)
