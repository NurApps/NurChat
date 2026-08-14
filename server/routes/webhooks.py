import sys
from pathlib import Path

if str(Path(__file__).resolve().parent.parent.parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import verify_token_dependency
from server.utils.id_generator import generate_id
from server.utils.logger import logger

router = APIRouter()


@router.get("/webhooks", response_model=list[schemas.WebhookResponse])
async def list_webhooks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(verify_token_dependency),
):
    webhooks = db.query(models.Webhook).filter(models.Webhook.user_id == current_user["sub"]).all()
    return [_webhook_to_response(w) for w in webhooks]


@router.post("/webhooks", response_model=schemas.WebhookResponse, status_code=status.HTTP_201_CREATED)
async def create_webhook(
    data: schemas.WebhookCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(verify_token_dependency),
):
    webhook = models.Webhook(
        id="hook_" + generate_id(),
        user_id=current_user["sub"],
        name=data.name,
        url=data.url,
        secret=data.secret,
        events=",".join(data.events),
        is_active=True,
    )
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    logger.info(f"[Webhooks] created '{webhook.name}' for user {current_user['sub']}")
    return _webhook_to_response(webhook)


@router.put("/webhooks/{webhook_id}", response_model=schemas.WebhookResponse)
async def update_webhook(
    webhook_id: str,
    data: schemas.WebhookUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(verify_token_dependency),
):
    webhook = db.query(models.Webhook).filter(
        models.Webhook.id == webhook_id,
        models.Webhook.user_id == current_user["sub"],
    ).first()
    if not webhook:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook не найден")

    if data.name is not None:
        webhook.name = data.name
    if data.url is not None:
        webhook.url = data.url
    if data.secret is not None:
        webhook.secret = data.secret
    if data.events is not None:
        webhook.events = ",".join(data.events)
    if data.is_active is not None:
        webhook.is_active = data.is_active

    db.commit()
    db.refresh(webhook)
    return _webhook_to_response(webhook)


@router.delete("/webhooks/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(
    webhook_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(verify_token_dependency),
):
    webhook = db.query(models.Webhook).filter(
        models.Webhook.id == webhook_id,
        models.Webhook.user_id == current_user["sub"],
    ).first()
    if not webhook:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook не найден")

    db.delete(webhook)
    db.commit()
    logger.info(f"[Webhooks] deleted '{webhook.name}' for user {current_user['sub']}")


@router.post("/webhooks/{webhook_id}/test", status_code=status.HTTP_200_OK)
async def test_webhook(
    webhook_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(verify_token_dependency),
):
    from server.core.webhook_delivery import deliver_webhook

    webhook = db.query(models.Webhook).filter(
        models.Webhook.id == webhook_id,
        models.Webhook.user_id == current_user["sub"],
    ).first()
    if not webhook:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook не найден")

    ok = await deliver_webhook(webhook, "test", {"message": "Тестовый webhook от NurChat"})
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Не удалось доставить тестовый webhook")
    return {"status": "ok", "message": "Тестовый webhook успешно доставлен"}


def _webhook_to_response(w: models.Webhook) -> schemas.WebhookResponse:
    return schemas.WebhookResponse(
        id=w.id,
        user_id=w.user_id,
        name=w.name,
        url=w.url,
        secret=w.secret,
        events=w.events.split(",") if w.events else [],
        is_active=w.is_active,
        created_at=w.created_at,
        updated_at=w.updated_at,
    )