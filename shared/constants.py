# Типы сообщений
MESSAGE_TYPES = {
    "TEXT": "text",
    "IMAGE": "image",
    "VIDEO": "video",
    "VOICE": "voice",
    "FILE": "file",
    "DOCUMENT": "document",
}

# Типы файлов
FILE_TYPES = {
    "IMAGE": "image",
    "VIDEO": "video",
    "VOICE": "voice",
    "DOCUMENT": "document",
    "AUDIO": "audio",
    "FILE": "file"
}

# WebSocket события
WS_EVENTS = {
    "MESSAGE": "message",
    "TYPING": "typing",
    "READ_RECEIPT": "read_receipt",
    "DELETE_MESSAGE": "delete_message",
    "USER_ONLINE": "user_online",
    "USER_OFFLINE": "user_offline",
    "CALL_REQUEST": "call_request",
    "CALL_ACCEPT": "call_accept",
    "CALL_REJECT": "call_reject",
    "CALL_END": "call_end",
    "SYNC_EVENT": "sync_event",
    "USER_STATUS": "user_status",
    "USER_TYPING": "user_typing",
    "USER_STOP_TYPING": "user_stop_typing",
    "EDIT_MESSAGE": "edit_message",
    "MESSAGE_DELIVERED": "message_delivered",
}

CALL_TYPES= {
    "CALLING": "calling",
    "CALLING_ACCEPTED": "calling_accepted",
    "CALLING_REJECTED": "calling_rejected",
    "CALLING_ENDED": "calling_ended"
}

# Ограничения
MAX_VOICE_MESSAGE_DURATION: int = 300  # секунд
MAX_FILE_SIZE_MB: int = 50
MAX_STORAGE_PER_USER: int = 1024 * 1024 * 1024  # 1GB

# Статусы звонков
CALL_STATUS = {
    "RINGING": "ringing",
    "ACTIVE": "active",
    "ENDED": "ended",
    "MISSED": "missed"
}

# CRDT операции
CRDT_OPS = {
    "MESSAGE_APPEND": "message.append",
    "MESSAGE_EDIT": "message.edit",
    "MESSAGE_DELETE": "message.delete",
    "MEMBER_ADD": "chat.member_add",
    "MEMBER_REMOVE": "chat.member_remove",
    "ATTACHMENT_ADD": "attachment.add",
    "READ_RECEIPT": "read_receipt.update",
    "CHAT_CREATE": "chat.create",
    "GROUP_KEY_DISTRIBUTE": "group.key_distribute",
    "REACTION_ADD": "reaction.add",
    "REACTION_REMOVE": "reaction.remove",
}

# Reactions (как в Telegram)
REACTION_LIST = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

# P2P WebSocket типы
P2P_MSG_HELLO = "p2p-hello"
P2P_MSG_HELLO_ACK = "p2p-hello-ack"
P2P_MSG_SIGNALING = "p2p-signaling"
P2P_MSG_DELIVER = "p2p-deliver"
P2P_MSG_SYNC = "p2p-sync"
P2P_MSG_CRDT_SYNC = "p2p-crdt-sync"
P2P_MSG_DELIVERED = "p2p-delivered"
P2P_MSG_QUEUED = "p2p-queued"
P2P_MSG_ERROR = "p2p-error"

# Типы P2P сообщений
P2P_MESSAGE_TYPES = {
    "TEXT": "chat.message",
    "GROUP_CREATE": "group.create",
    "GROUP_KEY": "group.key",
    "GROUP_MEMBER_ADD": "group.member_add",
    "GROUP_MEMBER_REMOVE": "group.member_remove",
}

# Коды ошибок
ERROR_CODES = {
    "AUTH_FAILED": "auth_failed",
    "FILE_TOO_LARGE": "file_too_large",
    "FILE_TYPE_NOT_ALLOWED": "file_type_not_allowed",
    "CHAT_NOT_FOUND": "chat_not_found",
    "MESSAGE_NOT_FOUND": "message_not_found",
    "USER_NOT_FOUND": "user_not_found",
    "INSUFFICIENT_STORAGE": "insufficient_storage"
}
