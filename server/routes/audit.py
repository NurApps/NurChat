"""Audit logs API"""
from fastapi import APIRouter, Depends

from server.core.audit import AUDIT_ACTIONS, get_audit_logs
from server.core.security import verify_token_dependency

router = APIRouter()


@router.get("/audit-logs")
async def list_audit_logs(
    skip: int = 0,
    limit: int = 100,
    token: dict = Depends(verify_token_dependency),
):
    """Получить историю действий пользователя"""
    user_id = token["sub"]
    logs = get_audit_logs(user_id, skip, limit)
    return {"logs": logs, "actions": AUDIT_ACTIONS}
