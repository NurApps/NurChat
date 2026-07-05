from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from server.core.database import get_db
from server.core.models import PinnedMessage, Message, Chat, User
from server.core.security import verify_token_dependency

router = APIRouter(prefix="/api/chat", tags=["pins"])


class PinMessageRequest(BaseModel):
    message_id: str


@router.post("/chats/{chat_id}/pin-message")
def pin_message(
    chat_id: str,
    body: PinMessageRequest,
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db),
):
    msg = db.query(Message).filter(Message.id == body.message_id, Message.chat_id == chat_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    existing = db.query(PinnedMessage).filter(
        PinnedMessage.chat_id == chat_id, PinnedMessage.message_id == body.message_id
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Already pinned")

    pinned = PinnedMessage(
        chat_id=chat_id,
        message_id=body.message_id,
        pinned_by=token["sub"],
    )
    db.add(pinned)
    db.commit()
    return {"detail": "Message pinned"}


@router.delete("/chats/{chat_id}/pin-message")
def unpin_message(
    chat_id: str,
    message_id: str,
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db),
):
    pinned = db.query(PinnedMessage).filter(
        PinnedMessage.chat_id == chat_id, PinnedMessage.message_id == message_id
    ).first()
    if not pinned:
        raise HTTPException(status_code=404, detail="Pin not found")
    db.delete(pinned)
    db.commit()
    return {"detail": "Message unpinned"}


@router.get("/chats/{chat_id}/pinned")
def get_pinned_messages(
    chat_id: str,
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db),
):
    pins = db.query(PinnedMessage).filter(PinnedMessage.chat_id == chat_id).order_by(PinnedMessage.created_at.desc()).all()
    result = []
    for pin in pins:
        msg = db.query(Message).filter(Message.id == pin.message_id).first()
        if msg and not msg.is_deleted:
            user = db.query(User).filter(User.id == msg.user_id).first()
            result.append({
                "id": pin.id,
                "message_id": pin.message_id,
                "pinned_by": pin.pinned_by,
                "created_at": pin.created_at.isoformat() if pin.created_at else None,
                "message": {
                    "id": msg.id,
                    "content": msg.content,
                    "user_id": msg.user_id,
                    "chat_id": msg.chat_id,
                    "message_type": msg.message_type,
                    "created_at": msg.created_at.isoformat() if msg.created_at else None,
                    "username": user.username if user else "",
                    "first_name": user.first_name if user else "",
                },
            })
    return result
