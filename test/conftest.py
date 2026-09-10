import pytest

class TestResults:


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
