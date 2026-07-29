from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from server.core import models, schemas
from server.core.database import get_db
from server.core.security import security, verify_token_dependency
from server.utils.logger import logger
from shared.config import settings

router = APIRouter()


@router.post("/keys/generate")
async def generate_p2p_keys(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Генерирует P2P ключи и сохраняет публичные ключи на сервер"""
    from shared.p2p_encryption import P2PEncryption

    crypto = P2PEncryption()
    private_hex, public_hex = crypto.generate_asymmetric_keys()

    # Генерируем signing ключи (Ed25519)
    from nacl.encoding import HexEncoder
    from nacl.signing import SigningKey
    signing_sk = SigningKey.generate()
    signing_pk = signing_sk.verify_key
    signing_private_hex = signing_sk.encode(encoder=HexEncoder).hex()
    signing_public_hex = signing_pk.encode(encoder=HexEncoder).hex()

    # Сохраняем публичные ключи на сервере
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    user.public_key = public_hex
    user.signing_public_key = signing_public_hex
    db.commit()

    logger.info(f"P2P keys generated for user {user.id}")

    return {
        "private_key": private_hex,
        "public_key": public_hex,
        "signing_private_key": signing_private_hex,
        "signing_public_key": signing_public_hex,
    }


@router.get("/identity", response_model=schemas.P2PIdentityResponse)
async def get_identity(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    peer_id = user.public_key or user.id
    return schemas.P2PIdentityResponse(
        user_id=user.id,
        peer_id=peer_id,
        public_key=user.public_key or "",
        signing_public_key=getattr(user, "signing_public_key", "") or "",
        updated_at=user.last_seen or datetime.now(timezone.utc),
    )


@router.post("/identity")
async def upsert_identity(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    public_key = payload.get("public_key")
    signing_public_key = payload.get("signing_public_key")
    if not public_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="public_key обязателен")
    if not signing_public_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="signing_public_key обязателен")

    user.public_key = public_key
    user.signing_public_key = signing_public_key
    user.last_seen = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    logger.info(f"P2P identity updated for user {user.id}")

    return {"message": "P2P identity updated"}


@router.get("/pending", response_model=list[schemas.P2PPendingResponse])
async def get_pending_messages(
    limit: int = 500,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    limit = min(max(limit, 1), 1000)
    messages = db.query(models.P2PMessage).filter(
        models.P2PMessage.recipient_id == token["sub"]
    ).order_by(models.P2PMessage.created_at.asc()).limit(limit).all()

    for message in messages:
        message.delivered_at = datetime.now(timezone.utc)
    db.commit()

    return [schemas.P2PPendingResponse(
        id=message.id,
        sender_id=message.sender_id,
        payload=message.payload,
        created_at=message.created_at,
    ) for message in messages]


@router.get("/peers/search", response_model=list[schemas.P2PPeerResponse])
async def search_peers(
    query: str,
    limit: int = 50,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    if not query or len(query.strip()) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="query должен содержать минимум 2 символа")
    limit = min(max(limit, 1), 100)
    pattern = f"%{query.strip()}%"
    users = db.query(models.User).filter(
        models.User.id != token["sub"],
        or_(
            models.User.username.ilike(pattern),
            models.User.id.ilike(pattern),
        ),
        models.User.public_key.is_not(None),
    ).limit(limit).all()

    online_user_ids = set()
    try:
        from server.ws.p2p_manager import p2p_manager
        online_user_ids = set(p2p_manager.active_connections.keys())
    except Exception as e:
        logger.debug("Could not check P2P online status: %s", e)

    return [schemas.P2PPeerResponse(
        user_id=user.id,
        username=user.username,
        peer_id=user.public_key,
        public_key=user.public_key,
        signing_public_key=getattr(user, "signing_public_key", None),
        is_online=user.id in online_user_ids,
    ) for user in users]


@router.post("/backups", response_model=schemas.P2PBackupResponse)
async def save_backup(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    chat_id = payload.get("chat_id")
    backup_payload = payload.get("payload")
    version = int(payload.get("version") or 1)
    if not chat_id or not backup_payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="chat_id и payload обязательны")

    backup_id = payload.get("id") or f"backup_{security.generate_message_id()}"
    existing = db.query(models.P2PBackup).filter(
        models.P2PBackup.id == backup_id,
        models.P2PBackup.user_id == token["sub"],
    ).first()
    if existing:
        existing.payload = backup_payload
        existing.version = version
        existing.created_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        backup = existing
    else:
        backup = models.P2PBackup(
            id=backup_id,
            user_id=token["sub"],
            chat_id=chat_id,
            payload=backup_payload,
            version=version,
            created_at=datetime.now(timezone.utc),
        )
        db.add(backup)
        db.commit()
        db.refresh(backup)

    return schemas.P2PBackupResponse(
        id=backup.id,
        chat_id=backup.chat_id,
        payload=backup.payload,
        version=backup.version,
        created_at=backup.created_at,
    )


@router.get("/backups", response_model=list[schemas.P2PBackupResponse])
async def list_backups(
    chat_id: str | None = None,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    query = db.query(models.P2PBackup).filter(models.P2PBackup.user_id == token["sub"])
    if chat_id:
        query = query.filter(models.P2PBackup.chat_id == chat_id)
    backups = query.order_by(models.P2PBackup.created_at.desc()).all()
    return [schemas.P2PBackupResponse(
        id=backup.id,
        chat_id=backup.chat_id,
        payload=backup.payload,
        version=backup.version,
        created_at=backup.created_at,
    ) for backup in backups]


@router.delete("/pending/{message_id}")
async def delete_pending_message(
    message_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    message = db.query(models.P2PMessage).filter(
        models.P2PMessage.id == message_id,
        models.P2PMessage.recipient_id == token["sub"],
    ).first()
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сообщение не найдено")

    db.delete(message)
    db.commit()
    return {"message": "Сообщение удалено"}


@router.get("/my-address")
async def get_my_address(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Возвращает nurchat:// URI для приглашения других пользователей"""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404)
    host = settings.SERVER_HOST
    port = settings.SERVER_PORT
    if host == "127.0.0.1":
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            host = s.getsockname()[0]
        except Exception:
            host = "127.0.0.1"
        finally:
            s.close()
    peer_id = user.public_key or user.id
    uri = f"nurchat://{host}:{port}/{user.id}#{peer_id[:16]}"
    return {
        "uri": uri,
        "host": host,
        "port": port,
        "user_id": user.id,
        "peer_id": peer_id,
        "port_open": settings.SERVER_HOST != "127.0.0.1",
    }


