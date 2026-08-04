# shared/schemas.py

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Базовая схема
class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

# TOTP 2FA Schemas
class TOTPSetupResponse(BaseSchema):
    """Response with QR code for TOTP setup"""
    qr_code: str  # Data URI with QR code image
    secret_hint: str  # First few characters of secret for manual entry (optional)
    backup_codes: list[str] | None = None  # Recovery codes (optional for future)

class TOTPVerifyRequest(BaseSchema):
    """Request to verify TOTP code"""
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")

class TOTPEnableRequest(TOTPVerifyRequest):
    """Request to enable TOTP after setup"""
    pass

class TOTPDisableRequest(TOTPVerifyRequest):
    """Request to disable TOTP"""
    pass

class UserTOTPStatus(BaseSchema):
    """TOTP status for user"""
    enabled: bool
    setup_required: bool  # True if secret exists but not enabled yet

# User
class UserBase(BaseSchema):
    id: str
    username: str
    first_name: str
    last_name: str | None = None

class UserCreate(BaseSchema):
    # Username: только латинские буквы и цифры, без ограничений по длине
    username: str = Field(..., description="Username (латинские буквы и цифры)")
    first_name: str | None = Field(None, description="Имя (обязательно)")
    last_name: str | None = Field(None, description="Фамилия (необязательно)")
    # Пароль: минимум 4 символа или цифры, или если букв более 4, то без ограничений
    password: str = Field(..., description="Password (минимум 4 символа или цифры, или >4 букв)")

