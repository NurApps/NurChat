import logging

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("nurchat_signaling")


class SignalingManager:
    """Generic signaling relay for WebRTC and P2P.

    Forwards messages between peers. Supports buffering for offline targets.

    Message format (frontend → server):
        {"type": "offer"|"answer"|"ice-candidate", "to": "<peer_id>", ...}

    Message format (server → frontend):
        {"type": "<same>", "from": "<sender_id>", ...}
    """

    def __init__(self):
        self.connections: dict[str, WebSocket] = {}
        self.pending: dict[str, list[dict]] = {}

    async def handle(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.connections[user_id] = websocket
        logger.info(f"Signaling: {user_id} connected")

        # Flush pending messages
        if user_id in self.pending:
            for msg in self.pending.pop(user_id):
                try:
                    await websocket.send_json(msg)
                except Exception:
                    break

        try:
            while True:
                data = await websocket.receive_json()
                msg_type = data.get("type")

                if not msg_type:
                    await websocket.send_json({"type": "error", "reason": "missing_type"})
                    continue

                # Accept both "to" and "target_user_id" as target field
                target = data.get("to") or data.get("target_user_id")
                if not target:
                    await websocket.send_json({"type": "error", "reason": "missing_target"})
                    continue

                # Forward message to target, preserving all fields
                forward = {
                    "type": msg_type,
                    "from": user_id,
                }
                # Copy relevant fields (sdp, candidate, etc.)
                for key in ("sdp", "candidate", "data"):
                    if key in data:
                        forward[key] = data[key]

                if target in self.connections:
                    try:
                        await self.connections[target].send_json(forward)
                    except Exception:
                        self.pending.setdefault(target, []).append(forward)
                else:
                    self.pending.setdefault(target, []).append(forward)
                    logger.debug(f"Signaling: buffered {msg_type} for offline {target}")

        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error(f"Signaling error for {user_id}: {e}")
        finally:
            self.connections.pop(user_id, None)
            logger.info(f"Signaling: {user_id} disconnected")


signaling_manager = SignalingManager()
