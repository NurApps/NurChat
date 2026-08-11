from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import security, verify_token_dependency
from server.utils.logger import logger

router = APIRouter()

MAX_PARTICIPANTS = 8


@router.post("/start", response_model=schemas.GroupCallResponse)
async def start_group_call(
    data: schemas.GroupCallStartRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]

    chat = db.query(models.Chat).filter(models.Chat.id == data.chat_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    membership = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == data.chat_id,
        models.ChatParticipant.user_id == user_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Вы не участник чата")

    if not chat.is_group:
        raise HTTPException(status_code=400, detail="Групповой звонок только в групповых чатах")

    active = db.query(models.GroupCall).filter(
        models.GroupCall.chat_id == data.chat_id,
        models.GroupCall.ended_at.is_(None),
    ).first()
    if active:
        raise HTTPException(status_code=409, detail="В этом чате уже идёт звонок")

    call_id = security.generate_call_id()
    group_call = models.GroupCall(
        call_id=call_id,
        chat_id=data.chat_id,
        created_by=user_id,
        call_type=data.call_type,
    )
    db.add(group_call)
    db.flush()

    me = models.GroupCallParticipant(
        group_call_id=group_call.id,
        user_id=user_id,
    )
    db.add(me)
    db.commit()
    db.refresh(group_call)

    logger.info(f"Group call {call_id} started by {user_id} in chat {data.chat_id}")

    return _build_response(group_call)


@router.post("/join/{call_id}", response_model=schemas.GroupCallResponse)
async def join_group_call(
    call_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]

    group_call = db.query(models.GroupCall).filter(
        models.GroupCall.call_id == call_id,
        models.GroupCall.ended_at.is_(None),
    ).first()
    if not group_call:
        raise HTTPException(status_code=404, detail="Звонок не найден или завершён")

    membership = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == group_call.chat_id,
        models.ChatParticipant.user_id == user_id,
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Вы не участник чата")

    already = db.query(models.GroupCallParticipant).filter(
        models.GroupCallParticipant.group_call_id == group_call.id,
        models.GroupCallParticipant.user_id == user_id,
        models.GroupCallParticipant.left_at.is_(None),
    ).first()
    if already:
        raise HTTPException(status_code=409, detail="Вы уже в звонке")

    active_count = db.query(models.GroupCallParticipant).filter(
        models.GroupCallParticipant.group_call_id == group_call.id,
        models.GroupCallParticipant.left_at.is_(None),
    ).count()
    if active_count >= MAX_PARTICIPANTS:
        raise HTTPException(status_code=400, detail=f"Максимум {MAX_PARTICIPANTS} участников")

    p = models.GroupCallParticipant(
        group_call_id=group_call.id,
        user_id=user_id,
    )
    db.add(p)
    db.commit()
    db.refresh(group_call)

    logger.info(f"User {user_id} joined group call {call_id}")

    return _build_response(group_call)


@router.post("/leave/{call_id}")
async def leave_group_call(
    call_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]

    group_call = db.query(models.GroupCall).filter(
        models.GroupCall.call_id == call_id,
        models.GroupCall.ended_at.is_(None),
    ).first()
    if not group_call:
        raise HTTPException(status_code=404, detail="Звонок не найден")

    p = db.query(models.GroupCallParticipant).filter(
        models.GroupCallParticipant.group_call_id == group_call.id,
        models.GroupCallParticipant.user_id == user_id,
        models.GroupCallParticipant.left_at.is_(None),
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Вы не в звонке")

    p.left_at = datetime.now(timezone.utc)
    db.commit()

    remaining = db.query(models.GroupCallParticipant).filter(
        models.GroupCallParticipant.group_call_id == group_call.id,
        models.GroupCallParticipant.left_at.is_(None),
    ).count()

    if remaining == 0:
        group_call.ended_at = datetime.now(timezone.utc)
        db.commit()

    logger.info(f"User {user_id} left group call {call_id}")

    return {"status": "ok", "remaining": remaining}


@router.post("/end/{call_id}")
async def end_group_call(
    call_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]

    group_call = db.query(models.GroupCall).filter(
        models.GroupCall.call_id == call_id,
        models.GroupCall.ended_at.is_(None),
    ).first()
    if not group_call:
        raise HTTPException(status_code=404, detail="Звонок не найден")

    group_call.ended_at = datetime.now(timezone.utc)

    from sqlalchemy import update
    db.execute(
        update(models.GroupCallParticipant)
        .where(
            models.GroupCallParticipant.group_call_id == group_call.id,
            models.GroupCallParticipant.left_at.is_(None),
        )
        .values(left_at=datetime.now(timezone.utc))
    )
    db.commit()

    logger.info(f"Group call {call_id} ended by {user_id}")

    return {"status": "ok"}


@router.post("/toggle-mute/{call_id}")
async def toggle_mute(
    call_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]

    group_call = db.query(models.GroupCall).filter(
        models.GroupCall.call_id == call_id,
        models.GroupCall.ended_at.is_(None),
    ).first()
    if not group_call:
        raise HTTPException(status_code=404, detail="Звонок не найден")

    p = db.query(models.GroupCallParticipant).filter(
        models.GroupCallParticipant.group_call_id == group_call.id,
        models.GroupCallParticipant.user_id == user_id,
        models.GroupCallParticipant.left_at.is_(None),
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Вы не в звонке")

    p.is_muted = not p.is_muted
    db.commit()

    return {"is_muted": p.is_muted}


@router.post("/toggle-video/{call_id}")
async def toggle_video(
    call_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]

    group_call = db.query(models.GroupCall).filter(
        models.GroupCall.call_id == call_id,
        models.GroupCall.ended_at.is_(None),
    ).first()
    if not group_call:
        raise HTTPException(status_code=404, detail="Звонок не найден")

    p = db.query(models.GroupCallParticipant).filter(
        models.GroupCallParticipant.group_call_id == group_call.id,
        models.GroupCallParticipant.user_id == user_id,
        models.GroupCallParticipant.left_at.is_(None),
    ).first()
    if not p:
        raise HTTPException(status_code=404, detail="Вы не в звонке")

    p.is_video_off = not p.is_video_off
    db.commit()

    return {"is_video_off": p.is_video_off}


@router.get("/active/{chat_id}", response_model=schemas.GroupCallResponse | None)
async def get_active_group_call(
    chat_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    group_call = db.query(models.GroupCall).filter(
        models.GroupCall.chat_id == chat_id,
        models.GroupCall.ended_at.is_(None),
    ).first()

    if not group_call:
        return None

    return _build_response(group_call)


def _build_response(group_call: models.GroupCall) -> schemas.GroupCallResponse:
    participants = []
    for p in group_call.participants:
        if p.left_at is None:
            participants.append(schemas.GroupCallParticipantResponse(
                user_id=p.user_id,
                username=p.user.username if p.user else None,
                is_muted=p.is_muted or False,
                is_video_off=p.is_video_off or False,
                joined_at=p.joined_at,
            ))

    return schemas.GroupCallResponse(
        call_id=group_call.call_id,
        chat_id=group_call.chat_id,
        created_by=group_call.created_by,
        call_type=group_call.call_type,
        started_at=group_call.started_at,
        ended_at=group_call.ended_at,
        participants=participants,
        participant_count=len(participants),
    )
