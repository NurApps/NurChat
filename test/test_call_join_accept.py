"""call-join должен принимать RINGING-звонок для callee.

Регрессия на «звонок не найден» при принятии: call_accept через chat WS
мог потеряться при навигации ChatPage -> CallPage. В этом случае callee
подключается к calls WS и шлёт call-join, а звонок всё ещё RINGING —
сервер обязан принять его автоматически.
"""
import asyncio
from datetime import datetime, timezone

from shared.constants import CALL_STATUS


class TestCallJoinAutoAccept:
    def test_callee_join_accepts_ringing_call(self):
        from server.ws.signaling import call_manager

        call_id = "call_test_join_accept"
        caller, callee = "user_caller_x", "user_callee_x"
        call_manager.active_calls[call_id] = {
            "caller_id": caller,
            "callee_id": callee,
            "call_type": "audio",
            "status": CALL_STATUS["RINGING"],
            "started_at": datetime.now(timezone.utc),
        }
        call_manager.user_calls[caller] = call_id
        call_manager.user_calls[callee] = call_id

        async def _run():
            await call_manager._handle_call_join(callee, {"call_id": call_id})

        try:
            asyncio.run(_run())
            assert call_manager.active_calls[call_id]["status"] == CALL_STATUS["ACTIVE"]
            caller_msgs = [e["msg"] for e in call_manager.pending_messages.get(caller, [])]
            callee_msgs = [e["msg"] for e in call_manager.pending_messages.get(callee, [])]
            assert any(m.get("type") == "call-accepted" for m in caller_msgs)
            assert any(m.get("type") == "call-request" for m in callee_msgs)
        finally:
            call_manager._cleanup_call(call_id)
            call_manager.pending_messages.pop(caller, None)
            call_manager.pending_messages.pop(callee, None)

    def test_join_missing_call_sends_not_found(self):
        from server.ws.signaling import call_manager

        user = "user_nobody_x"

        async def _run():
            await call_manager._handle_call_join(user, {"call_id": "call_no_such"})

        try:
            asyncio.run(_run())
            msgs = [e["msg"] for e in call_manager.pending_messages.get(user, [])]
            failed = [m for m in msgs if m.get("type") == "call-failed"]
            assert failed and failed[-1].get("reason") == "call_not_found"
        finally:
            call_manager.pending_messages.pop(user, None)
