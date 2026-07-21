from __future__ import annotations

import asyncio
import json
import socket
import struct
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from server.utils.logger import logger
from shared.config import settings

MCAST_GROUP = "239.255.43.21"
MCAST_PORT = 8002
DISCOVERY_INTERVAL = 60

_node_id: str = ""


def get_node_id() -> str:
    global _node_id
    if not _node_id:
        _node_id = str(uuid.uuid4())[:8]
    return _node_id


@dataclass
class LanPeer:
    node_id: str
    host: str
    port: int
    user_id: str | None
    username: str | None
    peer_name: str
    last_seen: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "host": self.host,
            "port": self.port,
            "user_id": self.user_id,
            "username": self.username,
            "peer_name": self.peer_name,
            "last_seen": self.last_seen.isoformat(),
        }


_discovered_peers: dict[str, LanPeer] = {}
_discovery_task: asyncio.Task | None = None
_discovery_server: asyncio.DatagramServer | None = None


async def _build_advert(current_user_id: str | None, current_username: str | None) -> bytes:
    payload = json.dumps({
        "type": "nurchat_advert",
        "node_id": get_node_id(),
        "host": settings.SERVER_HOST if settings.SERVER_HOST != "127.0.0.1" else _get_external_ip(),
        "port": settings.SERVER_PORT,
        "user_id": current_user_id or "",
        "username": current_username or "",
        "peer_name": f"NurChat {current_username or 'anonymous'}",
    })
    return payload.encode("utf-8")


def _get_external_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class DiscoveryProtocol(asyncio.DatagramProtocol):
    def __init__(self) -> None:
        self.transport: asyncio.DatagramTransport | None = None
        self._current_user_id: str | None = None
        self._current_username: str | None = None

    def set_user(self, user_id: str | None, username: str | None) -> None:
        self._current_user_id = user_id
        self._current_username = username

    def connection_made(self, transport: asyncio.DatagramTransport) -> None:
        self.transport = transport

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        try:
            msg = json.loads(data.decode("utf-8"))
            msg_type = msg.get("type", "")
            sender_host, sender_port = addr

            if msg_type == "nurchat_discover":
                asyncio.ensure_future(self._respond(sender_host, sender_port))
            elif msg_type == "nurchat_advert":
                self._register_peer(msg, sender_host)
        except Exception as e:
            logger.debug("Discovery protocol error: %s", e)

    def _register_peer(self, msg: dict, sender_host: str) -> None:
        node_id = msg.get("node_id", "")
        if not node_id or node_id == get_node_id():
            return
        _discovered_peers[node_id] = LanPeer(
            node_id=node_id,
            host=msg.get("host", sender_host),
            port=int(msg.get("port", 8000)),
            user_id=msg.get("user_id"),
            username=msg.get("username"),
            peer_name=msg.get("peer_name", f"Peer {node_id[:8]}"),
        )
        logger.debug("Discovered LAN peer: %s at %s:%s", node_id, sender_host, msg.get("port"))

    async def _respond(self, target_host: str, target_port: int) -> None:
        if not self.transport:
            return
        resp = await _build_advert(self._current_user_id, self._current_username)
        self.transport.sendto(resp, (target_host, target_port))


async def start_discovery(current_user_id: str | None = None, current_username: str | None = None) -> None:
    global _discovery_task, _discovery_server
    if _discovery_task is not None:
        return

    loop = asyncio.get_running_loop()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", MCAST_PORT))

    mreq = struct.pack("4sl", socket.inet_aton(MCAST_GROUP), socket.INADDR_ANY)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

    ttl = struct.pack("b", 2)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, ttl)

    sock.setblocking(False)

    protocol = DiscoveryProtocol()
    protocol.set_user(current_user_id, current_username)
    _discovery_server = await loop.create_datagram_endpoint(
        lambda: protocol,
        sock=sock,
    )

    _discovery_task = asyncio.create_task(_periodic_advert(protocol))
    logger.info("LAN discovery started on %s:%s", MCAST_GROUP, MCAST_PORT)


async def stop_discovery() -> None:
    global _discovery_task, _discovery_server
    if _discovery_task:
        _discovery_task.cancel()
        _discovery_task = None
    if _discovery_server:
        _discovery_server[0].close()
        _discovery_server = None
    _discovered_peers.clear()
    logger.info("LAN discovery stopped")


async def _periodic_advert(protocol: DiscoveryProtocol) -> None:
    while True:
        try:
            await asyncio.sleep(DISCOVERY_INTERVAL)
            if protocol.transport:
                advert = await _build_advert(protocol._current_user_id, protocol._current_username)
                protocol.transport.sendto(advert, (MCAST_GROUP, MCAST_PORT))
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug("Periodic advert error: %s", e)


async def scan_lan(timeout: float = 3.0) -> list[dict]:
    _discovered_peers.clear()

    loop = asyncio.get_running_loop()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", 0))
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, struct.pack("b", 2))
    sock.setblocking(False)

    query = json.dumps({"type": "nurchat_discover"}).encode("utf-8")

    async def _listen() -> None:
        loop2 = asyncio.get_running_loop()
        listen_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        listen_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listen_sock.bind(("", MCAST_PORT))
        mreq = struct.pack("4sl", socket.inet_aton(MCAST_GROUP), socket.INADDR_ANY)
        listen_sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        listen_sock.setblocking(False)

        _, proto = await loop2.create_datagram_endpoint(
            lambda: DiscoveryProtocol(),
            sock=listen_sock,
        )
        await asyncio.sleep(timeout)
        proto[0].close()

    listen_task = asyncio.create_task(_listen())
    await asyncio.sleep(0.1)

    sock.sendto(query, (MCAST_GROUP, MCAST_PORT))
    sock.close()

    await listen_task

    return [p.to_dict() for p in _discovered_peers.values()]
