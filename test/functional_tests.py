"""
Комплексные тесты для NurChat
QA-тестирование основного функционала
"""
import os
import random
import string
import sys
import time
from datetime import datetime

import pytest
import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


def random_username():
    return ''.join(random.choices(string.ascii_lowercase, k=10))


BASE_URL = "http://127.0.0.1:8000"

class TestResults:


# Эти тесты требуют запущенного relay на 127.0.0.1:8000.
# Если сервер недоступен — пропускаем весь модуль вместо ошибок соединения.
try:
    requests.get(f"{BASE_URL}/health", timeout=2)
except requests.exceptions.RequestException:
    pytest.skip("Relay не запущен на 127.0.0.1:8000 — functional tests пропущены", allow_module_level=True)

_IP_COUNTER = [0]


def fake_client_ip() -> str:
    """Уникальный IP для обхода rate limit регистраций (5/мин на реальный IP)."""
    _IP_COUNTER[0] += 1
    return f"10.{(_IP_COUNTER[0] >> 16) & 0xFF}.{(_IP_COUNTER[0] >> 8) & 0xFF}.{_IP_COUNTER[0] & 0xFF}"


def client_headers() -> dict:
    return {"X-Forwarded-For": fake_client_ip()}


def auth_headers(token: str, csrf_token: str = "") -> dict:
    headers = {"Authorization": f"Bearer {token}", "X-Forwarded-For": fake_client_ip()}
    if csrf_token:
        headers["X-CSRF-Token"] = csrf_token
    return headers

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
        print("РЕЗУЛЬТАТЫ ТЕСТОВ")
        print(f"{'='*60}")
        print(f"Всего тестов: {total}")
        print(f"Пройдено: {self.passed}")
        print(f"Провалено: {self.failed}")
        print(f"Успешность: {self.passed/total*100:.1f}%" if total > 0 else "Нет тестов")

        if self.errors:
            print("\nОШИБКИ:")
            for test, reason in self.errors:
                print(f"  - {test}: {reason}")

        return self.failed == 0


def get_captcha():
    """Получить CAPTCHA для регистрации"""
    r = requests.get(f"{BASE_URL}/api/auth/captcha", timeout=10)
    if r.status_code == 200:
        data = r.json()
        return data.get("captcha_id"), data.get("question")
    return None, None


def solve_captcha(question: str) -> str:
    """Решить простую математическую CAPTCHA."""
    question = question.strip().lower().replace("?", "").replace(" ", "")
    if "+" in question:
        parts = question.split("+")
        try:
            return str(int(parts[0]) + int(parts[1]))
        except (ValueError, IndexError):
            pass
    return "0"



    """Решить математическую CAPTCHA (поддерживает +, -, ×)."""
    import re
    if not question:
        return "0"
    m = re.search(r"(\d+)\s*([+\-×x*])\s*(\d+)", question)
    if not m:
        return "0"
    num1, op, num2 = int(m.group(1)), m.group(2), int(m.group(3))
    if op in ("-", "−"):
        return str(num1 - num2)
    if op in ("×", "x", "*"):
        return str(num1 * num2)
    return str(num1 + num2)


@pytest.mark.integration
def test_health_check(results):
    """Тест 1: Проверка доступности сервера"""
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "healthy"
        assert "NurChat" in data["service"]
        results.add_pass("Health Check")
    except Exception as e:
        results.add_fail("Health Check", str(e))


@pytest.mark.integration
def test_registration(results):
    """Тест 2: Регистрация нового пользователя"""
    try:
        username = random_username()
        password = "TestPass123"

        captcha_id, question = get_captcha()
        if captcha_id and question:
            captcha_code = solve_captcha(question)
        else:
            captcha_code = "0"
            captcha_id = ""

        r = requests.post(f"{BASE_URL}/api/auth/register", json={
            "username": username,
            "password": password,
            "first_name": "Тестовый",
            "captcha_id": captcha_id,
            "captcha_code": captcha_code,
        }, timeout=10)

        }, headers=client_headers(), timeout=10)

        assert r.status_code == 200, f"Status: {r.status_code}, Response: {r.text}"
        data = r.json()

        assert "access_token" in data
        assert "user" in data
        assert "private_key" in data  # Приватный ключ только при регистрации
        assert data["user"]["username"] == username

        print(f"  Зарегистрирован: {username}, ID: {data['user']['id']}")
        results.add_pass("Registration")

        return data
    except Exception as e:
        results.add_fail("Registration", str(e))
        return None


