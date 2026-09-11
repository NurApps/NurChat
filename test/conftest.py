import os

# Isolate tests from the developer's .env: the suite must run against
# a throwaway SQLite DB, never against a real Postgres/Supabase URL
# (which may be unreachable, require secrets, or get polluted).
# MUST stay above all server imports (conftest loads first).
os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
os.environ.setdefault(
    "ENCRYPTION_KEY",
    "test-key-for-ci-only-000000000000000000000000000000",
)
os.environ.setdefault(
    "JWT_SECRET_KEY",
    "test-jwt-key-for-ci-only-000000000000000000000000000",
)
os.environ.setdefault(
    "TOTP_MASTER_KEY",
    "test-totp-key-for-ci-only-0000000000000000000000",
)
os.environ.setdefault("USE_REDIS", "false")

import pytest


@pytest.fixture(scope="session", autouse=True)
def _prepare_test_db():
    """Create all tables in the throwaway test DB before any test runs."""
    from server.core import models  # noqa: F401 — register models on Base
    from server.core.database import Base, engine
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
