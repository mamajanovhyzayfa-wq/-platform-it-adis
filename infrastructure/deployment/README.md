# Deployment

Production запускается из корня репозитория одним compose-файлом. Подробная
топология, лимиты и чек-лист — в [`../README.md`](../README.md).

## 1. Подготовка окружения

```bash
cp .env.production.example .env.production
# заполните домены, пароли и ключи; файл не коммитится
```

Обязательных переменных для первого запуска — **восемь** (тот же список
проверяет `infrastructure/scripts/deploy.sh` в массиве `REQUIRED_VARS`):

| Переменная | Откуда взять | Если пусто |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | compose падает: `:?set POSTGRES_PASSWORD` |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` | backend не стартует (production-валидация `< 32` символов) |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` | backend не стартует |
| `DATA_ENCRYPTION_KEY` | `openssl rand -hex 32`, отличается от `JWT_ACCESS_SECRET` | backend не стартует |
| `APP_ORIGIN` | `https://<PUBLIC_HOSTNAME>` | compose падает; без `https` backend не стартует |
| `S3_ACCESS_KEY` | `openssl rand -hex 16` | compose падает, MinIO не стартует |
| `S3_SECRET_KEY` | `openssl rand -hex 24` | compose падает, MinIO не стартует |
| `ACME_EMAIL` | рабочий email | Caddy не выпустит сертификат |

Девятая обязательная величина — `PUBLIC_HOSTNAME`: её не заполняют руками,
`deploy.sh --ip` считает её из IP и записывает в `.env.production` (compose
требует её через `:?`).

Восемь — это минимум, чтобы стек поднялся. Для входа в кабинет нужен ещё
администратор: `PLATFORM_ADMIN_EMAIL` и `PLATFORM_ADMIN_PASSWORD` (не короче
12 символов) либо `PLATFORM_ADMIN_PASSWORD_HASH`; его создаёт сервис
`bootstrap` (см. §7). `ANTIVIRUS_SCAN_URL` уже указывает на контейнер ClamAV
из compose; вручную его задают только для внешнего сканера. Для филиалов —
`PRIMARY_DOMAIN`, `PLATFORM_DOMAIN`. Все внешние адаптеры получают ключи из
этого же файла; без ключей они работают в режиме `not_configured`.

## 2. Запуск

Одной командой — скрипт сам посчитает `PUBLIC_HOSTNAME` из IP сервера,
проверит переменные и порты 80/443, поднимет compose и дождётся `/healthz`:

```bash
infrastructure/scripts/deploy.sh --ip 203.0.113.10
infrastructure/scripts/deploy.sh --check   # только preflight, без запуска
```

Эквивалент вручную:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml --profile monitoring up -d
```

Порядок: `postgres` → `pgbouncer` → `migrate` (`prisma migrate deploy`) →
`backend` → `admin`/`edge`. MinIO создаёт приватный бакет `S3_BUCKET`;
`storage_data` и `uploads_data` — постоянные volume, поэтому файлы и записи
не теряются при пересоздании контейнера.

## 3. Домены и TLS

- Без своего домена используйте sslip.io: для сервера `203.0.113.10`
  `PUBLIC_HOSTNAME=203-0-113-10.sslip.io` (дефисы вместо точек), а
  `APP_ORIGIN`/`ADMIN_WEB_ORIGIN`/`API_PUBLIC_URL`/`PRIMARY_DOMAIN`/
  `PLATFORM_DOMAIN` — `https://203-0-113-10.sslip.io`.
- Откройте TCP 80 и 443 (и UDP 443): Caddy из compose сам получает
  сертификат Let's Encrypt и проксирует на внутренний `edge`.
- WebSocket upgrade для `/socket.io/`, HSTS и HTTP → HTTPS уже включены в
  `infrastructure/caddy/Caddyfile`, лимит тела — 512 MB.
- С внешним балансировщиком TLS переносится на него, а `caddy` не запускается;
  PostgreSQL, Redis, MinIO и ClamAV портов наружу не публикуют.

### Антивирус

Compose поднимает `clamav` и HTTP-обёртку `antivirus`; backend ждёт её
healthy и отправляет файлы на `http://antivirus:8080/scan`. Первый старт
скачивает базы сигнатур — до нескольких минут.

## 4. Проверка антивируса

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec antivirus \
  node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>r.text()).then(console.log)"
```

Ожидается `{"status":"ok"}`. Загрузка EICAR-файла через админку должна быть
отклонена.

## 5. Проверка после запуска

```bash
curl -fsS https://app.example.com/healthz
curl -fsS https://app.example.com/metrics | head
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Проверьте вход администратора, `/api/integrations`, создание тестового филиала
и восстановление резервной копии по процедуре из `infrastructure/README.md`.

