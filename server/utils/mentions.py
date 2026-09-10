import re

from sqlalchemy.orm import Session

from server.core import models

_MENTION_RE = re.compile(r"@([\w.@-]+)")


def parse_mentions(content: str) -> list[str]:
    if not content or content == "[encrypted]":
        return []
    seen: set[str] = set()
    result: list[str] = []
    for m in _MENTION_RE.finditer(content):
        username = m.group(1).strip().lower()
        if username and username not in seen:
            seen.add(username)
            result.append(username)
    return result


def resolve_mentioned_users(db: Session, usernames: list[str], chat_id: str) -> list[models.User]:
    if not usernames:
        return []
    participant_ids = {
        p.user_id for p in db.query(models.ChatParticipant).filter(
            models.ChatParticipant.chat_id == chat_id
        ).all()
    }
    if not participant_ids:
        return []
    users = db.query(models.User).filter(models.User.id.in_(participant_ids)).all()
    mentions_lower = {u.lower() for u in usernames}
    return [u for u in users if u.username.lower() in mentions_lower]
