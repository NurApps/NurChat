import json
import time

from fastapi import WebSocket, WebSocketDisconnect

from server.utils.logger import logger


class GroupCallManager:
    def __init__(self):
        self.active_calls: dict[str, dict] = {}
        self.user_calls: dict[str, str] = {}
        self.connections: dict[str, WebSocket] = {}

    async def handle(self, ws: WebSocket, user_id: str):
        await ws.accept()
        self.connections[user_id] = ws
        logger.info(f"Group call WS connected: {user_id}")

        try:
            while True:
                raw = await ws.receive_text()
                data = json.loads(raw)
                event = data.get("type")
                call_id = data.get("call_id")

                if event == "join":
                    await self._join(ws, user_id, call_id, data)
                elif event == "leave":
                    await self._leave(user_id, call_id)
                elif event in ("offer", "answer", "ice-candidate"):
                    await self._relay(user_id, call_id, data)
                elif event == "mute":
                    await self._mute(user_id, call_id, data)
                elif event == "video-toggle":
                    await self._video_toggle(user_id, call_id, data)

        except WebSocketDisconnect:
            pass
        finally:
            call_id = self.user_calls.pop(user_id, None)
            if call_id:
                await self._leave(user_id, call_id, notify=True)
            self.connections.pop(user_id, None)
            logger.info(f"Group call WS disconnected: {user_id}")

    async def _join(self, ws: WebSocket, user_id: str, call_id: str, data: dict):
        if call_id not in self.active_calls:
            self.active_calls[call_id] = {
                "participants": {},
                "created_at": time.time(),
                "chat_id": data.get("chat_id"),
                "call_type": data.get("call_type", "audio"),
            }

        room = self.active_calls[call_id]
        room["participants"][user_id] = {
            "username": data.get("username", user_id),
            "is_muted": False,
            "is_video_off": False,
            "joined_at": time.time(),
        }
        self.user_calls[user_id] = call_id

        existing = [
            {"user_id": uid, **info}
            for uid, info in room["participants"].items()
            if uid != user_id
        ]

        await ws.send_text(json.dumps({
            "type": "joined",
            "call_id": call_id,
            "participants": existing,
        }))

        await self._broadcast(call_id, user_id, {
            "type": "participant-joined",
            "user_id": user_id,
            "username": data.get("username", user_id),
        })

        logger.info(f"User {user_id} joined group call {call_id} ({len(room['participants'])} participants)")

    async def _leave(self, user_id: str, call_id: str, notify: bool = True):
        room = self.active_calls.get(call_id)
        if not room:
            return

        room["participants"].pop(user_id, None)

        if notify:
            await self._broadcast(call_id, user_id, {
                "type": "participant-left",
                "user_id": user_id,
            })

        if not room["participants"]:
            del self.active_calls[call_id]
            logger.info(f"Group call {call_id} ended (no participants)")
        else:
            logger.info(f"User {user_id} left group call {call_id} ({len(room['participants'])} remaining)")

    async def _relay(self, sender_id: str, call_id: str, data: dict):
        room = self.active_calls.get(call_id)
        if not room:
            return

        target = data.get("to")
        if not target:
            return

        ws = self.connections.get(target)
        if ws:
            payload = {**data, "from": sender_id}
            payload.pop("to", None)
            await ws.send_text(json.dumps(payload))

    async def _mute(self, user_id: str, call_id: str, data: dict):
        room = self.active_calls.get(call_id)
        if not room:
            return

        p = room["participants"].get(user_id)
        if p:
            p["is_muted"] = data.get("is_muted", not p["is_muted"])

        await self._broadcast(call_id, user_id, {
            "type": "participant-muted",
            "user_id": user_id,
            "is_muted": p["is_muted"] if p else False,
        })

    async def _video_toggle(self, user_id: str, call_id: str, data: dict):
        room = self.active_calls.get(call_id)
        if not room:
            return

        p = room["participants"].get(user_id)
        if p:
            p["is_video_off"] = data.get("is_video_off", not p["is_video_off"])

        await self._broadcast(call_id, user_id, {
            "type": "participant-video-toggle",
            "user_id": user_id,
            "is_video_off": p["is_video_off"] if p else False,
        })

    async def _broadcast(self, call_id: str, exclude_user: str, message: dict):
        room = self.active_calls.get(call_id)
        if not room:
            return

        payload = json.dumps(message)
        for uid in room["participants"]:
            if uid != exclude_user:
                ws = self.connections.get(uid)
                if ws:
                    try:
                        await ws.send_text(payload)
                    except Exception:
                        pass

    async def notify_chat(self, chat_id: str, message: dict, exclude: str | None = None):
        from server.ws.chat_manager import connection_manager
        await connection_manager.broadcast_to_chat(chat_id, message, exclude_user=exclude)


group_call_manager = GroupCallManager()