@router.post("/open-port")
async def open_port(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Переключает сервер на 0.0.0.0 для внешних подключений"""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404)
    if settings.SERVER_HOST not in ("0.0.0.0", ""):
        return {"message": "Порт уже открыт", "host": settings.SERVER_HOST, "port": settings.SERVER_PORT}
    logger.warning("Для внешних подключений задайте SERVER_HOST=0.0.0.0 в .env и перезапустите сервер")
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        external_ip = s.getsockname()[0]
    except Exception:
        external_ip = "0.0.0.0"
    finally:
        s.close()
    peer_id = user.public_key or user.id
    uri = f"nurchat://{external_ip}:{settings.SERVER_PORT}/{user.id}#{peer_id[:16]}"
    return {
        "message": "Порт открыт. Отправьте эту ссылку другу:",
        "uri": uri,
        "host": external_ip,
        "port": settings.SERVER_PORT,
        "user_id": user.id,
    }


@router.get("/remote-peers")
async def list_remote_peers(
    token: dict = Depends(verify_token_dependency),
):
    """Список подключённых удалённых пиров"""
    from server.ws.remote import remote_manager
    return {"peers": remote_manager.active_peers}


@router.delete("/remote-peers/{node_id}")
async def disconnect_remote_peer(
    node_id: str,
    token: dict = Depends(verify_token_dependency),
):
    """Отключить удалённого пира"""
    from server.ws.remote import remote_manager
    peer = remote_manager.get_peer_by_node(node_id)
    if not peer:
        raise HTTPException(status_code=404, detail="Пир не найден")
    remote_manager.disconnect(node_id)
    return {"message": f"Пир {node_id} отключён"}


@router.get("/relay-peers")
async def list_relay_peers(
    token: dict = Depends(verify_token_dependency),
):
    """Список пиров, которые могут выступать ретранслятором (NAT relay)"""
    from server.ws.remote import remote_manager
    return {"relays": remote_manager.relay_peers}


@router.post("/register-relay")
async def register_as_relay(
    token: dict = Depends(verify_token_dependency),
):
    """Отмечает текущего пользователя как ретранслятор"""
    user_id = token["sub"]
    from server.ws.remote import remote_manager
    peer = remote_manager.get_peer_by_user(user_id)
    if not peer:
        raise HTTPException(status_code=404, detail="Нет активного P2P соединения")
    peer.is_relay = True
    return {"message": "Релей зарегистрирован", "node_id": peer.node_id}
