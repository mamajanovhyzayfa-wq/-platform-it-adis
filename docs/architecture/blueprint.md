# ITadis: архитектурный blueprint

Документ фиксирует итоговую архитектуру платформы, структуру репозитория,
модель данных, план модулей, внешние зависимости и команды для Windows
PowerShell. Он дополняет `overview.md` (слои и решения) и
`docs/api/modules.md` (карта модулей), а не заменяет их.

## 1. Анализ требований

30 систем из ТЗ закрываются существующими модулями и приложениями:

| # | Система | Где реализована |
|---|---|---|
| 1 | Публичный сайт | `index.html`, `src/` (Vite, отдельный деплой `freebuff.sites.json`) |
| 2–4 | Филиалы, домены, отдельные БД | `modules/platform`, `modules/branches`, `lib/tenant*.ts`, `lib/branch-registry.ts` |
| 5 | Пять кабинетов | Веб: `/admin`, `/manager`, `/mentor`, `/student`, `/parent`; мобильные группы `(admin)`, `(manager)`, `(teacher)`, `(student)`, `(parent)` |
| 6–7 | LMS и конструктор | `modules/lms`, `modules/courses`, `modules/lessons`, страницы `CourseEditor`, `LessonBuilder` |
| 8–10 | ДЗ, тесты, экзамены | `modules/homework`, `modules/tests`, `modules/assessment`, `modules/exams` |
| 11–12 | Расписание и аудитории | `modules/scheduling`, `modules/classrooms`, `modules/schedule` |
| 13 | Видеоконференции | `modules/scheduling/livedigital.ts`, `adapters/livedigital.adapter.ts` |
| 14–15 | AI-помощники и автоматизации | `modules/ai-center`, `modules/ai`, `modules/ai-automation`, `adapters/ai.adapter.ts` |
| 16–18 | IT Coins, магазин, достижения | `modules/coins`, `modules/shop`, `modules/achievements`, `modules/economy` |
| 19–20 | Финансы и платежи | `modules/finance`, `modules/payments`, `integrations/payments/adapters/*` |
| 21 | Аналитика | `modules/analytics-center`, `modules/reports`, страницы `Analytics`, `Reports` |
| 22–23 | Сообщения и уведомления | `modules/messages`, `modules/notifications`, `lib/notify.ts`, Socket.IO |
| 24 | Сертификаты | `modules/certificates`, публичная проверка `/verify/:code` |
| 25 | Конкурсы и олимпиады | `modules/competitions` (витрина), `modules/community` (события и конкурсы) |
| 26–27 | Android и iOS | `apps/mobile` (Expo), сборки EAS |
| 28 | Безопасность | `lib/security.ts`, `lib/tenant.middleware.ts`, guards, `modules/audit`, `modules/privacy` |
| 29 | Резервное копирование | `modules/backups`, `lib/file-storage.ts` |
| 30 | Админ-панель | `apps/web`: 56 route-level `<Route>` и 49 page-файлов, включая `Integrations`, `Support`, `Reports`, `Backups`, `Audit` |

## 2. Противоречия и принятые решения

1. **LiveKit ⇄ LiveDigital.** В ТЗ видеопровайдер — LiveDigital, в старых
   данных остались записи LiveKit. Активный путь — LiveDigital; переменные
   `LIVEKIT_*` оставлены только для чтения архива и не создают комнаты.
2. **Отдельные БД филиалов ⇄ сквозная аналитика.** Аналитика считается в БД
   филиала; консоль платформы (`/platform`) видит только реестр филиалов и не
   читает их данные. Это осознанное ограничение изоляции.
3. **Read-модели ⇄ запись.** Модули-витрины (`read-model`) не дублируют
   бизнес-логику записи: создание и изменение живут в канонических модулях.
4. **Платёжные реквизиты нельзя проверить без платежа.** Health-check
   проверяет доступность хоста провайдера (`degraded`), а не имитирует оплату.
5. **AI и календари без ключей.** Адаптер сообщает `not_configured`, доменный
   маршрут — `503`; фиктивных ответов нет.
6. **Мобильные сборки.** Подпись Android/iOS и EAS-проект — внешние учётные
   данные; в репозитории есть конфигурация и команды сборки.
7. **Lockfile и workspaces.** Корневой `package-lock.json` относится к
   лендингу; API, панель и мобильное приложение ставятся каждый в своём каталоге
   (`npm ci --workspaces=false`), чтобы не пересобирать чужие зависимости.
8. **Мобильный администратор ⇄ полная админ-панель.** Полный CRUD-контур
   администратора остаётся в `apps/web` (рабочее место с таблицами, формами и
   подтверждениями). В приложении — оперативная сводка `/api/admin/dashboard`
   и переход в веб-панель; это не отдельная урезанная панель.