class UserUpdate(BaseSchema):
    """Схема для обновления профиля пользователя"""
    first_name: str | None = Field(None, min_length=2, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    bio: str | None = Field(None, max_length=500)
    status: str | None = Field(None, max_length=100)

class UserResponse(UserBase):
    created_at: datetime
    last_seen: datetime
    is_online: bool
    public_key: str | None = None  # Публичный ключ для E2E шифрования
    signing_public_key: str | None = None  # Ed25519 public key для верификации подписей
    avatar_path: str | None = None  # Путь к аватару
    status: str | None = None  # Статус пользователя
    bio: str | None = None  # Биография пользователя

# Chat
class ChatBase(BaseSchema):
    id: str
    name: str | None = None
    is_group: bool

class ChatCreate(BaseSchema):
    name: str | None = Field(None, max_length=100, description="Chat name must be up to 100 characters long")
    is_group: bool = False
    is_secret: bool = False
    disappears_after_seconds: int = 0
    participant_ids: list[str] = Field(
        ..., min_length=1, max_length=100, description="Chat must have 1-100 participants"
    )

    @field_validator('name')
    @classmethod
    def validate_name(cls, v):
        if v and len(v) > 0:
            if '<script' in v.lower() or 'javascript:' in v.lower():
                raise ValueError('Name contains forbidden characters')
        return v

class ChatResponse(ChatBase):
    created_at: datetime
    participants: list[UserResponse]
    last_message: Optional['MessageResponse'] = None
    unread_count: int = 0
    is_pinned: bool = False  # Закреплён ли чат
    is_muted: bool = False  # Отключены ли уведомления
    is_secret: bool = False
    disappears_after_seconds: int = 0


class GroupRenameRequest(BaseSchema):
    name: str = Field(..., min_length=1, max_length=100)

# Message
class MessageBase(BaseSchema):
    id: str
    content: str
    message_type: str = "text"

class MessageCreate(BaseSchema):
    chat_id: str = Field(..., min_length=1, max_length=100)
    content: str = Field(
        ..., min_length=1, max_length=5000, description="Message content must be 1-5000 characters long"
    )
    message_type: str = Field(default="text", pattern=r"^(text|image|video|audio|file|location|contact|voice)$")
    file_id: str | None = Field(None, max_length=100)
    forwarded_from: str | None = Field(None, max_length=100)
    reply_to_id: str | None = Field(None, max_length=100)
    encrypted_content: str | None = None
    signature: str | None = None
    expires_at: datetime | None = None

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        # Remove any potentially harmful content
        if '<script' in v.lower() or 'javascript:' in v.lower():
            raise ValueError('Content contains forbidden characters')
        return v

class MessageReplyPreview(BaseSchema):
    id: str
    content: str
    user_id: str
    user: UserResponse

class MessageResponse(MessageBase):
    user_id: str
    chat_id: str
    user: UserResponse
    file_id: str | None = None
    file: Optional['FileResponse'] = None
    forwarded_from: str | None = None
    reply_to_id: str | None = None
    reply_to: MessageReplyPreview | None = None
    encrypted_content: str | None = None
    signature: str | None = None
    is_deleted: bool = False
    deleted_for_all: bool = False
    is_read: bool = False
    created_at: datetime

# File
class FileBase(BaseSchema):
    id: str
    filename: str
    file_type: str
    file_size: int

class FileUploadResponse(FileBase):
    file_path: str
    ttl_days: int
    uploaded_at: datetime

class FileResponse(FileBase):
    user_id: str
    uploaded_at: datetime

# Auth
class Token(BaseSchema):
    access_token: str
    refresh_token: str | None = None
    token_type: str
    user: UserResponse
    private_key: str | None = None
    signing_private_key: str | None = None  # Ed25519 private key (returned once on register)
    requires_2fa: bool = False  # True if 2FA is enabled but not yet verified

# 2FA
class TwoFASetupRequest(BaseSchema):
    password: str = Field(..., description="Current password to confirm identity")

class TwoFASetupResponse(BaseSchema):
    secret: str = Field(..., description="TOTP secret (for manual entry)")
    uri: str = Field(..., description="otpauth:// URI")
    qr_code: str = Field(..., description="QR code as base64 data URI")
    backup_codes: list[str] = Field(..., description="Plaintext backup codes (shown once)")

class TwoFAVerifyRequest(BaseSchema):
    code: str = Field(..., min_length=6, max_length=7, description="6-digit TOTP code (e.g. 123456 or 123 456)")

class TwoFALoginRequest(BaseSchema):
    code: str = Field(..., description="6-digit TOTP code or backup code (XXXX-XXXX)")
    password: str | None = Field(None, description="Password (optional — TOTP secret uses master key)")

class TwoFAEnableRequest(BaseSchema):
    code: str = Field(..., min_length=6, max_length=7, description="6-digit TOTP code to confirm setup")
    password: str = Field(..., description="Current password")

class TwoFADisableRequest(BaseSchema):
    password: str = Field(..., description="Current password")
    code: str = Field(..., description="Current TOTP code or backup code")

class TwoFAResponse(BaseSchema):
    enabled: bool
    backup_codes_remaining: int = 0

# Forward
class ForwardRequest(BaseSchema):
    message_id: str = Field(..., min_length=1, max_length=100)
    target_chat_ids: list[str] = Field(..., min_length=1, max_length=50, description="Can forward to 1-50 chats")

# Contacts
class ContactBase(BaseSchema):
    id: str
    user_id: str
    contact_user_id: str

class ContactCreate(BaseSchema):
    contact_user_id: str = Field(..., min_length=1, max_length=100, description="ID контакта для добавления")

class ContactResponse(ContactBase):
    created_at: datetime
    user: UserResponse
    contact_user: UserResponse

# Groups
class GroupInviteBase(BaseSchema):
    id: str
    group_id: str
    inviter_id: str
    invitee_id: str
    status: str  # pending, accepted, declined

class GroupInviteCreate(BaseSchema):
    group_id: str = Field(..., min_length=1, max_length=100, description="ID группы для приглашения")
    invitee_id: str = Field(..., min_length=1, max_length=100, description="ID пользователя для приглашения")

class GroupInviteResponse(GroupInviteBase):
    created_at: datetime
    updated_at: datetime
    group: ChatResponse
    inviter: UserResponse
    invitee: UserResponse

# Calls
class CallStartRequest(BaseSchema):
    target_user_id: str = Field(..., min_length=1, max_length=100)
    call_type: str = Field(..., pattern=r"^(audio|video)$", description="Call type must be either 'audio' or 'video'")
    chat_id: str | None = Field(None, max_length=100)

class CallResponse(BaseSchema):
    call_id: str
    caller_id: str
    callee_id: str
    call_type: str
    status: str
    started_at: datetime
    ended_at: datetime | None = None
    ended_by: str | None = None
    duration: int | None = None

class CallHistoryResponse(BaseSchema):
    calls: list[CallResponse]
    total: int

# Files
class StorageInfo(BaseSchema):
    total_size: int
    file_count: int
    files_by_type: list[dict]
    max_storage: int
    storage_used_percent: float

class CleanupResponse(BaseSchema):
    message: str
    deleted_count: int

# Blocking
class BlockedUserBase(BaseSchema):
    id: int
    user_id: str
    blocked_user_id: str
    created_at: datetime
    blocked_user: UserResponse

class BlockedUserResponse(BlockedUserBase):
    pass

class P2PIdentityResponse(BaseSchema):
    user_id: str
    peer_id: str
    public_key: str
    signing_public_key: str
    updated_at: datetime


class P2PPendingResponse(BaseSchema):
    id: str
    sender_id: str
    payload: str
    created_at: datetime


class P2PPeerResponse(BaseSchema):
    user_id: str
    username: str
    peer_id: str
    public_key: str
    signing_public_key: str | None = None
    is_online: bool = False


class P2PBackupResponse(BaseSchema):
    id: str
    chat_id: str
    payload: str
    version: int
    created_at: datetime

class ReactionBase(BaseSchema):
    id: int
    message_id: str
    user_id: str
    emoji: str
    created_at: datetime

class ReactionCreate(BaseSchema):
    emoji: str

class ReactionResponse(ReactionBase):
    user: UserResponse

# Pinned Messages
class PinnedMessageResponse(BaseSchema):
    id: int
    chat_id: str
    message_id: str
    pinned_by: str
    created_at: datetime
    message: MessageResponse
    pinned_by_user: UserResponse

# Webhooks
class WebhookCreate(BaseSchema):
    name: str = Field(..., min_length=1, max_length=100)
    url: str = Field(..., max_length=500)
    secret: str | None = Field(None, max_length=256)
    events: list[str] = Field(..., min_length=1)

class WebhookUpdate(BaseSchema):
    name: str | None = Field(None, max_length=100)
    url: str | None = Field(None, max_length=500)
    secret: str | None = None
    events: list[str] | None = None
    is_active: bool | None = None

class WebhookResponse(BaseSchema):
    id: str
    user_id: str
    name: str
    url: str
    secret: str | None = None
    events: list[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

# Statistics
class StatsResponse(BaseSchema):
    total_messages: int
    total_chats: int
    total_files: int
    messages_by_day: list[dict]
    top_contacts: list[dict]
    message_types_breakdown: dict

# Обновляем ссылки для рекурсивных типов
MessageResponse.model_rebuild()
ChatResponse.model_rebuild()
FileResponse.model_rebuild()
ContactResponse.model_rebuild()
GroupInviteResponse.model_rebuild()
