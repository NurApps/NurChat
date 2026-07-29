"""
CAPTCHA generation and validation for NurChat
Token-gated challenge-response with varied operations.
"""
import operator
import random
import secrets
from datetime import datetime, timedelta, timezone

_OPS = [
    ("+", operator.add),
    ("-", operator.sub),
    ("\u00d7", operator.mul),
]


class CaptchaManager:
    """Manages CAPTCHA generation and validation"""

    def __init__(self, ttl_minutes: int = 5, max_attempts: int = 3):
        self.ttl = timedelta(minutes=ttl_minutes)
        self.max_attempts = max_attempts
        self._captcha_store: dict[str, dict] = {}

    def generate_captcha(self) -> tuple[str, str]:
        captcha_id = f"captcha_{secrets.token_hex(16)}"

        op_sym, op_fn = random.choice(_OPS)
        if op_fn is operator.mul:
            num1 = random.randint(2, 9)
            num2 = random.randint(2, 9)
        else:
            num1 = random.randint(10, 99)
            num2 = random.randint(1, num1 - 1) if op_fn is operator.sub else random.randint(1, 99)

        answer = op_fn(num1, num2)

        self._captcha_store[captcha_id] = {
            "answer": str(answer),
            "question": f"{num1} {op_sym} {num2} = ?",
            "created_at": datetime.now(timezone.utc),
            "attempts": 0,
        }

        self._cleanup_old_captchas()

        return captcha_id, f"{num1} {op_sym} {num2} = ?"

    def validate_captcha(self, captcha_id: str, answer: str) -> bool:
        if not captcha_id or not answer:
            return False

        captcha_data = self._captcha_store.get(captcha_id)
        if not captcha_data:
            return False

        created_at = captcha_data["created_at"]
        if datetime.now(timezone.utc) - created_at > self.ttl:
            del self._captcha_store[captcha_id]
            return False

        captcha_data["attempts"] += 1
        if captcha_data["attempts"] > self.max_attempts:
            del self._captcha_store[captcha_id]
            return False

        expected_answer = captcha_data["answer"].strip().lower()
        user_answer = str(answer).strip().lower()

        is_valid = expected_answer == user_answer

        if is_valid:
            del self._captcha_store[captcha_id]

        return is_valid

    def _cleanup_old_captchas(self):
        now = datetime.now(timezone.utc)
        expired_keys = [
            k for k, v in self._captcha_store.items()
            if now - v["created_at"] > self.ttl
        ]
        for key in expired_keys:
            del self._captcha_store[key]


# Global captcha manager instance
captcha_manager = CaptchaManager(ttl_minutes=5)


def generate_captcha() -> tuple[str, str]:
    return captcha_manager.generate_captcha()


def validate_captcha(captcha_id: str, answer: str) -> bool:
    return captcha_manager.validate_captcha(captcha_id, answer)
