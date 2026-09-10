# DEPLOY.md — запуск публичного релея NurChat

## 0. Постоянный релей дёшево (рекомендуемый путь)

Полный compose (Postgres+Redis) нужен от ~2 GB RAM. Для старта десяткам
пользователей хватает **микро-варианта: один uvicorn + SQLite** —
влезает в самый дешёвый VPS:

| Провайдер (RU, оплата МИР, верификация — телефон/email) | Тариф | Цена |
|---|---|---|
| JustHost | 1 CPU / 0.5 GB / 5 GB | ~70 ₽/мес |
| VDSina | 1 CPU / 1 GB / 10 GB | ~69 ₽/мес |
| RuVDS | 1 CPU / 0.5 GB / 10 GB | ~139 ₽/мес |
| AdminVPS | 1 CPU / 1 GB / 15 GB | ~179 ₽/мес |
| Timeweb Cloud | 1 CPU / 1 GB / 15 GB | ~300 ₽/мес |

Цены на сентябрь 2026, проверяйте на сайте — меняются. Паспорт нужен
только для `.ru`-доменов, для самого VPS достаточно почты/телефона.

Деплой микро-варианта (Ubuntu 22.04/24.04):

```bash
# 1. Система и код
apt update && apt install -y python3.12-venv git curl
useradd -m -s /bin/bash nurchat
git clone https://github.com/NurApps/NurChat.git /opt/NurChat
cd /opt/NurChat && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env   # см. раздел 2; DATABASE_URL=sqlite, USE_REDIS=false

# 2. Systemd (автозапуск + рестарт при падении)
cp infra/nurchat-relay.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now nurchat-relay

# 3. HTTPS: Caddy одной командой (нужен домен, см. ниже)
apt install -y caddy
caddy reverse-proxy --from relay.example.com --to 127.0.0.1:8000
# для постоянства — оформите как сервис, либо полный compose (раздел 1)
curl -f https://relay.example.com/health
```

Домен: дешевле всего цифровой `.xyz` (~$1/год) или `.ru` (~250 ₽/год,
но нужен паспорт). Бесплатно и без паспорта — `eu.org` (заявка
рассматривается неделями) либо поддомен у знакомых. Без домена первое
время сойдёт и `http://IP:8000` — приложение умеет ходить по IP,
TLS появится вместе с доменом.

Минимальный VPS: 1 CPU / 1 GB RAM / 10 GB SSD (до ~500 активных пользователей).
Для роста: 2 CPU / 4 GB RAM, PostgreSQL на отдельном volume.

## 0. Главное правило переездов: сначала домен

Аккаунты живут НА конкретном реле (таблица `users` локальна).
Переезд «дом → Alibaba → VPS» без потерь возможен только если клиенты
ходят по **доменному имени, а не по IP/временному URL**:
подняли новый релей → перенесли БД (`scripts/backup-postgres.sh` туда-обратно
или файл `nurchat.db`) → переключили DNS → пользователи ничего не заметили.

Поэтому шаг ноль: заведите домен (свой или бесплатный) на Cloudflare
и дальше везде используйте только его. `trycloudflare.com`-URL меняются
при каждом рестарте туннеля — для публичного релея не годятся,
только для теста.

План развития: **дом + Cloudflare Tunnel → Alibaba/Termux → VPS**.
Ниже — все три ступени.

## 0.0. Бюджет 0: триалы + переезды (честная схема)

Постоянного бесплатного релея с фиксированным адресом **не существует**:
всё бесплатное либо засыпает (Render/HF), либо с плавающим адресом
(quick tunnel), либо требует карту. Поэтому при бюджете 0 работаем так:

**База (постоянно, $0):** домашний ПК + quick tunnel (раздел 0.1).
Друг привыкает, что адрес иногда меняется.

**Усиление (по неделям, $0):** триалы RU-хостеров со стабильным белым IP.
По данным агрегаторов на сентябрь 2026 (проверяйте на сайте!):
Timeweb ~10 дней, AdminVPS ~7 дней, RuVDS ~3 дня, SpaceWeb ~3 дня.
Цепочкой дают ~3 недели нормального тестирования. Оплата не нужна,
достаточно почты/телефона.

**Переезд за 10 минут** (триал → триал, триал → дом):

```bash
# На старом реле: бэкап БД + файлы
.venv\Scripts\python scripts\backup-sqlite.py   # → backup/nurchat_*.db
# На новом: развернуть код, положить бэкап как nurchat.db,
# скопировать media/ целиком, поднять systemd unit
# Друг вводит новый адрес один раз (экран подключения → свой релей)
```

Аккаунты и история ПЕРЕЕЗЖАЮТ вместе с БД (таблица `users` локальна
релею, но едет вместе с файлом). Перерегистрация не нужна — меняется
только адрес в настройках друга. Не забудьте `media/` (файлы/аватарки),
иначе сообщения останутся, а вложения побьются.

Поэтому в TESTING.md тестируйте функционал, а «боевые» аккаунты можно
заводить уже сейчас — они переживут переезды вместе с БД. До постоянного
VPS это всё равно стенд, но уже без потери данных.

## 0.1. Домашний always-on 24/7 (ступень 1, прямо сейчас)

Чтобы друг писал в любое время, релей должен жить круглосуточно.
Домашний ПК потянет десятки пользователей на SQLite.