9. **Историческая документация БД.** `docs/database/schema.md` содержит
   ранний снимок; актуальные 128 моделей и 64 enum находятся в
   `apps/api/prisma/schema.prisma`, а раздел 17 файла фиксирует изменения.

## 3. Технологии и зависимости

| Слой | Технологии |
|---|---|
| API | Node.js 22+, NestJS 12, Express 5, Prisma 6, PostgreSQL 16, Socket.IO, Zod, JWT, nodemailer, pdfkit, AWS SDK S3, Vitest, supertest |
| Админ-панель | React 19, Vite, React Router 7, TanStack Query 5, Axios, TypeScript |
| Мобильные | Expo / React Native, expo-router, expo-notifications, TypeScript |
| Пакеты | `@itadis/shared-types`, `validation`, `api-client`, `ui`, `config` |
| Инфраструктура | Docker Compose, Nginx, Prometheus-метрики `/metrics`, pg_dump/restore, S3/MinIO, Redis (кеш и лимиты) |

Полные версии — `apps/api/package.json`, `apps/web/package.json`,
`apps/mobile/package.json`, корневой `package.json`.

## 4. Структура проекта

```text
itadis/
├── apps/
│   ├── api/                     backend (NestJS + Express, Prisma)
│   │   ├── 57 модулей в AppModule, 64 каталога (read-model/legacy)
│   │   ├── prisma/              schema.prisma, migrations/, seed.ts
│   │   ├── src/
│   │   │   ├── config/          env.ts (zod-валидация окружения)
│   │   │   ├── docs/            openapi.ts (Swagger /docs)
│   │   │   ├── integrations/    core/ + adapters/ (14 сервисов)
│   │   │   ├── lib/             prisma, tenant, security, audit, notify, storage…
│   │   │   ├── middleware/      auth, validate, step-up
│   │   │   ├── modules/         64 каталога доменных модулей, read-model
│   │   │   ├── nest/            AppModule, guards, filters, rbac, prisma
│   │   │   ├── legacy-routers.ts
│   │   │   ├── jobs/            фоновые задания
│   │   │   ├── websocket/       realtime.ts + realtime-auth.ts
│   │   │   └── main.ts
│   │   ├── scripts/             verify-*.mjs (сценарии на стенде)
│   │   └── test/                unit, contract, integration, api, e2e/
│   ├── web/                     админ-панель и кабинеты (React + Vite)
│   │   ├── src/app/             маршруты и AllowRoles
│   │   ├── src/api/             клиенты admin, access, finance, roles…
│   │   ├── src/features/        community, scheduling
│   │   ├── src/pages/           49 route-level страниц
│   │   ├── src/layouts/         AppLayout и ролевая навигация
│   │   └── src/locales/         ru/ky/en
│   └── mobile/                  Android/iOS (Expo, expo-router)
│       └── src/app/             (auth), (student), (teacher), (manager),
│                                (parent), (admin), course, lesson, test,
│                                video, messages, shop, achievements, ai
├── packages/                    shared-types, validation, api-client, ui, config
├── infrastructure/              docker, deployment, monitoring, scripts
├── docs/                        architecture, api, database, deployment,
│                                integrations, testing
├── index.html, src/             публичный сайт (Vite)
├── docker-compose.yml           dev-стенд (PostgreSQL, Redis, API)
├── docker-compose.prod.yml      production-конфигурация
├── freebuff.sites.json          деплой лендинга
└── package.json                 workspaces и общие команды
```

## 5. Модель данных и связи

Полная схема — `apps/api/prisma/schema.prisma` и `docs/database/schema.md`.
Домены:

| Домен | Ключевые модели | Связи |
|---|---|---|
| Филиалы (control plane) | `Branch`, `BackupRun`, `RestoreRequest` | отдельная управляющая БД; данные филиалов — в их БД |
| Пользователи и доступ | `User`, `RefreshSession`, `UserRoleGrant`, `RolePermission`, `Invitation`, `AccessRequest` | `User 1:N RefreshSession/Grant`, роли и права |
| Обучение | `Course`, `CourseModule`, `Lesson`, `CourseEnrollment`, `LessonMaterial` | курс → модули → уроки; записи на курс |
| Оценивание | `Homework`, `HomeworkSubmission`, `Test`, `Question`, `TestAttempt`, `Exam`, `ExamRegistration` | студент ↔ задание/тест/экзамен |
| Расписание | `Schedule`, `ScheduleTemplate`, `Classroom`, `Attendance`, `VideoRoom`, `Recording` | курс/преподаватель/аудитория → занятие → комната |
| Финансы | `Invoice`, `Payment`, `Refund`, `Expense`, `PaymentProviderAccount`, `PaymentAdjustment` | счёт → платежи/возвраты; провайдерский аккаунт |
| Экономика | `CoinBalance`, `CoinTransaction`, `ShopItem`, `ShopOrder`, `Achievement`, `UserAchievement` | пользователь ↔ транзакции/заказы/достижения |
| Коммуникации | `Conversation`, `ConversationParticipant`, `Message`, `Notification`, `NotificationPreference` | участники переписки, настройки каналов |
| Файлы и аудит | `StorageFile`, `FileAuditLog`, `AuditLog`, `Consent`, `CookieConsent`, `SupportTicket` | ACL файлов, журналы, согласия |
| Интеграции | `IntegrationConfig`, `IntegrationEvent` | настройки адаптеров и журнал событий |