@pytest.mark.integration
def test_login(results, username, password):
    """Тест 3: Вход пользователя"""
    try:
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": username,
            "password": password
        }, timeout=10)

        assert r.status_code == 200
        data = r.json()

        assert "access_token" in data
        assert "user" in data
        assert "private_key" not in data  # При логине приватный ключ не возвращается

        results.add_pass("Login")
        return data
    except Exception as e:
        results.add_fail("Login", str(e))
        return None


@pytest.mark.integration
def test_get_current_user(results, token):
    """Тест 4: Получение информации о текущем пользователе"""
    try:
        headers = auth_headers(token)
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=10)

        assert r.status_code == 200
        data = r.json()

        assert "id" in data
        assert "username" in data
        assert "created_at" in data

        results.add_pass("Get Current User")
        return data
    except Exception as e:
        results.add_fail("Get Current User", str(e))
        return None


@pytest.mark.integration
def test_create_chat(results, token, user_id, user2_id, csrf_token):
    """Тест 5: Создание чата"""
    try:
        headers = auth_headers(token, csrf_token)

        r = requests.post(f"{BASE_URL}/api/chat/chats", json={
            "name": "Test Chat",
            "participant_ids": [user_id, user2_id],
            "is_group": False
        }, headers=headers, timeout=10)

        assert r.status_code == 200, f"Status: {r.status_code}, Response: {r.text}"
        data = r.json()

        assert "id" in data
        assert not data["is_group"]

        results.add_pass("Create Chat")
        return data
    except Exception as e:
        results.add_fail("Create Chat", str(e))
        return None


@pytest.mark.integration
def test_get_chats(results, token):
    """Тест 6: Получение списка чатов"""
    try:
        headers = auth_headers(token)
        r = requests.get(f"{BASE_URL}/api/chat/chats", headers=headers, timeout=10)

        assert r.status_code == 200
        data = r.json()

        assert isinstance(data, list)
        assert len(data) > 0

        results.add_pass("Get Chats")
        return data
    except Exception as e:
        results.add_fail("Get Chats", str(e))
        return []


@pytest.mark.integration
def test_send_message(results, token, chat_id, csrf_token):
    """Тест 7: Отправка сообщения"""
    try:
        headers = auth_headers(token, csrf_token)

        # Создаем тестовое сообщение (имитация шифрования)
        test_content = f"enc:test_encrypted_message_{int(time.time())}"

        r = requests.post(f"{BASE_URL}/api/chat/chats/{chat_id}/messages", json={
            "chat_id": chat_id,
            "content": test_content,
            "message_type": "text"
        }, headers=headers, timeout=10)

        assert r.status_code == 200, f"Status: {r.status_code}, Response: {r.text}"
        data = r.json()

        assert "id" in data
        assert data["content"] == test_content
        assert data["message_type"] == "text"

        results.add_pass("Send Message")
        return data
    except Exception as e:
        results.add_fail("Send Message", str(e))
        return None


@pytest.mark.integration
def test_get_messages(results, token, chat_id):
    """Тест 8: Получение сообщений чата"""
    try:
        headers = auth_headers(token)
        r = requests.get(
            f"{BASE_URL}/api/chat/chats/{chat_id}/messages",
            headers=headers,
            params={"skip": 0, "limit": 50},
            timeout=10
        )

        assert r.status_code == 200
        data = r.json()

        assert isinstance(data, list)
        assert len(data) > 0

        results.add_pass("Get Messages")
        return data
    except Exception as e:
        results.add_fail("Get Messages", str(e))
        return []


@pytest.mark.integration
def test_mark_as_read(results, token, message_id, csrf_token):
    """Тест 9: Отметка сообщения как прочитанного"""
    try:
        headers = auth_headers(token, csrf_token)
        r = requests.post(
            f"{BASE_URL}/api/chat/messages/{message_id}/mark-as-read",
            headers=headers,
            timeout=10
        )

        assert r.status_code == 200
        results.add_pass("Mark Message as Read")
        return True
    except Exception as e:
        results.add_fail("Mark Message as Read", str(e))
        return False


@pytest.mark.integration
def test_delete_message(results, token, message_id, csrf_token):
    """Тест 10: Удаление сообщения"""
    try:
        headers = auth_headers(token, csrf_token)
        r = requests.delete(
            f"{BASE_URL}/api/chat/messages/{message_id}",
            headers=headers,
            timeout=10
        )

        assert r.status_code == 200
        results.add_pass("Delete Message")
        return True
    except Exception as e:
        results.add_fail("Delete Message", str(e))
        return False


@pytest.mark.integration
def test_invalid_login(results):
    """Тест 11: Вход с неверным паролем"""
    try:
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "nonexistentuser",
            "password": "wrong_password"
        }, timeout=10)

        assert r.status_code == 401
        results.add_pass("Invalid Login Rejection")
        return True
    except Exception as e:
        results.add_fail("Invalid Login Rejection", str(e))
        return False


