import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger("nurchat_remote")


class RemotePeer:
    def __init__(self, node_id: str, ws: WebSocket, address: str, user_id: str):
        self.node_id = node_id
        self.ws = ws
        self.address = address
        self.user_id = user_id
        self.connected_at = datetime.now(timezone.utc)


class RemotePeerManager:
    """Управляет прямыми P2P соединениями между серверами"""

    def __init__(self):
        self._peers: dict[str, RemotePeer] = {}
        self._user_map: dict[str, str] = {}

    @property
    def active_peers(self) -> list[dict]:
        return [
            {
                "node_id": p.node_id,
                "address": p.address,
                "user_id": p.user_id,
                "connected_at": p.connected_at.isoformat(),
            }
            for p in self._peers.values()
        ]

    async def connect(self, node_id: str, ws: WebSocket, address: str, user_id: str):
        old = self._peers.pop(node_id, None)
        if old:
            try:
                await old.ws.close()
            except Exception:
                pass
        self._peers[node_id] = RemotePeer(node_id, ws, address, user_id)
        self._user_map[user_id] = node_id
        logger.info("Remote peer connected: %s (%s)", node_id, address)

    def disconnect(self, node_id: str):
        peer = self._peers.pop(node_id, None)
        if peer:
            self._user_map.pop(peer.user_id, None)
            logger.info("Remote peer disconnected: %s", node_id)

    def get_peer_by_node(self, node_id: str) -> Optional[RemotePeer]:
        return self._peers.get(node_id)

    def get_peer_by_user(self, user_id: str) -> Optional[RemotePeer]:
        node_id = self._user_map.get(user_id)
        if node_id:
            return self._peers.get(node_id)
        return None

    async def relay_message(self, target_user_id: str, message: dict) -> bool:
        peer = self.get_peer_by_user(target_user_id)
        if not peer:
            return False
        try:
            await peer.ws.send_json(message)
            return True
        except Exception as e:
            logger.warning("Failed to relay to %s: %s", target_user_id, e)
            self.disconnect(peer.node_id)
            return False

    async def broadcast_online(self, user_id: str, username: str):
        for peer in list(self._peers.values()):
            try:
                await peer.ws.send_json({
                    "type": "peer_online",
                    "user_id": user_id,
                    "username": username,
                })
            except Exception:
                self.disconnect(peer.node_id)

    async def broadcast_offline(self, user_id: str):
        for peer in list(self._peers.values()):
            try:
                await peer.ws.send_json({
                    "type": "peer_offline",
                    "user_id": user_id,
                })
            except Exception:
                self.disconnect(peer.node_id)


remote_manager = RemotePeerManager()
