"""
Тесты для E2E шифрования NurChat
Проверка корректности шифрования/дешифрования сообщений
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from shared.p2p_encryption import P2PEncryption


class TestResults:
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
        print(f"Успешность: {self.passed/total*100:.1f}%" if total > 0 else "Нет тестов")

        if self.errors:
            print("\nОШИБКИ:")
            for test, reason in self.errors:
                print(f"  - {test}: {reason}")

        return self.failed == 0


def test_symmetric_key_generation(results):
    """Тест 1: Генерация симметричного ключа"""
    try:
        p2p = P2PEncryption()
        key = p2p.generate_symmetric_key()

        assert key is not None, "Ключ не сгенерирован"
        assert len(key) == 32, f"Неверная длина ключа: {len(key)} (ожидалось 32)"
        assert isinstance(key, bytes), f"Ключ не bytes: {type(key)}"

        results.add_pass("Symmetric Key Generation")
    except Exception as e:
        results.add_fail("Symmetric Key Generation", str(e))


def test_asymmetric_keypair_generation(results):
    """Тест 2: Генерация асимметричной пары ключей"""
    try:
        p2p = P2PEncryption()
        private_key, public_key = p2p.generate_asymmetric_keys()

        assert private_key is not None, "Приватный ключ не сгенерирован"
        assert public_key is not None, "Публичный ключ не сгенерирован"
        assert len(private_key) == 64, f"Неверная длина приватного ключа: {len(private_key)}"
        assert len(public_key) == 64, f"Неверная длина публичного ключа: {len(public_key)}"

        # Проверка что ключи разные
        assert private_key != public_key, "Приватный и публичный ключи одинаковы"

        results.add_pass("Asymmetric Keypair Generation")
    except Exception as e:
        results.add_fail("Asymmetric Keypair Generation", str(e))


def test_shared_key_from_password(results):
    """Тест 3: Создание общего ключа из пароля"""
    try:
        p2p = P2PEncryption()
        password = "test_password_123"

        key1, salt = p2p.create_shared_key(password)
        key2, salt2 = p2p.create_shared_key(password, salt)

        assert key1 is not None, "Ключ 1 не сгенерирован"
        assert key2 is not None, "Ключ 2 не сгенерирован"
        assert key1 == key2, "Ключи не совпадают при одинаковом пароле и соли"
        assert len(key1) == 32, f"Неверная длина ключа: {len(key1)}"

        results.add_pass("Shared Key From Password")
    except Exception as e:
        results.add_fail("Shared Key From Password", str(e))


def test_encrypt_decrypt_symmetric(results):
    """Тест 4: Шифрование/дешифрование симметричным ключом"""
    try:
        p2p = P2PEncryption()
        message = "Hello, World! Это тестовое сообщение."

        key = p2p.generate_symmetric_key()
        encrypted = p2p.encrypt_for_chat(message, key)
        decrypted = p2p.decrypt_for_chat(encrypted, key)

        assert encrypted != message, "Зашифрованное сообщение равно оригиналу"
        assert decrypted == message, f"Расшифрованное не равно оригиналу: '{decrypted}' != '{message}'"
        assert isinstance(encrypted, str), f"Зашифрованное не строка: {type(encrypted)}"

        results.add_pass("Symmetric Encrypt/Decrypt")
    except Exception as e:
        results.add_fail("Symmetric Encrypt/Decrypt", str(e))


def test_encrypt_wrong_key(results):
    """Тест 5: Дешифрование неправильным ключом"""
    try:
        p2p = P2PEncryption()
        message = "Secret message"

        key1 = p2p.generate_symmetric_key()
        key2 = p2p.generate_symmetric_key()

        encrypted = p2p.encrypt_for_chat(message, key1)

        try:
            p2p.decrypt_for_chat(encrypted, key2)
            # Если дошли сюда - это ошибка (должно было выбросить исключение)
            results.add_fail("Wrong Key Decryption", "Не выбросило исключение при неправильном ключе")
        except (ValueError, Exception):
            # Ожидаемое поведение
            results.add_pass("Wrong Key Decryption Rejection")
    except Exception as e:
        results.add_fail("Wrong Key Decryption", str(e))


def test_encrypt_key_with_public_key(results):
    """Тест 6: Шифрование ключа публичным ключом"""
    try:
        p2p = P2PEncryption()

        # Генерируем пару ключей
        private_key, public_key = p2p.generate_asymmetric_keys()

        # Ключ для шифрования
        key_to_encrypt = p2p.generate_symmetric_key()

        # Шифруем публичным ключом
        encrypted_key = p2p.encrypt_key_with_public_key(key_to_encrypt, public_key)

        assert encrypted_key is not None, "Зашифрованный ключ не создан"
        assert isinstance(encrypted_key, str), f"Зашифрованный ключ не строка: {type(encrypted_key)}"

        results.add_pass("Encrypt Key With Public Key")
        return encrypted_key, private_key, key_to_encrypt
    except Exception as e:
        results.add_fail("Encrypt Key With Public Key", str(e))
        return None, None, None


def test_decrypt_key_with_private_key(results, encrypted_key, private_key, original_key):
    """Тест 7: Дешифрование ключа приватным ключом"""
    try:
        if not encrypted_key:
            results.add_fail("Decrypt Key With Private Key", "Нет данных для теста (ошибка в тесте 6)")
            return

        p2p = P2PEncryption()

        decrypted_key = p2p.decrypt_key_with_private_key(encrypted_key, private_key)

        assert decrypted_key == original_key, "Расшифрованный ключ не совпадает с оригиналом"

        results.add_pass("Decrypt Key With Private Key")
    except Exception as e:
        results.add_fail("Decrypt Key With Private Key", str(e))


import pytest

@pytest.mark.skip(reason="EncryptionManager удалён из кодовой базы")
def test_encryption_manager_chat_key(results):
    """Тест 8: Генерация ключа чата в EncryptionManager"""


@pytest.mark.skip(reason="EncryptionManager удалён из кодовой базы")
def test_encryption_manager_message(results):
    """Тест 9: Шифрование/дешифрование сообщения через EncryptionManager"""


def test_base64_padding_handling(results):
    """Тест 10: Обработка padding в Base64"""
    try:
        p2p = P2PEncryption()
        message = "Test"
        key = p2p.generate_symmetric_key()

        encrypted = p2p.encrypt_for_chat(message, key)

        # Имитируем отсутствие padding
        encrypted_no_padding = encrypted.rstrip('=')

        decrypted = p2p.decrypt_for_chat(encrypted_no_padding, key)

        assert decrypted == message, f"Padding не обработан корректно: '{decrypted}' != '{message}'"

        results.add_pass("Base64 Padding Handling")
    except Exception as e:
        results.add_fail("Base64 Padding Handling", str(e))


def test_empty_message(results):
    """Тест 11: Шифрование пустого сообщения"""
    try:
        p2p = P2PEncryption()
        message = ""
        key = p2p.generate_symmetric_key()

        encrypted = p2p.encrypt_for_chat(message, key)
        decrypted = p2p.decrypt_for_chat(encrypted, key)

        assert decrypted == message, f"Пустое сообщение не обработано: '{decrypted}' != '{message}'"

        results.add_pass("Empty Message Encryption")
    except Exception as e:
        results.add_fail("Empty Message Encryption", str(e))


def test_long_message(results):
    """Тест 12: Шифрование длинного сообщения"""
    try:
        p2p = P2PEncryption()
        message = "A" * 10000  # 10KB сообщение
        key = p2p.generate_symmetric_key()

        encrypted = p2p.encrypt_for_chat(message, key)
        decrypted = p2p.decrypt_for_chat(encrypted, key)

        assert decrypted == message, "Длинное сообщение не расшифровано корректно"

        results.add_pass("Long Message Encryption")
    except Exception as e:
        results.add_fail("Long Message Encryption", str(e))


def test_unicode_message(results):
    """Тест 13: Шифрование Unicode сообщения"""
    try:
        p2p = P2PEncryption()
        message = "Привет! 你好! مرحبا! 🎉🔐"  # Русский, китайский, арабский, эмодзи
        key = p2p.generate_symmetric_key()

        encrypted = p2p.encrypt_for_chat(message, key)
        decrypted = p2p.decrypt_for_chat(encrypted, key)

        assert decrypted == message, f"Unicode сообщение не расшифровано: '{decrypted}' != '{message}'"

        results.add_pass("Unicode Message Encryption")
    except Exception as e:
        results.add_fail("Unicode Message Encryption", str(e))


def run_e2e_encryption_tests():
    """Запуск тестов E2E шифрования"""
    print("="*60)
    print("ТЕСТИРОВАНИЕ E2E ШИФРОВАНИЯ NURCHAT")
    print("="*60)
    print(f"Время начала: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    results = TestResults()

    # Базовые тесты P2PEncryption
    test_symmetric_key_generation(results)
    test_asymmetric_keypair_generation(results)
    test_shared_key_from_password(results)
    test_encrypt_decrypt_symmetric(results)
    test_encrypt_wrong_key(results)

    # Тесты шифрования ключей
    encrypted_key, private_key, original_key = test_encrypt_key_with_public_key(results)
    test_decrypt_key_with_private_key(results, encrypted_key, private_key, original_key)

    # Краевые случаи
    test_base64_padding_handling(results)
    test_empty_message(results)
    test_long_message(results)
    test_unicode_message(results)

    return results


if __name__ == "__main__":
    results = run_e2e_encryption_tests()
    success = results.summary()
    sys.exit(0 if success else 1)