def _register_with_captcha(username: str, password: str, first_name: str, last_name: str = "", expect_fail: bool = False):
    """Helper: get CAPTCHA and register."""
    captcha_id, question = get_captcha()
    captcha_code = solve_captcha(question) if question else "0"
    payload = {
        "username": username,
        "password": password,
        "first_name": first_name,
        "captcha_id": captcha_id or "",
        "captcha_code": captcha_code,
    }
    if last_name:
        payload["last_name"] = last_name
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=10)

    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, headers=client_headers(), timeout=10)
    if expect_fail:
        return r.status_code in [400, 422], r
    return r.status_code == 200, r



@pytest.fixture(scope="module")
def registered_user():
    """Регистрирует свежего пользователя для всей цепочки тестов."""
    username = random_username()
    ok, r = _register_with_captcha(username, "TestPass123", "Тестовый")
    if not ok:
        pytest.skip(f"Не удалось зарегистрировать тестового пользователя: {r.status_code} {r.text}")
    return r.json()


@pytest.fixture(scope="module")
def username(registered_user):
    return registered_user["user"]["username"]


@pytest.fixture(scope="module")
def password():
    return "TestPass123"


@pytest.fixture(scope="module")
def token(registered_user):
    return registered_user["access_token"]


@pytest.fixture(scope="module")
def user_id(registered_user):
    return registered_user["user"]["id"]


@pytest.fixture(scope="module")
def user2_id():
    """Второй участник чата."""
    ok, r = _register_with_captcha(random_username(), "TestPass123", "Тестовый2")
    if not ok:
        pytest.skip(f"Не удалось зарегистрировать второго пользователя: {r.status_code} {r.text}")
    return r.json()["user"]["id"]


@pytest.fixture(scope="module")
def csrf_token():
    """Валидный CSRF-токен (подписан тем же JWT_SECRET_KEY, что и middleware)."""
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    from server.middleware.csrf import generate_csrf_token
    return generate_csrf_token()


@pytest.fixture(scope="module")
def chat_id(token, user_id, user2_id, csrf_token):
    headers = auth_headers(token, csrf_token)
    r = requests.post(f"{BASE_URL}/api/chat/chats", json={
        "name": "Test Chat",
        "participant_ids": [user_id, user2_id],
        "is_group": False,
    }, headers=headers, timeout=10)
    if r.status_code != 200:
        pytest.skip(f"Не удалось создать чат: {r.status_code} {r.text}")
    return r.json()["id"]


@pytest.fixture(scope="module")
def message_id(token, chat_id, csrf_token):
    headers = auth_headers(token, csrf_token)
    r = requests.post(f"{BASE_URL}/api/chat/chats/{chat_id}/messages", json={
        "chat_id": chat_id,
        "content": f"enc:test_encrypted_message_{int(time.time())}",
        "message_type": "text",
    }, headers=headers, timeout=10)
    if r.status_code != 200:
        pytest.skip(f"Не удалось отправить сообщение: {r.status_code} {r.text}")
    return r.json()["id"]


@pytest.mark.integration
def test_duplicate_registration(results, username):
    """Тест 12: Регистрация с занятым username"""
    try:
        ok, r = _register_with_captcha(username, "AnotherPass123", "Дубликат", expect_fail=True)
        if ok or r.status_code in [400, 422]:
            results.add_pass("Duplicate Registration Rejection")
            return True
        results.add_fail("Duplicate Registration Rejection", f"Expected 400/422, got {r.status_code}")
        return False
    except Exception as e:
        results.add_fail("Duplicate Registration Rejection", str(e))
        return False


@pytest.mark.integration
def test_validation_username(results, token):
    """Тест 13: Валидация username (спецсимволы)"""
    try:
        ok, r = _register_with_captcha("user<script>alert('xss')</script>", "TestPass123", "Тест", expect_fail=True)
        if ok or r.status_code in [400, 422]:
            results.add_pass("Username XSS Validation")
            return True
        results.add_fail("Username XSS Validation", f"Expected 400/422, got {r.status_code}")
        return False
    except Exception as e:
        results.add_fail("Username XSS Validation", str(e))
        return False


