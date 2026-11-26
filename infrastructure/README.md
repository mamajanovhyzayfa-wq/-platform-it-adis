# Infrastructure

Актуальная инфраструктура ITadis: локальная разработка, production-топология,
файловое облако, резервное копирование и наблюдаемость.

## Файлы

| Файл | Назначение |
| --- | --- |
| `../docker-compose.yml` | Локально: PostgreSQL 16, Redis 7, backend |
| `../docker-compose.prod.yml` | Production: PostgreSQL, PgBouncer, Redis, MinIO, ClamAV, backend, admin, nginx, Caddy, Prometheus |
| `../apps/api/Dockerfile` | Backend + `pg_dump`/`pg_restore` для backup/restore |
| `../apps/web/Dockerfile` | Сборка SPA и nginx-контейнер |
| `nginx/nginx.conf` | Общий конфиг Nginx: 32k соединений на worker, nofile 65k |
| `nginx/admin.conf` | SPA, `/api`, `/socket.io`, `/uploads` |
| `nginx/edge.conf` | Внутренний вход, прокси на admin/backend |
| `caddy/Caddyfile` | TLS-фронт на sslip.io: Let's Encrypt, HTTPS, WebSocket |
| `clamav/rest.mjs` | HTTP-обёртка над clamd для `ANTIVIRUS_SCAN_URL` |
| `scripts/deploy.sh` | Деплой одной командой: sslip.io-хостнейм из IP, preflight, compose up, ожидание `/healthz` |
| `scripts/smoke.sh` | Smoke-проверка живого стека: `/healthz`, анонимный `POST /api/leads`, его CORS-ответ для Origin сайта, 401 без токена, `/socket.io/` |
| `monitoring/prometheus.yml` | Scrape `/metrics` |
| `monitoring/alerts.yml` | Алерты: API down, рост 5xx, перезапуск процесса |
| `../.env.production.example` | Полный шаблон production-переменных (домены, секреты, интеграции) |
| `../.github/workflows/ci.yml` | CI: миграции, тесты API, e2e, сборка admin, typecheck mobile, гейт deploy-пути (`shellcheck`, `compose config`, `caddy validate`) |
| `../.github/workflows/release.yml` | Release: образы API/admin в GHCR и CD по тегу при заданных `DEPLOY_*` |

## Окружения

| Окружение | Назначение | Конфигурация |
| --- | --- | --- |
| development | локальная разработка | `docker-compose.yml`, `.env` |
| test | CI и приёмка | сервисы CI, отдельные `DATABASE_URL`/`REDIS_URL` |
| production | боевой сервер | `docker-compose.prod.yml`, `.env.production` |

В production обязательны: `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY`, `APP_ORIGIN`, `PUBLIC_HOSTNAME`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`.
`ANTIVIRUS_SCAN_URL` по умолчанию указывает на контейнер `antivirus`
(`http://antivirus:8080/scan`) и вручную заполняется только для внешнего сканера.
Для филиалов также задайте `PLATFORM_DOMAIN`, `PRIMARY_DOMAIN` и
`PLATFORM_ADMIN_PASSWORD` (или `PLATFORM_ADMIN_PASSWORD_HASH`).
`ALLOW_PRIMARY_FALLBACK` в production должен оставаться `false`.
Секреты хранятся только в secret store/CI, не в git. Для нескольких реплик
задайте `CONTROL_DATABASE_URL` (управляющая БД) отдельно от баз филиалов.

## Запуск production

```bash
cp .env.production.example .env.production
# заполните все пустые значения: домены, пароли, ключи провайдеров
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml --profile monitoring up -d
```

Шаблон содержит все переменные, которые `docker-compose.prod.yml` передаёт
backend: JWT/шифрование, антивирус, SMTP, SMS/Twilio, Expo Push, AI,
Google/Apple, календари, бухгалтерию, платёжные адаптеры, LiveDigital и S3.
Пустые необязательные интеграции переводят адаптер в `not_configured`, а не
ломают запуск. `PUBLIC_HOSTNAME` и production-секреты обязательны: compose
падает до старта, если они не заданы. `ANTIVIRUS_SCAN_URL` заполнять не нужно —
его значение по умолчанию ведёт на контейнер ClamAV.

### Одной командой: `infrastructure/scripts/deploy.sh`

