# Deployment

Production запускается из корня репозитория одним compose-файлом. Подробная
топология, лимиты и чек-лист — в [`../README.md`](../README.md).

## 1. Подготовка окружения

```bash
cp .env.production.example .env.production
# заполните домены, пароли и ключи; файл не коммитится
```

Обязательны `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`DATA_ENCRYPTION_KEY`, `APP_ORIGIN`, `ANTIVIRUS_SCAN_URL`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`. Для филиалов — `PRIMARY_DOMAIN`, `PLATFORM_DOMAIN` и пароль
или bcrypt-хеш платформенного администратора. Все внешние адаптеры получают
ключи из этого же файла; без ключей они работают в режиме `not_configured`.

## 2. Запуск

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml --profile monitoring up -d
```

Порядок: `postgres` → `pgbouncer` → `migrate` (`prisma migrate deploy`) →
`backend` → `admin`/`edge`. MinIO создаёт приватный бакет `S3_BUCKET`;
`storage_data` и `uploads_data` — постоянные volume, поэтому файлы и записи
не теряются при пересоздании контейнера.

## 3. Домены и TLS

- A/AAAA-записи основного домена, `PLATFORM_DOMAIN` и доменов филиалов ведут
  на балансировщик или внешний nginx.
- TLS-сертификат устанавливается на балансировщике; `edge` принимает HTTP
  только из private network.
- Включите WebSocket upgrade для `/socket.io/`, HSTS, HTTP → HTTPS и
  `client_max_body_size` не меньше 512 MB.
- PostgreSQL, Redis и MinIO не публикуют порты наружу.

## 4. Проверка после запуска

```bash
curl -fsS https://app.example.com/healthz
curl -fsS https://app.example.com/metrics | head
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Проверьте вход администратора, `/api/integrations`, создание тестового филиала
и восстановление резервной копии по процедуре из `infrastructure/README.md`.

## 5. CI/CD и откат

- `.github/workflows/ci.yml` — миграции, тесты API, e2e с PostgreSQL/Redis,
  сборка admin и typecheck mobile.
- `.github/workflows/release.yml` — образы API/admin в GHCR и SSH-деплой по
  тегу при заданных `DEPLOY_*` в GitHub Environment `production`.
- Откат — предыдущий тег образа. Миграции автоматически не откатываются:
  сначала проверьте совместимость и сделайте свежую копию БД.
