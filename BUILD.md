# NurChat Desktop — Сборка и автообновления

## Быстрый запуск

```bat
run.bat          :: dev: relay (SQLite) + Tauri
run.bat vite     :: relay (SQLite) + Vite в браузере (:5173)
run.bat relay    :: только relay (.env как есть)
```

Ручной вариант: relay отдельно (`run.bat relay`), Tauri отдельно (`npx tauri dev`).

## Сборка Tauri exe

```bat
run.bat build
```

Тот же `npx tauri build` напрямую. Результат: `src-tauri/target/release/bundle/nsis/*.exe` (`NurChat_<версия>_x64-setup.exe`).

## Автообновления (Tauri Updater)

Relay сервер НЕ входит в сборку — приложение подключается к внешнему relay (через `VITE_API_HOST`).

### Релиз новой версии

```bash
# Версия — в ДВУХ местах (должны совпадать):
#   src-tauri/tauri.conf.json ("version") и src-tauri/Cargo.toml (version).
# Сейчас: 0.16.2. Пример следующего релиза:
git tag v0.16.3
git push origin v0.16.3
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
├── src-tauri/         # Tauri + Rust (обёртка окна, трей, автообновления)
├── server/            # FastAPI + SQLite/PostgreSQL (relay)
├── shared/            # Общие схемы и конфиг
└── .github/workflows/ # CI/CD
```
