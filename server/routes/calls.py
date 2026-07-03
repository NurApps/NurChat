import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, status
from sqlalchemy.orm import Session

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import security, verify_token_dependency
from server.utils.logger import logger
from server.ws.notifications import notification_manager
from server.ws.signaling import call_manager

router = APIRouter()

def generate_call_id():
    """Генерация ID звонка"""
    return f"call_{secrets.token_hex(16)}"

@router.websocket("/ws/calls/{user_id}")
async def calls_websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint для звонков в NurChat"""
    await call_manager.handle_signaling(websocket, user_id)

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
                logger.warning(f"Users {token['sub']} and {call_data.target_user_id} are not in the same chat: {call_data.chat_id}")
                raise HTTPException(status_code=403, detail="Пользователи не в одном чате")

        # Генерируем ID звонка
        call_id = security.generate_call_id()

        # Создаем запись о звонке
        call_log = models.CallLog(
            call_id=call_id,
            caller_id=token["sub"],
            callee_id=call_data.target_user_id,
            call_type=call_data.call_type,
            started_at=datetime.now(timezone.utc)
        )

        db.add(call_log)
        db.commit()
        db.refresh(call_log)

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
            started_at=call_log.started_at
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Start call error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера"
        )

@router.post("/end-call/{call_id}")
async def end_call(
    call_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Завершение звонка в NurChat"""
    try:
        logger.info(f"Call end requested by user: {token['sub']} for call: {call_id}")

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

        # Рассчитываем длительность
        if call_log.started_at and call_log.ended_at:
            duration = (call_log.ended_at - call_log.started_at).total_seconds()
            call_log.duration = int(duration)

        db.commit()

        logger.info(f"Call ended: {call_id}, ended by user: {token['sub']}")
        return {"message": "Звонок завершен", "call_id": call_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"End call error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера"
        )

@router.get("/call-history", response_model=schemas.CallHistoryResponse)
async def get_call_history(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Получение истории звонков пользователя"""
    try:
        logger.info(f"Getting call history for user: {token['sub']}, skip: {skip}, limit: {limit}")

        # Ограничиваем лимит для безопасности
        if limit > 100:
            limit = 100

        # Получаем звонки где пользователь был caller или callee
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
    except Exception as e:
        logger.error(f"Get call history error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера"
        )
