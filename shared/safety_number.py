import hashlib
import struct


def generate_safety_number(
    my_public_key: str,
    my_signing_public_key: str,
    their_public_key: str,
    their_signing_public_key: str,
) -> str:
    """
    Signal-style safety number.

    Берёт обе пары ключей (X25519 encryption + Ed25519 signing),
    сортирует их канонически (лексикографически по public_key),
    конкатенирует и хеширует SHA-512, затем форматирует
    как группы цифр (по 5) для ручного сравнения.
    """
    # Каноническая сортировка: сравниваем X25519 ключи
    if my_public_key < their_public_key:
        a_keys = my_public_key + my_signing_public_key
        b_keys = their_public_key + their_signing_public_key
    else:
        a_keys = their_public_key + their_signing_public_key
        b_keys = my_public_key + my_signing_public_key

    combined = (a_keys + b_keys).encode("ascii")
    digest = hashlib.sha512(combined).digest()

    # Берём первые 30 байт → 60 десятичных цифр
    num = int.from_bytes(digest[:30], "big")
    digits = f"{num:060d}"

    # Группируем: 5 групп по 5 цифр × 2 строки
    groups = [digits[i:i+5] for i in range(0, 60, 5)]
    line1 = " ".join(groups[:6])
    line2 = " ".join(groups[6:])
    return f"{line1}\n{line2}"


def format_safety_number_for_display(number: str) -> str:
    """Просто убираем перевод строки и красиво отображаем."""
    return number


def safety_number_bytes(display: str) -> bytes:
    """Уникальные байты из safety number для QR-кода."""
    return display.replace("\n", "").replace(" ", "").encode("ascii")
