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

## Сборка под Linux (.deb + .AppImage)

Системные зависимости (Debian/Ubuntu 22.04+):

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  libxdo-dev libssl-dev patchelf \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good gstreamer1.0-libav   # GStreamer — для аудио/видео (звонки) в AppImage
```

```bash
./run.sh build     # = npx tauri build --bundles deb,appimage
```

Результат: `src-tauri/target/release/bundle/{deb,appimage}/`. Таргеты и Linux-специфика лежат в `src-tauri/tauri.linux.conf.json` (Tauri мержит его поверх `tauri.conf.json` сам), поэтому голый `npx tauri build` на Linux тоже соберёт `.deb`/`.AppImage`.

Собирать лучше на Ubuntu 22.04: чем старше glibc сборочной машины, тем шире круг дистрибутивов, где запустится AppImage. Архитектура — только x86_64.

Relay в пакет не входит. Приложение ищет локальный relay в таком порядке: бинарник `server-x86_64-unknown-linux-gnu` / `server` рядом с приложением → `.venv/bin/python` → системный `python3` (нужны зависимости из `requirements.txt`). Готовый бинарник публикуется в релизе (собирается в `release.yml`, джоб `release-linux`). Иначе приложение подключается к внешнему relay через `VITE_API_HOST`.

## Автообновления (Tauri Updater)

Relay сервер НЕ входит в сборку — приложение подключается к внешнему relay (через `VITE_API_HOST`).

### Релиз новой версии

```bash
# Версия — в ДВУХ местах (должны совпадать):
#   src-tauri/tauri.conf.json ("version") и src-tauri/Cargo.toml (version).
# Сейчас: 0.16.2. Пример следующего релиза:
# затем GitHub -> Actions -> Release -> Run workflow, ввести tag (напр. v0.16.3)
# и выбрать платформы (Windows / Linux)
```

Релиз запускается ТОЛЬКО вручную (`workflow_dispatch`), пуш тега сам ничего не собирает.

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
