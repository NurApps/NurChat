import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import security, verify_token_dependency
from server.utils.logger import logger
from shared.exceptions import ChatNotFoundError, MessageNotFoundError

if str(Path(__file__).resolve().parent.parent.parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_

from server.ws.chat_manager import connection_manager
from server.ws.notifications import notification_manager

router = APIRouter()


@router.get("/chats", response_model=list[schemas.ChatResponse])
async def get_user_chats(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
    search: str | None = None
):
    try:
        user_id = token["sub"]

        query = db.query(models.Chat).join(models.ChatParticipant).filter(models.ChatParticipant.user_id == user_id)
        if search:
            query = query.filter(or_(models.Chat.name.ilike(f"%{search}%"), models.Chat.id.ilike(f"%{search}%")))
        user_chats = query.all()
        chat_ids = [c.id for c in user_chats]

        if not chat_ids:
            return []

        # Batch load last messages for all chats
        last_msg_subq = (
            db.query(models.Message.chat_id, models.Message.id.label("msg_id"))
            .filter(models.Message.chat_id.in_(chat_ids))
            .order_by(models.Message.chat_id, models.Message.created_at.desc())
            .distinct(models.Message.chat_id)
            .subquery()
        )
        last_messages = {}
        if chat_ids:
            msgs = db.query(models.Message).join(
                last_msg_subq, models.Message.id == last_msg_subq.c.msg_id
            ).options(joinedload(models.Message.user)).all()
            last_messages = {m.chat_id: m for m in msgs}

        # Batch load participants
        all_participants = db.query(models.User, models.ChatParticipant).join(
            models.ChatParticipant, models.User.id == models.ChatParticipant.user_id
        ).filter(models.ChatParticipant.chat_id.in_(chat_ids)).all()
        chat_participants: dict[str, list] = {}
        user_participant_map: dict[str, dict] = {}
        for user, participant in all_participants:
            chat_participants.setdefault(participant.chat_id, []).append(user)
            if participant.user_id == user_id:
                user_participant_map[participant.chat_id] = participant

        # Batch load unread counts
        unread_counts = {}
        if chat_ids:
            unread_rows = (
                db.query(models.Message.chat_id, func.count().label("cnt"))
                .join(models.MessageReadStatus, models.MessageReadStatus.message_id == models.Message.id)
                .filter(
                    models.Message.chat_id.in_(chat_ids),
                    models.MessageReadStatus.user_id == user_id,
                    models.MessageReadStatus.is_read == False
                )
                .group_by(models.Message.chat_id)
                .all()
            )
            unread_counts = {row.chat_id: row.cnt for row in unread_rows}

        chats_response = []
        for chat in user_chats:
            try:
                participant = user_participant_map.get(chat.id)
                is_pinned = participant.is_pinned if participant else False
                is_muted = participant.is_muted if participant else False
                participants = chat_participants.get(chat.id, [])
                last_message = last_messages.get(chat.id)
                unread = unread_counts.get(chat.id, 0)

                chats_response.append(schemas.ChatResponse(
                    id=chat.id, name=chat.name, is_group=chat.is_group, created_at=chat.created_at,
                    participants=[schemas.UserResponse.model_validate(p) for p in participants],
                    last_message=schemas.MessageResponse.model_validate(last_message) if last_message else None,
                    unread_count=unread, is_pinned=is_pinned, is_muted=is_muted,
                ))
            except Exception as e:
                logger.error(f"Error processing chat {chat.id}: {e}")
                continue

        def get_sort_key(c):
            if c.last_message and c.last_message.created_at:
                return (not c.is_pinned, c.last_message.created_at)
            return (not c.is_pinned, datetime.min.replace(tzinfo=None))

        chats_response.sort(key=get_sort_key, reverse=True)
        return chats_response
    except Exception as e:
        logger.error(f"Get user chats error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.post("/chats", response_model=schemas.ChatResponse)
async def create_chat(
    chat_data: schemas.ChatCreate,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Creating chat for user: {user_id}")
        if user_id not in chat_data.participant_ids:
            chat_data.participant_ids.append(user_id)

        chat_id = security.generate_chat_id()
        now = datetime.now(timezone.utc)

        chat = models.Chat(id=chat_id, name=chat_data.name, is_group=chat_data.is_group, is_secret=chat_data.is_secret, disappears_after_seconds=chat_data.disappears_after_seconds)
        db.add(chat)
        added = 0
        for uid in chat_data.participant_ids:
            exists = db.query(models.User).filter(models.User.id == uid).first()
            if exists:
                is_creator = (uid == user_id and chat_data.is_group)
                db.add(models.ChatParticipant(chat_id=chat_id, user_id=uid, is_admin=is_creator))
                added += 1
            else:
                logger.warning(f"User {uid} does not exist, skipping")
        db.commit()
        db.refresh(chat)
        for uid in chat_data.participant_ids:
            if db.query(models.User).filter(models.User.id == uid).first():
                connection_manager.add_user_to_chat(user_id=uid, chat_id=chat_id)
        logger.info(f"Chat created: {chat_id} with {added} participants")
        return schemas.ChatResponse(id=chat.id, name=chat.name, is_group=chat.is_group, is_secret=chat.is_secret, disappears_after_seconds=chat.disappears_after_seconds, created_at=chat.created_at, participants=[], last_message=None)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create chat error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.get("/chats/{chat_id}/messages", response_model=list[schemas.MessageResponse])
async def get_chat_messages(
    chat_id: str,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Getting messages for chat {chat_id} by user: {user_id}")

        participant = db.query(models.ChatParticipant).filter(models.ChatParticipant.chat_id == chat_id, models.ChatParticipant.user_id == user_id).first()
        if not participant:
            logger.warning(f"User {user_id} tried to access chat {chat_id} without permission")
            raise ChatNotFoundError("Чат не найден или доступ запрещен")
        if limit > 100:
            limit = 100
        messages = db.query(models.Message).options(joinedload(models.Message.user)).filter(models.Message.chat_id == chat_id, models.Message.is_deleted == False).order_by(models.Message.created_at.desc()).offset(skip).limit(limit).all()
        messages.reverse()
        processed_messages = []
        for msg in messages:
            try:
                processed_msg = schemas.MessageResponse.model_validate(msg)
                processed_messages.append(processed_msg)
            except Exception as e:
                logger.error(f"Error processing message {msg.id}: {e}")
        return processed_messages
    except ChatNotFoundError:
        raise
    except Exception as e:
        logger.error(f"Get chat messages error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.post("/chats/{chat_id}/messages", response_model=schemas.MessageResponse)
async def send_message(
    chat_id: str,
    message_data: schemas.MessageCreate,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Sending message to chat {chat_id} by user: {user_id}")

        participant = db.query(models.ChatParticipant).filter(models.ChatParticipant.chat_id == chat_id, models.ChatParticipant.user_id == user_id).first()
        if not participant:
            logger.warning(f"User {user_id} tried to send message to chat {chat_id} without permission")
            raise ChatNotFoundError("Чат не найден или доступ запрещен")
        if not message_data.content.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Содержимое сообщения не может быть пустым")
        message_content = message_data.content
        message_id = security.generate_message_id()

        # E2E: store encrypted envelope if provided
        encrypted_content = message_data.encrypted_content
        signature = message_data.signature
        if encrypted_content:
            message_content = "[encrypted]"

        message = models.Message(
            id=message_id, chat_id=chat_id, user_id=user_id,
            content=message_content, message_type=message_data.message_type,
            file_id=message_data.file_id, forwarded_from=message_data.forwarded_from,
            encrypted_content=encrypted_content, signature=signature,
            expires_at=getattr(message_data, 'expires_at', None),
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        message_full = db.query(models.Message).options(joinedload(models.Message.user)).filter(models.Message.id == message_id).first()
        if message_full:
            participants = db.query(models.ChatParticipant).filter(models.ChatParticipant.chat_id == chat_id, models.ChatParticipant.user_id != user_id).all()
            target_user_ids = [p.user_id for p in participants]
            for uid in target_user_ids:
                read_status = models.MessageReadStatus(message_id=message_id, user_id=uid, is_read=False)
                db.add(read_status)
            db.commit()
            try:
                notification_message_data = message_data.dict()
                notification_message_data['content'] = message_data.content
                await notification_manager.send_message_notification(message_data=notification_message_data, target_user_ids=target_user_ids)
            except Exception as notify_error:
                logger.error(f"Failed to send notification: {notify_error}")
            try:
                message_event = {
                    "event": "message",
                    "data": {
                        "id": message_id, "chat_id": chat_id,
                        "content": message_full.content,
                        "message_type": message_full.message_type,
                        "file_id": message_full.file_id,
                        "user_id": message_full.user_id,
                        "username": message_full.user.username if message_full.user else "Unknown",
                        "encrypted_content": message_full.encrypted_content,
                        "signature": message_full.signature,
                        "timestamp": message_full.created_at.isoformat() if message_full.created_at else None,
                    }
                }
                await connection_manager.broadcast_to_chat(message_event, chat_id, exclude_user=user_id)
            except Exception as ws_error:
                logger.error(f"Failed to broadcast message via WebSocket: {ws_error}")
            logger.info(f"Message sent successfully: {message_id} in chat {chat_id}")

            # Federation: deliver to remote server if chat name is a remote address
            if not chat_id.startswith("chat_"):
                chat_obj = db.query(models.Chat).filter(models.Chat.id == chat_id).first()
                if chat_obj and chat_obj.name and "@" in chat_obj.name:
                    from server.routes.federation import send_federated_message
                    sender_user = db.query(models.User).filter(models.User.id == user_id).first()
                    if sender_user:
                        try:
                            await send_federated_message(
                                sender_user=sender_user,
                                recipient_address=chat_obj.name,
                                content=message_data.content,
                                msg_id=message_id,
                                encrypted_content=encrypted_content,
                                message_type=message_data.message_type,
                            )
                        except Exception as fed_err:
                            logger.warning(f"Federation delivery failed: {fed_err}")

            return schemas.MessageResponse.model_validate(message_full)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Не удалось создать сообщение")
    except ChatNotFoundError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Send message error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.post("/messages/{message_id}/mark-as-read")
async def mark_message_as_read(
    message_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Marking message {message_id} as read by user: {user_id}")

        message = db.query(models.Message).filter(models.Message.id == message_id).first()
        if not message:
            raise MessageNotFoundError("Сообщение не найдено")
        participant = db.query(models.ChatParticipant).filter(models.ChatParticipant.chat_id == message.chat_id, models.ChatParticipant.user_id == user_id).first()
        if not participant:
            logger.warning(f"User {user_id} tried to mark message {message_id} as read without permission")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к сообщению")
        read_status = db.query(models.MessageReadStatus).filter(models.MessageReadStatus.message_id == message_id, models.MessageReadStatus.user_id == user_id).first()
        if read_status:
            read_status.is_read = True
            read_status.read_at = func.now()
        else:
            read_status = models.MessageReadStatus(message_id=message_id, user_id=user_id, is_read=True, read_at=func.now())
            db.add(read_status)
        db.commit()
        return {"message": "Сообщение отмечено как прочитанное"}
    except MessageNotFoundError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Mark message as read error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.get("/messages/{message_id}/read-count")
async def get_read_count(
    message_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        message = db.query(models.Message).filter(models.Message.id == message_id).first()
        if not message:
            raise HTTPException(status_code=404, detail="Сообщение не найдено")
        participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == message.chat_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not participant:
            raise HTTPException(status_code=403, detail="Нет доступа")
        total = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == message.chat_id
        ).count()
        read_count = db.query(models.MessageReadStatus).filter(
            models.MessageReadStatus.message_id == message_id,
            models.MessageReadStatus.is_read == True
        ).count()
        return {"read_count": read_count, "total_participants": total}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get read count error: {e}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: str,
    delete_for_all: bool = False,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Deleting message {message_id} by user: {user_id}, delete_for_all: {delete_for_all}")

        message = db.query(models.Message).filter(models.Message.id == message_id).first()
        if not message:
            raise MessageNotFoundError("Сообщение не найдено")
        if message.user_id != user_id:
            logger.warning(f"User {user_id} tried to delete message {message_id} not owned by them")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нельзя удалить чужое сообщение")
        if delete_for_all:
            message.deleted_for_all = True
        else:
            message.is_deleted = True
        db.commit()
        return {"message": "Сообщение удалено"}
    except MessageNotFoundError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete message error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.put("/messages/{message_id}/edit")
async def edit_message(
    message_id: str,
    new_content: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Editing message {message_id} by user: {user_id}")

        message = db.query(models.Message).filter(models.Message.id == message_id).first()
        if not message:
            raise MessageNotFoundError("Сообщение не найдено")
        if message.user_id != user_id:
            logger.warning(f"User {user_id} tried to edit message {message_id} not owned by them")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нельзя редактировать чужое сообщение")
        message.content = new_content
        db.commit()
        edit_event = {
            "event": "message_edit",
            "data": {
                "message_id": message_id,
                "chat_id": message.chat_id,
                "new_content": new_content,
                "edited_by": user_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }
        await connection_manager.broadcast_to_chat(edit_event, message.chat_id)
        return {"message": "Сообщение отредактировано"}
    except MessageNotFoundError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Edit message error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.post("/chats/{chat_id}/pin")
async def pin_chat(
    chat_id: str,
    pin: bool = True,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"{'Pinning' if pin else 'Unpinning'} chat {chat_id} for user: {user_id}")

        participant = db.query(models.ChatParticipant).filter(models.ChatParticipant.chat_id == chat_id, models.ChatParticipant.user_id == user_id).first()
        if not participant:
            raise ChatNotFoundError("Чат не найден")
        participant.is_pinned = pin
        db.commit()
        return {"message": f"Чат {'закреплён' if pin else 'откреплён'}"}
    except ChatNotFoundError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pin chat error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.post("/chats/{chat_id}/mute")
async def mute_chat(
    chat_id: str,
    mute: bool = True,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"{'Muting' if mute else 'Unmuting'} chat {chat_id} for user: {user_id}")

        participant = db.query(models.ChatParticipant).filter(models.ChatParticipant.chat_id == chat_id, models.ChatParticipant.user_id == user_id).first()
        if not participant:
            raise ChatNotFoundError("Чат не найден")
        participant.is_muted = mute
        db.commit()
        return {"message": f"Уведомления {'отключены' if mute else 'включены'}"}
    except ChatNotFoundError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Mute chat error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.delete("/chats/{chat_id}")
async def delete_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Удаление чата (выход из чата / удаление для себя)"""
    try:
        user_id = token["sub"]
        logger.info(f"Deleting chat {chat_id} for user: {user_id}")

        participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == chat_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not participant:
            raise ChatNotFoundError("Чат не найден")
        db.delete(participant)
        db.commit()
        connection_manager.remove_user_from_chat(user_id=user_id, chat_id=chat_id)
        logger.info(f"Chat {chat_id} deleted for user {user_id}")
        return {"message": "Чат удален"}
    except ChatNotFoundError:
        raise
    except Exception as e:
        logger.error(f"Delete chat error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.post("/block/{blocked_user_id}")
async def block_user(
    blocked_user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"User {user_id} blocking user {blocked_user_id}")

        existing = db.query(models.BlockedUser).filter(models.BlockedUser.user_id == user_id, models.BlockedUser.blocked_user_id == blocked_user_id).first()
        if existing:
            return {"message": "Пользователь уже заблокирован"}
        block = models.BlockedUser(user_id=user_id, blocked_user_id=blocked_user_id)
        db.add(block)
        db.commit()
        return {"message": "Пользователь заблокирован"}
    except Exception as e:
        logger.error(f"Block user error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.delete("/block/{blocked_user_id}")
async def unblock_user(
    blocked_user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"User {user_id} unblocking user {blocked_user_id}")

        block = db.query(models.BlockedUser).filter(models.BlockedUser.user_id == user_id, models.BlockedUser.blocked_user_id == blocked_user_id).first()
        if not block:
            raise HTTPException(status_code=404, detail="Блокировка не найдена")
        db.delete(block)
        db.commit()
        return {"message": "Пользователь разблокирован"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unblock user error: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.get("/block", response_model=list[schemas.BlockedUserResponse])
async def get_blocked_users(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]

        blocked = db.query(models.BlockedUser).filter(models.BlockedUser.user_id == user_id).all()
        return [schemas.BlockedUserResponse.model_validate(b) for b in blocked]
    except Exception as e:
        logger.error(f"Get blocked users error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.get("/chats/{chat_id}/export")
async def export_chat(
    chat_id: str,
    format: str = "json",
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]

        participant = db.query(models.ChatParticipant).filter(models.ChatParticipant.chat_id == chat_id, models.ChatParticipant.user_id == user_id).first()
        if not participant:
            raise HTTPException(status_code=404, detail="Чат не найден")
        messages = db.query(models.Message).filter(models.Message.chat_id == chat_id, models.Message.is_deleted == False).order_by(models.Message.created_at.asc()).all()
        chat = db.query(models.Chat).filter(models.Chat.id == chat_id).first()
        if format == "json":
            export_data = {
                "chat_name": chat.name if chat.name else f"Чат {chat_id}",
                "export_date": datetime.now(timezone.utc).isoformat(),
                "messages": []
            }
            for msg in messages:
                sender = db.query(models.User).filter(models.User.id == msg.user_id).first()
                export_data["messages"].append({
                    "id": msg.id, "sender": sender.username if sender else "Unknown",
                    "content": msg.content, "type": msg.message_type,
                    "timestamp": msg.created_at.isoformat() if hasattr(msg.created_at, 'isoformat') else str(msg.created_at)
                })
            return export_data
        elif format == "txt":
            export_text = f"Экспорт чата: {chat.name if chat.name else chat_id}\n"
            export_text += "=" * 50 + "\n\n"
            for msg in messages:
                sender = db.query(models.User).filter(models.User.id == msg.user_id).first()
                ts = msg.created_at.strftime("%Y-%m-%d %H:%M:%S") if hasattr(msg.created_at, 'strftime') else str(msg.created_at)
                export_text += f"[{ts}] {sender.username if sender else 'Unknown'}: {msg.content}\n"
            return {"content": export_text}
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат экспорта")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Export chat error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Внутренняя ошибка сервера")


@router.get("/chats/{chat_id}/search")
async def search_messages(
    chat_id: str,
    q: str,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == chat_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not participant:
            raise HTTPException(status_code=404, detail="Чат не найден")
        if limit > 100:
            limit = 100

        # Check if chat has E2E messages (server can't search encrypted content)
        has_e2e = db.query(models.Message).filter(
            models.Message.chat_id == chat_id,
            models.Message.encrypted_content.is_not(None),
        ).first()
        if has_e2e:
            # Return all messages — client will search after decryption
            messages = db.query(models.Message).options(joinedload(models.Message.user)).filter(
                models.Message.chat_id == chat_id,
                models.Message.is_deleted == False
            ).order_by(models.Message.created_at.desc()).offset(skip).limit(limit).all()
            return [schemas.MessageResponse.model_validate(m) for m in messages]

        messages = db.query(models.Message).options(joinedload(models.Message.user)).filter(
            models.Message.chat_id == chat_id,
            models.Message.content.ilike(f"%{q}%"),
            models.Message.is_deleted == False
        ).order_by(models.Message.created_at.desc()).offset(skip).limit(limit).all()
        return [schemas.MessageResponse.model_validate(m) for m in messages]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search messages error: {e}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.post("/messages/{message_id}/react", response_model=list[schemas.ReactionResponse])
async def toggle_reaction(
    message_id: str,
    reaction: schemas.ReactionCreate,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        message = db.query(models.Message).filter(models.Message.id == message_id).first()
        if not message:
            raise MessageNotFoundError("Сообщение не найдено")
        participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == message.chat_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not participant:
            raise HTTPException(status_code=403, detail="Нет доступа к сообщению")

        existing = db.query(models.MessageReaction).filter(
            models.MessageReaction.message_id == message_id,
            models.MessageReaction.user_id == user_id,
            models.MessageReaction.emoji == reaction.emoji
        ).first()
        if existing:
            db.delete(existing)
        else:
            db.add(models.MessageReaction(message_id=message_id, user_id=user_id, emoji=reaction.emoji))
        db.commit()

        reactions = db.query(models.MessageReaction).options(joinedload(models.MessageReaction.user)).filter(
            models.MessageReaction.message_id == message_id
        ).all()
        result = [schemas.ReactionResponse.model_validate(r) for r in reactions]

        # Broadcast reaction update via WebSocket
        try:
            await connection_manager.broadcast_to_chat(
                {"event": "reaction_update", "data": {"message_id": message_id, "reactions": [r.model_dump(mode="json") for r in result]}},
                message.chat_id,
                exclude_user=user_id
            )
        except Exception as ws_err:
            logger.warning(f"Failed to broadcast reaction: {ws_err}")

        return result
    except MessageNotFoundError:
        raise
    except Exception as e:
        logger.error(f"Toggle reaction error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.get("/messages/{message_id}/reactions", response_model=list[schemas.ReactionResponse])
async def get_reactions(
    message_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        message = db.query(models.Message).filter(models.Message.id == message_id).first()
        if not message:
            raise MessageNotFoundError("Сообщение не найдено")
        participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == message.chat_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not participant:
            raise HTTPException(status_code=403, detail="Нет доступа")
        reactions = db.query(models.MessageReaction).options(joinedload(models.MessageReaction.user)).filter(
            models.MessageReaction.message_id == message_id
        ).all()
        return [schemas.ReactionResponse.model_validate(r) for r in reactions]
    except MessageNotFoundError:
        raise
    except Exception as e:
        logger.error(f"Get reactions error: {e}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


# ─── E2E Group Key ───

@router.post("/chats/{chat_id}/group-key")
async def set_group_key(
    chat_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Store encrypted group key for E2E group chat. payload: {encrypted_keys: {user_id: sealed_box_b64}}"""
    user_id = token["sub"]
    participant = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == chat_id,
        models.ChatParticipant.user_id == user_id,
    ).first()
    if not participant:
        raise HTTPException(status_code=403, detail="Нет доступа")

    chat = db.query(models.Chat).filter(models.Chat.id == chat_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    import json
    chat.group_key = json.dumps(payload.get("encrypted_keys", {}))
    db.commit()
    return {"message": "Group key updated"}


@router.get("/chats/{chat_id}/group-key")
async def get_group_key(
    chat_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Get encrypted group key for the current user."""
    user_id = token["sub"]
    participant = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == chat_id,
        models.ChatParticipant.user_id == user_id,
    ).first()
    if not participant:
        raise HTTPException(status_code=403, detail="Нет доступа")

    chat = db.query(models.Chat).filter(models.Chat.id == chat_id).first()
    if not chat or not chat.group_key:
        raise HTTPException(status_code=404, detail="Group key not found")

    import json
    encrypted_keys = json.loads(chat.group_key)
    my_encrypted_key = encrypted_keys.get(user_id)
    if not my_encrypted_key:
        raise HTTPException(status_code=404, detail="No group key for this user")

    return {"encrypted_key": my_encrypted_key, "chat_id": chat_id}


# ─── Global Search ───

@router.get("/search-global")
async def search_global(
    q: str,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Global search by user {user_id}: {q}")

        if limit > 100:
            limit = 100

        user_chat_ids = [
            chat_id for (chat_id,) in db.query(models.ChatParticipant.chat_id)
            .filter(models.ChatParticipant.user_id == user_id)
            .all()
        ]

        if not user_chat_ids:
            return []

        messages = db.query(models.Message).options(joinedload(models.Message.user)).filter(
            models.Message.chat_id.in_(user_chat_ids),
            models.Message.content.ilike(f"%{q}%"),
            models.Message.is_deleted == False
        ).order_by(models.Message.created_at.desc()).offset(skip).limit(limit).all()

        return [schemas.MessageResponse.model_validate(m) for m in messages]
    except Exception as e:
        logger.error(f"Global search error: {e}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


# ─── Mark Chat as Read ───

@router.post("/chats/{chat_id}/read")
async def mark_chat_as_read(
    chat_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Marking all messages in chat {chat_id} as read for user {user_id}")

        participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == chat_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not participant:
            raise HTTPException(status_code=404, detail="Чат не найден")

        unread_statuses = db.query(models.MessageReadStatus).join(models.Message).filter(
            models.Message.chat_id == chat_id,
            models.MessageReadStatus.user_id == user_id,
            models.MessageReadStatus.is_read == False
        ).all()

        count = 0
        for status in unread_statuses:
            status.is_read = True
            status.read_at = func.now()
            count += 1

        db.commit()
        return {"message": f"Отмечено {count} сообщений как прочитанные", "count": count}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Mark chat as read error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


# ─── Send Message with expires_at ───

@router.post("/chats/{chat_id}/messages-ephemeral", response_model=schemas.MessageResponse)
async def send_ephemeral_message(
    chat_id: str,
    content: str,
    expires_in_seconds: int,
    message_type: str = "text",
    file_id: str | None = None,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        user_id = token["sub"]
        logger.info(f"Sending ephemeral message to chat {chat_id} by user {user_id}")

        participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == chat_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not participant:
            raise HTTPException(status_code=404, detail="Чат не найден")

        if not content.strip():
            raise HTTPException(status_code=400, detail="Содержимое сообщения не может быть пустым")

        message_id = security.generate_message_id()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)

        message = models.Message(
            id=message_id, chat_id=chat_id, user_id=user_id,
            content=content, message_type=message_type,
            file_id=file_id, expires_at=expires_at,
        )
        db.add(message)
        db.commit()
        db.refresh(message)

        message_full = db.query(models.Message).options(joinedload(models.Message.user)).filter(models.Message.id == message_id).first()
        if message_full:
            participants = db.query(models.ChatParticipant).filter(
                models.ChatParticipant.chat_id == chat_id,
                models.ChatParticipant.user_id != user_id
            ).all()
            target_user_ids = [p.user_id for p in participants]
            for uid in target_user_ids:
                read_status = models.MessageReadStatus(message_id=message_id, user_id=uid, is_read=False)
                db.add(read_status)
            db.commit()

            try:
                message_event = {
                    "event": "message",
                    "data": {
                        "id": message_id, "chat_id": chat_id,
                        "content": message_full.content,
                        "message_type": message_full.message_type,
                        "file_id": message_full.file_id,
                        "user_id": message_full.user_id,
                        "username": message_full.user.username if message_full.user else "Unknown",
                        "expires_at": expires_at.isoformat(),
                        "timestamp": message_full.created_at.isoformat() if message_full.created_at else None,
                    }
                }
                await connection_manager.broadcast_to_chat(message_event, chat_id, exclude_user=user_id)
            except Exception as ws_error:
                logger.error(f"Failed to broadcast ephemeral message: {ws_error}")

            return schemas.MessageResponse.model_validate(message_full)
        raise HTTPException(status_code=500, detail="Не удалось создать сообщение")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Send ephemeral message error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")
