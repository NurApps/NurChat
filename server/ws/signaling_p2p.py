import logging

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("nurchat_signaling")


class SignalingManager:
    def __init__(self):
        self.connections: dict[str, WebSocket] = {}
        self.pending: dict[str, list[dict]] = {}

    async def handle(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.connections[user_id] = websocket
        logger.info(f"Signaling: {user_id} connected")

        if user_id in self.pending:
            for msg in self.pending.pop(user_id):
                await websocket.send_json(msg)

        try:
            while True:
                data = await websocket.receive_json()
                msg_type = data.get("type")
                target = data.get("target_user_id")

                if not target:
                    await websocket.send_json({"type": "error", "reason": "missing_target"})
                    continue

                if target in self.connections:
                    await self.connections[target].send_json({
                        "type": msg_type,
                        "sender_id": user_id,
                        "data": data.get("data"),
                    })
                else:
                    self.pending.setdefault(target, []).append({
                        "type": msg_type,
                        "sender_id": user_id,
                        "data": data.get("data"),
                    })
        except WebSocketDisconnect:
            pass
        finally:
            self.connections.pop(user_id, None)
            logger.info(f"Signaling: {user_id} disconnected")


signaling_manager = SignalingManager()
