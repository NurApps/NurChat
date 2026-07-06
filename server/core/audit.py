"""
Audit logging helper — logs security-relevant events without message content
"""
import json
import logging
from datetime import datetime, timezone
from server.core.database import get_db
from server.core import models

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


def log_audit(
    user_id: str,
    action: str,
    details: dict | None = None,
    ip_address: str | None = None,
):
    """Log an audit event (non-blocking, best-effort)"""
    try:
        db = next(get_db())
        audit_log = models.AuditLog(
            user_id=user_id,
            action=action,
            details=json.dumps(details) if details else None,
            ip_address=ip_address,
        )
        db.add(audit_log)
        db.commit()
    except Exception as e:
        logger.error(f"Audit log failed: {e}")


def get_audit_logs(
    user_id: str,
    skip: int = 0,
    limit: int = 100,
) -> list[dict]:
    """Get audit logs for a user"""
    try:
        db = next(get_db())
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
