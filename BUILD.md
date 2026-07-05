# NurChat Desktop — Сборка и автообновления

## Сборка exe для тестирования

### 1. Подготовка

```bash
# Установить зависимости фронтенда
cd frontend
npm install

# Установить зависимости бэкенда
cd ..
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### 2. Сборка фронтенда (production)

```bash
cd frontend
npm run build
```

Результат: `frontend/dist/` — статика для Tauri.

### 3. Сборка Tauri exe

```bash
# Из корня проекта
cd src-tauri
cargo build --release
```

Или через npm:

```bash
cd frontend
npm run tauri build
```

Результат: `src-tauri/target/release/app.exe`

### 4. Быстрый запуск (dev mode)

```bash
# Сервер
.venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload

# Tauri dev (отдельная консоль)
cd frontend
npx tauri dev
```

Или `start.bat` — запускает оба.

---

## Автообновления (Tauri Updater)

### Настройка сервера обновлений

Для автообновлений нужен HTTP-сервер, раздающий `latest.json` и exe файлы.

#### Вариант 1: GitHub Releases

1. Создать релиз на GitHub с тегом `v0.1.0`
2. Загрузить `app.exe` и `latest.json` как ассеты релиза

#### Вариант 2: Свой сервер

Разместить на сервере:

```
/latest.json          — метаданные последней версии
/releases/v0.1.0/app.exe  — файл обновления
```

### latest.json формат

```json
{
  "version": "0.2.0",
  "notes": "Исправления багов, новые эмодзи",
  "pub_date": "2026-07-05T20:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "Подпись файла (ed25519 илиRSA)",
      "url": "https://your-server.com/releases/v0.2.0/app.exe"
    }
  }
}
```

### Конфигурация в tauri.conf.json

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://your-server.com/latest.json",
        "https://github.com/NurApps/NurChat_desktop_beta/releases/latest/download/latest.json"
      ],
      "pubkey": "ВАШ_PUBKEY_ИЗ_UPDATER_TOOL"
    }
  }
}
```

### Генерация ключей подписи

```bash
# Установить tauri-cli
cargo install tauri-cli

# Генерация ключей
npx tauri signer generate -w ~/.tauri/nurchat.key

# Публичный ключ (вставляется в tauri.conf.json)
npx tauri signer show ~/.tauri/nurchat.key
```

### Процесс обновления

1. Tauri периодически проверяет `endpoints`
2. Если `latest.json.version` > текущей → скачивает exe
3. Проверяет `signature` публичным ключом
4. Предлагает установить обновление
5. После подтверждения — заменяет exe и перезапускает

---

## Автосборка через GitHub Actions

`.github/workflows/build.yml` уже настроен. При пуше в `main`:

1. Запускает тесты
2. Собирает Tauri exe (Windows)
3. Создаёт GitHub Release с exe + latest.json

### Релиз новой версии

```bash
# Обновить версию в src-tauri/Cargo.toml и frontend/package.json
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions автоматически создаст релиз с exe и latest.json.

---

## Структура проекта

```
NurChat_desktop/
├── frontend/          # React + Vite (фронтенд)
├── src-tauri/         # Tauri + Rust (обёртка)
│   ├── src/lib.rs     # Tauri команды (IPFS, P2P)
│   └── Cargo.toml
├── server/            # FastAPI + SQLite (бэкенд)
│   ├── routes/        # API эндпоинты
│   ├── core/          # Модели, БД, крипто
│   └── ws/            # WebSocket
├── shared/            # Общие схемы
├── start.bat          # Быстрый запуск
└── requirements.txt
```

---

## Чек-лист перед релизом

- [ ] Версия в `Cargo.toml` и `package.json` совпадают
- [ ] `npm run build` проходит без ошибок
- [ ] `cargo build --release` проходит без ошибок
- [ ] Тесты пройдены (`pytest`)
- [ ] Ключи подписи сгенерированы
- [ ] `pubkey` вставлен в `tauri.conf.json`
- [ ] `latest.json` создан для новой версии
