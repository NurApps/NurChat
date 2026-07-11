# 🔐 TOTP 2FA Настройка и Использование

## 📋 Обзор

NurChat теперь поддерживает двухфакторную аутентификацию (TOTP) с:
- ✅ QR кодами для быстрой настройки в приложениях аутентификации
- ✅ Резервными кодами восстановления (10 одноразовых кодов)
- ✅ Шифрованием секретов мастер-ключом (не зависит от пароля)
- ✅ Поддержкой Google Authenticator, Authy, Microsoft Authenticator и др.

## ⚙️ Настройка сервера

### 1. Добавьте переменные окружения

В `.env` файл добавьте:

```bash
# TOTP 2FA Master Key — CRITICAL: Set a stable key for TOTP secret encryption
# Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
TOTP_MASTER_KEY=your_generated_key_here
```

**ВАЖНО:** Сгенерируйте уникальный ключ и сохраните его! При изменении этого ключа все существующие TOTP конфигурации станут недействительными.

### 2. Примените миграцию базы данных

```bash
cd /workspace
alembic upgrade head
```

Это добавит поля `totp_secret`, `totp_enabled` и `backup_codes` в таблицу пользователей.

### 3. Перезапустите сервер

```bash
python -m uvicorn server.main:app --reload
```

## 📡 API Endpoints

### 1. Проверка статуса TOTP

**GET** `/api/auth/totp/status`

Проверяет, включен ли TOTP для текущего пользователя.

**Ответ:**
```json
{
  "enabled": false,
  "setup_required": false
}
```

### 2. Настройка TOTP (получение QR кода)

**GET** `/api/auth/totp/setup`

**Заголовки:**
- `X-Password-Confirmation`: ваш пароль (для подтверждения)

**Ответ:**
```json
{
  "qr_code": "data:image/png;base64,iVBORw0KGgoAAAANSU...",
  "secret_hint": "ABCD...",
  "manual_entry_key": "JBSWY3DPEHPK3PXP"
}
```

**Поля:**
- `qr_code`: Data URI с QR кодом для сканирования
- `secret_hint`: Первые 4 символа секрета (для проверки)
- `manual_entry_key`: Ключ для ручного ввода в приложении аутентификации

### 3. Включение TOTP

**POST** `/api/auth/totp/enable`

**Заголовки:**
- `X-Password-Confirmation`: ваш пароль

**Тело запроса:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "code": "123456"
}
```

**Ответ:**
```json
{
  "message": "TOTP успешно включен",
  "enabled": true,
  "backup_codes": [
    "1234-5678",
    "9012-3456",
    ...
  ]
}
```

**⚠️ ВАЖНО:** Сохраните резервные коды немедленно! Они показываются только один раз.

### 4. Отключение TOTP

**POST** `/api/auth/totp/disable`

**Заголовки:**
- `X-Password-Confirmation`: ваш пароль

**Тело запроса:**
```json
{
  "code": "123456" 
}
```

Можно использовать как TOTP код, так и резервный код.

### 5. Вход с TOTP

**POST** `/api/auth/login`

**Тело запроса:**
```json
{
  "username": "user@example.com",
  "password": "your_password",
  "totp_code": "123456" // или резервный код формата XXXX-XXXX
}
```

Если TOTP включен, но код не передан, сервер вернет:
- **Status:** 403 Forbidden
- **Header:** `X-TOTP-Required: true`
- **Body:** `{"detail": "TOTP_REQUIRED"}`

## 🎨 Пример реализации на фронтенде (React/TypeScript)

### Компонент настройки TOTP

```tsx
import React, { useState } from 'react';
import { api } from '../services/api';

