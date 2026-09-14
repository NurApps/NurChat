# Тест с друзьями через Cloudflare Tunnel — 5 минут

Цель: показать мессенджер друзьям без покупки VPS/домена. Твой ПК = релей, наружу торчит через `trycloudflare.com` (бесплатно, без регистрации домена).

## 1) Поднять релей локально

```bat
:: в корне проекта
.venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload
:: проверь: http://127.0.0.1:8000/health  -> {"status":"healthy"}
```

`.env` для теста достаточно дефолтного. Для теста с друзьями поставь:
```
RELAY_DEAF=true
CALLS_MINIMAL_METADATA=true
FILE_E2E_ENABLED=true
# для звонков за NAT позже добавь TURN, пока хватит STUN
```

## 2) Поставить cloudflared (Windows)

```powershell
winget install --id Cloudflare.cloudflared
cloudflared --version
```

## 3) Быстрый туннель (без домена, на 1 сессию)

```powershell
cloudflared tunnel --url http://localhost:8000
```

Вывод содержит:
```
https://xxxx-yyy-zzz.trycloudflare.com
```
Это и есть публичный URL твоего релея. Скопируй его.

> URL меняется при каждом рестарте `cloudflared` — норм для теста. Для вечного адреса см. «Именованный туннель» ниже.

## 4) Дать друзьям

Друг ставит NurChat (exe из Releases или `npx tauri dev`) и на экране подключения вводит:

- Host: `xxxx-yyy-zzz.trycloudflare.com` (без https://)
- Protocol: `https`

Или ты раздаёшь ссылку: `https://xxxx-yyy-zzz.trycloudflare.com/health` — пусть убедятся что `{"status":"healthy"}`.

Друг регистрируется — аккаунт живёт на твоём реле. Переписка, файлы, голосовые, звонки пойдут через твой ПК (медиа звонков P2P, сигналу нужен только relay).

## 5) Проверка E2E файлов, голосовых, звонков

1. Отправь фото/файл — на сервере в `media/` лежит `enc_*.bin` (ciphertext), а в чате фото открывается (расшифровано локально).
2. Запиши голосовое — ищи `Таймаут 30с` в `frontend/src/pages/ChatPage.tsx`, нажми микрофон, говори, стоп. Если не уходит — смотри `logs/nurchat.log` на 422 по MIME (уже пофикшено).
3. Звонок: `CALLS_MINIMAL_METADATA=true` => в БД `call_logs` пусто, сигналинг только форвардит SDP/ICE (relay не хранит историю, метаданные минимальны, логи без SDP).
4. Скачивание: файлы качаются через `blobManager` — стабильный Blob URL, кэш 64 файла, `URL.revokeObjectURL` при выгрузке, токен не торчит в `<img src>`.

## 6) Именованный туннель (вечный URL, нужен свой домен)

Если есть домен на Cloudflare:

```powershell
cloudflared tunnel login
cloudflared tunnel create nurchat
cloudflared tunnel route dns nurchat relay.example.com
```

`~/.cloudflared/config.yml`:
```yaml
tunnel: nurchat
credentials-file: C:\Users\<ты>\.cloudflared\<id>.json
ingress:
  - hostname: relay.example.com
    service: http://localhost:8000
  - service: http_status:404
```

```powershell
cloudflared tunnel run nurchat
# как служба:
cloudflared service install; Start-Service cloudflared
```

Друзья вводят `relay.example.com`/`https` один раз и больше не перенастраивают.

## 7) Частые проблемы

- **Войсы не уходят**: обнови код (фикс `voice` MIME + выбор `audio/webm;codecs=opus` автоматом). Пересобери фронт `cd frontend && npm run build`, перезапусти relay.
- **Фото не открывается**: проверь что `FILE_E2E_ENABLED=true` и у собеседника тоже свежий фронт (ключ файла обёрнут ECDH per-user).
- **Звонок не соединяется за NAT**: нужен TURN (`infra/coturn.conf` + `TURN_URLS` в `.env`). Без него работает только если оба не за NAT.
- **Ссылка умерла**: quick tunnel живёт пока открыт `cloudflared`. Именованный туннель + домен = вечно.
