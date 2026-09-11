# shared/schemas.py

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Базовая схема
class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

# User
class UserBase(BaseSchema):
    id: str
    username: str
    first_name: str
    last_name: str | None = None

class UserCreate(BaseSchema):
    username: str = Field(..., description="Username (латинские буквы и цифры)")
    first_name: str | None = Field(None, description="Имя (обязательно)")
    last_name: str | None = Field(None, description="Фамилия (необязательно)")
    password: str = Field(..., description="Password (минимум 4 символа)")

class UserResponse(UserBase):
    created_at: datetime | None = None
    last_seen: datetime | None = None
    is_online: bool | None = None
    public_key: str | None = None
    signing_public_key: str | None = None
    avatar_path: str | None = None
    status: str | None = None
    bio: str | None = None

# Chat
class ChatBase(BaseSchema):
    id: str
    name: str | None = None
    is_group: bool

class ChatCreate(BaseSchema):
    name: str | None = Field(None, max_length=100)
    is_group: bool = False
    is_secret: bool = False
    disappears_after_seconds: int = 0
    participant_ids: list[str] = Field(..., min_length=1, max_length=100)

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
    is_pinned: bool = False
    is_muted: bool = False
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
    content: str = Field(..., min_length=1, max_length=5000)
    message_type: str = Field(default="text", pattern=r"^(text|image|video|audio|file|location|contact|voice)$")
    file_id: str | None = Field(None, max_length=100)
    forwarded_from: str | None = Field(None, max_length=100)
    reply_to_id: str | None = Field(None, max_length=100)
    encrypted_content: str | None = None
    signature: str | None = None
    expires_at: datetime | None = None
    sealed_sender: bool = Field(default=False)
    scheduled_at: datetime | None = None
    is_view_once: bool = Field(default=False)

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
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
    edited_at: datetime | None = None
    expires_at: datetime | None = None
    scheduled_at: datetime | None = None
    is_view_once: bool = False
    viewed_at: datetime | None = None
    created_at: datetime
    reactions: dict[str, list[str]] | None = None

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
    password: str | None = Field(None)

class TwoFAEnableRequest(BaseSchema):
    code: str = Field(..., min_length=6, max_length=7)
    password: str = Field(..., description="Current password")

class TwoFADisableRequest(BaseSchema):
    password: str = Field(..., description="Current password")
    code: str = Field(..., description="Current TOTP code or backup code")

class TwoFAResponse(BaseSchema):
    enabled: bool
    backup_codes_remaining: int = 0


# Contacts
class ContactBase(BaseSchema):
    id: str
    user_id: str
    contact_user_id: str

class ContactCreate(BaseSchema):
    contact_user_id: str = Field(..., min_length=1, max_length=100)

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
    status: str

class GroupInviteCreate(BaseSchema):
    group_id: str = Field(..., min_length=1, max_length=100)
    invitee_id: str = Field(..., min_length=1, max_length=100)

class GroupInviteResponse(GroupInviteBase):
    created_at: datetime
    updated_at: datetime
    group: ChatResponse
    inviter: UserResponse
    invitee: UserResponse

# Calls
class CallStartRequest(BaseSchema):
    target_user_id: str = Field(..., min_length=1, max_length=100)
    call_type: str = Field(..., pattern=r"^(audio|video)$")
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

# Contact Requests
class ContactRequestCreate(BaseSchema):
    to_user_id: str = Field(..., min_length=1, max_length=100)
    message: str | None = Field(None, max_length=200)

class ContactRequestResponse(BaseSchema):
    id: str
    from_user_id: str
    to_user_id: str
    message: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    from_user: UserResponse
    to_user: UserResponse


# Обновляем ссылки для рекурсивных типов
MessageResponse.model_rebuild()
ChatResponse.model_rebuild()
FileResponse.model_rebuild()
ContactResponse.model_rebuild()
GroupInviteResponse.model_rebuild()