Ключевые цепочки связей:

```text
Branch (control DB) 1:N BackupRun, RestoreRequest
Branch 1:N (изолированная БД) User, Course, Schedule, Invoice, ...
User 1:1 Student | Teacher | Parent
Parent 1:N ParentStudentLink N:1 Student
Course N:1 Teacher(User); Course 1:N Module 1:N Lesson 1:N LessonMaterial
Course 1:N CourseEnrollment N:1 User; Lesson 1:N LessonProgress
Homework 1:N HomeworkSubmission 1:N HomeworkReview
Test 1:N TestQuestion 1:N TestOption; Test 1:N TestAttempt 1:N TestAnswer
Exam 1:N ExamRegistration; Exam N:1 GradingScale
Schedule N:1 Course/Teacher/Classroom; Schedule 1:1 VideoRoom 1:N Recording
Invoice 1:N Payment 1:N Refund; Payment N:1 PaymentProviderAccount
Conversation 1:N Message; Conversation 1:N ConversationParticipant
ShopItem 1:N ShopOrder; User 1:1 CoinBalance 1:N CoinTransaction
StorageFile 1:N FileAuditLog; User 1:N Notification
```

Правила: внешние ключи с `onDelete` по смыслу (каскад для дочерних сущностей,
`SetNull` для журналов), UUID в API, деньги в целых сомах, время в UTC.

## 6. План модулей и статус

| Блок | Статус | Артефакты |
|---|---|---|
| Филиалы, домены, отдельные БД, консоль платформы | готово | `modules/platform`, `modules/branches`, провижининг и миграции |
| Auth, роли, права, пять кабинетов | готово | `modules/auth`, `nest/rbac`, `access`, страницы кабинетов |
| LMS, конструктор курсов и уроков | готово | `modules/lms|courses|lessons`, `CourseEditor`, `LessonBuilder` |
| ДЗ, тесты, экзамены, шкала оценок | готово | `homework`, `tests`, `assessment`, `exams`, `grading` |
| Расписание, аудитории, конфликты, LiveDigital | готово, нужны ключи LiveDigital | `scheduling`, `classrooms`, `livedigital` |
| AI-помощники и автоматизации | готово, нужен `OPENAI_API_KEY` | `ai-center`, `ai`, `ai-automation`, `adapters/ai` |
| IT Coins, магазин, достижения | готово | `coins`, `shop`, `achievements`, `economy` |
| Финансы, счета, платежи, возвраты | готово, нужны реквизиты провайдеров | `finance`, `payments`, `integrations/payments` |
| Аналитика и отчёты | готово | `analytics-center`, `reports`, страницы `Analytics`, `Reports` |
| Сообщения, уведомления, push | готово, ключи SMTP/Twilio/Expo опциональны | `messages`, `notifications`, `lib/notify` |
| Сертификаты и публичная проверка | готово | `certificates`, `/verify/:code` |
| Конкурсы, олимпиады, сообщество | готово: события, регистрация, задания, результаты, рейтинг и награды; `competitions` — read-model витрины, запись — в `community` | `competitions`, `community` |
| Мобильные приложения | готово, сборка через EAS | `apps/mobile` |
| Безопасность, аудит, согласия, cookie | готово | `security`, `audit`, `privacy`, `consent`, `cookie` |
| Резервное копирование и восстановление | готово | `backups`, S3, планировщик |
| Интеграции (14 адаптеров) | готово, нужны ключи провайдеров | `integrations/*`, `Integrations` в панели |
| Админ-панель | готово | `apps/web` 56 route-level `<Route>`; мобильная сводка `(admin)` |

Порядок сборки и повторного аудита (зависимости идут сверху вниз):

