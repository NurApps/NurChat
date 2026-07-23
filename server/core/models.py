from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from shared.constants import MESSAGE_TYPES

from .database import Base, engine


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    first_name = Column(String, nullable=False)  # Имя - обязательно
    last_name = Column(String, nullable=True)  # Фамилия - необязательно
    bio = Column(String, nullable=True)  # Биография пользователя
    hashed_password = Column(String)  # Хэшированный пароль
    public_key = Column(Text)  # Для E2E шифрования
    signing_public_key = Column(Text, nullable=True)  # Ed25519 public key для подписи P2P-событий
    avatar_path = Column(String, nullable=True)  # Путь к аватару
    status = Column(String, default="", nullable=True)  # Статус пользователя
    totp_secret = Column(String, nullable=True)  # TOTP секрет для 2FA (зашифрован мастер-ключом)
    backup_codes = Column(Text, nullable=True)  # JSON список хешей резервных кодов восстановления
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_seen = Column(DateTime(timezone=True), server_default=func.now())
    is_online = Column(Boolean, default=False)
    is_2fa_enabled = Column(Boolean, default=False)

    messages = relationship("Message", back_populates="user")
    files = relationship("File", back_populates="user")
    chats = relationship("ChatParticipant", back_populates="user")
    contacts_added = relationship("Contact", foreign_keys="Contact.user_id", back_populates="user")
    contacts_of_user = relationship("Contact", foreign_keys="Contact.contact_user_id", back_populates="contact_user")

class Chat(Base):
    __tablename__ = "chats"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=True)  # Для групповых чатов
    is_group = Column(Boolean, default=False)
    is_secret = Column(Boolean, default=False)  # Секретный чат (эфемерные сообщения)
    disappears_after_seconds = Column(Integer, default=0)  # 0 = отключено
    group_key = Column(Text, nullable=True)  # E2E: зашифрованный group key (JSON: {user_id: sealed_box_b64})
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    messages = relationship("Message", back_populates="chat")
    participants = relationship("ChatParticipant", back_populates="chat")
    invites = relationship("GroupInvite", back_populates="group")

class ChatParticipant(Base):
    __tablename__ = "chat_participants"
    __table_args__ = (
        Index("ix_chat_participants_user_chat", "user_id", "chat_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(String, ForeignKey("chats.id"))
    user_id = Column(String, ForeignKey("users.id"))
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    is_pinned = Column(Boolean, default=False)  # Закреплён ли чат для пользователя
    is_muted = Column(Boolean, default=False)  # Отключены ли уведомления для пользователя
    is_admin = Column(Boolean, default=False)  # Является ли пользователь админом группы

    chat = relationship("Chat", back_populates="participants")
    user = relationship("User", back_populates="chats")

class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_chat_created", "chat_id", "created_at"),
    )

    id = Column(String, primary_key=True, index=True)
    chat_id = Column(String, ForeignKey("chats.id"))
    user_id = Column(String, ForeignKey("users.id"))
    content = Column(Text)  # Плейнтекст или "[encrypted]" если E2E
    encrypted_content = Column(Text, nullable=True)  # E2E: JSON envelope (ciphertext, signature, timestamp, senderId)
    signature = Column(Text, nullable=True)  # E2E: Ed25519 signature (base64)
    message_type = Column(String, default=MESSAGE_TYPES["TEXT"])
    file_id = Column(String, ForeignKey("files.id"), nullable=True)
    forwarded_from = Column(String, nullable=True)  # ID оригинального сообщения
    is_deleted = Column(Boolean, default=False)
    deleted_for_all = Column(Boolean, default=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)  # Auto-destruct timer
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="messages")
    chat = relationship("Chat", back_populates="messages")
    file = relationship("File", back_populates="message")

class File(Base):
    __tablename__ = "files"
    __table_args__ = (
        Index("ix_files_user_uploaded", "user_id", "uploaded_at"),
    )

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"))
    filename = Column(String)
    file_path = Column(String)
    file_type = Column(String)  # image, video, voice, document
    file_size = Column(Integer)
    ttl_days = Column(Integer, default=30)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="files")
    message = relationship("Message", back_populates="file")

# Создаем таблицы
def create_tables():
    Base.metadata.create_all(bind=engine)

class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = (
        Index("ix_contacts_user_contact", "user_id", "contact_user_id"),
    )

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"))  # Кто добавил контакт
    contact_user_id = Column(String, ForeignKey("users.id"))  # Кого добавили в контакты
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id], back_populates="contacts_added")
    contact_user = relationship("User", foreign_keys=[contact_user_id], back_populates="contacts_of_user")

class GroupInvite(Base):
    __tablename__ = "group_invites"
    __table_args__ = (
        Index("ix_group_invites_invitee_status", "invitee_id", "status"),
    )

    id = Column(String, primary_key=True, index=True)
    group_id = Column(String, ForeignKey("chats.id"))
    inviter_id = Column(String, ForeignKey("users.id"))  # Кто пригласил
    invitee_id = Column(String, ForeignKey("users.id"))  # Кого пригласили
    status = Column(String, default="pending")  # pending, accepted, declined
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    group = relationship("Chat", back_populates="invites")
    inviter = relationship("User", foreign_keys=[inviter_id])
    invitee = relationship("User", foreign_keys=[invitee_id])

