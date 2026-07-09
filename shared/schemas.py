# shared/schemas.py

from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, List
from datetime import datetime

# Базовая схема
class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

# User
class UserBase(BaseSchema):
    id: str
    username: str
    first_name: str
    last_name: Optional[str] = None

class UserCreate(BaseSchema):
    # Username: только латинские буквы и цифры, без ограничений по длине
    username: str = Field(..., description="Username (латинские буквы и цифры)")
    first_name: Optional[str] = Field(None, description="Имя (обязательно)")
    last_name: Optional[str] = Field(None, description="Фамилия (необязательно)")
    # Пароль: минимум 4 символа или цифры, или если букв более 4, то без ограничений
    password: str = Field(..., description="Password (минимум 4 символа или цифры, или >4 букв)")

class UserUpdate(BaseSchema):
    """Схема для обновления профиля пользователя"""
    first_name: Optional[str] = Field(None, min_length=2, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    bio: Optional[str] = Field(None, max_length=500)
    status: Optional[str] = Field(None, max_length=100)

class UserResponse(UserBase):
    created_at: datetime
    last_seen: datetime
    is_online: bool
    public_key: Optional[str] = None  # Публичный ключ для E2E шифрования
    signing_public_key: Optional[str] = None  # Ed25519 public key для верификации подписей
    avatar_path: Optional[str] = None  # Путь к аватару
    status: Optional[str] = None  # Статус пользователя
    bio: Optional[str] = None  # Биография пользователя

# Chat
class ChatBase(BaseSchema):
    id: str
    name: Optional[str] = None
    is_group: bool

class ChatCreate(BaseSchema):
    name: Optional[str] = Field(None, max_length=100, description="Chat name must be up to 100 characters long")
    is_group: bool = False
    is_secret: bool = False
    disappears_after_seconds: int = 0
    participant_ids: List[str] = Field(..., min_items=1, max_items=100, description="Chat must have 1-100 participants")

    @field_validator('name')
    @classmethod
    def validate_name(cls, v):
        if v and len(v) > 0:
            if '<script' in v.lower() or 'javascript:' in v.lower():
                raise ValueError('Name contains forbidden characters')
        return v

class ChatResponse(ChatBase):
    created_at: datetime
    participants: List[UserResponse]
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
    content: str = Field(..., min_length=1, max_length=5000, description="Message content must be 1-5000 characters long")
    message_type: str = Field(default="text", pattern=r"^(text|image|video|audio|file|location|contact|voice)$")
    file_id: Optional[str] = Field(None, max_length=100)
    forwarded_from: Optional[str] = Field(None, max_length=100)
    encrypted_content: Optional[str] = None  # E2E: JSON envelope (ciphertext, timestamp, senderId)
    signature: Optional[str] = None  # E2E: Ed25519 signature (base64)
    expires_at: Optional[datetime] = None  # Auto-destruct time

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        # Remove any potentially harmful content
        if '<script' in v.lower() or 'javascript:' in v.lower():
            raise ValueError('Content contains forbidden characters')
        return v

class MessageResponse(MessageBase):
    user_id: str
    chat_id: str
    user: UserResponse
    file_id: Optional[str] = None
    file: Optional['FileResponse'] = None
    plan: Optional['PlanResponse'] = None
    forwarded_from: Optional[str] = None
    encrypted_content: Optional[str] = None  # E2E: JSON envelope
    signature: Optional[str] = None  # E2E: Ed25519 signature
    is_deleted: bool = False
    deleted_for_all: bool = False
    is_read: bool = False  # Статус прочтения для своих сообщений
    created_at: datetime

# File
class FileBase(BaseSchema):
    id: str
    filename: str
    file_type: str
    file_size: int

class FileUploadResponse(FileBase):
    file_path: str
    ipfs_hash: Optional[str] = None
    ttl_days: int
    uploaded_at: datetime

class FileResponse(FileBase):
    user_id: str
    uploaded_at: datetime
    ipfs_hash: Optional[str] = None

# Auth
class Token(BaseSchema):
    access_token: str
    token_type: str
    user: UserResponse
    private_key: Optional[str] = None
    signing_private_key: Optional[str] = None  # Ed25519 private key (returned once on register)
    
# Forward
class ForwardRequest(BaseSchema):
    message_id: str = Field(..., min_length=1, max_length=100)
    target_chat_ids: List[str] = Field(..., min_items=1, max_items=50, description="Can forward to 1-50 chats")

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
    chat_id: Optional[str] = Field(None, max_length=100)

class CallResponse(BaseSchema):
    call_id: str
    caller_id: str
    callee_id: str
    call_type: str
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration: Optional[int] = None

class CallHistoryResponse(BaseSchema):
    calls: List[CallResponse]
    total: int

# Files
class StorageInfo(BaseSchema):
    total_size: int
    file_count: int
    files_by_type: List[dict]
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

# Plans
class PlanBase(BaseSchema):
    task: str = Field(..., max_length=255, description="The main task of the plan")
    steps: str = Field(..., description="The steps of the plan, likely a JSON string")

class PlanCreate(PlanBase):
    pass

class PlanResponse(PlanBase):
    id: str
    user_id: str
    created_at: datetime


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
    signing_public_key: Optional[str] = None
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

# Statistics
class StatsResponse(BaseSchema):
    total_messages: int
    total_chats: int
    total_files: int
    messages_by_day: List[dict]
    top_contacts: List[dict]
    message_types_breakdown: dict

# Обновляем ссылки для рекурсивных типов
MessageResponse.model_rebuild()
ChatResponse.model_rebuild()
FileResponse.model_rebuild()
PlanResponse.model_rebuild()
ContactResponse.model_rebuild()
GroupInviteResponse.model_rebuild()