Скрипт закрывает весь подготовительный этап: считает `PUBLIC_HOSTNAME` из IP
сервера (`203.0.113.10` → `203-0-113-10.sslip.io`) и записывает его в
`.env.production`, проверяет обязательные переменные и занятость портов
80/443, затем запускает `docker compose up -d --build` и ждёт ответа
`https://PUBLIC_HOSTNAME/healthz`.

```bash
# на сервере, из корня репозитория (Docker + compose v2 должны быть установлены)
infrastructure/scripts/deploy.sh --ip 203.0.113.10

# только preflight: переменные, порты, валидность compose — без запуска
infrastructure/scripts/deploy.sh --check
```

Опции: `--ip <IPv4>` (без него IP берётся из текущего `PUBLIC_HOSTNAME` или
определяется через внешний сервис), `--env-file <путь>` (по умолчанию
`.env.production`), `--check`. Секреты скрипт не печатает — только имена
незаполненных переменных. При повторном запуске занятые порты не считаются
ошибкой, если их держит `caddy` этого же стека: команда работает как
передеплой. Собственный домен: скрипт не трогает `PUBLIC_HOSTNAME`, если он
уже не в формате sslip.io — тогда он только предупредит о расхождении с
`APP_ORIGIN`.

### Чек-лист первого запуска

Порядок команд на новом сервере и ожидаемый вывод. Если вывод отличается —
остановитесь и разберите причину, дальше не идите.

| # | Команда | Ожидаемый вывод |
| --- | --- | --- |
| 1 | `docker compose version` | `Docker Compose version v2.…` (иначе поставить compose-плагин) |
| 2 | `git clone <repo> && cd -- -platform-it-adis` | рабочая копия без ошибок, код 0 |
| 3 | `cp .env.production.example .env.production && chmod 600 .env.production` | ничего не печатает, код 0 |
| 4 | `$EDITOR .env.production` | заполнены `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY`, `APP_ORIGIN`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `ACME_EMAIL` |
| 5 | `infrastructure/scripts/deploy.sh --check --ip 203.0.113.10` | `preflight пройден (--check): https://203-0-113-10.sslip.io/healthz после запуска` |
| 6 | `infrastructure/scripts/deploy.sh --ip 203.0.113.10` | `https://203-0-113-10.sslip.io/healthz отвечает`, затем `Деплой завершён.` |
| 7 | `infrastructure/scripts/smoke.sh https://203-0-113-10.sslip.io --origin https://platform-it-adis-nmtovk.freebuff.site` | пять `PASS` и `Проверок пройдено: 5, провалено: 0, пропущено: 0`, код возврата 0 |
| 8 | в настройках сайта Freebuff: `API_ORIGIN=https://203-0-113-10.sslip.io` | заявка с лендинга сохраняется, вход в кабинет работает |

Шаг 5 проверяет переменные, порты 80/443 и `docker compose config` без запуска;
шаг 6 дополнительно ждёт TLS-сертификат и `/healthz`. Шаг 7 создаёт одну
настоящую заявку «Smoke test» — это единственное изменение данных; ответ `429`
на `POST /api/leads` тоже считается успехом, потому что лимит 5 заявок за
10 минут с одного IP уже исчерпан.

`--origin` в шаге 7 обязателен для полной проверки: за воркером сайта `Host`
равен sslip-имени, а `Origin` — домену сайта, и именно эта пара решает, увидит
ли лендинг ответ на свою заявку. Скрипт отправляет `POST /api/leads` с этим
`Origin` и требует `Access-Control-Allow-Origin` ровно с этим значением:
отсутствие заголовка и `*` (с `credentials` браузер такой ответ отклонит) —
провал. Без `--origin` проверка печатает `SKIP` и считается в итоговой строке
`пропущено`, а не молча проходит.

Те же проверки deploy-пути выполняет job `infrastructure` в CI на каждый PR:
`shellcheck -x` по `infrastructure/**/*.sh`, `docker compose config -q` с
одноразовым env из фиктивных значений и `caddy validate` для `caddy/Caddyfile`.
Локально они запускаются теми же командами — секретов для них не нужно.

### Деплой без домена: sslip.io

