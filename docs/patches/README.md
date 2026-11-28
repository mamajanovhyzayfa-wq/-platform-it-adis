# Патчи хардненинга

## `0002-audit-fixes.patch` — весь аудит 2026-11-27

Один коммит со всеми изменениями ветки `audit/full-analysis-2026-11-27`
(поверх `main`): IDOR на вложениях и короткие file-токены, D-1/D-2 (FK-правила
`ON DELETE`, 79 индексов, частичный уникальный индекс PENDING), F-2/F-3
(ссылки на сертификаты, 400 на пустой файл), S-1/S-2/S-5/S-6/S-7/S-8
(ACL, NUL-байт, санитизация заявок, закрытые `/docs` и `/metrics`, IP в
access-логе, общий формат ошибки JSON), C-1 (мёртвый код, зависимости, CSS)
и P-1 (code splitting кабинета).

```bash
git checkout main
git am docs/patches/0002-audit-fixes.patch
```

Проверка перед PR: `git apply --check` не подходит для mbox-патча — используйте
`git am` в одноразовой ветке, как показано выше.

## `0001-hardening-phase-1.patch`

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
- `apps/api/package-lock.json` — пересобран отдельно от workspace. Он отставал
  от `package.json` (`nodemailer` 7.0.13 вместо `^10.6.1`, `prisma`/`@prisma/client`
  `^6.16.0` вместо `^6.19.3`). В job'ах `npm ci` идёт по корневому lockfile и этого
  не видит, а образ `backend` собирается только из `apps/api` и падал с
  `npm error code EUSAGE` на шаге `RUN npm ci` (`full-stack-e2e`, «Собрать
  образы»). Новый шаг job'а `backend` ставит только манифесты `apps/api` во
  временном каталоге — ровно так же, как это делает Docker.
- `infrastructure/ci/run-annotated.sh` — шаг CI, упав, публикует хвост вывода
  аннотацией check-run'а (её читает `GET /check-runs/{id}/annotations`), потому
  что скачивание логов job'а требует прав администратора репозитория. Обёрнуты
  «Скачать образы» и «Собрать образы», а «Поднять стек» печатает аннотацией
  состояние сервисов при неудачном `compose up`.
- `infrastructure/ci/docker-compose.ci.yml` — публикует `edge` на 8080, не
  поднимает Caddy (в CI нет публичного домена для ACME) и выключает планировщик
  резервных копий: job проверяет стек, а не фоновый pg_dump и выгрузку в S3.
- `docker-compose.prod.yml` — S3-хранилище на `pgsty/silo` (поддерживаемый форк
  MinIO) вместо удалённых с Docker Hub в сентябре 2026 `minio/minio` и
  `minio/mc`; healthcheck ClamAV — штатный `clamdcheck.sh` из образа.
- `infrastructure/tests/deploy.bats` — 11 проверок preflight без Docker и сети.
- `.github/workflows/ci.yml` — шаг «Фактический хеш администратора из БД не
  попадает в логи» грепает буквальное значение `passwordHash` из таблицы (а не
  шаблон `$2[aby]$`), и шаг резервного копирования/восстановления
  (`pg_dump` + `pg_restore --clean --if-exists --single-transaction
  --exit-on-error` в отдельную БД) в `full-stack-e2e`.
- `.oxlintrc.json` — подключён плагин `typescript`, включены
  `no-explicit-any` и `no-floating-promises`; найденные нарушения исправлены
  типами в `apps/web/src/pages/AiCenter.tsx` и
  `apps/api/test/admin-routes.test.ts`.
- `.github/workflows/production-health.yml` — живая проверка опубликованного
  сайта: `/api/healthz`, `POST /api/auth/password/request`, лендинг и кабинет.
  Ловит `503 API_NOT_CONFIGURED`, когда у сайта не задан `API_ORIGIN`.
- `infrastructure/README.md` — копии файлов S3/MinIO через `mc mirror` /
  `rclone sync` вместо `tar.gz` бакета, а в разделах запуска и восстановления -
  блоки «Ожидаемо» с тем, что печатают шаги CI.

## Ограничения

Job `full-stack-e2e` поднимает настоящие ClamAV/PgBouncer/S3-хранилище, поэтому
он идёт 20–40 минут и зависит от сети runner-а (сборка образов и, при первом
запуске, обновление сигнатур freshclam). Ожидание `/healthz` — до 30 минут,
лимит job — 60 минут.
Патч не деплоит ничего и не меняет `main`: ветка `fix/hardening-2026-11-26`
готова к PR.

Опубликованный сайт `https://platform-it-adis-nmtovk.freebuff.site` остаётся
без API, пока сервер не развёрнут: `203.0.113.10` в документации — адрес из
TEST-NET-3, а `.deploy/render.key` пуст. Пока `API_ORIGIN` не задан, воркер
возвращает `503 API_NOT_CONFIGURED`, и именно это показывает
`production-health.yml`. Порядок: `infrastructure/README.md`, «Чек-лист
первого запуска», шаги 5–8.