class MessageReadStatus(Base):
    __tablename__ = "message_read_status"
    __table_args__ = (
        Index("ix_read_status_message_user", "message_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(String, ForeignKey("messages.id"))
    user_id = Column(String, ForeignKey("users.id"))
    is_read = Column(Boolean, default=False)
    read_at = Column(DateTime(timezone=True))

    message = relationship("Message")
    user = relationship("User")

class CallLog(Base):
    __tablename__ = "call_logs"
    __table_args__ = (
        Index("ix_call_logs_callee", "callee_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String, index=True)
    caller_id = Column(String, ForeignKey("users.id"))
    callee_id = Column(String, ForeignKey("users.id"))
    call_type = Column(String)  # audio или video
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True))
    duration = Column(Integer)  # в секундах
    ended_by = Column(String)  # кто завершил звонок

    caller = relationship("User", foreign_keys=[caller_id])
    callee = relationship("User", foreign_keys=[callee_id])

class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        Index("ix_reactions_message", "message_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(String, ForeignKey("messages.id"))
    user_id = Column(String, ForeignKey("users.id"))
    emoji = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    message = relationship("Message")
    user = relationship("User")


class BlockedUser(Base):
    __tablename__ = "blocked_users"
    __table_args__ = (
        Index("ix_blocked_user_target", "user_id", "blocked_user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"))  # Кто заблокировал
    blocked_user_id = Column(String, ForeignKey("users.id"))  # Кого заблокировали
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id], backref="blocked_users_list")
    blocked_user = relationship("User", foreign_keys=[blocked_user_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_user_action", "user_id", "created_at"),
        Index("ix_audit_logs_action", "action"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"))
    action = Column(String, nullable=False)  # login, logout, message_sent, file_upload, etc.
    details = Column(Text, nullable=True)  # JSON with non-sensitive metadata
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class P2PMessage(Base):
    __tablename__ = "p2p_messages"
    __table_args__ = (
        Index("ix_p2p_messages_recipient_created", "recipient_id", "created_at"),
    )

    id = Column(String, primary_key=True, index=True)
    sender_id = Column(String, ForeignKey("users.id"), index=True)
    recipient_id = Column(String, ForeignKey("users.id"), index=True)
    payload = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    delivered_at = Column(DateTime(timezone=True), nullable=True)

    sender = relationship("User", foreign_keys=[sender_id])
    recipient = relationship("User", foreign_keys=[recipient_id])


class P2PBackup(Base):
    __tablename__ = "p2p_backups"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), index=True)
    chat_id = Column(String, index=True)
    payload = Column(Text, nullable=False)
    version = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])


class Bookmark(Base):
    __tablename__ = "bookmarks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), index=True)
    message_id = Column(String, ForeignKey("messages.id"), index=True)
    chat_id = Column(String, ForeignKey("chats.id"), index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
    message = relationship("Message")
    chat = relationship("Chat")


class PinnedMessage(Base):
    __tablename__ = "pinned_messages"

    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(String, ForeignKey("chats.id"), index=True)
    message_id = Column(String, ForeignKey("messages.id"), index=True)
    pinned_by = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    chat = relationship("Chat")
    message = relationship("Message")
    pinned_by_user = relationship("User", foreign_keys=[pinned_by])


class SignedPreKey(Base):
    __tablename__ = "signed_prekeys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), index=True)
    public_key = Column(Text, nullable=False)
    signature = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class OneTimePreKey(Base):
    __tablename__ = "one_time_prekeys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), index=True)
    public_key = Column(Text, nullable=False)
    is_used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class KeyRotationLog(Base):
    __tablename__ = "key_rotation_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), index=True)
    old_public_key = Column(Text, nullable=True)
    new_public_key = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class FederationServer(Base):
    __tablename__ = "federation_servers"

    id = Column(Integer, primary_key=True, index=True)
    server_name = Column(String, unique=True, index=True, nullable=False)  # e.g. "nurchat.example.com:8000"
    public_key = Column(Text, nullable=False)  # Ed25519 public key (hex)
    display_name = Column(String, nullable=True)
    software_version = Column(String, nullable=True)
    last_seen = Column(DateTime(timezone=True), server_default=func.now())
    is_blocked = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FederationActivity(Base):
    __tablename__ = "federation_activities"
    __table_args__ = (
        Index("ix_fed_activity_sender", "sender_server", "created_at"),
        Index("ix_fed_activity_type", "activity_type", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    activity_id = Column(String, unique=True, index=True, nullable=False)  # Unique activity ID
    activity_type = Column(String, nullable=False)  # message, typing, reaction, etc.
    sender_server = Column(String, nullable=False)
    sender_user = Column(String, nullable=False)  # username on sender server
    recipient_server = Column(String, nullable=False)
    recipient_user = Column(String, nullable=False)
    payload = Column(Text, nullable=False)  # JSON activity body
    signature = Column(Text, nullable=False)  # Ed25519 signature (hex)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)
