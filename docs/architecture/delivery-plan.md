# Порядок выполнения и статус этапов

Проект собирался поэтапно: сначала архитектура и основа, затем модули,
интеграции, мобильные приложения, тестирование и развёртывание. Ниже — карта
этапов и артефактов, чтобы изменение можно было проверить, не читая всю
историю.

## Этап A. Архитектура

| Шаг | Артефакт |
|---|---|
| Архитектура и слои | `docs/architecture/overview.md`, `docs/architecture/monorepo.md` |
| Связи модулей | `docs/api/modules.md`, `apps/api/src/modules/README.md` |
| Структура проекта | `apps/*`, `packages/*`, `infrastructure/*` |
| Модели БД и ER | `apps/api/prisma/schema.prisma`, `docs/database/schema.md` |
| API | `docs/api/endpoints.md`, `apps/api/src/docs/openapi.ts`, Swagger `/docs` |
| Изоляция филиалов | `docs/architecture/overview.md`, `lib/tenant*.ts`, `docs/testing/strategy.md` |
| Интеграции | `docs/integrations/README.md`, `apps/api/src/integrations` |

## Этап B. Основа проекта

| Шаг | Артефакт |
|---|---|
| Монорепозиторий | `package.json` (workspaces), `apps/api`, `apps/web`, `apps/mobile` |
| Frontend | `apps/web`, `packages/{shared-types,validation,api-client,ui,config}` |
| Backend | `apps/api` (Nest + Express-роутеры, `legacy-routers.ts`) |
| PostgreSQL и миграции | `apps/api/prisma`, `docker-compose.yml` |
| Redis | `lib/redis.ts`, `REDIS_URL` в `.env.example` |
| Docker | `apps/api/Dockerfile`, `apps/web/Dockerfile`, `infrastructure/docker` |
| Переменные окружения | `apps/api/.env.example` |
| Авторизация, роли, филиалы | `modules/auth`, `nest/rbac`, `modules/branches`, `lib/tenant*` |

## Этап C. Основные модули

41 модуль из `docs/api/modules.md`. Канонические модули с записью — Nest или
Express; read-модели строятся общим `modules/read-model` и не дублируют
бизнес-правила. Каждый модуль подключён к БД, API и интерфейсу там, где это
предусмотрено ТЗ.

## Этап D. Интеграции

`apps/api/src/integrations`: LiveDigital, Google, Apple, email, SMS, push,
Google Calendar, Apple Calendar, Outlook, FreedomPay и Elsom, бухгалтерия,
AI-провайдер, S3. У каждого адаптера — конфигурация, проверка доступности,
повторы, журнал и безопасное хранение секретов. Подробности и таблица
переменных — `docs/integrations/README.md`.

## Этап E. Мобильные приложения

`apps/mobile` (Expo/React Native) использует общий backend и пакеты
`shared-types`, `validation`, `api-client`. Сборка — EAS, см. README.

## Этап F. Тестирование

См. `docs/testing/strategy.md`: unit, контрактные, интеграционные, HTTP/API,
e2e-сценарии на стенде, проверки RBAC и изоляции филиалов (HTTP и WebSocket).

## Этап G. Развёртывание

`docker-compose.prod.yml`, `.env.production.example`, `infrastructure/deployment`,
`infrastructure/monitoring`, `.github/workflows/ci.yml` и `release.yml`,
`docs/deployment/development.md`. Резервное копирование — `modules/backups`,
планировщик `BACKUP_SCHEDULER_ENABLED`.

Production-шаблон содержит все серверные ключи, которые получает контейнер API,
включая обязательные `ANTIVIRUS_SCAN_URL`, `DATA_ENCRYPTION_KEY` и домены.
TLS завершается балансировщиком; `edge` работает только внутри private network.
WebSocket `/socket.io/` проксируется через `admin`/`edge` без буферизации.

Итоговая матрица 30 систем и честные ограничения — в [`final-result.md`](final-result.md).

## Что требует внешних сервисов

- Ключи провайдеров (LiveDigital, платёжные системы, Google/Apple, календари,
  бухгалтерия, AI, S3) задаются только на сервере. Без них адаптер сообщает
  `not_configured`, а доменный маршрут — `503`.
- Миграция `20261120140000_integration_adapters` применяется
  `npx prisma migrate deploy` на стенде с PostgreSQL.
- E2E-сценарии запускаются против работающего API и БД. В CI job `e2e`
  автоматически применяет миграции, seed, поднимает API и выполняет все
  9 сценариев; локально без `E2E_BASE_URL` они пропускаются.

## Проверки на 22.11.2026

| Проверка | Результат |
|---|---|
| `npm --prefix apps/api run typecheck` | ✔ без ошибок |
| `npm --prefix apps/api test` | ✔ 263 passed, 9 skipped; 33 файла |
| `npm --prefix apps/mobile test` | ✔ 20 passed; `tsc --noEmit` без ошибок |
| `npm --prefix apps/web run build` | ✔ typecheck + Vite build |
| `docker compose --env-file ... -f docker-compose.prod.yml config` | ✔ конфигурация валидна (с тестовыми значениями) |
| E2E с PostgreSQL/Redis | ⏳ локально пропущены; выполняются в CI job `e2e` |
| Native Android/iOS build, EAS submit | ⏳ требуют EAS-аккаунта и подписи |
| Живые интеграции | ⏳ требуют ключей провайдеров |
