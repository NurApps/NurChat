"""Naive datetimes из SQLite (UTC без tzinfo) сериализуются с +00:00.

Без этого браузер парсит время как локальное: часы съезжают на TZ-офсет,
а ephemeral-сообщения исчезают сразу (наивный expires_at уже в прошлом).
"""
from datetime import datetime

from shared.schemas import MessageResponse, UserResponse


def _user() -> UserResponse:
    return UserResponse(
        id="user_1",
        username="tester",
        first_name="Test",
        created_at=datetime(2026, 9, 21, 12, 0, 0),  # naive, как из SQLite
    )


def test_naive_created_at_serialized_as_utc():
    msg = MessageResponse(
        id="msg_1",
        chat_id="chat_1",
        user_id="user_1",
        user=_user(),
        content="[encrypted]",
        created_at=datetime(2026, 9, 21, 12, 0, 0),  # naive UTC
    )
    assert msg.created_at.tzinfo is not None
    dumped = msg.model_dump(mode="json")
    # Pydantic сериализует UTC как Z — главное, что смещение явное,
    # браузер больше не парсит время как локальное.
    assert dumped["created_at"].endswith(("+00:00", "Z")), dumped["created_at"]
    assert dumped["user"]["created_at"].endswith(("+00:00", "Z"))


def test_aware_datetimes_untouched():
    from datetime import timezone
    aware = datetime(2026, 9, 21, 12, 0, 0, tzinfo=timezone.utc)
    msg = MessageResponse(
        id="msg_1",
        chat_id="chat_1",
        user_id="user_1",
        user=_user(),
        content="hi",
        created_at=aware,
        expires_at=aware,
    )
    assert msg.created_at == aware
    assert msg.expires_at == aware


def test_optional_none_fields_ok():
    msg = MessageResponse(
        id="msg_1",
        chat_id="chat_1",
        user_id="user_1",
        user=_user(),
        content="hi",
        created_at=datetime(2026, 9, 21, 12, 0, 0),
    )
    assert msg.edited_at is None
    assert msg.expires_at is None
