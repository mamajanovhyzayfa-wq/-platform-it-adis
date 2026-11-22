# Тестирование и контроль качества

Пирамида тестов живёт в `apps/api/test`. Запуск: `npm test` (unit,
интеграционные, контрактные и HTTP-проверки) и `npm run test:e2e` (сценарии
против запущенного стенда). Конфигурация — `apps/api/vitest.config.ts`:
тестовые каталоги вынесены в `test/.tmp`, внешние переменные не влияют на
результат.

| Уровень | Файлы | Что проверяет |
|---|---|---|
| Unit | `security.test.ts`, `branches.test.ts`, `certificates.test.ts`, `finance.test.ts`, `grading.test.ts`, `livekit.test.ts`, `retry.test.ts`, `notifications.test.ts`, `scheduling.test.ts`, `coins.test.ts`, `file-storage.test.ts`, `file-scan.test.ts`, `livedigital-webhook.test.ts`, `ai-security.test.ts` | пароли, JWT, refresh, домены и slug, номера и коды сертификатов, расчёты счетов и возвратов, 6 типов вопросов, подпись вебхуков LiveKit и LiveDigital, повторы с backoff, каналы уведомлений, часовой пояс и серии занятий, награды IT Coins, префиксы и ключи файлового хранилища, антивирусная проверка, отсутствие ключа AI в ошибке и логе |
| Мобильные unit | `apps/mobile/test/offline-queue.test.ts`, `offline-storage.test.ts` | офлайн-очередь (дедупликация, конфликты, обрыв сети, повтор после разбора конфликта), кэш GET-ответов, черновики ДЗ |
| Контрактные | `auth.schemas.test.ts`, `domain-modules.test.ts` | DTO регистрации, поддержки, групп, отчётов, cookie, пагинация read-моделей |
| Интеграционные | `integrations.test.ts`, `access-isolation.test.ts`, `tenant-prisma-isolation.test.ts`, `learning-access.test.ts`, `auth-password-reset.test.ts`, `support-access.test.ts` | реестр адаптеров, health-check с подменённым провайдером, журнал без секретов, права ролей, middleware филиала, авторизация Socket.IO, маршрутизация Prisma по филиалам, конкурентные запросы, доступ по чужому ID, права на курсы/уроки/ДЗ/тесты/экзамены/магазин, восстановление пароля с отзывом сессий, область видимости обращений поддержки |
| HTTP / API | `api-surface.test.ts`, `api-access-matrix.test.ts` | реальные guard'ы и контроллеры: `/api/integrations`, курсы, уроки, ДЗ, тесты, экзамены, экономика и аналитика; 200, 201, 400, 401, 403, 404, единый формат ошибки |
| E2E | `e2e/api.e2e.test.ts` | 9 сценариев на живом стенде: health, регистрация, закрытый маршрут, восстановление пароля, обращение поддержки, бэкапы, интеграции, изоляция филиалов и подмена филиала через query/body/заголовки |

## Изоляция филиалов

Изоляция обеспечивается на шести уровнях, и каждый покрыт тестами:

1. **База выбирается только по `Host`.** `tenantMiddleware` не читает
   `branchId`/`domain` из query, body или заголовков `X-Branch-Id`,
   `X-Tenant`, `X-Forwarded-Host`; подмена игнорируется
   (`access-isolation.test.ts` → «подмена филиала через query, body и заголовки не работает»).
2. **Токен привязан к филиалу.** JWT содержит `branchId`; токен другого
   филиала получает `401/403` и на HTTP, и при рукопожатии Socket.IO.
3. **Отдельная БД на филиал.** `branchDatabaseUrl` строит URL без `schema`;
   разные филиалы получают разные базы. `lib/prisma.ts` проксирует каждый
   запрос в клиент текущего `TenantContext`, а не в общую БД.
4. **Данные не достаются по чужому ID.** Сервисы ищут запись одновременно по
   `id` и текущему филиалу/пользователю; тест `tenant-prisma-isolation.test.ts`
   подставляет два независимых клиента и проверяет, что обращение филиала A
   по ID филиала B получает 404.
5. **Realtime-комнаты содержат `branchId`.** `authorizeSocket` пускает только в
   комнаты своего филиала; участие в переписке проверяется в БД филиала.
6. **Файлы и вложения** лежат в каталоге/префиксе филиала; ключ объекта
   строит сервер, а не клиент.

Тесты: `test/access-isolation.test.ts` (25 сценариев), `test/tenant-prisma-isolation.test.ts`
(маршрутизация БД, конкурентные запросы, чужой ID), `test/e2e/api.e2e.test.ts`
(чужой токен и подмена филиала на домене другого филиала),
`test/branches.test.ts` (имена баз, домены, миграции).

## Покрытие требований

