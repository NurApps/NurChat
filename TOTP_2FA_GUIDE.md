# 🔐 TOTP 2FA — настройка и использование

## 📋 Обзор

NurChat поддерживает двухфакторную аутентификацию (TOTP):
- ✅ QR-код для быстрой настройки в приложениях аутентификации
- ✅ Резервные коды восстановления (10 одноразовых кодов формата `XXXX-XXXX`)
- ✅ Шифрование секретов мастер-ключом (не зависит от пароля)
- ✅ Поддержка Google Authenticator, Authy, Microsoft Authenticator и др.

## ⚙️ Настройка сервера

### 1. Мастер-ключ

В `.env` добавьте (или позвольте серверу сгенерировать автоматически):

```bash
# TOTP 2FA Master Key — CRITICAL: стабильный ключ для шифрования TOTP-секретов
# Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
TOTP_MASTER_KEY=your_generated_key_here
```

**ВАЖНО:** при смене ключа все существующие TOTP-конфигурации станут
недействительными. Бэкапьте ключ вместе с БД.

### 2. Миграции

```bash
.venv\Scripts\python -m alembic upgrade head
```

### 3. Перезапуск

```bash
.venv\Scripts\python -m uvicorn server.main:app --reload
```

## 📡 API Endpoints

Все запросы требуют `Authorization: Bearer <token>` (кроме login).
Тело — JSON. Пароль передаётся в теле, не в заголовках.

### 1. Статус 2FA

**GET** `/api/auth/2fa/status`

**Ответ:**
```json
{
  "enabled": false,
  "backup_codes_remaining": 0
}
```

### 2. Начать настройку (QR + backup-коды)

**POST** `/api/auth/2fa/setup`

**Тело:**
```json
{ "password": "текущий_пароль" }
```

**Ответ:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "uri": "otpauth://totp/NurChat:username?secret=...&issuer=NurChat",
  "qr_code": "data:image/png;base64,iVBORw0KGgoAAAANSU...",
  "backup_codes": ["AB12-CD34", "..."]
}
```

**Поля:**
- `qr_code`: Data URI с QR-кодом для сканирования
- `secret`: секрет для ручного ввода
- `uri`: `otpauth://` URI
- `backup_codes`: 10 кодов, показываются **только один раз**

На этом этапе 2FA ещё НЕ включена — секрет сохранён, ждёт подтверждения.

### 3. Подтвердить и включить

**POST** `/api/auth/2fa/enable`

**Тело:**
```json
{ "code": "123456", "password": "текущий_пароль" }
```

**Ответ:**
```json
{ "message": "2FA включена" }
```

### 4. Отключить

**POST** `/api/auth/2fa/disable`

**Тело:**
```json
{ "password": "текущий_пароль", "code": "123456" }
```

В `code` можно передать TOTP-код или неиспользованный backup-код.

**Ответ:**
```json
{ "message": "2FA отключена" }
```

### 5. Вход с 2FA (два шага)

**Шаг 1 — POST** `/api/auth/login` с username+password:

```json
{ "username": "alice", "password": "Secret123" }
```

Если 2FA включена, ответ содержит `requires_2fa: true` и `access_token`
с флагом `2fa_pending` (такой токен НЕ даёт доступа к API — только к шагу 2):

```json
{
  "access_token": "<2fa-pending token>",
  "token_type": "bearer",
  "user": { "...": "..." },
  "requires_2fa": true
}
```

**Шаг 2 — POST** `/api/auth/2fa/verify-login`
(заголовок `Authorization: Bearer <2fa-pending token>`):

```json
{ "code": "123456" }
```

Код — 6 цифр TOTP или backup-код `XXXX-XXXX` (сжигается после использования).

**Ответ:** полноценные `access_token` + `refresh_token` + `user`.

## 🔒 Рекомендации по безопасности

1. **Резервные коды:** распечатайте и храните отдельно от пароля
   (сейф / менеджер паролей). Показываются один раз.
2. **Мастер-ключ:** храните в vault, никогда не коммитьте в Git,
   разные ключи для dev/staging/production.
3. **Бэкапы:** БД бесполезна без `TOTP_MASTER_KEY` — бэкапьте вместе.

## 🧪 Тестирование

```bash
# Применение миграций
.venv\Scripts\python -m alembic upgrade head

# Тесты 2FA
.venv\Scripts\python -m pytest test/test_2fa_login.py -v
```

## ❓ Troubleshooting

**Проблема:** неверный код TOTP
- **Решение:** проверьте время на устройстве (TOTP требует синхронизации
  часов, допуск ±30 сек).

**Проблема:** потерян доступ к TOTP
- **Решение:** войдите backup-кодом. Если и их нет — данные 2FA можно
  сбросить только прямым доступом к БД (`is_2fa_enabled=false`,
  `totp_secret=NULL`, `backup_codes=NULL`).

## 📚 Дополнительные ресурсы

- [RFC 6238 — TOTP Standard](https://tools.ietf.org/html/rfc6238)
- [pyotp Documentation](https://pyotp.readthedocs.io/)
- [Google Authenticator](https://support.google.com/accounts/answer/1066447)
