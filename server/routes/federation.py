import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from server.core.database import get_db
from server.core.federation import federation
from server.core.models import FederationServer, FederationActivity, User
from shared.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


class FederationUserInfo(BaseModel):
    username: str
    display_name: str
    public_key: str
    signing_public_key: str | None = None
    server_name: str


# ── Discovery ──

@router.get("/.well-known/nurchat.json")
async def well_known():
    """Server discovery endpoint."""
    return {
        "server_name": federation.server_name,
        "public_key": federation.public_key_hex,
        "software": "NurChat",
        "version": "0.12",
        "federation_enabled": federation.enabled,
    }


@router.get("/federation/user/{username}")
async def federation_user_profile(username: str, db: Session = next(get_db)):
    """Public profile for cross-server user lookup."""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "username": user.username,
        "display_name": f"{user.first_name} {user.last_name or ''}".strip(),
        "public_key": user.public_key or "",
        "signing_public_key": user.signing_public_key or "",
        "server_name": federation.server_name,
        "avatar_path": user.avatar_path,
        "status": user.status or "",
    }


@router.get("/api/federation/resolve")
async def resolve_remote_address(address: str, db: Session = next(get_db)):
    """Resolve a user@host:port address to their public profile."""
    parsed = federation.parse_address(address)
    if not parsed:
        raise HTTPException(status_code=400, detail="Invalid address format. Use username@host:port")

    username, server_name = parsed

    # If it's our own server, look up locally
    if server_name == federation.server_name:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return {
            "username": user.username,
            "display_name": f"{user.first_name} {user.last_name or ''}".strip(),
            "public_key": user.public_key or "",
            "server_name": federation.server_name,
            "is_local": True,
        }

    # Fetch from remote server
    profile = await federation.fetch_user_profile(server_name, username)
    if not profile:
        raise HTTPException(status_code=502, detail=f"Cannot reach server {server_name}")

    profile["is_local"] = False
    profile["address"] = address
    return profile


class CreateRemoteChatRequest(BaseModel):
    remote_address: str  # username@host:port


@router.post("/api/federation/chat")
async def create_remote_chat(
    req: CreateRemoteChatRequest,
    db: Session = next(get_db),
):
    """Create or get a chat with a remote user (federation)."""
    from fastapi import Depends
    from server.core.security import verify_token_dependency, security

    # We can't use Depends here directly, so we extract token manually
    # This endpoint should be called with Authorization header

    parsed = federation.parse_address(req.remote_address)
    if not parsed:
        raise HTTPException(status_code=400, detail="Invalid address. Use username@host:port")

    username, server_name = parsed

    # Don't allow chatting with own server via federation
    if server_name == federation.server_name:
        raise HTTPException(status_code=400, detail="User is on this server. Use regular chat creation.")

    # Verify remote user exists
    profile = await federation.fetch_user_profile(server_name, username)
    if not profile:
        raise HTTPException(status_code=502, detail=f"Cannot reach {server_name}")

    return {
        "remote_address": req.remote_address,
        "display_name": profile.get("display_name", username),
        "public_key": profile.get("public_key", ""),
        "server_name": server_name,
        "username": username,
    }


# ── Inbox ──

class FederationActivityPayload(BaseModel):
    activity_id: str
    activity_type: str  # message, typing, reaction, read, presence
    sender_server: str
    sender_user: str
    recipient_server: str
    recipient_user: str
    payload: dict
    signature: str
    timestamp: float


@router.post("/federation/inbox")
async def federation_inbox(activity: FederationActivityPayload, db: Session = next(get_db)):
    """Receive a signed activity from a remote server."""
    if not federation.enabled:
        raise HTTPException(status_code=503, detail="Federation disabled")

    if not federation.is_server_allowed(activity.sender_server):
        logger.warning("Blocked activity from %s (not in allowed list)", activity.sender_server)
        raise HTTPException(status_code=403, detail="Server not allowed")

    # Verify signature
    payload_for_verify = json.dumps(
        {k: v for k, v in activity.model_dump().items() if k != "signature"},
        sort_keys=True,
        separators=(",", ":"),
    )
    if not federation.verify(payload_for_verify, activity.signature, activity.sender_server):
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Store/update remote server info
    server = db.query(FederationServer).filter(
        FederationServer.server_name == activity.sender_server
    ).first()
    if not server:
        server = FederationServer(
            server_name=activity.sender_server,
            public_key="",
            display_name=activity.sender_server,
        )
        db.add(server)
    server.last_seen = datetime.now(timezone.utc)
    db.commit()

    # Store activity
    db_activity = FederationActivity(
        activity_id=activity.activity_id,
        activity_type=activity.activity_type,
        sender_server=activity.sender_server,
        sender_user=activity.sender_user,
        recipient_server=activity.recipient_server,
        recipient_user=activity.recipient_user,
        payload=json.dumps(activity.payload),
        signature=activity.signature,
    )
    db.add(db_activity)
    db.commit()

    # Route the activity
    await _route_activity(activity, db)

    return {"status": "ok"}


async def _route_activity(activity: FederationActivityPayload, db: Session):
    """Route incoming activity to the appropriate local handler."""
    from server.ws.chat_manager import connection_manager

    if activity.activity_type == "message":
        await _handle_federated_message(activity, db)
    elif activity.activity_type == "typing":
        await _handle_federated_typing(activity)
    elif activity.activity_type == "reaction":
        await _handle_federated_reaction(activity, db)
    elif activity.activity_type == "presence":
        pass  # Could update remote user presence