## 6. CI/CD и откат

- `.github/workflows/ci.yml` — миграции, тесты API, e2e с PostgreSQL/Redis,
  сборка admin и typecheck mobile.
- `.github/workflows/release.yml` — образы API/admin в GHCR и SSH-деплой по
  тегу при заданных `DEPLOY_*` в GitHub Environment `production`.
  `DEPLOY_PATH` — checkout репозитория: compose и конфиги `caddy`/`antivirus`
  монтируются с диска, поэтому перед деплоем обновите его (`git pull`).
- Откат — предыдущий тег образа. Миграции автоматически не откатываются:
  сначала проверьте совместимость и сделайте свежую копию БД.

## 7. Администратор основной БД (сервис `bootstrap`)

Сервис `bootstrap` в `docker-compose.prod.yml` — одноразовый шаг того же
образа, что `backend`. Он запускает `node dist/src/bootstrap.js` (собранный
`tsc` код, без `tsx` и без `scripts/` в образе) после `postgres` и `migrate`,
с `restart: "no"`.

Что делает:

- создаёт каталог ролей и прав (`bootstrapRbac`), потому что `User.role`
  ссылается на `Role.code`, а миграции строк в `Role` не вставляют;
- создаёт или обновляет пользователя `PLATFORM_ADMIN_EMAIL` с ролью `ADMIN`;
- использует `PLATFORM_ADMIN_PASSWORD_HASH`, если он задан, иначе
  `PLATFORM_ADMIN_PASSWORD`; значение, начинающееся с `$2a$`/`$2b$`/`$2y$`,
  считается готовым bcrypt-хешем и повторно не хешируется;
- пишет в лог только email, роль и факт изменения — пароль и хеш не логируются.

Идемпотентность:

- повторный запуск с тем же паролем → `unchanged`, строка пользователя не
  перезаписывается (bcrypt-хеш сравнивается через `bcrypt.compare`);
- смена `PLATFORM_ADMIN_PASSWORD` в `.env.production` → следующий
  `docker compose ... up -d` обновляет хеш (`password-updated`);
- в `.env.production` символы `$` в bcrypt-хеше нужно удваивать
  (`$$2b$$...`), иначе compose подставит их как переменные.

```bash
# что произошло при последнем запуске
docker compose --env-file .env.production -f docker-compose.prod.yml logs bootstrap
# повторить вручную после правки пароля
docker compose --env-file .env.production -f docker-compose.prod.yml up -d bootstrap
```

Если `PLATFORM_ADMIN_EMAIL` не задан, шаг пропускается с предупреждением в
логе (код 0). Если email задан, а пароля и хеша нет — шаг завершается с
кодом 1: это незаконченная настройка, а не норма.

## 8. Эксплуатация

### Резервные копии

Приложение делает их само (`BACKUP_SCHEDULER_ENABLED=true`, каталог
`/data/backups` в volume `backup_data`): `pg_dump --format=custom` для каждой
БД филиала плюс `tar.gz` файлов, с контрольной суммой и проверкой
`pg_restore --list`. Ручная копия основной БД — с хоста, прямым подключением
(не через PgBouncer):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U itadis -Fc itadis > /var/backups/itadis-$(date +%F).dump
docker run --rm -v itadis_minio_data:/data -v /var/backups:/backup alpine \
  tar czf /backup/minio-$(date +%F).tar.gz -C /data .
```

Восстановление: остановить `backend`, затем
`pg_restore --clean --if-exists -U itadis -d itadis /var/backups/<файл>.dump`
и распаковать архив MinIO. Копии — на другой хост: локальный диск не спасает
от потери сервера.

### Доступ к серверу

- отдельный пользователь `deploy` в группе `docker` вместо `root`; вход по
  ключу, `PasswordAuthentication no`;
- `fail2ban` на `sshd`;
- SSH и панели — только с известных IP (`ufw allow from <IP> to any port 22`);
  наружу открыты лишь 80/tcp, 443/tcp, 443/udp.

### Пароль администратора без SMTP

Сброса пароля по email нет (§9), поэтому единственный способ ротации —
сменить `PLATFORM_ADMIN_PASSWORD` в `.env.production` и повторить
`up -d bootstrap`.

## 9. Ограничение: сброс пароля без SMTP

Пользовательский reset-flow требует отправки письма (`SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`). Пока SMTP не настроен, письма не
уходят, и пользователь не может восстановить пароль самостоятельно.
`bootstrap` — это создание/ротация администратора, а не замена reset-flow:
он не выдаёт ссылок, не знает паролей пользователей и не должен
использоваться как «сброс для всех».
