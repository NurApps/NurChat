import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import verify_token_dependency
from server.ws.chat_manager import connection_manager
from shared.rate_limiter import limiter

router = APIRouter(prefix="/api/contacts", tags=["contact-requests"])


@router.post("/requests", response_model=schemas.ContactRequestResponse)
@limiter.limit("5/minute")
async def send_contact_request(
    request: Request,
    req: schemas.ContactRequestCreate,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]
    if user_id == req.to_user_id:
        raise HTTPException(status_code=400, detail="Cannot send request to yourself")

    target = db.query(models.User).filter(models.User.id == req.to_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.query(models.ContactRequest).filter(
        models.ContactRequest.from_user_id == user_id,
        models.ContactRequest.to_user_id == req.to_user_id,
        models.ContactRequest.status == "pending",
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Request already sent")

    contact_request = models.ContactRequest(
        id=str(uuid.uuid4()),
        from_user_id=user_id,
        to_user_id=req.to_user_id,
        message=req.message,
    )
    db.add(contact_request)
    db.commit()
    db.refresh(contact_request)

    from_user = db.query(models.User).filter(models.User.id == user_id).first()
    to_user = db.query(models.User).filter(models.User.id == req.to_user_id).first()

    await connection_manager.send_personal_message({
        "event": "contact_request",
        "from_user_id": user_id,
        "from_username": from_user.username if from_user else user_id,
    }, req.to_user_id)

    return schemas.ContactRequestResponse(
        id=contact_request.id,
        from_user_id=contact_request.from_user_id,
        to_user_id=contact_request.to_user_id,
        message=contact_request.message,
        status=contact_request.status,
        created_at=contact_request.created_at,
        updated_at=contact_request.updated_at,
        from_user=schemas.UserResponse.model_validate(from_user),
        to_user=schemas.UserResponse.model_validate(to_user),
    )


@router.get("/requests/incoming", response_model=list[schemas.ContactRequestResponse])
@limiter.limit("10/minute")
async def get_incoming_requests(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]
    requests = (
        db.query(models.ContactRequest)
        .filter(
            models.ContactRequest.to_user_id == user_id,
            models.ContactRequest.status == "pending",
        )
        .options(
            joinedload(models.ContactRequest.from_user),
            joinedload(models.ContactRequest.to_user),
        )
        .order_by(models.ContactRequest.created_at.desc())
        .all()
    )
    return [
        schemas.ContactRequestResponse(
            id=r.id,
            from_user_id=r.from_user_id,
            to_user_id=r.to_user_id,
            message=r.message,
            status=r.status,
            created_at=r.created_at,
            updated_at=r.updated_at,
            from_user=schemas.UserResponse.model_validate(r.from_user),
            to_user=schemas.UserResponse.model_validate(r.to_user),
        )
        for r in requests
    ]


@router.get("/requests/sent", response_model=list[schemas.ContactRequestResponse])
@limiter.limit("10/minute")
async def get_sent_requests(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]
    requests = (
        db.query(models.ContactRequest)
        .filter(models.ContactRequest.from_user_id == user_id)
        .options(
            joinedload(models.ContactRequest.from_user),
            joinedload(models.ContactRequest.to_user),
        )
        .order_by(models.ContactRequest.created_at.desc())
        .all()
    )
    return [
        schemas.ContactRequestResponse(
            id=r.id,
            from_user_id=r.from_user_id,
            to_user_id=r.to_user_id,
            message=r.message,
            status=r.status,
            created_at=r.created_at,
            updated_at=r.updated_at,
            from_user=schemas.UserResponse.model_validate(r.from_user),
            to_user=schemas.UserResponse.model_validate(r.to_user),
        )
        for r in requests
    ]


@router.post("/requests/{request_id}/accept", response_model=schemas.ContactRequestResponse)
async def accept_contact_request(
    request_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]
    req = db.query(models.ContactRequest).filter(
        models.ContactRequest.id == request_id,
        models.ContactRequest.to_user_id == user_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Request already processed")

    req.status = "accepted"
    req.updated_at = datetime.now(timezone.utc)

    existing = db.query(models.Contact).filter(
        models.Contact.user_id == user_id,
        models.Contact.contact_user_id == req.from_user_id,
    ).first()
    if not existing:
        contact = models.Contact(
            id=str(uuid.uuid4()),
            user_id=user_id,
            contact_user_id=req.from_user_id,
        )
        db.add(contact)

    reverse = db.query(models.Contact).filter(
        models.Contact.user_id == req.from_user_id,
        models.Contact.contact_user_id == user_id,
    ).first()
    if not reverse:
        contact_rev = models.Contact(
            id=str(uuid.uuid4()),
            user_id=req.from_user_id,
            contact_user_id=user_id,
        )
        db.add(contact_rev)

    db.commit()
    db.refresh(req)

    from_user = db.query(models.User).filter(models.User.id == req.from_user_id).first()
    to_user = db.query(models.User).filter(models.User.id == user_id).first()

    return schemas.ContactRequestResponse(
        id=req.id,
        from_user_id=req.from_user_id,
        to_user_id=req.to_user_id,
        message=req.message,
        status=req.status,
        created_at=req.created_at,
        updated_at=req.updated_at,
        from_user=schemas.UserResponse.model_validate(from_user),
        to_user=schemas.UserResponse.model_validate(to_user),
    )


@router.post("/requests/{request_id}/reject")
async def reject_contact_request(
    request_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user_id = token["sub"]
    req = db.query(models.ContactRequest).filter(
        models.ContactRequest.id == request_id,
        models.ContactRequest.to_user_id == user_id,
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Request already processed")

    req.status = "rejected"
    req.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"detail": "Request rejected"}