export const TOTPSetupPage: React.FC = () => {
  const [qrCode, setQrCode] = useState<string>('');
  const [secretHint, setSecretHint] = useState<string>('');
  const [manualKey, setManualKey] = useState<string>('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [step, setStep] = useState<'setup' | 'verify' | 'complete'>('setup');

  // Шаг 1: Запрос QR кода
  const handleSetupTOTP = async () => {
    try {
      const response = await api.get('/auth/totp/setup', {
        headers: {
          'X-Password-Confirmation': password,
        },
      });
      
      setQrCode(response.data.qr_code);
      setSecretHint(response.data.secret_hint);
      setManualKey(response.data.manual_entry_key);
      setStep('verify');
    } catch (error) {
      alert('Ошибка настройки TOTP');
    }
  };

  // Шаг 2: Верификация и включение
  const handleEnableTOTP = async () => {
    try {
      const response = await api.post('/auth/totp/enable', {
        secret: manualKey,
        code: verificationCode,
      }, {
        headers: {
          'X-Password-Confirmation': password,
        },
      });
      
      setBackupCodes(response.data.backup_codes);
      setStep('complete');
    } catch (error) {
      alert('Неверный код TOTP');
    }
  };

  // Шаг 3: Сохранение резервных кодов
  const downloadBackupCodes = () => {
    const content = backupCodes.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nurchat-backup-codes.txt';
    a.click();
  };

  if (step === 'setup') {
    return (
      <div>
        <h2>Настройка двухфакторной аутентификации</h2>
        <input
          type="password"
          placeholder="Подтвердите пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={handleSetupTOTP}>Получить QR код</button>
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div>
        <h2>Отсканируйте QR код</h2>
        <img src={qrCode} alt="TOTP QR Code" />
        <p>Или введите ключ вручную: <strong>{manualKey}</strong></p>
        <p>Подсказка: {secretHint}</p>
        
        <input
          type="text"
          placeholder="Введите 6-значный код"
          value={verificationCode}
          onChange={(e) => setVerificationCode(e.target.value)}
        />
        <button onClick={handleEnableTOTP}>Включить TOTP</button>
      </div>
    );
  }

  if (step === 'complete') {
    return (
      <div>
        <h2>✅ TOTP успешно включен!</h2>
        <p>Сохраните эти резервные коды в безопасном месте:</p>
        <div style={{ background: '#f0f0f0', padding: '10px' }}>
          {backupCodes.map((code, i) => (
            <div key={i}>{code}</div>
          ))}
        </div>
        <button onClick={downloadBackupCodes}>Скачать коды</button>
        <p>⚠️ Эти коды показываются только один раз!</p>
      </div>
    );
  }

  return null;
};
```

### Компонент входа с TOTP

```tsx
import React, { useState } from 'react';
import { api } from '../services/api';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requiresTOTP, setRequiresTOTP] = useState(false);

  const handleLogin = async () => {
    try {
      const payload: any = { username, password };
      
      if (requiresTOTP && totpCode) {
        payload.totp_code = totpCode;
      }
      
      const response = await api.post('/auth/login', payload);
      // Успешный вход
      localStorage.setItem('token', response.data.access_token);
    } catch (error) {
      if (error.response?.status === 403 && 
          error.response?.headers['x-totp-required'] === 'true') {
        setRequiresTOTP(true);
      } else {
        alert('Ошибка входа');
      }
    }
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        placeholder="Пароль"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      
      {requiresTOTP && (
        <input
          type="text"
          placeholder="TOTP код или резервный код"
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value)}
        />
      )}
      
      <button onClick={handleLogin}>Войти</button>
    </div>
  );
};
```

## 🔒 Рекомендации по безопасности

1. **Хранение резервных кодов:**
   - Распечатайте и храните в сейфе
   - Сохраните в менеджере паролей (Bitwarden, 1Password)
   - Никогда не храните вместе с паролем

2. **Мастер-ключ TOTP:**
   - Храните в secure vault (HashiCorp Vault, AWS Secrets Manager)
   - Никогда не коммитьте в Git
   - Используйте разные ключи для dev/staging/production

3. **Бэкапы:**
   - Регулярно делайте бэкапы БД
   - Убедитесь, что `TOTP_MASTER_KEY` тоже забэкаплен

## 🧪 Тестирование

```bash
# Проверка импорта модулей
python -c "from server.utils.totp import *; print('OK')"

# Генерация тестового ключа
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Применение миграций
alembic upgrade head
```

## ❓ Troubleshooting

**Проблема:** "TOTP_MASTER_KEY not set in ENV"
- **Решение:** Добавьте ключ в `.env` и перезапустите сервер

**Проблема:** "Неверный код TOTP"
- **Решение:** Проверьте время на устройстве (должно быть синхронизировано)

**Проблема:** Потерян доступ к TOTP
- **Решение:** Используйте резервные коды или обратитесь к администратору для сброса

## 📚 Дополнительные ресурсы

- [RFC 6238 - TOTP Standard](https://tools.ietf.org/html/rfc6238)
- [pyotp Documentation](https://pyotp.readthedocs.io/)
- [Google Authenticator](https://support.google.com/accounts/answer/1066447)
