# server/core/schemas.py - экспорт общих схем

from shared.schemas import (
    BlockedUserResponse,
    CallHistoryResponse,
    CallResponse,
    CallStartRequest,
    ChatCreate,
    ChatResponse,
    CleanupResponse,
    ContactCreate,
    ContactResponse,
    FileResponse,
    FileUploadResponse,
    ForwardRequest,
    GroupInviteCreate,
    GroupInviteResponse,
    MessageResponse,
    P2PBackupResponse,
    P2PIdentityResponse,
    P2PPeerResponse,
    P2PPendingResponse,
    ReactionCreate,
    ReactionResponse,
    StorageInfo,
    Token,
    UserBase,
    UserCreate,
    UserUpdate,
    UserResponse,
    MessageCreate,
    GroupRenameRequest
)

# Обновляем ссылки для рекурсивных типов
MessageResponse.model_rebuild()
ChatResponse.model_rebuild()
FileResponse.model_rebuild()
CallResponse.model_rebuild()
ContactResponse.model_rebuild()
GroupInviteResponse.model_rebuild()
BlockedUserResponse.model_rebuild()
