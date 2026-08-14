
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from shared.exceptions import MessageNotFoundError

from ..core import models, schemas
from ..core.database import get_db
from ..core.security import security, verify_token_dependency

router = APIRouter()

@router.post("/forward", response_model=list[schemas.MessageResponse])
async def forward_message(
    forward_data: schemas.ForwardRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Пересылка сообщения в несколько чатов в NurChat"""
    # Получаем оригинальное сообщение с загруженным пользователем
    original_message = db.query(models.Message).options(
        joinedload(models.Message.user)
    ).filter(
        models.Message.id == forward_data.message_id,
        ~models.Message.is_deleted
    ).first()

    if not original_message:
        raise MessageNotFoundError("Сообщение не найдено")

    # Проверяем, что пользователь имеет доступ к оригинальному сообщению
    original_chat_access = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == original_message.chat_id,
        models.ChatParticipant.user_id == token["sub"]
    ).first()

    if not original_chat_access:
        raise HTTPException(status_code=403, detail="Нет доступа к исходному сообщению")

    forwarded_messages = []

    for target_chat_id in forward_data.target_chat_ids:
        # Проверяем доступ к целевому чату
        target_chat_access = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == target_chat_id,
            models.ChatParticipant.user_id == token["sub"]
        ).first()

        if not target_chat_access:
            continue  # Пропускаем чаты без доступа

        # Создаем пересланное сообщение
        message_id = security.generate_message_id()
        forwarded_message = models.Message(
            id=message_id,
            chat_id=target_chat_id,
            user_id=token["sub"],
            content=original_message.content,
            message_type=original_message.message_type,
            file_id=original_message.file_id,
            forwarded_from=original_message.id  # Сохраняем ссылку на оригинал
        )

        db.add(forwarded_message)
        forwarded_messages.append(forwarded_message)

    db.commit()

    # Получаем полные данные пересланных сообщений с загруженным пользователем
    result_messages = []
    for msg in forwarded_messages:
        db.refresh(msg)
        message_full = db.query(models.Message).options(
            joinedload(models.Message.user)
        ).filter(models.Message.id == msg.id).first()
        result_messages.append(schemas.MessageResponse.model_validate(message_full))

    return result_messages

@router.get("/message/{message_id}/info", response_model=schemas.MessageResponse)
async def get_message_info(
    message_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Получение информации о сообщении для пересылки в NurChat"""
    message = db.query(models.Message).options(
        joinedload(models.Message.user)
    ).filter(
        models.Message.id == message_id,
        ~models.Message.is_deleted
    ).first()

    if not message:
        raise MessageNotFoundError("Сообщение не найдено")

    # Проверяем доступ к чату сообщения
    chat_access = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == message.chat_id,
        models.ChatParticipant.user_id == token["sub"]
    ).first()

    if not chat_access:
        raise HTTPException(status_code=403, detail="Нет доступа к сообщению")

    return schemas.MessageResponse.model_validate(message)

@router.get("/chats/available-for-forward", response_model=list[schemas.ChatResponse])
async def get_chats_available_for_forward(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Получение списка чатов, доступных для пересылки в NurChat"""
    user_chats = db.query(models.Chat).join(
        models.ChatParticipant
    ).filter(
        models.ChatParticipant.user_id == token["sub"]
    ).all()

    chats_response = []
    for chat in user_chats:
        # Получаем участников
        participants = db.query(models.User).join(
            models.ChatParticipant
        ).filter(
            models.ChatParticipant.chat_id == chat.id
        ).all()

        chat_data = schemas.ChatResponse(
            id=chat.id,
            name=chat.name,
            is_group=chat.is_group,
            is_secret=chat.is_secret,
            disappears_after_seconds=chat.disappears_after_seconds,
            created_at=chat.created_at,
            participants=[schemas.UserResponse.model_validate(p) for p in participants],
            last_message=None,
            unread_count=0
        )
        chats_response.append(chat_data)

    return chats_response