| Требование | Где проверяется |
|---|---|
| регистрация, авторизация, восстановление пароля | `auth.schemas.test.ts`, `auth-password-reset.test.ts` (одноразовый токен, хэш пароля, отзыв refresh-сессий); e2e — `register`, `login`, `forgot-password` |
| роли и права доступа | `access-isolation.test.ts` (RolesGuard), `api-surface.test.ts` и `api-access-matrix.test.ts` (401/403 на маршрутах) |
| изоляция филиалов | `access-isolation.test.ts`, `branches.test.ts`, e2e |
| курсы, уроки, домашние задания, тесты, экзамены | `learning-access.test.ts` (создание курса/урока, владение курсом, запись, публикация, адресность ДЗ), `api-access-matrix.test.ts` (401/403 на маршрутах), `grading.test.ts`; живые сценарии — `scripts/verify-learning-flow-api.mjs` |
| расписание и конфликты занятий | `scheduling.test.ts` (пересечения интервалов, серии, UTC+6), схемы в `scheduling.schemas.ts`; 409 `SCHEDULE_CONFLICT` на стенде — `scripts/verify-learning-flow-api.mjs` |
| видеоконференции | `livekit.test.ts` (токены, подпись вебхуков), `livedigital-webhook.test.ts` (подпись сырого тела, подмена, отсутствие настройки), `integrations.test.ts` (адаптер LiveDigital) |
| IT Coins, магазин | `coins.test.ts` (награды за ДЗ и тест, границы и округление), `learning-access.test.ts` (недостаток баланса, нулевой остаток, область заказов), `finance.test.ts` (суммы и возвраты), `domain-modules.test.ts`; живые — `scripts/verify-learning-flow-api.mjs` |
| платежи и возвраты | `finance.test.ts` (переплата, возвраты, отмена счёта), `integrations.test.ts` (адаптеры) |
| уведомления | `notifications.test.ts` (каналы и настройки по типам), `api-access-matrix.test.ts` (закрытый API) |
| поддержка и обращения | `support-access.test.ts` (7 сценариев: свои/все обращения, чужой id → 403, ученик не меняет статус, создание привязывает userId), `tenant-prisma-isolation.test.ts` (чужой филиал), e2e — создание и поиск обращения |
| AI | `ai-security.test.ts` (отсутствие ключа, 401/429, невалидный JSON, отсутствие секрета в ошибке и логе), `integrations.test.ts` (адаптер), `domain-modules.test.ts` (DTO автоматизаций) |
| аналитика и отчёты | `api-access-matrix.test.ts` (роли и период), `domain-modules.test.ts` (отчёты и даты), `finance.test.ts` |
| загрузка файлов | `file-storage.test.ts` (префикс филиала, защита от `..`, нормализация расширения), `file-scan.test.ts` (EICAR, подмена MIME), `domain-modules.test.ts` (DTO); живые проверки — `scripts/verify-security-api.mjs` |
| мобильные функции и офлайн-синхронизация | `apps/mobile/test/offline-queue.test.ts` (офлайн-очередь: дубли, конфликты, обрыв сети, повтор после разбора конфликта), `offline-storage.test.ts` (кэш и черновики), `apps/mobile` (`tsc --noEmit`); экран `offline-queue` сохраняет конфликт до ручного решения; ручная проверка на устройстве — навигация и уведомления |
| резервное копирование | e2e — `/api/backups/overview` и `/runs` без секретов и с реальными правами; создание копии и восстановление требуют `pg_dump`/`pg_restore` — `scripts/verify-security-api.mjs`, `docs/deployment/development.md` |

Строки, зависящие от PostgreSQL, выполняются на стенде: в окружении без БД
они либо заменены подменённым Prisma-клиентом, либо пропускаются с явным
маркером `skip`.

## Мобильные тесты

```bash
cd apps/mobile
npm install
npm test
```

AsyncStorage заменён in-memory реализацией (`apps/mobile/test/async-storage-mock.ts`),
`@/api/api` и `@/api/session` — моками, поэтому тесты не требуют ни устройства,
ни сети. Запускаются вместе с `npx tsc --noEmit` перед сборкой приложения.

## E2E на запущенном стенде

```bash
# 1. Поднимите API и примените миграции/seed
cd apps/api && npx prisma migrate deploy && npm run prisma:seed && npm run dev

# 2. В другом терминале
cd apps/api
E2E_BASE_URL=http://localhost:4000 \
E2E_ADMIN_EMAIL=admin@itadis.kg \
E2E_ADMIN_PASSWORD='ITadis2026' \
E2E_BRANCH_B_URL=https://filial-b.example.com \
npm run test:e2e
```

Если `E2E_BASE_URL` не задан, файл пропускается. Если задан, остальные
переменные обязательны: e2e падает с понятной ошибкой вместо молчаливого
пропуска сценариев с данными. `E2E_BRANCH_B_URL` — домен второго филиала с
активной записью в реестре; токен для проверки изоляции тест получает сам
входом администратора на `E2E_BASE_URL`.

В CI job `e2e` (`.github/workflows/ci.yml`) поднимает PostgreSQL 16 и Redis,
применяет `prisma migrate deploy`, выполняет seed, создаёт филиал B, отдельную
БД филиала B и применяет к ней миграции, направляет `primary.local` и
`branch-b.itadis.test` на `127.0.0.1`, собирает и запускает API, ждёт
`/healthz` со статусом `ok` и запускает все 9 сценариев.
Локально второй филиал создаётся штатным provisioner или записью в реестре
филиалов; API должен быть доступен по его домену.

## Команды проверки

```bash
# backend: unit + integration + HTTP, без внешних сервисов
npm --prefix apps/api run typecheck
npm --prefix apps/api test

# e2e: только против поднятого стенда; без E2E_BASE_URL сценарии skip
npm --prefix apps/api run test:e2e

# mobile: офлайн-очередь, кэш, черновики + типы
npm --prefix apps/mobile test
(cd apps/mobile && npx tsc --noEmit)
```

## Правила

- Новый модуль получает минимум один контрактный тест DTO и один тест правил
  доступа; изменения в адаптерах — тест на утечку секрета.
- Тесты не ходят в реальные внешние API: `fetch`/провайдер подменяются.
- Тест не должен ослаблять проверку ради «зелёного» прогона: сценарии с БД
  входят в e2e и выполняются в CI; допустимый `skip` — только когда не задан
  `E2E_BASE_URL`.
- Эталон запуска: `npx tsc --noEmit`, `npm test`, `npx prisma validate`.
