from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql import func

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import security, verify_token_dependency
from server.utils.logger import logger
from server.ws.chat_manager import connection_manager
from server.ws.notifications import notification_manager

router = APIRouter()

class GroupRenameRequest(BaseModel):
    name: str


@router.get("/contacts", response_model=list[schemas.ContactResponse])
async def get_contacts(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    logger.info(f"Getting contacts for user: {token['sub']}")
    user_id = token["sub"]

    contacts = db.query(models.Contact).options(
        joinedload(models.Contact.contact_user),
        joinedload(models.Contact.user),
    ).filter(models.Contact.user_id == user_id).all()
    result = []
    for contact in contacts:
        result.append(
            schemas.ContactResponse(
                id=contact.id,
                user_id=contact.user_id,
                contact_user_id=contact.contact_user_id,
                created_at=contact.created_at,
                user=schemas.UserResponse.model_validate(contact.user) if contact.user else None,
                contact_user=schemas.UserResponse.model_validate(contact.contact_user)
                if contact.contact_user else None,
            )
        )
    return result


@router.post("/contacts", response_model=schemas.ContactResponse)
async def add_contact(
    contact_data: schemas.ContactCreate,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        logger.info(f"Adding contact {contact_data.contact_user_id} for user: {token['sub']}")
        user_id = token["sub"]
        target_id = contact_data.contact_user_id

        contact_user = db.query(models.User).filter(models.User.id == target_id).first()
        if not contact_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        if target_id == user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя добавить самого себя в контакты"
            )
        existing_contact = db.query(models.Contact).filter(
            models.Contact.user_id == user_id,
            models.Contact.contact_user_id == target_id
        ).first()
        if existing_contact:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Контакт уже добавлен")

        contact_id = security.generate_contact_id()
        contact = models.Contact(id=contact_id, user_id=user_id, contact_user_id=target_id)
        db.add(contact)
        db.commit()
        db.refresh(contact)

        contact_user = db.query(models.User).filter(models.User.id == contact.contact_user_id).first()
        return schemas.ContactResponse(
            id=contact.id,
            user_id=contact.user_id,
            contact_user_id=contact.contact_user_id,
            created_at=contact.created_at,
            user=schemas.UserResponse.model_validate(
                db.query(models.User).filter(models.User.id == contact.user_id).first()
            ),
            contact_user=schemas.UserResponse.model_validate(contact_user) if contact_user else None,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Add contact error: {e}")
        db.rollback()
        raise


@router.delete("/contacts/{contact_id}")
async def remove_contact(
    contact_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        logger.info(f"Removing contact {contact_id} for user: {token['sub']}")
        user_id = token["sub"]

        contact = db.query(models.Contact).filter(
            models.Contact.id == contact_id,
            models.Contact.user_id == user_id
        ).first()
        if not contact:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Контакт не найден")
        db.delete(contact)
        db.commit()
        return {"message": "Контакт удален"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Remove contact error: {e}")
        db.rollback()
        raise


@router.post("/groups/{group_id}/invites", response_model=schemas.GroupInviteResponse)
async def invite_to_group(
    group_id: str,
    invite_data: schemas.GroupInviteCreate,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        logger.info(f"Inviting user {invite_data.invitee_id} to group {group_id} by user: {token['sub']}")
        user_id = token["sub"]
        invitee_id = invite_data.invitee_id

        group = db.query(models.Chat).filter(models.Chat.id == group_id).first()
        if not group:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Группа не найдена")
        participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == group_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not participant:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к группе")
        invitee_user = db.query(models.User).filter(models.User.id == invitee_id).first()
        if not invitee_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
        existing_participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == group_id,
            models.ChatParticipant.user_id == invitee_id
        ).first()
        if existing_participant:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Пользователь уже является участником группы"
            )
        existing_invite = db.query(models.GroupInvite).filter(
            models.GroupInvite.group_id == group_id,
            models.GroupInvite.invitee_id == invitee_id,
            models.GroupInvite.status == "pending"
        ).first()
        if existing_invite:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Приглашение уже отправлено")

        invite_id = security.generate_invite_id()
        invite = models.GroupInvite(
            id=invite_id, group_id=group_id, inviter_id=user_id, invitee_id=invitee_id, status="pending"
        )
        db.add(invite)
        db.commit()
        db.refresh(invite)

        try:
            await notification_manager.send_group_invite_notification(
                invite_data=schemas.GroupInviteResponse.model_validate(invite).model_dump(),
                target_user_id=invitee_id
            )
        except Exception as notify_error:
            logger.error(f"Failed to send group invite notification: {notify_error}")

        group_obj = db.query(models.Chat).filter(models.Chat.id == invite.group_id).first()
        inviter_obj = db.query(models.User).filter(models.User.id == invite.inviter_id).first()
        invitee_obj = db.query(models.User).filter(models.User.id == invite.invitee_id).first()
        return schemas.GroupInviteResponse(
            id=invite.id,
            group_id=invite.group_id,
            inviter_id=invite.inviter_id,
            invitee_id=invite.invitee_id,
            status=invite.status,
            created_at=invite.created_at,
            updated_at=invite.updated_at,
            group=schemas.ChatResponse.model_validate(group_obj) if group_obj else None,
            inviter=schemas.UserResponse.model_validate(inviter_obj) if inviter_obj else None,
            invitee=schemas.UserResponse.model_validate(invitee_obj) if invitee_obj else None,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Invite to group error: {e}")
        db.rollback()
        raise


@router.get("/groups/invites", response_model=list[schemas.GroupInviteResponse])
async def get_group_invites(
    status_filter: str = "pending",
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    logger.info(f"Getting group invites for user: {token['sub']} with status: {status_filter}")
    user_id = token["sub"]

    invites = db.query(models.GroupInvite).options(
        joinedload(models.GroupInvite.group),
        joinedload(models.GroupInvite.inviter),
        joinedload(models.GroupInvite.invitee),
    ).filter(
        models.GroupInvite.invitee_id == user_id,
        models.GroupInvite.status == status_filter
    ).all()
    result = []
    for invite in invites:
        result.append(
            schemas.GroupInviteResponse(
                id=invite.id,
                group_id=invite.group_id,
                inviter_id=invite.inviter_id,
                invitee_id=invite.invitee_id,
                status=invite.status,
                created_at=invite.created_at,
                updated_at=invite.updated_at,
                group=schemas.ChatResponse.model_validate(invite.group) if invite.group else None,
                inviter=schemas.UserResponse.model_validate(invite.inviter) if invite.inviter else None,
                invitee=schemas.UserResponse.model_validate(invite.invitee) if invite.invitee else None,
            )
        )
    return result


@router.put("/groups/invites/{invite_id}/accept")
async def accept_group_invite(
    invite_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        logger.info(f"Accepting group invite {invite_id} for user: {token['sub']}")
        user_id = token["sub"]

        invite = db.query(models.GroupInvite).filter(
            models.GroupInvite.id == invite_id,
            models.GroupInvite.invitee_id == user_id,
            models.GroupInvite.status == "pending"
        ).first()
        if not invite:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Приглашение не найдено или уже обработано"
            )
        invite.status = "accepted"
        invite.updated_at = func.now()
        db.commit()
        existing_participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == invite.group_id,
            models.ChatParticipant.user_id == user_id
        ).first()
        if not existing_participant:
            participant = models.ChatParticipant(chat_id=invite.group_id, user_id=user_id)
            db.add(participant)
        db.commit()
        connection_manager.add_user_to_chat(user_id=user_id, chat_id=invite.group_id)
        return {"message": "Приглашение принято", "group_id": invite.group_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Accept group invite error: {e}")
        db.rollback()
        raise


@router.put("/groups/invites/{invite_id}/decline")
async def decline_group_invite(
    invite_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    try:
        logger.info(f"Declining group invite {invite_id} for user: {token['sub']}")
        user_id = token["sub"]

        invite = db.query(models.GroupInvite).filter(
            models.GroupInvite.id == invite_id,
            models.GroupInvite.invitee_id == user_id,
            models.GroupInvite.status == "pending"
        ).first()
        if not invite:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Приглашение не найдено или уже обработано"
            )
        invite.status = "declined"
        invite.updated_at = func.now()
        db.commit()
        return {"message": "Приглашение отклонено"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Decline group invite error: {e}")
        db.rollback()
        raise


# ─── Group Management ───

@router.put("/groups/{group_id}/rename")
async def rename_group(
    group_id: str,
    body: schemas.GroupRenameRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    chat = db.query(models.Chat).filter(models.Chat.id == group_id, models.Chat.is_group).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    participant = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == user_id,
        models.ChatParticipant.is_admin
    ).first()
    if not participant:
        raise HTTPException(status_code=403, detail="Только админ может переименовать группу")
    chat.name = body.name
    db.commit()
    return {"message": "Группа переименована", "name": chat.name}


@router.post("/groups/{group_id}/participants/{target_user_id}")
async def add_participant(
    group_id: str,
    target_user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    chat = db.query(models.Chat).filter(models.Chat.id == group_id, models.Chat.is_group).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    caller = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == user_id
    ).first()
    if not caller:
        raise HTTPException(status_code=403, detail="Вы не участник группы")
    target = db.query(models.User).filter(models.User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    existing = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == target_user_id
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Пользователь уже в группе")
    new_participant = models.ChatParticipant(chat_id=group_id, user_id=target_user_id)
    db.add(new_participant)
    db.commit()
    return {"message": f"Пользователь {target_user_id} добавлен в группу"}


@router.delete("/groups/{group_id}/participants/{target_user_id}")
async def remove_participant(
    group_id: str,
    target_user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    chat = db.query(models.Chat).filter(models.Chat.id == group_id, models.Chat.is_group).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    caller = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == user_id,
        models.ChatParticipant.is_admin
    ).first()
    if not caller and user_id != target_user_id:
        raise HTTPException(status_code=403, detail="Только админ может удалять участников")
    if user_id == target_user_id and not caller:
        target_participant = db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == group_id,
            models.ChatParticipant.user_id == target_user_id
        ).first()
        if target_participant:
            db.delete(target_participant)
            db.commit()
            return {"message": "Вы вышли из группы"}
    target_participant = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == target_user_id
    ).first()
    if not target_participant:
        raise HTTPException(status_code=404, detail="Пользователь не в группе")
    db.delete(target_participant)
    db.commit()
    return {"message": f"Пользователь {target_user_id} удалён из группы"}


@router.post("/groups/{group_id}/leave")
async def leave_group(
    group_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    participant = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == user_id
    ).first()
    if not participant:
        raise HTTPException(status_code=404, detail="Вы не в этой группе")
    db.delete(participant)
    db.commit()
    return {"message": "Вы вышли из группы"}


@router.put("/groups/{group_id}/admin/{target_user_id}")
async def set_admin(
    group_id: str,
    target_user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    caller = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == user_id,
        models.ChatParticipant.is_admin
    ).first()
    if not caller:
        raise HTTPException(status_code=403, detail="Только админ может назначать админов")
    target = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == target_user_id
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не в группе")
    target.is_admin = not target.is_admin
    db.commit()
    action = "назначен админом" if target.is_admin else "снят с админа"
    return {"message": f"Пользователь {target_user_id} {action}", "is_admin": target.is_admin}


@router.get("/groups/{group_id}/members")
async def get_group_members(
    group_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    user_id = token["sub"]
    caller = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_id,
        models.ChatParticipant.user_id == user_id
    ).first()
    if not caller:
        raise HTTPException(status_code=403, detail="Вы не участник группы")
    participants = db.query(models.ChatParticipant).options(
        joinedload(models.ChatParticipant.user)
    ).filter(
        models.ChatParticipant.chat_id == group_id
    ).all()
    members = []
    for p in participants:
        user = p.user
        if user:
            members.append({
                "id": user.id,
                "username": user.username,
                "first_name": user.first_name,
                "avatar_path": user.avatar_path,
                "is_admin": p.is_admin,
                "joined_at": p.joined_at.isoformat() if p.joined_at else None,
            })
    return members