Покупать домен не нужно. `sslip.io` — публичный DNS, встраивающий IP в имя:
хостнейм `203-0-113-10.sslip.io` резолвится в `203.0.113.10`.

1. Откройте на сервере входящие TCP 80 и 443 (и UDP 443 для HTTP/3): порт 80
   нужен Let's Encrypt для ACME HTTP-01 и для редиректа на HTTPS.
2. Замените `203.0.113.10` на публичный IPv4 сервера (в хостнейме — дефисы
   вместо точек) и задайте в `.env.production`:

   ```ini
   PUBLIC_HOSTNAME=203-0-113-10.sslip.io
   ACME_EMAIL=admin@example.com
   APP_ORIGIN=https://203-0-113-10.sslip.io
   ADMIN_WEB_ORIGIN=https://203-0-113-10.sslip.io
   API_PUBLIC_URL=https://203-0-113-10.sslip.io
   PRIMARY_DOMAIN=203-0-113-10.sslip.io
   PLATFORM_DOMAIN=203-0-113-10.sslip.io
   ```

3. Запустите compose из раздела выше. `caddy` получает сертификат сам и
   проксирует трафик на `edge`: TLS, HTTP/2, WebSocket `/socket.io/` и лимит
   тела файла 512 MB уже настроены в `caddy/Caddyfile`.
4. Проверьте: `curl -fsS https://203-0-113-10.sslip.io/healthz`. При смене IP сервера меняется
   только `PUBLIC_HOSTNAME` (и связанные URL) → `docker compose up -d`.

`sslip.io` подходит для тестового и рабочего запуска без своего домена; имя
привязано к IP и не подходит для мобильных приложений с жёстким deep link.
Когда появится домен: добавьте A-запись на этот же IP, замените
`PUBLIC_HOSTNAME`/`*_ORIGIN` на домен и выполните `docker compose up -d` —
Caddy перевыпустит сертификат автоматически. Если TLS завершается облачным
балансировщиком, оставьте его перед `edge` и сделайте `caddy` no-op через
`docker compose ... up -d --scale caddy=0`.

### TLS и проксирование

1. Наружу опубликованы только порты `caddy` (80/443). `edge` — внутренний
   nginx, PostgreSQL, Redis, MinIO и ClamAV портов не публикуют.
2. Caddy включает HSTS, WebSocket upgrade для `/socket.io/` и
   `request_body max_size 512MB`; `edge` проксирует запросы на `admin` и
   `backend` по private network.
3. При внешнем балансировщике перенесите эти правила на него и не публикуйте
   `caddy` (см. выше).
4. Проверьте HTTPS для API, admin и домена каждого филиала; токен филиала
   отклоняется на чужом домене tenant-middleware.

Порядок: `postgres` → `pgbouncer` → `migrate` (`prisma migrate deploy`) →
`backend` → `admin`/`edge` → `caddy`. MinIO создаёт приватный бакет `S3_BUCKET`;
анонимный доступ запрещён. TLS завершается `caddy`, `edge` принимает HTTP
только из private network.

### Антивирус

`ANTIVIRUS_SCAN_URL` в production обязателен по валидации env. Compose поднимает
два контейнера:

- `clamav` (`clamav/clamav:stable`) — clamd на 3310, базы сигнатур в volume
  `clamav_signatures`, freshclam обновляет их при старте (первый старт — минуты,
  `start_period` healthcheck 300 s);
- `antivirus` (`node:24-alpine` + `clamav/rest.mjs`) — HTTP API для backend:
  `POST /scan` с сырым телом файла → `{"clean":true}` или
  `{"clean":false,"reason":"..."}`, `GET /healthz` проверяет clamd.

Backend ждёт `antivirus` здоровым и отправляет файлы на
`http://antivirus:8080/scan` (`ANTIVIRUS_PROVIDER=clamav`). Если задан
`ANTIVIRUS_API_KEY`, обёртка требует заголовок `X-API-Key` — backend отправляет
его автоматически. Внешний сканер (Cloudmersive/MetaDefender) подключается
сменой `ANTIVIRUS_SCAN_URL` и `ANTIVIRUS_PROVIDER`.

Проверка после запуска:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec antivirus \
  node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>r.text()).then(console.log)"