async def _handle_federated_message(activity: FederationActivityPayload, db: Session):
    """Store and deliver a federated message to a local user."""
    from server.core.security import security
    from server.core.models import Chat, ChatParticipant, Message

    recipient = db.query(User).filter(User.username == activity.recipient_user).first()
    if not recipient:
        logger.warning("Recipient %s not found locally", activity.recipient_user)
        return

    sender_username = activity.sender_user
    sender_server = activity.sender_server
    msg_data = activity.payload

    # Find or create a chat with this remote user
    remote_address = f"{sender_username}@{sender_server}"

    # Look for an existing 1:1 chat where the name matches the remote address
    chat = None
    local_chats = db.query(Chat).join(ChatParticipant).filter(
        ChatParticipant.user_id == recipient.id,
        Chat.is_group == False,
    ).all()
    for c in local_chats:
        if c.name == remote_address:
            chat = c
            break

    if not chat:
        # Create new chat for this remote user
        chat_id = security.generate_chat_id()
        chat = Chat(id=chat_id, name=remote_address, is_group=False)
        db.add(chat)
        participant = ChatParticipant(chat_id=chat_id, user_id=recipient.id)
        db.add(participant)
        db.commit()

    # Store message
    msg_id = msg_data.get("id") or security.generate_message_id()
    message = Message(
        id=msg_id,
        chat_id=chat.id,
        user_id=recipient.id,  # Store as recipient's message
        content=msg_data.get("content", ""),
        encrypted_content=msg_data.get("encrypted_content"),
        message_type=msg_data.get("message_type", "text"),
        created_at=datetime.fromtimestamp(activity.timestamp, tz=timezone.utc),
    )
    db.add(message)
    db.commit()

    # Deliver via WebSocket
    await connection_manager.send_personal_message(
        json.dumps({
            "type": "message",
            "message": {
                "id": msg_id,
                "chat_id": chat.id,
                "content": msg_data.get("content", ""),
                "encrypted_content": msg_data.get("encrypted_content"),
                "message_type": msg_data.get("message_type", "text"),
                "created_at": message.created_at.isoformat(),
                "sender": remote_address,
            },
        }),
        recipient.id,
    )


async def _handle_federated_typing(activity: FederationActivityPayload):
    """Forward typing indicator from remote user."""
    from server.ws.chat_manager import connection_manager
    from server.core.database import SessionLocal

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == activity.recipient_user).first()
        if user:
            remote_address = f"{activity.sender_user}@{activity.sender_server}"
            await connection_manager.send_personal_message(
                json.dumps({"type": "typing", "user": remote_address}),
                user.id,
            )
    finally:
        db.close()


async def _handle_federated_reaction(activity: FederationActivityPayload, db: Session):
    """Handle a federated reaction."""
    from server.ws.chat_manager import connection_manager
    from server.core.models import MessageReaction

    msg_data = activity.payload
    recipient = db.query(User).filter(User.username == activity.recipient_user).first()
    if not recipient:
        return

    reaction = MessageReaction(
        message_id=msg_data.get("message_id", ""),
        user_id=recipient.id,
        emoji=msg_data.get("emoji", ""),
    )
    db.add(reaction)
    db.commit()

    await connection_manager.send_personal_message(
        json.dumps({
            "type": "reaction",
            "message_id": msg_data.get("message_id"),
            "emoji": msg_data.get("emoji"),
            "user": f"{activity.sender_user}@{activity.sender_server}",
        }),
        recipient.id,
    )


# ── Outbox helper (called from chat routes) ──

async def send_federated_message(sender_user: User, recipient_address: str, content: str, msg_id: str, encrypted_content: str | None = None, message_type: str = "text") -> bool:
    """Send a message to a remote user via federation."""
    if not federation.enabled:
        return False

    parsed = federation.parse_address(recipient_address)
    if not parsed:
        return False

    recipient_username, recipient_server = parsed

    activity = {
        "activity_id": f"fed_{msg_id}",
        "activity_type": "message",
        "sender_server": federation.server_name,
        "sender_user": sender_user.username,
        "recipient_server": recipient_server,
        "recipient_user": recipient_username,
        "payload": {
            "id": msg_id,
            "content": content,
            "encrypted_content": encrypted_content,
            "message_type": message_type,
        },
        "timestamp": time.time(),
    }

    return await federation.deliver_activity(recipient_server, activity)


import time


# Helper for typing
async def send_federated_typing(sender_user: User, recipient_address: str) -> bool:
    if not federation.enabled:
        return False
    parsed = federation.parse_address(recipient_address)
    if not parsed:
        return False
    recipient_username, recipient_server = parsed

    activity = {
        "activity_id": f"fed_typing_{sender_user.id}_{int(time.time())}",
        "activity_type": "typing",
        "sender_server": federation.server_name,
        "sender_user": sender_user.username,
        "recipient_server": recipient_server,
        "recipient_user": recipient_username,
        "payload": {},
        "timestamp": time.time(),
    }
    return await federation.deliver_activity(recipient_server, activity)


async def send_federated_reaction(sender_user: User, recipient_address: str, message_id: str, emoji: str) -> bool:
    if not federation.enabled:
        return False
    parsed = federation.parse_address(recipient_address)
    if not parsed:
        return False
    recipient_username, recipient_server = parsed

    activity = {
        "activity_id": f"fed_react_{sender_user.id}_{message_id}_{int(time.time())}",
        "activity_type": "reaction",
        "sender_server": federation.server_name,
        "sender_user": sender_user.username,
        "recipient_server": recipient_server,
        "recipient_user": recipient_username,
        "payload": {"message_id": message_id, "emoji": emoji},
        "timestamp": time.time(),
    }
    return await federation.deliver_activity(recipient_server, activity)
