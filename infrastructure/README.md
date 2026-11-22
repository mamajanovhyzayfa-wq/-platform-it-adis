# Infrastructure

Актуальная инфраструктура ITadis: локальная разработка, production-топология,
файловое облако, резервное копирование и наблюдаемость.

## Файлы

| Файл | Назначение |
| --- | --- |
| `../docker-compose.yml` | Локально: PostgreSQL 16, Redis 7, backend |
| `../docker-compose.prod.yml` | Production: PostgreSQL, PgBouncer, Redis, MinIO, backend, admin, nginx, Prometheus |
| `../apps/api/Dockerfile` | Backend + `pg_dump`/`pg_restore` для backup/restore |
| `../apps/web/Dockerfile` | Сборка SPA и nginx-контейнер |
| `nginx/nginx.conf` | Общий конфиг Nginx: 32k соединений на worker, nofile 65k |
| `nginx/admin.conf` | SPA, `/api`, `/socket.io`, `/uploads` |
| `nginx/edge.conf` | Внешний вход, прокси на admin/backend |
| `monitoring/prometheus.yml` | Scrape `/metrics` |
| `monitoring/alerts.yml` | Алерты: API down, рост 5xx, перезапуск процесса |
| `../.env.production.example` | Полный шаблон production-переменных (домены, секреты, интеграции) |
| `../.github/workflows/ci.yml` | CI: миграции, тесты API, e2e, сборка admin, typecheck mobile |
| `../.github/workflows/release.yml` | Release: образы API/admin в GHCR и CD по тегу при заданных `DEPLOY_*` |

## Окружения

| Окружение | Назначение | Конфигурация |
| --- | --- | --- |
| development | локальная разработка | `docker-compose.yml`, `.env` |
| test | CI и приёмка | сервисы CI, отдельные `DATABASE_URL`/`REDIS_URL` |
| production | боевой сервер | `docker-compose.prod.yml`, `.env.production` |

В production обязательны: `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY`, `APP_ORIGIN`,
`ANTIVIRUS_SCAN_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
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
ломают запуск. `ANTIVIRUS_SCAN_URL` и production-секреты обязательны: compose
падает до старта, если они не заданы.

### Домены и TLS

1. Направьте A/AAAA-записи основного домена, `PLATFORM_DOMAIN` и доменов
   филиалов на балансировщик или внешний nginx.
2. TLS-сертификат (Let's Encrypt/ACL) устанавливается на балансировщике;
   `edge` принимает HTTP только из private network и не публикует PostgreSQL,
   Redis или MinIO.
3. На балансировщике включите WebSocket upgrade для `/socket.io/`, HSTS и
   перенаправление HTTP → HTTPS. `client_max_body_size` — не меньше 512 MB.
4. Проверьте HTTPS для API, admin и домена каждого филиала; токен филиала
   отклоняется на чужом домене tenant-middleware.

Порядок: `postgres` → `pgbouncer` → `migrate` (`prisma migrate deploy`) →
`backend` → `admin`/`edge`. MinIO создаёт приватный бакет `S3_BUCKET`;
анонимный доступ запрещён. TLS завершается облачным балансировщиком или
внешним nginx; `edge` принимает HTTP только из private network.

### CD по тегу

`.github/workflows/release.yml` собирает образы API/admin и публикует их в GHCR.
Для автоматического деплоя добавьте в GitHub Environment `production`:
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (публичный
ключ сервера, чтобы не использовать TOFU), `DEPLOY_PATH` и при необходимости
`DEPLOY_PORT`. Сервер должен быть заранее авторизован в GHCR (`docker login ghcr.io`)
и содержать `.env.production`. Без `DEPLOY_*` job деплоя пропускается, образы
всё равно публикуются.

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
- [ ] TLS/HSTS, WebSocket upgrade, `client_max_body_size`.
- [ ] `prisma migrate deploy` выполнен; демо-данные отсутствуют.
- [ ] `BACKUP_SCHEDULER_ENABLED=true`, `BACKUP_DIR` на отдельном volume.
- [ ] Проверено восстановление тестового филиала и целостность копий.
- [ ] Prometheus scrape и ALERT_WEBHOOK_URL проверены.
- [ ] Мобильные `eas.json`/`app.json`, push и deep linking настроены.