```

Ответ `{"status":"ok"}` означает, что обёртка видит clamd. Затем загрузите
тестовый EICAR-файл через админку: загрузка должна быть отклонена с причиной
«Обнаружено: …»; чистый файл проходит со статусом `EXTERNAL` в аудите.

### CD по тегу

`.github/workflows/release.yml` собирает образы API/admin и публикует их в GHCR.
Для автоматического деплоя добавьте в GitHub Environment `production`:
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (публичный
ключ сервера, чтобы не использовать TOFU), `DEPLOY_PATH` и при необходимости
`DEPLOY_PORT`. Сервер должен быть заранее авторизован в GHCR (`docker login ghcr.io`)
и содержать `.env.production`. Без `DEPLOY_*` job деплоя пропускается, образы
всё равно публикуются.

`DEPLOY_PATH` — рабочая копия репозитория: `docker-compose.prod.yml`,
`infrastructure/caddy/Caddyfile` и `infrastructure/clamav/rest.mjs` читаются
с диска, а не из образов. Перед деплоем обновите копию (`git pull`), иначе
`caddy` и `antivirus` получат устаревшие конфиги или не найдут файлы.

## Масштабирование до 10 000 онлайн

10 000 онлайн — это 10 000 HTTP/WebSocket-клиентов, а не 10 000 соединений
PostgreSQL. Схема: `client → nginx → backend replicas → PgBouncer → postgres`.

- Nginx: `worker_connections 32768`, `worker_rlimit_nofile 65536`; WebSocket
  проксируется без буферизации (`/socket.io/`).
- Backend: `nofile 65536`; несколько реплик работают через общий Redis adapter
  Socket.IO. Без `REDIS_URL` сокеты работают только внутри одного процесса.
- PgBouncer: transaction mode, `max_client_conn=20000`, `default_pool_size=30`
  на пару пользователь/БД, `max_db_connections=30`. Клиентские соединения
  реплик мультиплексируются, PostgreSQL видит десятки соединений на филиал.
- PostgreSQL: `max_connections=400`, `shared_buffers=1GB`, `shm_size=2GB`,
  `effective_cache_size=3GB`, `idle_in_transaction_session_timeout=30s`.
- Prisma: `connection_limit=10` на один `PrismaClient` в процессе. Суммарно
  это `реплики × (2 + число филиалов) × 10` клиентских соединений к PgBouncer;
  это нормально, пока сумма ниже `PGBOUNCER_MAX_CLIENT_CONN`.
- `DIRECT_DATABASE_URL` обязателен в production: миграции, `pg_dump`,
  `pg_restore` и провижининг филиалов идут напрямую в PostgreSQL, не через
  transaction pooler.

Формула запаса PostgreSQL: `число активных БД × PGBOUNCER_DEFAULT_POOL_SIZE`
должно быть меньше `POSTGRES_MAX_CONNECTIONS` с запасом на администратора и
мониторинг. При 10 филиалах это около 300 из 400. Если филиалов больше,
уменьшите пул или поднимите `POSTGRES_MAX_CONNECTIONS` и память сервера.

Проверка после запуска:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec pgbouncer \
  sh -c 'PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -p 5432 -U "$DB_USER" pgbouncer -c "SHOW POOLS;"'
```

Перед production обязательно прогоните нагрузочный тест на реальном железе:
10 000 одновременных WebSocket-подключений и профиль типичных запросов. Эти
настройки задают безопасные пределы, но не заменяют измерение CPU, IOPS и
задержек PostgreSQL. Если используется PgBouncer старше 1.21, добавьте
`?pgbouncer=true` к `DATABASE_URL`; в образе 1.24 подготовленные выражения
включены через `MAX_PREPARED_STATEMENTS`.

## Базы данных филиалов

- `Branch` в управляющей БД содержит домен, имя БД, `storagePrefix`.
- Пользователь БД должен иметь право `CREATEDB` для провижининга.
- Все изменения схемы — только Prisma-миграции (`prisma migrate deploy`).
  В production запускайте их с прямым URL:
  `DATABASE_URL="$DIRECT_DATABASE_URL" npx prisma migrate deploy`.
- Новый филиал получает отдельную БД, каталог `storage/branches/{slug}` и
  S3-префикс `branches/{slug}/library`.
