# DEPLOY.md — запуск публичного релея NurChat

Минимальный VPS: 1 CPU / 1 GB RAM / 10 GB SSD (до ~500 активных пользователей).
Для роста: 2 CPU / 4 GB RAM, PostgreSQL на отдельном volume.

## 0. Бесплатные варианты (без VPS за деньги)

**Вариант A — Oracle Cloud Always Free (рекомендуется).**
4 ARM CPU + 24 GB RAM + 200 GB диска — бесплатно навсегда, настоящий VPS,
`docker compose` работает как на платном. Нюансы: нужна карта для
верификации (деньги не списывают), ARM — наши образы
(`python:3.12-slim`, `postgres:15-alpine`, `redis:7-alpine`, `coturn`)
мультиархные, заводится без правок. Регион выбирайте где есть capacity
(Frankfurt/Zurich обычно ок). Дальше — раздел 1.

**Вариант B — домашний ПК + Cloudflare Tunnel (0 ₽, без карты).**
Релей крутится дома (хоть на старом ноутбуке), наружу торчит через
`cloudflared` — белый IP и проброс портов не нужны, HTTPS-домен бесплатно:

```bash
# На домашней машине: релей как обычно
docker compose up -d --build
# Туннель (ставится отдельно: https://developers.cloudflare.com/cloudflare-one/)
cloudflared tunnel --url http://localhost:8000
# cloudflared выдаст https://xxx.trycloudflare.com → раздайте его пользователям
# Для постоянного домена: свой домен на Cloudflare + named tunnel (тоже бесплатно)
```

Нюансы: звонки за NAT без TURN могут деградировать (туннель плохо
дружит с UDP-диапазонами coturn — STUN остаётся, прямого P2P WebRTC
обычно хватает); аптайм = аптайм домашнего ПК; электричество ваше.

**Не подходят:** Render/HuggingFace free (засыпают — мессенджер так
не работает), Railway/Heroku-подобные (триал кончится).

Какой бы вариант ни выбрали — добавьте хост в `PUBLIC_RELAYS`
(`frontend/src/config.ts`), иначе клиенты будут упираться в localhost.

## 1. Первичный деплой

```bash
# На сервере (Ubuntu 22.04+)
git clone https://github.com/NurApps/NurChat.git /opt/NurChat
cd /opt/NurChat
cp .env.example .env
nano .env   # см. раздел 2
docker compose up -d --build
docker compose exec nurchat alembic upgrade head
curl -f http://localhost:8000/health
```

С HTTPS (публичный релей):

```bash
# DOMAIN=relay.example.com в .env, DNS A-запись уже направлена
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## 2. Обязательный харднинг `.env`

```bash
DEBUG=False
POSTGRES_PASSWORD=<32+ случайных символов>
REDIS_PASSWORD=<32+ случайных символов>
ENCRYPTION_KEY=<hex 64>   # python -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET_KEY=<hex 64>
TOTP_MASTER_KEY=<token_urlsafe 32>
TURN_USERNAME=<не nurchat>
TURN_CREDENTIAL=<длинный случайный>
# и те же TURN-значения в infra/coturn.conf (user=...), затем пересобрать coturn
CORS_ORIGINS=https://ваш-домен
```

Проверка: `docker compose exec nurchat python -c "from shared.config import settings; assert not settings.DEBUG"`.

## 3. Режим без присмотра (рекомендуется, если мейнтейнера нет)

```bash
RELAY_DEAF=true            # стирать содержимое после доставки
MESSAGE_RETENTION_HOURS=48 # TTL недоставленного
USE_REDIS=true             # троттлинг и presence переживают рестарт
```

Плюс в compose уже есть `restart: unless-stopped` на всех сервисах.

Почему так: без модерации публичный релей — магнит для спама.
Глухой режим означает, что на диске нет читаемого контента —
только шифротексты и метаданные. Это не панацея (граф общения виден),
но кардинально снижает риски хранения.

## 4. Бэкапы (cron на хосте)

```bash
# PostgreSQL, ежедневно в 03:00, ротация 7 дней:
0 3 * * * cd /opt/NurChat && ./scripts/backup-postgres.sh >> /var/log/nurchat-backup.log 2>&1

# Ключи отдельно (без них бэкап БД бесполезен для 2FA):
0 3 * * * cp /opt/NurChat/.env /root/nurchat-env-backup-$(date +\%F)
```

Восстановление:

```bash
gunzip -c backup/nurchat_pg_YYYYMMDD_HHMMSS.sql.gz | docker compose exec -T db psql -U nurchat -d nurchat
```

## 5. Обновления без мейнтейнера

1. **Dependabot** (уже настроен) открывает PR с патчами безопасности weekly.
   Любой с write-доступом жмёт merge — CI (тесты + сборка) гоняется автоматически.
2. **Релиз десктопа:** запушить тег `vX.Y.Z` → GitHub Actions соберёт exe
   и опубликует в Releases, клиенты обновятся сами (Tauri updater).
3. **Релей:** `cd /opt/NurChat && git pull && docker compose up -d --build`
   (миграции: `docker compose exec nurchat alembic upgrade head`).

## 6. Мониторинг (5 минут настройки)

- Health: `GET /health` → `{"status":"healthy"}`. Повесьте Uptime Kuma /
  BetterUptime / cron+curl с алертом в Telegram.
- Логи: `docker compose logs -f nurchat` (JSON, ротация 10MB×5).
  Тревожные маркеры: `Error rate .* exceeds threshold`, `WS connections .* exceed`.
- Метрики (опционально): `ENABLE_METRICS=true` → `GET /metrics` (Prometheus).

## 7. Абьюз: честные ограничения

Без модерации вы НЕ сможете удалять чужой контент точечно (E2E — релей
не читает сообщения). Что реально работает:

- Rate limits (slowapi) — спам-шеллы упираются в 429
- `RELAY_DEAF` — нет хранимого контента для изъятия
- Блокировка IP на уровне nginx/Caddy или fail2ban
- Полное отключение регистрации — только кодом (эндпоинт один,
  закрывается флагом в `server/routes/auth.py`)

Если придёт требование удалить конкретный контент — технически возможно
только удаление ВСЕГО (`DELETE FROM messages`) или остановка инстанса.
Заложите это в правила использования заранее.

## 8. Чеклист перед уходом

- [ ] `.env` заполнен, `DEBUG=False`, секреты длинные и уникальные
- [ ] `RELAY_DEAF=true`, бэкапы по cron, ключ `.env` бэкапится отдельно
- [ ] HTTPS работает (prod overlay), health отвечает outward
- [ ] TURN-логин/пароль сменены и совпадают в `.env` + `infra/coturn.conf`
- [ ] Uptime-мониторинг заведён, алерты приходят
- [ ] Хотя бы 2 человека с write-доступом к репозиторию (bus factor > 1)
- [ ] SECURITY.md контакт актуален (куда слать уязвимости, пока вас нет)
