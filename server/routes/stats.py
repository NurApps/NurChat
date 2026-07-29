from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from server.core.database import get_db
from server.core.models import ChatParticipant, File, Message, User
from server.core.security import verify_token_dependency

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
def get_stats(
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db),
):
    user_id = token["sub"]

    # Total counts
    total_messages = db.query(func.count(Message.id)).filter(
        Message.user_id == user_id, ~Message.is_deleted
    ).scalar() or 0

    total_chats = db.query(func.count(ChatParticipant.id)).filter(
        ChatParticipant.user_id == user_id
    ).scalar() or 0

    total_files = db.query(func.count(File.id)).filter(
        File.user_id == user_id
    ).scalar() or 0

    # Messages by day (last 30 days)
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    messages_by_day = (
        db.query(
            func.date(Message.created_at).label("day"),
            func.count(Message.id).label("count"),
        )
        .filter(
            Message.user_id == user_id,
            Message.created_at >= thirty_days_ago,
            ~Message.is_deleted,
        )
        .group_by(func.date(Message.created_at))
        .order_by(func.date(Message.created_at))
        .all()
    )

    # Top contacts
    chat_ids = [cp.chat_id for cp in db.query(ChatParticipant.chat_id).filter(ChatParticipant.user_id == user_id).all()]
    top_contacts = []
    if chat_ids:
        results = (
            db.query(
                Message.user_id,
                func.count(Message.id).label("msg_count"),
            )
            .filter(
                Message.chat_id.in_(chat_ids),
                Message.user_id != user_id,
                ~Message.is_deleted,
            )
            .group_by(Message.user_id)
            .order_by(desc("msg_count"))
            .limit(5)
            .all()
        )
        for r in results:
            user = db.query(User).filter(User.id == r.user_id).first()
            if user:
                top_contacts.append({
                    "user_id": r.user_id,
                    "username": user.username,
                    "first_name": user.first_name,
                    "message_count": r.msg_count,
                })

    # Message types breakdown
    type_breakdown = (
        db.query(
            Message.message_type,
            func.count(Message.id).label("count"),
        )
        .filter(
            Message.user_id == user_id,
            ~Message.is_deleted,
        )
        .group_by(Message.message_type)
        .all()
    )

    return {
        "total_messages": total_messages,
        "total_chats": total_chats,
        "total_files": total_files,
        "messages_by_day": [{"date": str(r.day), "count": r.count} for r in messages_by_day],
        "top_contacts": top_contacts,
        "message_types": {r.message_type: r.count for r in type_breakdown},
    }
