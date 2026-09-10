"""
Audit logging helper — logs security-relevant events without message content
"""
import json
import logging
import secrets

from fastapi import Request

from server.core import models
from server.core.database import SessionLocal

logger = logging.getLogger(__name__)

# Actions that are logged
AUDIT_ACTIONS = {
    "user_login": "Вход в систему",
    "user_register": "Регистрация",
    "user_logout": "Выход из системы",
    "password_changed": "Пароль изменён",
    "message_sent": "Сообщение отправлено",
    "file_uploaded": "Файл загружен",
    "call_started": "Звонок начат",
    "call_ended": "Звонок завершён",
    "chat_created": "Чат создан",
    "user_blocked": "Пользователь заблокирован",
    "e2e_keys_generated": "E2E ключи сгенерированы",
    "backup_created": "Бэкап создан",
    "backup_restored": "Бэкап восстановлен",
}


def client_ip(request: Request) -> str | None:
    """Extract real client IP from request, respecting X-Forwarded-For.

    Returns None when settings.LOG_IPS is False (deaf relay mode) —
    callers store it directly into AuditLog.ip_address (nullable).
    """
    from shared.config import settings
    if not settings.LOG_IPS:
        return None
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def log_audit(
    user_id: str,
    action: str,
    details: dict | None = None,
    ip_address: str | None = None,
):
    """Log an audit event (non-blocking, best-effort). Uses direct Session."""
    db = None
    try:
        db = SessionLocal()
        audit_log = models.AuditLog(
            id=f"audit_{secrets.token_hex(16)}",
            user_id=user_id,
            action=action,
            details=json.dumps(details) if details else None,
            ip_address=ip_address,
        )
        db.add(audit_log)
        db.commit()
    except Exception as e:
        logger.error(f"Audit log failed: {e}")
        if db:
            try:
                db.rollback()
            except Exception:
                pass
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


def get_audit_logs(
    user_id: str,
    skip: int = 0,
    limit: int = 100,
) -> list[dict]:
    """Get audit logs for a user"""
    db = None
    try:
        db = SessionLocal()
        logs = (
            db.query(models.AuditLog)
            .filter(models.AuditLog.user_id == user_id)
            .order_by(models.AuditLog.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        return [
            {
                "id": log.id,
                "action": log.action,
                "action_label": AUDIT_ACTIONS.get(log.action, log.action),
                "details": json.loads(log.details) if log.details else None,
                "ip_address": log.ip_address,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ]
    except Exception as e:
        logger.error(f"Get audit logs failed: {e}")
        return []
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass
