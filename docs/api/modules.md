# Backend-модули и API

Все модули находятся в `apps/api/src/modules/<domain>`. Модули с записью —
канонические; read-модели (`read-model`) дают администраторам стабильные
списки и не дублируют бизнес-правила записи.

Формат ошибок единый: `{ "error": { "code", "message", "details?" } }`.
Ошибки валидации — `422 VALIDATION_ERROR`, доступ — `403 FORBIDDEN`,
отсутствующая запись — `404 NOT_FOUND`.

| # | Модуль | Каталог | Основные маршруты | Доступ |
|---|---|---|---|---|
| 1 | AuthModule | `auth` | `/api/auth/*` | публичные вход/регистрация, остальное — сессия |
| 2 | UsersModule | `users` | `/api/users/*` | ADMIN, MANAGER; self-service |
| 3 | RolesModule | `roles` | `/api/roles/*` | ADMIN |
| 4 | BranchesModule | `branches` | `GET /api/branches`, `GET /api/branches/:id` (control plane) | ADMIN |
| 5 | StudentsModule | `students` | `GET /api/students`, `GET /api/students/:id` | ADMIN, MANAGER, TEACHER |
| 6 | MentorsModule | `mentors` | `GET /api/mentors`, `GET /api/mentors/:id` | все роли |
| 7 | ManagersModule | `managers` | `GET /api/managers`, `GET /api/managers/:id` | ADMIN, MANAGER |
| 8 | ParentsModule | `parents` | `GET /api/parents`, `GET /api/parents/:id` | ADMIN, MANAGER |
| 9 | GroupsModule | `groups` | `GET /api/groups`, `GET /api/groups/:id` | ADMIN, MANAGER, TEACHER |
| 10 | CoursesModule | `courses` | `/api/courses/*`, `/api/modules/*` | все роли, каталог фильтруется |
| 11 | LessonsModule | `lessons` | `/api/lessons/*` | по курсу/роли |
| 12 | MaterialsModule | `materials` | `GET /api/materials`, `GET /api/materials/:id` | ADMIN, MANAGER, TEACHER |
| 13 | HomeworkModule | `homework` | Nest: `/api/assessment/homework/*`; legacy alias `/api/homework/*` | TEACHER, STUDENT |
| 14 | TestsModule | `tests` | Nest: `/api/assessment/tests/*`; legacy alias `/api/tests/*` | TEACHER, STUDENT |
| 15 | ExamsModule | `exams` | Nest: `/api/assessment/exams/*`, read-модель `/api/exams` | ADMIN, MANAGER, TEACHER |
| 16 | ScheduleModule | `schedule`, `scheduling` | `/api/schedule/*`, `/api/scheduling/*` | по роли и участию |
| 17 | ClassroomsModule | `classrooms` | `GET /api/classrooms`, `GET /api/classrooms/:id` | ADMIN, MANAGER, TEACHER |
| 18 | AttendanceModule | `attendance` | `GET /api/attendance`, `GET /api/attendance/:id` | staff; STUDENT — только свои |
| 19 | LiveDigitalModule | `live-digital`, `scheduling` | `/api/live-digital/*`, `/api/scheduling/video/*` | ADMIN, MANAGER, TEACHER |
| 20 | AIHubModule | `ai-hub`, `ai-center` | `/api/ai-center/*` (AIHubModule — алиас домена) | по роли и лимитам |
| 21 | AIAutomationModule | `ai-automation` | `/api/ai-automation`, `/api/ai-center/automations` | ADMIN, MANAGER |
| 22 | ITCoinsModule | `it-coins`, `coins`, `economy` | `/api/it-coins/*`, `/api/coins/*` | STUDENT — свои, staff — все |
| 23 | RewardsStoreModule | `rewards-store`, `shop` | `/api/rewards-store/*`, `/api/shop/*` | все роли |
| 24 | AchievementsModule | `achievements` | `/api/achievements/*` (Nest) | все роли |
| 25 | CompetitionsModule | `competitions`, `community` | `/api/competitions/*`, `/api/community/*` | все роли |
| 26 | PaymentsModule | `payments`, `finance` | `/api/payments/*`, `/api/finance/payments/*` | ADMIN, MANAGER |
| 27 | FinanceModule | `finance` | `/api/finance/*` | ADMIN, MANAGER |
| 28 | InvoicesModule | `invoices`, `finance` | `/api/invoices/*`, `/api/finance/invoices/*` | staff; STUDENT — свои |
| 29 | ExpensesModule | `expenses`, `finance` | `/api/expenses/*`, `/api/finance/expenses/*` | ADMIN, MANAGER |
| 30 | MessagingModule | `messaging`, `messages` | `/api/messaging/*`, `/api/messages/*` | участники диалога |
| 31 | NotificationsModule | `notifications` | `/api/notifications/*` (Nest) | только свои |
| 32 | CertificatesModule | `certificates` | `/api/certificates/*` | ADMIN; публичная проверка |
| 33 | AnalyticsModule | `analytics`, `analytics-center` | `/api/analytics-center/*` (AnalyticsModule — алиас домена) | ADMIN, MANAGER |
| 34 | FilesModule | `files` | `/api/files/*` (legacy Express, модуль-граница) | по ACL файла/категории |
| 35 | AuditModule | `audit` | `GET /api/audit`, `GET /api/audit/:id` | ADMIN |
| 36 | ConsentModule | `consent`, `privacy` | `GET /api/consents`, `/api/privacy/*` | свои; ADMIN — все |
| 37 | CookieModule | `cookie` | `GET /api/cookies/policy`, `GET /api/cookie-consents` | policy публичная; согласия свои |
| 38 | SupportModule | `support` | `/api/support/tickets` | свои; ADMIN/MANAGER — все |
| 39 | ReportsModule | `reports` | `/api/reports/overview`, `/finance`, `/academic` | ADMIN, MANAGER; academic + TEACHER |
| 40 | BackupModule | `backups` | `/api/backups/*` (Nest) | ADMIN, step-up |
| 41 | IntegrationsModule | `integrations` | `GET /api/integrations`, `POST /:id/check`, `PATCH /:id`, `/events`, `/accounting/entries` | ADMIN |

