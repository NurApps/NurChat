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
        # Брутфорс-защита уровня IP/аккаунта (pentest #5/#6): после серии
        # неверных ответов/входов ключ блокируется на LOCKOUT_SECONDS.
        # In-memory per-process — как весь slowapi здесь; для мульти-инстанса
        # нужен Redis (см. USE_REDIS).
        self._failures: dict[str, list[datetime]] = {}
        self.lockout_threshold = 10
        self.lockout_window = timedelta(minutes=15)
        self.lockout_seconds = 300

    def is_locked_out(self, key: str) -> bool:
        now = datetime.now(timezone.utc)
        hits = [t for t in self._failures.get(key, []) if now - t < self.lockout_window]
        self._failures[key] = hits
        if len(hits) < self.lockout_threshold:
            return False
        # Блок держится lockout_seconds с ПОСЛЕДНЕЙ неудачи (скользящее окно).
        return (now - hits[-1]).total_seconds() < self.lockout_seconds

    def record_failure(self, key: str) -> None:
        now = datetime.now(timezone.utc)
        hits = [t for t in self._failures.get(key, []) if now - t < self.lockout_window]
        hits.append(now)
        self._failures[key] = hits

    def record_success(self, key: str) -> None:
        self._failures.pop(key, None)

    def generate_captcha(self) -> tuple[str, str]:
        captcha_id = f"captcha_{secrets.token_hex(16)}"

        # Сложность выше «10+20»: иногда три операнда, умножение до 12×12,
        # целочисленное деление. OCR всё ещё решает — это anti-bot, а не
        # anti-human; связка с rate-limit + lockout держит перебор.
        roll = random.random()
        if roll < 0.25:
            num1 = random.randint(2, 12)
            num2 = random.randint(2, 12)
            answer = num1 * num2
            question = f"{num1} × {num2} = ?"
        elif roll < 0.40:
            num2 = random.randint(2, 12)
            answer = random.randint(2, 12)
            num1 = num2 * answer
            question = f"{num1} ÷ {num2} = ?"
        elif roll < 0.60:
            a = random.randint(10, 99)
            b = random.randint(10, 99)
            c = random.randint(2, 9)
            answer = a + b - c
            question = f"{a} + {b} − {c} = ?"
        else:
            op_sym, op_fn = random.choice(_OPS)
            if op_fn is operator.mul:
                num1 = random.randint(2, 12)
                num2 = random.randint(2, 12)
            else:
                num1 = random.randint(10, 99)
                num2 = random.randint(1, num1 - 1) if op_fn is operator.sub else random.randint(1, 99)
            answer = op_fn(num1, num2)
            question = f"{num1} {op_sym} {num2} = ?"

        self._captcha_store[captcha_id] = {
            "answer": str(answer),
            "question": question,
            "created_at": datetime.now(timezone.utc),
            "attempts": 0,
        }

        self._cleanup_old_captchas()

        return captcha_id, question

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

        is_valid: bool = expected_answer == user_answer

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
