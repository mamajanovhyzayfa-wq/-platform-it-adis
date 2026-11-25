# Deployment

Production запускается из корня репозитория одним compose-файлом. Подробная
топология, лимиты и чек-лист — в [`../README.md`](../README.md).

## 1. Подготовка окружения

```bash
cp .env.production.example .env.production
# заполните домены, пароли и ключи; файл не коммитится
```

Обязательны `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`DATA_ENCRYPTION_KEY`, `APP_ORIGIN`, `PUBLIC_HOSTNAME`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`. `ANTIVIRUS_SCAN_URL` уже указывает на контейнер ClamAV из
compose; вручную его задают только для внешнего сканера. Для филиалов —
`PRIMARY_DOMAIN`, `PLATFORM_DOMAIN` и пароль или bcrypt-хеш платформенного
администратора. Все внешние адаптеры получают
ключи из этого же файла; без ключей они работают в режиме `not_configured`.

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
