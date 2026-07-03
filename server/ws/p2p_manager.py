from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone, timezone
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from server.core import models
from server.core.database import SessionLocal
from shared.config import settings

logger = logging.getLogger("nurchat_p2p_ws")


class P2PManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.peer_info: dict[str, dict] = {}

    async def handle_connection(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"P2P user {user_id} connected")

        try:
            while True:
                data = await websocket.receive_json()
                await self.handle_message(user_id, data)
        except WebSocketDisconnect:
            await self.disconnect(user_id)
        except Exception as exc:
            logger.error(f"P2P websocket error for {user_id}: {exc}")
            await self.disconnect(user_id)

    async def disconnect(self, user_id: str):
        self.active_connections.pop(user_id, None)
        self.peer_info.pop(user_id, None)
        logger.info(f"P2P user {user_id} disconnected")

    async def handle_message(self, user_id: str, data: dict):
        message_type = data.get("type")

        if message_type == "p2p-hello":
            await self.handle_hello(user_id, data)
        elif message_type == "p2p-signaling":
            await self.relay_signaling(user_id, data)
        elif message_type == "p2p-deliver":
            await self.deliver_encrypted(user_id, data)
        elif message_type == "p2p-sync":
            await self.sync_pending(user_id, data)
        else:
            logger.warning(f"Unknown P2P message type from {user_id}: {message_type}")

    async def handle_hello(self, user_id: str, data: dict):
        payload = data.get("data", {})
        self.peer_info[user_id] = {
            "peer_id": payload.get("peer_id") or user_id,
            "public_key": payload.get("public_key"),
            "signing_public_key": payload.get("signing_public_key"),
            "capabilities": payload.get("capabilities", []),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "seen_at": time.time(),
        }
        await self.send_json(user_id, {
            "type": "p2p-hello-ack",
            "data": {
                "user_id": user_id,
                "received_at": datetime.now(timezone.utc).isoformat(),
            },
        })

    async def relay_signaling(self, user_id: str, data: dict):
        target_user_id = data.get("target_user_id")
        if not target_user_id:
            await self.send_json(user_id, {"type": "p2p-error", "data": {"reason": "missing_target_user_id"}})
            return

        payload = data.get("data") or {}
        if target_user_id in self.active_connections:
            await self.send_json(target_user_id, {
                "type": "p2p-signaling",
                "data": {
                    "sender_id": user_id,
                    **payload,
                },
            })
        else:
            await self.save_offline(user_id, target_user_id, {
                "type": "p2p-signaling",
                "data": {
                    "sender_id": user_id,
                    **payload,
                },
            })

    async def deliver_encrypted(self, user_id: str, data: dict):
        target_user_id = data.get("target_user_id")
        if not target_user_id:
            await self.send_json(user_id, {"type": "p2p-error", "data": {"reason": "missing_target_user_id"}})
            return

        payload = data.get("data") or {}
        if target_user_id in self.active_connections:
            await self.send_json(target_user_id, {
                "type": "p2p-deliver",
                "data": {
                    "sender_id": user_id,
                    **payload,
                },
            })
            await self.send_json(user_id, {
                "type": "p2p-delivered",
                "data": {
                    "target_user_id": target_user_id,
                    "message_id": payload.get("message_id"),
                    "delivered_at": datetime.now(timezone.utc).isoformat(),
                },
            })
        else:
            await self.save_offline(user_id, target_user_id, {
                "type": "p2p-deliver",
                "data": {
                    "sender_id": user_id,
                    **payload,
                },
            })
            await self.send_json(user_id, {
                "type": "p2p-queued",
                "data": {
                    "target_user_id": target_user_id,
                    "message_id": payload.get("message_id"),
                    "queued_at": datetime.now(timezone.utc).isoformat(),
                },
            })

    async def sync_pending(self, user_id: str, data: dict):
        limit = min(int(data.get("limit") or settings.P2P_PENDING_LIMIT), max(settings.P2P_PENDING_LIMIT, 1))
        db: Session = SessionLocal()
        try:
            messages = db.query(models.P2PMessage).filter(
                models.P2PMessage.recipient_id == user_id
            ).order_by(models.P2PMessage.created_at.asc()).limit(limit).all()
            payload = []
            for message in messages:
                payload.append({
                    "id": message.id,
                    "sender_id": message.sender_id,
                    "payload": message.payload,
                    "created_at": message.created_at.isoformat() if message.created_at else None,
                })
                message.delivered_at = datetime.now(timezone.utc)
            db.commit()
            await self.send_json(user_id, {
                "type": "p2p-sync",
                "data": {
                    "messages": payload,
                    "count": len(payload),
                },
            })
        except Exception as exc:
            db.rollback()
            logger.error(f"P2P sync error for {user_id}: {exc}")
            await self.send_json(user_id, {"type": "p2p-error", "data": {"reason": "sync_failed", "detail": str(exc)}})
        finally:
            db.close()

    async def save_offline(self, sender_id: str, recipient_id: str, payload: dict):
        if not settings.P2P_RELAY_STORE_MESSAGES:
            return

        db: Session = SessionLocal()
        try:
            message_id = payload.get("message_id") or str(uuid4())
            db.add(models.P2PMessage(
                id=message_id,
                sender_id=sender_id,
                recipient_id=recipient_id,
                payload=json.dumps(payload, ensure_ascii=False),
                created_at=datetime.now(timezone.utc),
            ))
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.error(f"P2P offline save failed from {sender_id} to {recipient_id}: {exc}")
        finally:
            db.close()

    async def send_json(self, user_id: str, payload: dict) -> bool:
        websocket = self.active_connections.get(user_id)
        if not websocket:
            return False
        try:
            await websocket.send_json(payload)
            return True
        except Exception as exc:
            logger.error(f"P2P send to {user_id} failed: {exc}")
            self.active_connections.pop(user_id, None)
            return False


p2p_manager = P2PManager()