1. **Control plane:** `Branch`, домены, провижининг, миграции БД филиала, storage prefix.
2. **Identity:** `User`, роли/права, refresh-сессии, согласия, устройства, parent links.
3. **Learning:** курсы → модули → уроки → материалы → прогресс → ДЗ → тесты → экзамены.
4. **Delivery:** расписание, аудитории, конфликты, LiveDigital, посещаемость, записи.
5. **Economy:** IT Coins, правила, магазин, достижения, сезоны.
6. **Money:** счета → платежи → возвраты → расходы → провайдерские вебхуки.
7. **Communication:** сообщения, уведомления, поддержка, сообщество и конкурсы.
8. **Operations:** аналитика, отчёты, аудит, backup/restore, интеграции, админ-панель.
9. **Clients:** веб-кабинеты, мобильные группы, EAS-сборки; внешние ключи проверяются на стенде.

## 7. Внешние API и доступы

| Сервис | Что нужно | Переменные |
|---|---|---|
| LiveDigital | тариф, API-токен, spaceId, webhook-секрет | `LIVEDIGITAL_*` |
| FreedomPay KG | merchantId, секрет, тестовый режим | `FREEDOMPAY_*` |
| Elsom / КИКБ | базовый URL, partner code, пароль | `ELSOM_*` |
| Google Sign-In | OAuth client id (+ secret для серверного обмена) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Apple Sign-In | client id, team/key id, приватный ключ | `APPLE_*` |
| SMTP | хост, порт, логин, пароль | `SMTP_*` |
| SMS | Twilio SID, token, номер | `TWILIO_*`, `SMS_PROVIDER` |
| Push | токен Expo (опционально) | `EXPO_ACCESS_TOKEN` |
| Google Calendar | OAuth client, refresh-токен, id календаря | `GOOGLE_CALENDAR_*` |
| Apple Calendar | CalDAV URL, логин, пароль приложения | `APPLE_CALDAV_*` |
| Outlook / Microsoft 365 | tenant, client id, secret | `OUTLOOK_*` |
| Бухгалтерия (1С) | URL API, ключ, провайдер | `ACCOUNTING_*` |
| AI | ключ OpenAI-совместимого API | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` |
| Облачное хранилище | S3 endpoint, bucket, ключи | `S3_*` |

Ключи задаются только на сервере: локально — `apps/api/.env`, в production —
секреты платформы/оркестратора. В админ-панели и мобильном приложении их нет.

## 8. Команды Windows PowerShell

```powershell
# 0. Из корня репозитория
cd C:\Projects\itadis

# 1. Backend: зависимости и окружение
cd apps\api
npm ci --workspaces=false
Copy-Item .env.example .env
# откройте .env и задайте DATABASE_URL, JWT_*; ключи интеграций — по необходимости
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run dev                     # http://localhost:4000, Swagger /docs

# 2. Админ-панель и кабинеты (второй терминал)
cd C:\Projects\itadis\apps\web
npm ci --workspaces=false
$env:VITE_API_URL = "http://localhost:4000/api"
npm run dev                     # http://localhost:5174

# 3. Мобильное приложение (третий терминал)
cd C:\Projects\itadis\apps\mobile
npm ci --workspaces=false
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.10:4000/api"
npm run start                   # Expo DevTools: a / i
npm run build:android:apk       # EAS preview APK
npm run build:ios               # EAS production iOS

# 4. Проверки
cd C:\Projects\itadis\apps\api
npm run typecheck
npm test
npx prisma validate
$env:E2E_BASE_URL = "http://localhost:4000"
$env:E2E_ADMIN_EMAIL = "admin@itadis.kg"
$env:E2E_ADMIN_PASSWORD = "ITadis2026"
$env:E2E_BRANCH_B_URL = "https://filial-b.example.com"
npm run test:e2e

cd C:\Projects\itadis\apps\web
npm run typecheck
npm run build

cd C:\Projects\itadis\apps\mobile
npx tsc --noEmit

# 5. Production-сборка
cd C:\Projects\itadis\apps\api
npm run build                   # dist/

cd C:\Projects\itadis\apps\web
npm run build                   # dist/

cd C:\Projects\itadis
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 6. Лендинг (публичный сайт)
npm install
npm run build
npm run preview
```

Миграции в разработке: `npx prisma migrate dev --name <имя>`; на стенде —
`npx prisma migrate deploy`; откат — восстановление из резервной копии
(`/api/backups/*`), а не правка применённых миграций.

## 9. Правила выдачи кода

- Каждый файл имеет точный путь; фрагментов с многоточиями и заглушек нет.
- После крупного блока выполняются `tsc`, тесты, `prisma validate`, сборка.
- Внешние ключи не имитируются: адаптер сообщает `not_configured`, маршрут —
  `503`, а панель показывает, каких переменных не хватает.
- Ошибка устраняется в причине: воспроизведение, исправление файла, повторная
  проверка затронутого сценария (см. `docs/testing/strategy.md`).
