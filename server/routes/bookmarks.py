from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from server.core.database import get_db
from server.core.models import Bookmark, Message, User
from server.core.security import verify_token_dependency

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])


class BookmarkCreate(BaseModel):
    message_id: str
    chat_id: str


@router.get("")
def get_bookmarks(
    chat_id: Optional[str] = None,
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db),
):
    query = db.query(Bookmark).filter(Bookmark.user_id == token["sub"])
    if chat_id:
        query = query.filter(Bookmark.chat_id == chat_id)
    bookmarks = query.order_by(Bookmark.created_at.desc()).all()

    result = []
    for bm in bookmarks:
        msg = db.query(Message).filter(Message.id == bm.message_id).first()
        if msg:
            result.append({
                "id": bm.id,
                "message_id": bm.message_id,
                "user_id": bm.user_id,
                "chat_id": bm.chat_id,
                "created_at": bm.created_at.isoformat() if bm.created_at else None,
                "message": {
                    "id": msg.id,
                    "content": msg.content,
                    "user_id": msg.user_id,
                    "chat_id": msg.chat_id,
                    "message_type": msg.message_type,
                    "created_at": msg.created_at.isoformat() if msg.created_at else None,
                    "user": {
                        "id": msg.user.id,
                        "username": msg.user.username,
                        "first_name": msg.user.first_name,
                        "avatar_path": msg.user.avatar_path,
                    } if msg.user else None,
                },
            })
    return result


@router.post("")
def add_bookmark(
    body: BookmarkCreate,
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db),
):
    # Check message exists
    msg = db.query(Message).filter(Message.id == body.message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Check not already bookmarked
    existing = (
        db.query(Bookmark)
        .filter(Bookmark.user_id == token["sub"], Bookmark.message_id == body.message_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Already bookmarked")

    bookmark = Bookmark(
        user_id=token["sub"],
        message_id=body.message_id,
        chat_id=body.chat_id,
    )
    db.add(bookmark)
    db.commit()
    db.refresh(bookmark)

    return {
        "id": bookmark.id,
        "message_id": bookmark.message_id,
        "user_id": bookmark.user_id,
        "chat_id": bookmark.chat_id,
        "created_at": bookmark.created_at.isoformat() if bookmark.created_at else None,
    }


@router.delete("/{message_id}")
def remove_bookmark(
    message_id: str,
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db),
):
    bookmark = (
        db.query(Bookmark)
        .filter(Bookmark.user_id == token["sub"], Bookmark.message_id == message_id)
        .first()
    )
    if not bookmark:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    db.delete(bookmark)
    db.commit()
    return {"detail": "Bookmark removed"}
