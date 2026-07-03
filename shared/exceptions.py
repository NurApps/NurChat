class TogetherException(Exception):
    """Базовое исключение для приложения"""
    pass

class AuthenticationError(TogetherException):
    """Ошибка аутентификации"""
    pass

class FileTooLargeError(TogetherException):
    """Файл слишком большой"""
    pass

class FileTypeNotAllowedError(TogetherException):
    """Тип файла не поддерживается"""
    pass

class MessageNotFoundError(TogetherException):
    """Сообщение не найдено"""
    pass

class ChatNotFoundError(TogetherException):
    """Чат не найден"""
    pass

class WebSocketError(TogetherException):
    """Ошибка WebSocket соединения"""
    pass
