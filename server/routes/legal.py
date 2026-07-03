from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()

# Пути к юридическим документам
LEGAL_DIR = Path("legal")
PRIVACY_POLICY_PATH = LEGAL_DIR / "privacy_policy.md"
USER_AGREEMENT_PATH = LEGAL_DIR / "user_agreement.md"

@router.get("/privacy")
async def get_privacy_policy():
    """Получение Политики конфиденциальности NurChat"""
    if not PRIVACY_POLICY_PATH.exists():
        raise HTTPException(status_code=404, detail="Политика конфиденциальности не найдена")

    return FileResponse(
        path=PRIVACY_POLICY_PATH,
        filename="privacy_policy_nurchat.md",
        media_type="text/markdown"
    )

@router.get("/agreement")
async def get_user_agreement():
    """Получение Пользовательского соглашения NurChat"""
    if not USER_AGREEMENT_PATH.exists():
        raise HTTPException(status_code=404, detail="Пользовательское соглашение не найдено")

    return FileResponse(
        path=USER_AGREEMENT_PATH,
        filename="user_agreement_nurchat.md",
        media_type="text/markdown"
    )

@router.get("/privacy/text")
async def get_privacy_policy_text():
    """Получение текста Политики конфиденциальности NurChat"""
    if not PRIVACY_POLICY_PATH.exists():
        # Возвращаем базовый текст, если файла нет
        return {
            "title": "Политика конфиденциальности NurChat",
            "content": """
# Политика конфиденциальности NurChat

## 1. Общие положения
NurChat - анонимный мессенджер, разработанный NurApps. Мы ценим вашу конфиденциальность.
Мы имеем право заблокировать пользователей, нарушающих законы по жалобам других пользователей.

## 2. Собираемая информация
- Анонимный идентификатор пользователя
- Сообщения (зашифрованные end-to-end)
- Медиафайлы (хранятся ограниченное время)
- Публичный ключ для шифрования
- Никнейм и юзернейм (если указаны)

## 3. Использование информации
Информация используется исключительно для работы мессенджера.
Мы не несем отвественности за использование сервиса в нарушение законов.

## 4. Безопасность
Все сообщения шифруются end-to-end. Файлы автоматически удаляются через 30 дней.
Мы не храним ваши сообщения и медиафайлы.И не обрабатываем на дата центрах и серверах.
Данные не передаются третьим лицам.

## 5. Контакты
По вопросам конфиденциальности: support@nurapps.com
            """
        }

    with open(PRIVACY_POLICY_PATH, encoding="utf-8") as f:
        content = f.read()

    return {
        "title": "Политика конфиденциальности NurChat",
        "content": content
    }

@router.get("/agreement/text")
async def get_user_agreement_text():
    """Получение текста Пользовательского соглашения NurChat"""
    if not USER_AGREEMENT_PATH.exists():
        # Возвращаем базовый текст, если файла нет
        return {
            "title": "Пользовательское соглашение NurChat",
            "content": """
# Пользовательское соглашение NurChat

## 1. Общие положения
NurChat - анонимный мессенджер от NurApps. Используя приложение, вы соглашаетесь с условиями.

## 2. Права и обязанности
- Вы можете анонимно общаться
- Запрещено распространение незаконного контента
- Файлы хранятся 30 дней

## 3. Ограничение ответственности
NurApps не несет ответственности за содержание переписок.

## 4. Изменения в соглашении
Условия могут изменяться. Актуальная версия всегда в приложении.

## 5. Контакты
@salikh_suyundikov Telegram
salixsuyundikov@gmail.com
            """
        }

    with open(USER_AGREEMENT_PATH, encoding="utf-8") as f:
        content = f.read()

    return {
        "title": "Пользовательское соглашение NurChat",
        "content": content
    }