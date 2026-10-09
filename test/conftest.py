import os

# Force (override, NOT setdefault): the developer's .env (e.g. DISABLE_CAPTCHA=true,
# real Postgres/Supabase URL) must never leak into the suite — pydantic reads
# the .env FILE too, but explicit os.environ wins over dotenv source.
# MUST stay above all server imports (conftest loads first).
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["ENCRYPTION_KEY"] = "test-key-for-ci-only-000000000000000000000000000000"
os.environ["JWT_SECRET_KEY"] = "test-jwt-key-for-ci-only-000000000000000000000000000"
os.environ["TOTP_MASTER_KEY"] = "test-totp-key-for-ci-only-0000000000000000000000"
os.environ["USE_REDIS"] = "false"
# Captcha fail-closed in tests: DISABLE_CAPTCHA must be false, otherwise
# forged tokens pass and lockout/fail-closed tests go green-wrong (200).
os.environ["DISABLE_CAPTCHA"] = "false"
# Публичный тестовый sitekey Cloudflare — только чтобы /captcha отвечал 200.
os.environ["TURNSTILE_SITEKEY"] = "1x00000000000000000000AA"
os.environ["TURNSTILE_SECRET"] = "test-secret-for-ci-only"
os.environ["TURNSTILE_HOSTNAMES"] = "tauri.localhost,127.0.0.1,localhost"

import pytest

TURNSTILE_TEST_TOKEN = "test-pass"


@pytest.fixture(autouse=True)
def _fake_turnstile(monkeypatch):
    """/register не ходит в Cloudflare из тестов: пропускает только TURNSTILE_TEST_TOKEN.

    Сам verify_turnstile покрыт отдельно в test_turnstile.py.
    """
    async def fake_verify(token: str, expected_action: str) -> bool:
        return token == TURNSTILE_TEST_TOKEN

    monkeypatch.setattr("server.routes.auth.verify_turnstile", fake_verify)


@pytest.fixture(scope="session", autouse=True)
def _prepare_test_db():
    """Rebuild the throwaway test DB before any test runs.

    drop_all + create_all: create_all не добавляет колонки в существующие
    таблицы, поэтому переиспользованный test.db протухал после каждой
    миграции (напр. viewed_by) и тесты падали с no such column локально.
    """
    from server.core import models  # noqa: F401 — register models on Base
    from server.core.database import Base, engine
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


class TestResults:
    __test__ = False
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []

    def add_pass(self, test_name):
        self.passed += 1
        print(f"[PASS] {test_name}")

    def add_fail(self, test_name, reason):
        self.failed += 1
        self.errors.append((test_name, reason))
        print(f"[FAIL] {test_name} - {reason}")

    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print("РЕЗУЛЬТАТЫ ТЕСТОВ E2E ШИФРОВАНИЯ")
        print(f"{'='*60}")
        print(f"Всего тестов: {total}")
        print(f"Пройдено: {self.passed}")
        print(f"Провалено: {self.failed}")
        if total > 0:
            print(f"Успешность: {self.passed/total*100:.1f}%")
        else:
            print("Нет тестов")

        if self.errors:
            print("\nОШИБКИ:")
            for test, reason in self.errors:
                print(f"  - {test}: {reason}")

        return self.failed == 0


@pytest.fixture
def results():
    return TestResults()
