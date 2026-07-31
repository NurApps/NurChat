import secrets


def generate_id(length: int = 16) -> str:
    """Генерация случайного hex ID"""
    return secrets.token_hex(length)