**1. Запрет сна (Windows, от админа):**

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
# Ноутбук: при закрытии крышки — ничего не делать
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
```

**2. Автозапуск при включении.** Планировщик заданий →
«При входе пользователя» → действие: `D:\projects\NurChat\scripts\relay-home.bat`
(аргументы не нужны; туннель поднимается отдельно, см. ниже).
Либо просто кинь ярлык в `shell:startup`.

**3. Запуск:**

```powershell
scripts\relay-home.bat tunnel
```

Релей — в свернутом окне `nurchat-relay`, туннель — в текущем.
Логи сервера: `logs/nurchat.log` (ротация уже настроена).

**4. Бэкап по расписанию** (Планировщик → ежедневно):

- действие: `D:\projects\NurChat\.venv\Scripts\python.exe`
- аргументы: `scripts\backup-sqlite.py`
- рабочая папка: `D:\projects\NurChat`

Хранит последние 7 копий в `backup/` (в git не попадает).

**5. Конфиг для дома** (`.env`):

```bash
DATABASE_URL=sqlite:///./nurchat.db
USE_REDIS=false
DEBUG=False
RELAY_DEAF=true
```

**Честные ограничения ступени 1:**
- Quick-туннель меняет URL при каждом рестарте `cloudflared` → друг
  вводит новый адрес вручную (минута делов, но надо знать).
  Лечится именованным туннелем + своим доменом (инструкция выше в
  варианте B) — сделай это следующим шагом, и адрес станет вечным.
- ПК должен быть включён. Пока релей лежит — отправить нельзя
  (очередь офлайн-сообщений на клиенте не хранится), прочитать
  старое — тоже (история на реле). Планируй аптайм.

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
`cloudflared` — белый IP и проброс портов не нужны, HTTPS-домен бесплатно.

Windows (твоя машина):

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login            # один раз: привяжет твой домен
cloudflared tunnel create nurchat   # один раз: lava id + credentials
# в дашборде Cloudflare: DNS relay.example.com → CNAME <tunnel-id>.cfargotunnel.com
cloudflared tunnel route dns nurchat relay.example.com
cloudflared tunnel run --url http://localhost:8000 nurchat
# как служба (чтобы жил после перезагрузки):
cloudflared service install; Start-Service cloudflared
```

Файл туннеля (`~/.cloudflared/config.yml`):

```yaml
tunnel: nurchat
credentials-file: C:\Users\<ты>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: relay.example.com
    service: http://localhost:8000
  - service: http_status:404
```

Переезд дальше = раздел 1 на новой машине + смена DNS. Клиенты не тронуты.

Нюансы: звонки за NAT без TURN могут деградировать (туннель плохо
дружит с UDP-диапазонами coturn — STUN остаётся, прямого P2P WebRTC
обычно хватает); аптайм = аптайм домашнего ПК; электричество ваше.

**Не подходят:** Render/HuggingFace free (засыпают — мессенджер так
не работает; у HF плюс эфемерный диск — SQLite умрёт при рестарте),
Railway-триалы (кончаются), Fly.io (фактически только триал + карта),
serverless (Vercel/Netlify — нельзя держать WebSocket).

**Вариант C — VPS без карты (проверяйте лично).**
Alibaba Cloud периодически даёт free tier без карты (1 CPU/1 GB).
Условия меняются — регистрируйтесь и смотрите текущий free trial.
Любой «бесплатный VPS без верификации» с форумов — скам с вероятностью
90%: не вводите туда ключи и доступы, держите только релей.

**Вариант D — старый Android + Termux (0 ₽).**
Телефон и так всегда включён — готовый micro-сервер:

```bash
# В Termux:
pkg install python cloudflared
# склонируйте репо, затем:
python -m uvicorn server.main:app --port 8000 &
cloudflared tunnel --url http://localhost:8000
```

SQLite вместо Postgres, `USE_REDIS=false`. Минусы: звонки только через
STUN, бэкап — копированием `nurchat.db` (`scripts/backup.sh`), держать
на зарядке.

**Вариант E — спонсорский VPS от сообщества.**
Hetzner CX22 (~€4/мес) тянет релей на сотни пользователей. Один спонсор
из будущих пользователей решает вопрос навсегда — повесьте кнопку
«спонсировать релей» в README когда будет комьюнити.

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

## 8. Релеи сообщества (добровольцы)

Идея: пользователи поднимают свои реле по разделам 0–1, мы добавляем их
в `PUBLIC_RELAYS` (`frontend/src/config.ts`), клиенты разбирают нагрузку
случайным выбором при первом запуске, дальше релей липкий (аккаунт живёт
на одном реле — рандом при каждом старте разлогинил бы всех).

**Требования к релею из списка:**
- HTTPS, `GET /health` → 200, аптайм, актуальная версия (`/health` отдаёт `version`)
- `RELAY_DEAF=true` (иначе не берём — не хотим складов чужого контента)
- Оператор согласен на удаление из списка при злоупотреблениях

**Как попасть в список:** PR, добавляющий `{ host, protocol }` в
`PUBLIC_RELAYS` + пару слов кто оператор. Мейнтейнер проверяет health
и мержит. Следующий релиз десктопа (тег `v*`) развезёт список клиентам.

**Честно про доверие:** E2E защищает содержимое, но злой релей видит
метаданные (кто/когда), может дропать сообщения и подсунуть чужой бандл
при первом контакте (защита — safety numbers + предупреждения о смене
ключа, они в приложении есть). Поэтому список курируемый, а не открытый:
рандом — только среди проверенных.

## 9. Чеклист перед уходом

- [ ] `.env` заполнен, `DEBUG=False`, секреты длинные и уникальные
- [ ] `RELAY_DEAF=true`, бэкапы по cron, ключ `.env` бэкапится отдельно
- [ ] HTTPS работает (prod overlay), health отвечает outward
- [ ] TURN-логин/пароль сменены и совпадают в `.env` + `infra/coturn.conf`
- [ ] Uptime-мониторинг заведён, алерты приходят
- [ ] Хотя бы 2 человека с write-доступом к репозиторию (bus factor > 1)
- [ ] SECURITY.md контакт актуален (куда слать уязвимости, пока вас нет)