## Как устроены модули

- **Сущности** — модели Prisma (`apps/api/prisma/schema.prisma`); отдельные ORM-копии
  в модулях не создаются.
- **DTO/валидация** — Zod-схемы (`*.schemas.ts` / `*.dto.ts`), общий `zodBody`
  возвращает `422 VALIDATION_ERROR` с путями полей.
- **Контроллер/сервис** — Nest-контроллер с `@Roles`/`@CurrentUser`, бизнес-логика
  в сервисе; ошибки — `AppError`/`badRequest`/`forbidden`/`notFound`.
- **Чтение** — read-модели с единым контрактом страницы; запись остаётся в
  каноническом модуле домена.

Файловый домен пока использует legacy Express-роутер: multipart и потоковая
отдача файлов сохраняют прежний контракт. Остальные модули из таблицы имеют
Nest-контроллеры; `HomeworkModule`, `TestsModule` и `ExamsModule` разделяют
академический домен, а `AIHubModule`/`AnalyticsModule` — публичные имена
существующих `AiCenterModule`/`AnalyticsCenterModule`.

## Проверка реестра

`apps/api/test/module-registry.test.ts` проверяет, что все 41 модуль из ТЗ
экспортируют класс с ожидаемым именем и подключены в `AppModule`.

## Read-модели

`apps/api/src/modules/read-model` — общий контракт списка: `page`, `limit`
(1–100), `search`, фильтры домена. Ответ:

```json
{ "data": [], "page": 1, "limit": 25, "total": 0, "pages": 0 }
```

Проверки доступа задаются `@Roles(...)` на контроллере; для студента/родителя
сервис дополнительно ограничивает `where` текущим `userId`. Валидация query —
zod, ошибки преобразуются в `422` с путями полей.

## Группы

В текущей схеме отдельной таблицы групп нет: группа — это опубликованный курс
с наставником и составом `CourseEnrollment`. `GET /api/groups/:id` возвращает
ID курса, преподавателя, количество учеников и состав. Это не дублирует
запись на курс и не создаёт второй источник истины.

## Поддержка

`SupportTicket` — новая модель (`20261120120000_support_tickets`). Пользователь
создаёт обращение; ADMIN/MANAGER меняют статус, приоритет, исполнителя и
резолюцию. Каждое изменение пишется в `AuditLog`.

## Отчёты

`ReportsModule` только читает существующие таблицы:
- `overview` — пользователи по ролям, курсы, активные записи, выручка/расходы,
  сертификаты, открытые обращения, посещаемость;
- `finance` — платежи по методам, расходы по категориям, возвраты, долг по счетам;
- `academic` — посещаемость, статусы сдач ДЗ, средний процент тестов.

Период задаётся `from`/`to` (ISO 8601); по умолчанию — текущий месяц.

## Интеграции

`IntegrationsModule` — единственная точка управления внешними сервисами.
Адаптеры находятся в `apps/api/src/integrations/adapters`, реестр — в
`integrations/index.ts`. Подробная таблица провайдеров, переменных окружения и
правил безопасности — в [`docs/integrations/README.md`](../integrations/README.md).

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/integrations` | все адаптеры: `configured`, `missingEnv`, `enabled`, последний статус |
| `GET` | `/api/integrations/status` | сводка ключевых провайдеров (совместимость) |
| `GET` | `/api/integrations/events` | журнал `IntegrationEvent`; фильтры `provider`, `status`, `page`, `limit` |
| `POST` | `/api/integrations/:id/check` | проверка доступности с записью в журнал |
| `POST` | `/api/integrations/check-all` | проверка всех адаптеров |
| `PATCH` | `/api/integrations/:id` | `enabled`, `settings`, имена `secretEnvVars` (не значения) |
| `POST` | `/api/integrations/accounting/entries` | экспорт документа в бухгалтерию |

Ответы не содержат значений токенов: только имена отсутствующих переменных
(`missingEnv`) и очищенный текст ошибки. Неизвестный адаптер — `404`,
неверное тело — `422`, отключённая интеграция — статус `not_configured` в
ответе проверки без сетевого вызова.