- Токен филиала не действует на другом домене (проверка в tenant middleware).
- Ошибку создания можно повторить: `POST /api/platform/branches/:id/retry`.
- `PRIMARY_DOMAIN` привязывает основной филиал к production-домену; без него
  при `ALLOW_PRIMARY_FALLBACK=false` основной сайт отвечает 404.

## Файловое облако

- S3-совместимое хранилище; ключи `branches/{slug}/library/...`.
- Без S3 используется `STORAGE_DIR`, который **не** отдаётся статикой.
- Скачивание только через `/api/files/:id/download` с проверкой роли/владельца.
- Лимит файла и квота — поля `Branch`; настраиваются администратором филиала.
- MIME-allowlist, проверка сигнатур, SHA-256, EICAR/PE/ELF/Mach-O, опционально
  внешний антивирус (`ANTIVIRUS_SCAN_URL`).
- История операций — `FileAuditLog` (UPLOAD/DOWNLOAD/UPDATE/DELETE).

## Резервное копирование

- Планировщик в backend включается `BACKUP_SCHEDULER_ENABLED=true`.
- По умолчанию БД копируется ежедневно; частота/срок хранения/файлы — поля
  `Branch` (`backupFrequencyHours`, `backupRetentionDays`, `backupIncludeFiles`).
- БД: `pg_dump --format=custom`; файлы: `tar.gz` каталога uploads и библиотеки.
- Каждая копия получает SHA-256; целостность проверяется `pg_restore --list`
  или `tar -tzf`, результат — `verifiedAt`.
- Retention удаляет старые файлы копий (и объекты S3), записи истории остаются.
- `BACKUP_DIR` должен быть на отдельном volume; S3-копии — в приватном бакете.

## Восстановление

Автоматического восстановления нет. Процедура:

1. `POST /api/backups/restores` — обнаружение проблемы, проверка копий и план.
2. Администратор проверяет план и вводит `RESTORE {slug}` + step-up токен:
   `POST /api/backups/restores/:id/approve`.
3. Отдельным действием `POST /api/backups/restores/:id/execute` запускается
   `pg_restore --clean --if-exists` и/или распаковка файлов.
4. После восстановления проверяются БД и файлы, формируется `report`.
5. Статусы: `AWAITING_APPROVAL → APPROVED → RUNNING → VERIFIED/FAILED`.

На время восстановления остановите другие реплики backend: `pg_restore`
требует освободить соединения. Для primary demo управляющая БД совпадает с
восстанавливаемой; в production используйте отдельный `CONTROL_DATABASE_URL`.
Перед production-restore сделайте свежую копию и проверьте её.

## Мониторинг и логи

- `/healthz` — БД, Redis, storage driver, scheduler.
- `/metrics` — Prometheus: uptime, память, HTTP-запросы/ошибки/задержки.
- Алерты Prometheus — `monitoring/alerts.yml`; дополнительно backend отправляет
  события 5xx, ошибок backup и integrity в `ALERT_WEBHOOK_URL`.
- Логи контейнеров: json-file, 50 MB × 7. Для долгого хранения подключите
  Loki/ELK и не пишите токены, пароли и содержимое файлов.
- Резервные копии и S3 monitoring: проверяйте `lastBackupStatus`, `verifiedAt`,
  свободное место volume и алерт `ItadisApiDown`.

## Чек-лист перед публикацией

- [ ] Секреты ≥ 32 символов, разные для JWT/refresh/encryption.
- [ ] `APP_ORIGIN` и `ADMIN_WEB_ORIGIN` — точные HTTPS-origin.
- [ ] PostgreSQL/Redis/MinIO недоступны из интернета.
- [ ] `PUBLIC_HOSTNAME` указывает на реальный IP, порты 80/443 открыты.
- [ ] TLS/HSTS, WebSocket upgrade, `client_max_body_size`.
- [ ] `antivirus` и `clamav` в статусе healthy, загрузка EICAR отклоняется.
- [ ] `prisma migrate deploy` выполнен; демо-данные отсутствуют.
- [ ] `BACKUP_SCHEDULER_ENABLED=true`, `BACKUP_DIR` на отдельном volume.
- [ ] Проверено восстановление тестового филиала и целостность копий.
- [ ] Prometheus scrape и ALERT_WEBHOOK_URL проверены.
- [ ] Мобильные `eas.json`/`app.json`, push и deep linking настроены.
