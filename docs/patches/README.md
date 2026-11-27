# Патчи хардненинга

Изменения Phase 1 собраны в `0001-hardening-phase-1.patch` — его можно
применить к `main` без доступа к GitHub:

```bash
git checkout main
git am docs/patches/0001-hardening-phase-1.patch
```

Если патч не применяется из-за локальных изменений, проверьте их тем же
набором команд, что и CI:

```bash
cd apps/api && npm ci && npx prisma generate && npm run build && npm test
bats infrastructure/tests/deploy.bats   # apt: bats

# пять сценариев bootstrap на реальном PostgreSQL
DATABASE_URL=postgresql://itadis:itadis@127.0.0.1:5432/itadis?schema=public \
  bash apps/api/scripts/ci-bootstrap-postgres.sh
```

## Что в патче

- `apps/api/src/lib/bootstrap-admin.ts` — cost factor bcrypt ограничен
  диапазоном 04–31 (`isBcryptHash`), существующий не-ADMIN пользователь больше
  не повышается до ADMIN молча: bootstrap падает с объяснением и не меняет
  роль, пароль и `isActive`.
- `apps/api/test/bootstrap-admin.test.ts` — границы cost 03/04/31/32 и отказ
  повышать `STUDENT`.
- `apps/api/scripts/ci-bootstrap-postgres.sh` — пять сценариев на реальном
  PostgreSQL с SQL-проверками до/после (создание, идемпотентность, ротация
  пароля, отказ не-ADMIN, готовый хеш и отклонение cost вне 04–31).
- `.github/workflows/ci.yml` — jobs `bootstrap-postgres` и `full-stack-e2e`
  (production compose, smoke через edge, ошибки в логах), шаг `bats` для
  preflight `deploy.sh`.
- `infrastructure/ci/docker-compose.ci.yml` — публикует `edge` на 8080, не
  поднимает Caddy (в CI нет публичного домена для ACME) и выключает планировщик
  резервных копий: job проверяет стек, а не фоновый pg_dump и выгрузку в S3.
- `docker-compose.prod.yml` — S3-хранилище на `pgsty/silo` (поддерживаемый форк
  MinIO) вместо удалённых с Docker Hub в сентябре 2026 `minio/minio` и
  `minio/mc`; healthcheck ClamAV — штатный `clamdcheck.sh` из образа.
- `infrastructure/tests/deploy.bats` — 11 проверок preflight без Docker и сети.

## Ограничения

Job `full-stack-e2e` поднимает настоящие ClamAV/PgBouncer/S3-хранилище, поэтому
он идёт 20–40 минут и зависит от сети runner-а (сборка образов и, при первом
запуске, обновление сигнатур freshclam). Ожидание `/healthz` — до 30 минут,
лимит job — 60 минут.
Патч не деплоит ничего и не меняет `main`: ветка `fix/hardening-2026-11-26`
готова к PR.
