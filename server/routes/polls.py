import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import verify_token_dependency
from server.ws.chat_manager import connection_manager
from shared.rate_limiter import limiter

router = APIRouter(prefix="/api/chat", tags=["polls"])


@router.post("/chats/{chat_id}/polls", response_model=schemas.PollResponse)
@limiter.limit("10/minute")
async def create_poll(
    request: Request,
    chat_id: str,
    poll_data: schemas.PollCreate,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]
    participant = db.query(models.ChatParticipant).filter(
        models.ChatParticipant.chat_id == chat_id,
        models.ChatParticipant.user_id == user_id,
    ).first()
    if not participant:
        raise HTTPException(status_code=403, detail="Not a participant")

    poll = models.Poll(
        id=str(uuid.uuid4()),
        chat_id=chat_id,
        creator_id=user_id,
        question=poll_data.question,
        is_anonymous=poll_data.is_anonymous,
        allow_multiple=poll_data.allow_multiple,
        expires_at=poll_data.expires_at,
    )
    db.add(poll)
    db.flush()

    for i, opt in enumerate(poll_data.options):
        option = models.PollOption(
            poll_id=poll.id,
            text=opt.text,
            position=i,
        )
        db.add(option)

    db.commit()
    db.refresh(poll)

    await connection_manager.broadcast_to_chat({
        "event": "new_poll",
        "poll_id": poll.id,
        "chat_id": chat_id,
        "creator_id": user_id,
        "question": poll.question,
    }, chat_id)

    return _poll_to_response(poll, user_id, db)


@router.get("/chats/{chat_id}/polls", response_model=list[schemas.PollResponse])
async def get_polls(
    chat_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]
    polls = (
        db.query(models.Poll)
        .filter(models.Poll.chat_id == chat_id)
        .options(
            joinedload(models.Poll.options),
            joinedload(models.Poll.votes),
        )
        .order_by(models.Poll.created_at.desc())
        .all()
    )
    return [_poll_to_response(p, user_id, db) for p in polls]


@router.post("/polls/{poll_id}/vote", response_model=schemas.PollResponse)
@limiter.limit("30/minute")
async def vote_poll(
    request: Request,
    poll_id: str,
    vote_data: schemas.PollVoteRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]
    poll = db.query(models.Poll).filter(models.Poll.id == poll_id).first()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")

    if poll.expires_at:
        # SQLite returns naive datetimes — normalize before comparing
        poll_expiry = poll.expires_at if poll.expires_at.tzinfo else poll.expires_at.replace(tzinfo=timezone.utc)
        if poll_expiry < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Poll has expired")

    if not poll.allow_multiple and len(vote_data.option_ids) > 1:
        raise HTTPException(status_code=400, detail="Multiple choices not allowed")

    for option_id in vote_data.option_ids:
        option = db.query(models.PollOption).filter(
            models.PollOption.id == option_id,
            models.PollOption.poll_id == poll_id,
        ).first()
        if not option:
            raise HTTPException(status_code=400, detail=f"Invalid option {option_id}")

    existing = db.query(models.PollVote).filter(
        models.PollVote.poll_id == poll_id,
        models.PollVote.user_id == user_id,
    ).all()

    for vote in existing:
        if vote.option_id not in vote_data.option_ids:
            db.delete(vote)

    for option_id in vote_data.option_ids:
        already_voted = any(v.option_id == option_id for v in existing if v.option_id in vote_data.option_ids)
        if not already_voted:
            vote = models.PollVote(
                poll_id=poll_id,
                option_id=option_id,
                user_id=user_id,
            )
            db.add(vote)

    db.commit()
    db.refresh(poll)

    await connection_manager.broadcast_to_chat({
        "event": "poll_vote",
        "poll_id": poll_id,
        "chat_id": poll.chat_id,
    }, poll.chat_id)

    return _poll_to_response(poll, user_id, db)


def _poll_to_response(poll: models.Poll, user_id: str, db: Session) -> schemas.PollResponse:
    options = sorted(poll.options, key=lambda o: o.position)
    vote_counts = {}
    for opt in options:
        count = db.query(models.PollVote).filter(models.PollVote.option_id == opt.id).count()
        vote_counts[opt.id] = count

    my_votes = []
    if user_id:
        votes = db.query(models.PollVote).filter(
            models.PollVote.poll_id == poll.id,
            models.PollVote.user_id == user_id,
        ).all()
        my_votes = [v.option_id for v in votes]

    total_votes = sum(vote_counts.values())

    return schemas.PollResponse(
        id=poll.id,
        chat_id=poll.chat_id,
        creator_id=poll.creator_id,
        question=poll.question,
        is_anonymous=poll.is_anonymous,
        allow_multiple=poll.allow_multiple,
        expires_at=poll.expires_at,
        created_at=poll.created_at,
        options=[
            schemas.PollOptionResponse(
                id=opt.id, text=opt.text,
                position=opt.position,
                vote_count=vote_counts.get(opt.id, 0)
            )
            for opt in options
        ],
        total_votes=total_votes,
        my_votes=my_votes,
    )