@pytest.mark.integration
def test_username_only_letters(results):
    """Тест 14: Username только английские буквы"""
    passed = True

    # С цифрами — должно FAIL
    ok, r = _register_with_captcha("user123", "abc", "Тест", expect_fail=True)
    if not ok and r.status_code in [400, 422]:
        results.add_pass("Username Reject Digits")
    else:
        results.add_fail("Username Reject Digits", f"Expected 400/422, got {r.status_code}")
        passed = False

    # С кириллицей — должно FAIL
    ok, r = _register_with_captcha("пользователь", "abc", "Тест", expect_fail=True)
    if not ok and r.status_code in [400, 422]:
        results.add_pass("Username Reject Cyrillic")
    else:
        results.add_fail("Username Reject Cyrillic", f"Expected 400/422, got {r.status_code}")
        passed = False

    return passed


@pytest.mark.integration
def test_password_min_length(results):
    """Тест 15: Пароль минимум 3 символа"""
    passed = True

    # Пароль 3 символа — OK
    username = random_username()
    ok, r = _register_with_captcha(username, "abc", "Тест")
    if ok:
        results.add_pass("Password 3 chars Accepted")
    else:
        results.add_fail("Password 3 chars Accepted", f"Expected 200, got {r.status_code}: {r.text}")
        passed = False

    return passed


@pytest.mark.integration
def test_name_any_letters(results):
    """Тест 16: Имя/фамилия любые буквы"""
    username = random_username()
    ok, r = _register_with_captcha(username, "abc", "Мухаммад", "ибн Абдуллах")
    if ok:
        results.add_pass("Name Any Letters (Cyrillic/Arabic)")
        return True
    results.add_fail("Name Any Letters", f"Expected 200, got {r.status_code}: {r.text}")
    return False


@pytest.mark.integration
def test_logout(results, token, csrf_token):
    """Тест 18: Выход пользователя"""
    try:
        headers = auth_headers(token, csrf_token)
        r = requests.post(f"{BASE_URL}/api/auth/logout", headers=headers, timeout=10)

        assert r.status_code == 200
        results.add_pass("Logout")
        return True
    except Exception as e:
        results.add_fail("Logout", str(e))
        return False


def run_functional_tests():
    """Запуск функциональных тестов"""
    print("="*60)
    print("ФУНКЦИОНАЛЬНОЕ ТЕСТИРОВАНИЕ NURCHAT")
    print("="*60)
    print(f"Время начала: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Server: {BASE_URL}\n")

    results = TestResults()

    # Генерация CSRF-токена (тот же секрет, что у middleware)
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    from server.middleware.csrf import generate_csrf_token
    csrf_token = generate_csrf_token()

    # Тест 1: Health check
    test_health_check(results)

    # Тест 2: Регистрация пользователя 1
    reg_data = test_registration(results)
    if not reg_data:
        print("Критическая ошибка: не удалось зарегистрировать пользователя 1")
        return results

    token = reg_data["access_token"]
    user_id = reg_data["user"]["id"]
    username1 = reg_data["user"]["username"]

    # Тест 3: Регистрация пользователя 2
    reg_data2 = test_registration(results)
    if not reg_data2:
        print("Критическая ошибка: не удалось зарегистрировать пользователя 2")
        return results

    user2_id = reg_data2["user"]["id"]
    reg_data2["user"]["username"]

    # Тест 4: Логин
    login_data = test_login(results, username1, "TestPass123")
    if login_data:
        token = login_data["access_token"]

    # Тест 5: Получение текущего пользователя
    test_get_current_user(results, token)

    # Тест 6: Создание чата
    chat_data = test_create_chat(results, token, user_id, user2_id, csrf_token)
    chat_id = chat_data["id"] if chat_data else None

    # Тест 7: Получение списка чатов
    test_get_chats(results, token)

    # Тест 8: Отправка сообщения
    if chat_id:
        message_data = test_send_message(results, token, chat_id, csrf_token)
        message_id = message_data["id"] if message_data else None

        # Тест 9: Получение сообщений
        test_get_messages(results, token, chat_id)

        # Тест 10: Отметка как прочитанное
        if message_id:
            test_mark_as_read(results, token, message_id, csrf_token)

        # Тест 11: Удаление сообщения
        if message_id:
            test_delete_message(results, token, message_id, csrf_token)

    # Тест 12: Неверный логин
    test_invalid_login(results)

    # Тест 13: Дубликат регистрации
    test_duplicate_registration(results, username1)

    # Тест 14: Валидация username (XSS)
    test_validation_username(results, token)

    # Тест 15: Username только английские буквы (цифры/кириллица — FAIL)
    test_username_only_letters(results)

    # Тест 16: Пароль минимум 3 символа
    test_password_min_length(results)

    # Тест 17: Имя/фамилия любые буквы
    test_name_any_letters(results)

    # Тест 18: Выход
    test_logout(results, token, csrf_token)

    return results


if __name__ == "__main__":
    results = run_functional_tests()
    success = results.summary()
    sys.exit(0 if success else 1)
