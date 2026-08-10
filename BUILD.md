# NurChat Desktop — Сборка и автообновления

## Быстрый запуск

```bash
# Relay (нужен ОДИН экземпляр для всех)
.venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload

# Tauri dev (отдельная консоль)
cd frontend
npx tauri dev
```

## Сборка Tauri exe

```bash
# Установить зависимости фронтенда
cd frontend
npm ci

# Сборка
npx tauri build
```

Результат: `src-tauri/target/release/bundle/nsis/*.exe`

## Автообновления (Tauri Updater)

Relay сервер НЕ входит в сборку — приложение подключается к внешнему relay (через `VITE_API_HOST`).

### Релиз новой версии

```bash
# Обновить версию в src-tauri/Cargo.toml и frontend/package.json
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions автоматически создаст релиз с exe и latest.json.

### latest.json формат

```json
{
  "version": "0.2.0",
  "notes": "Исправления багов",
  "pub_date": "2026-07-05T20:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "ed25519 signature",
      "url": "https://github.com/NurApps/NurChat/releases/download/v0.2.0/nurchat-windows-x64.exe"
    }
  }
}
```

## Структура проекта

```
NurChat/
├── frontend/          # React + Vite
├── src-tauri/         # Tauri + Rust (обёртка, P2P)
├── server/            # FastAPI + SQLite (relay)
├── shared/            # Общие схемы
└── .github/workflows/ # CI/CD
```
