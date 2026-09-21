from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import security, verify_token_dependency
from server.utils.logger import logger
from server.ws.notifications import notification_manager

router = APIRouter()


@router.post("/start-call", response_model=schemas.CallResponse)
async def start_call(
    call_data: schemas.CallStartRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Начало звонка в NurChat"""
    try:
        logger.info(f"Call start requested by user: {token['sub']} to user: {call_data.target_user_id}")

        # Проверяем, что целевой пользователь существует
        target_user = db.query(models.User).filter(
            models.User.id == call_data.target_user_id
        ).first()

        if not target_user:
            logger.warning(f"User {token['sub']} tried to call non-existent user: {call_data.target_user_id}")
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        # Блокировки: звонок невозможен в любую сторону блокировки.
        me, peer = token["sub"], call_data.target_user_id
        blocked = db.query(models.BlockedUser).filter(
            ((models.BlockedUser.user_id == me) & (models.BlockedUser.blocked_user_id == peer)) |
            ((models.BlockedUser.user_id == peer) & (models.BlockedUser.blocked_user_id == me)),
        ).first()
        if blocked:
            raise HTTPException(status_code=403, detail="Пользователь заблокирован")

        # Проверяем, что пользователи в одном чате (если указан chat_id)
        if call_data.chat_id:
            caller_in_chat = db.query(models.ChatParticipant).filter(
                models.ChatParticipant.chat_id == call_data.chat_id,
                models.ChatParticipant.user_id == token["sub"]
            ).first()

            target_in_chat = db.query(models.ChatParticipant).filter(
                models.ChatParticipant.chat_id == call_data.chat_id,
                models.ChatParticipant.user_id == call_data.target_user_id
            ).first()

            if not caller_in_chat or not target_in_chat:
                uid1, uid2 = token["sub"], call_data.target_user_id
                logger.warning(f"Users {uid1} and {uid2} not in same chat: {call_data.chat_id}")
                raise HTTPException(status_code=403, detail="Пользователи не в одном чате")

        # Один ID на звонок для REST и WS: клиент (CallPage) генерит
        # call_<ms>_<rand> и шлёт его в WS call-request. Если REST вызвать
        # без call_id — получим второй ID того же звонка (гонка, дубль
        # уведомлений). Поэтому принимаем клиентский call_id и сразу
        # создаём строку CallLog (ringing), чтобы end-call не падал в 404
        # для звонков, ещё не дошедших до accept.
        call_id = call_data.call_id or security.generate_call_id()

        # Minimal metadata mode: don't persist CallLog on relay; history lives
        # on devices only. Signaling (WS) still forwards call-request.
        from shared.config import settings as _cfg
        if _cfg.CALLS_MINIMAL_METADATA:
            logger.info(f"Call {call_id} minimal mode: skip DB persist ({token['sub']}→{call_data.target_user_id})")
        else:
            existing = db.query(models.CallLog).filter(
                models.CallLog.call_id == call_id
            ).first()
            if existing:
                logger.info(f"Call {call_id} already exists, returning it idempotently")
                return schemas.CallResponse.model_validate(existing)

            db.add(models.CallLog(
                call_id=call_id,
                caller_id=token["sub"],
                callee_id=call_data.target_user_id,
                call_type=call_data.call_type,
                started_at=datetime.now(timezone.utc),
            ))
            db.commit()

        try:
            await notification_manager.send_call_notification(
                call_data={
                    "call_id": call_id,
                    "caller_id": token["sub"],
                    "call_type": call_data.call_type,
                    "chat_id": call_data.chat_id
                },
                target_user_id=call_data.target_user_id
            )
        except Exception as notify_error:
            logger.error(f"Failed to send call notification: {notify_error}")

        logger.info(f"Call started: {call_id}, from {token['sub']} to {call_data.target_user_id}")
        return schemas.CallResponse(
            call_id=call_id,
            caller_id=token["sub"],
            callee_id=call_data.target_user_id,
            call_type=call_data.call_type,
            status="ringing",
            started_at=datetime.now(timezone.utc)
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Start call error: {e}")
        db.rollback()
        raise


@router.post("/end-call/{call_id}")
async def end_call(
    call_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Завершение звонка в NurChat"""
    try:
        logger.info(f"Call end requested by user: {token['sub']} for call: {call_id}")

        from shared.config import settings as _cfg2
        if _cfg2.CALLS_MINIMAL_METADATA:
            # No DB row to update; just forward call-ended via signaling
            try:
                from server.ws.signaling import call_manager
                # Broadcast to both sides via cleanup
                await call_manager._send_to_user(call_id, {
                    "type": "call-ended",
                    "call_id": call_id,
                    "ended_by": token["sub"],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                call_manager._cleanup_call(call_id)
            except Exception:
                pass
            logger.info(f"Call ended (minimal): {call_id} by {token['sub']}")
            return {"message": "Звонок завершен", "call_id": call_id}

        # Находим запись о звонке
        call_log = db.query(models.CallLog).filter(
            models.CallLog.call_id == call_id
        ).first()

        if not call_log:
            logger.warning(f"User {token['sub']} tried to end non-existent call: {call_id}")
            raise HTTPException(status_code=404, detail="Звонок не найден")

        # Проверяем права
        if call_log.caller_id != token["sub"] and call_log.callee_id != token["sub"]:
            logger.warning(f"User {token['sub']} tried to end call {call_id} without permission")
            raise HTTPException(status_code=403, detail="Нет доступа к этому звонку")

        # Обновляем запись
        call_log.ended_at = datetime.now(timezone.utc)
        call_log.ended_by = token["sub"]

        # Рассчитываем длительность. started_at из SQLite возвращается
        # naive (без tz), а ended_at — aware: нормализуем перед вычитанием,
        # иначе TypeError и 500 на любом REST end-call.
        if call_log.started_at and call_log.ended_at:
            started = call_log.started_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            duration = (call_log.ended_at - started).total_seconds()
            call_log.duration = int(duration)

        db.commit()

        # REST end-call раньше только писал в БД и не уведомлял пира:
        # второй участник узнавал о завершении лишь по своему таймауту.
        # Рассылаем call-ended через signaling-менеджер и чистим звонок.
        try:
            from server.ws.signaling import call_manager
            other_user = (
                call_log.callee_id
                if token["sub"] == call_log.caller_id
                else call_log.caller_id
            )
            await call_manager._send_to_user(other_user, {
                "type": "call-ended",
                "call_id": call_id,
                "ended_by": token["sub"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            call_manager._cleanup_call(call_id)
        except Exception as sig_error:
            logger.warning(f"Call {call_id}: peer notify on end failed: {sig_error}")

        logger.info(f"Call ended: {call_id}, ended by user: {token['sub']}")
        return {"message": "Звонок завершен", "call_id": call_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"End call error: {e}")
        db.rollback()
        raise

@router.get("/call-history", response_model=schemas.CallHistoryResponse)
async def get_call_history(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    from shared.config import settings as _cfg3
    if _cfg3.CALLS_MINIMAL_METADATA:
        # Relay doesn't store history in minimal mode; client keeps local history.
        return schemas.CallHistoryResponse(calls=[], total=0)
    logger.info(f"Getting call history for user: {token['sub']}, skip: {skip}, limit: {limit}")

    if limit > 100:
        limit = 100

    calls = db.query(models.CallLog).filter(
        (models.CallLog.caller_id == token["sub"]) |
        (models.CallLog.callee_id == token["sub"])
    ).order_by(models.CallLog.started_at.desc()).offset(skip).limit(limit).all()

    total = db.query(models.CallLog).filter(
        (models.CallLog.caller_id == token["sub"]) |
        (models.CallLog.callee_id == token["sub"])
    ).count()

    call_responses = [schemas.CallResponse.model_validate(call) for call in calls]

    logger.info(f"Retrieved {len(call_responses)} calls for user: {token['sub']}, total: {total}")
    return schemas.CallHistoryResponse(
        calls=call_responses,
        total=total
    )


@router.get("/ice-servers")
async def get_ice_servers(token: dict = Depends(verify_token_dependency)):
    """Get configured ICE servers (STUN/TURN) for WebRTC."""
    import json

    from shared.config import settings

    # Parse STUN servers
    stun_list = [
        {"urls": s.strip()}
        for s in settings.STUN_SERVERS.split(",")
        if s.strip()
    ]

    # Parse custom ICE servers (takes precedence)
    if settings.WEBRTC_ICE_SERVERS:
        try:
            custom = json.loads(settings.WEBRTC_ICE_SERVERS)
            if isinstance(custom, list) and len(custom) > 0:
                return {"ice_servers": custom}
        except Exception:
            pass

    # Use TURN_SERVERS config if set, with credentials from config
    if settings.TURN_SERVERS:
        try:
            turn_list = json.loads(settings.TURN_SERVERS)
            if isinstance(turn_list, list) and len(turn_list) > 0:
                return {"ice_servers": turn_list}
        except Exception:
            pass

    # Build TURN entries from TURN_URLS + TURN_USERNAME/TURN_CREDENTIAL.
    # TURN_URLS — comma-separated, напр. "turn:relay.example.com:3478".
    # Хосты НЕ выдумываем: внутренний docker-хост (coturn/nurchat-turn)
    # удалённым клиентам бесполезен, а неверный URL тихо ломает звонки
    # (клиент ждёт кандидата, которого не будет).
    if settings.TURN_URLS and settings.TURN_CREDENTIAL != "CHANGE_ME_IN_PRODUCTION":
        urls = [u.strip() for u in settings.TURN_URLS.split(",") if u.strip()]
        if urls:
            turn_server = {
                "urls": urls if len(urls) > 1 else urls[0],
                "username": settings.TURN_USERNAME,
                "credential": settings.TURN_CREDENTIAL,
            }
            return {"ice_servers": stun_list + [turn_server]}

    # Честно: без TURN звонки за NAT (мобильные сети, офисы) не соединятся —
    # только STUN. Оператору продакшена нужен coturn (см. infra/coturn.conf)
    # + TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL (или WEBRTC_ICE_SERVERS JSON).
    logger.warning(
        "ICE servers: TURN not configured — calls behind NAT will fail. "
        "Set TURN_URLS + TURN_USERNAME/TURN_CREDENTIAL (infra/coturn.conf) "
        "or WEBRTC_ICE_SERVERS JSON for production."
    )
    return {"ice_servers": stun_list}
