# Архитектура ITadis

Документ описывает **фактически реализованную** архитектуру монорепозитория, принятые решения и разрывы
между текущим кодом и полным техническим заданием (части 1–12). Он обновляется по мере развития проекта.

> **Актуальность.** Стек и окружения сверены 22.11.2026 с `docs/technology-stack.md`; раздел 3 и схема
> ниже отражают текущий код. Исторические статусы в разделе 10 могут отставать — при расхождении
> верен `docs/technology-stack.md`.

- [1. Принципы](#1-принципы)
- [2. Структура монорепозитория](#2-структура-монорепозитория)
- [2.1 Карта модулей по ТЗ](#21-карта-модулей-по-тз)
- [3. Технологический стек](#3-технологический-стек)
- [4. Общая схема](#4-общая-схема)
- [5. Backend](#5-backend)
- [6. Мобильное приложение](#6-мобильное-приложение)
- [7. Административная панель](#7-административная-панель)
- [8. Инфраструктура и окружения](#8-инфраструктура-и-окружения)
- [9. Сквозные правила](#9-сквозные-правила)
- [10. Соответствие ТЗ и пробелы](#10-соответствие-тз-и-пробелы)
- [11. Точки расширения](#11-точки-расширения)
- [12. Технический долг и риски](#12-технический-долг-и-риски)
- [13. План дальнейшей разработки](#13-план-дальнейшей-разработки)

---

## 1. Принципы

1. **Один источник истины — сервер.** Мобильное приложение и админ-панель не хранят бизнес-данные локально
   дольше, чем нужно для кеша отображения. Баланс монет, оценки, прогресс, посещаемость и результаты тестов
   рассчитываются только в backend.
2. **Права проверяются на сервере.** Роль из JWT и участие в курсе/переписке/занятии проверяются в каждом
   маршруте; клиентская навигация — только удобство, не защита.
3. **Разделение ролей на уровне интерфейса.** У ученика и преподавателя отдельные группы маршрутов и разные
   экраны, а не один экран с подменой подписей.
4. **Секреты только на сервере.** Ключи LiveDigital, S3, SMTP, провайдера AI не попадают в мобильный бандл.
5. **Идемпотентность критичных операций.** Отправка домашней работы (`idempotencyKey`) и списание монет
   защищены от повторного выполнения; вебхуки проверяются по подписи.
6. **Один дизайн-язык.** Цвета, отступы, радиусы и типографика — только из `apps/mobile/src/theme` и
   `apps/web/src/styles/`.

## 2. Структура монорепозитория

```
ITadis/
├── apps/mobile/                     # Expo / React Native приложение (Android, iOS)
│   ├── src/
│   │   ├── api/                # axios-клиент, интерсепторы, сессия, доменные вызовы
│   │   ├── app/                # Expo Router: файловая маршрутизация
│   │   │   ├── (auth)/         # welcome, login, register, forgot-password
│   │   │   ├── (student)/      # 5 вкладок ученика
│   │   │   ├── (teacher)/      # 5 вкладок преподавателя
│   │   │   ├── (manager)/      # сводка филиала и заявки
│   │   │   ├── (parent)/       # дети, успеваемость, задания и платежи
│   │   │   ├── (admin)/        # мобильная сводка администратора
│   │   │   └── ...             # course/[id], lesson/[id], test/[id], video/[scheduleId],
│   │   │                       # messages, notifications, knowledge, shop, achievements
│   │   ├── components/         # дизайн-система и списки
│   │   ├── features/           # самодостаточные блоки экранов (профиль)
│   │   ├── i18n/               # ru / ky / en
│   │   ├── services/           # socket.io-клиент
│   │   ├── store/              # Zustand (сессия, тема, язык)
│   │   ├── theme/              # токены дизайн-системы
│   │   └── utils/              # форматирование дат, чисел, ошибок
│   ├── assets/images/          # логотип, иконки, splash
│   └── app.json                # конфигурация Expo
├── apps/api/                    # REST API + Socket.IO
│   ├── prisma/
│   │   ├── schema.prisma       # 128 моделей, 64 enum
│   │   ├── migrations/         # история миграций (initial + RBAC)
│   │   └── seed.ts             # роли, права, профили, демо-данные
│   ├── src/
│   │   ├── config/env.ts       # zod-валидация переменных окружения
│   │   ├── docs/openapi.ts     # OpenAPI-документ для Swagger UI
│   │   ├── integrations/       # адаптеры внешних провайдеров
│   │   ├── jobs/               # фоновые задания вне домена
│   │   ├── lib/                # prisma, security, errors, audit, mailer
│   │   ├── middleware/         # requireAuth, requireRole, validate (legacy)
│   │   ├── nest/               # ядро Nest: app.module, modules, guards, RBAC
│   │   ├── modules/            # доменные модули (см. §5.2)
│   │   ├── websocket/          # Socket.IO и авторизация рукопожатия
│   │   ├── legacy-routers.ts   # Express-роутеры, ещё не перенесённые в Nest
│   │   └── main.ts             # bootstrap Nest, graceful shutdown
│   ├── test/                   # Vitest: 263 API-теста, e2e в CI
│   └── Dockerfile
├── apps/web/                  # Административная панель: React + Vite
│   └── src/
│       ├── api/                # клиент и вызовы /api
│       ├── app/                # App.tsx (маршруты, guards), navigation.ts
│       ├── components/         # переиспользуемые UI-компоненты
│       ├── features/           # community, scheduling и другие домены
│       ├── hooks/              # общие React-хуки
│       ├── i18n/               # провайдер и типы ключей
│       ├── layouts/            # AppLayout и каркас
│       ├── locales/            # ru/ky/en JSON
│       ├── pages/              # route-level страницы
│       └── styles/             # CSS по слоям, index.css
├── infrastructure/             # Конфигурации развёртывания (см. infrastructure/README.md)
├── src/, public/, index.html   # Витрина-лендинг (Vite) и иконка приложения
├── docker-compose.yml          # PostgreSQL 16, Redis 7, backend
├── .env.example                # переменные docker compose
├── docs/architecture/overview.md
├── docs/api/endpoints.md
├── docs/database/schema.md
├── docs/deployment/development.md
└── README.md
```

`dist/` в корне — собранный лендинг, генерируется `npm run build`, в репозиторий не входит.

### 2.1 Карта модулей по ТЗ

Ниже — каждый модуль, который требует ТЗ (часть 1.2), сопоставлен с реальным расположением в коде и
честным статусом. «Этап» — на каком этапе разработки модуль закрывается полностью.

Обозначения: ✔ — работает и покрыт проверками; ◐ — есть частично; ✘ — отсутствует.

**Mobile (`apps/mobile/src`)**

| Модуль ТЗ | Расположение | Статус | Этап |
| --- | --- | --- | --- |
| Authentication | `app/(auth)/*`, `store/auth.ts`, `api/session.ts` | ✔ вход, регистрация, сброс пароля, refresh-rotation | — |
| Student | `app/(student)/*` | ✔ 5 вкладок ученика | — |
| Teacher | `app/(teacher)/*`, `app/teacher-course/[id].tsx`, `app/teacher-lesson/[id].tsx`, `app/teacher-homework/[id].tsx`, `app/teacher-submission/[id].tsx` | ✔ мои курсы, модули и уроки, задания, проверка работ | — |
| Parent | `apps/web/src/pages/ParentDashboard.tsx`, `apps/mobile/src/app/(parent)/*` | ✔ роль, веб- и мобильный кабинет, подтверждённая связь с учеником | — |
| Courses | `app/(student)/courses.tsx`, `app/course/[id].tsx` | ✔ каталог с категориями, поиском, фильтрами, записью и прогрессом | — |
| Lessons | `app/lesson/[id].tsx` | ✔ видеоплеер (expo-video), конспект, материалы, прогресс | — |
| Homework | `app/(student)/homework.tsx`, `app/homework/[id].tsx`, `app/(teacher)/homework.tsx`, `app/teacher-homework/[id].tsx`, `app/teacher-submission/[id].tsx` | ✔ создание/редактирование преподавателем, сдача с текстом, ссылкой и файлами, повторная сдача, проверка с оценкой/возвратом; файлы — ссылки (без загрузчика) | — |
| Quizzes | `app/test/[id].tsx` | ◐ прохождение и результаты есть, конструктора нет | 5 |
| Schedule | `app/(student)/schedule.tsx`, `app/(teacher)/schedule.tsx`, `components/schedule.tsx` | ✔ календарь день/неделя/месяц, создание занятия преподавателем, конфликты проверяет сервер | — |
| VideoConference | `app/video/[scheduleId].tsx`, `services/socket.ts` | ✔ LiveDigital Web SDK в WebView; чат занятия через REST/Socket.IO, запись и посещаемость | 6 |
| Messenger | `app/messages/*` | ✔ диалоги, realtime, жалобы | — |
| Notifications | `app/notifications.tsx`, `services/push.ts` | ✔ центр уведомлений, Expo Push, переход по нажатию | — |
| Wallet | `app/(student)/index.tsx`, `app/coins.tsx`, `app/shop.tsx` | ✔ баланс, история с источником начисления, траты | — |
| Rewards | `app/shop.tsx`, `app/achievements.tsx` | ✔ магазин и достижения | — |
| AI Assistant | `app/ai.tsx` | ✔ чат с помощником-наставником, лимит на сервере | — |
| Knowledge Base | `app/knowledge/*` | ✔ список, статья, избранное, рекомендации | — |
| Profile | `app/(student|teacher)/profile.tsx`, `features/profile` | ◐ нет посещаемости/оценок сводкой | 4 |
| Settings | `features/profile.tsx`, `app/privacy.tsx`, `app/delete-account.tsx` | ✔ тема, язык, push, политика конфиденциальности, удаление аккаунта | — |

**Backend (`apps/api/src`)**

| Модуль ТЗ | Расположение | Статус | Этап |
| --- | --- | --- | --- |
| Auth | `modules/auth/*` | ✔ JWT, refresh-family, сброс пароля, согласия | — |
| Users | `modules/users/*` | ✔ профиль, курсы/ученики, удаление аккаунта | — |
| Roles | `enum RoleName`, `nest/rbac` | ✔ пять ролей (`ADMIN`, `MANAGER`, `TEACHER`, `STUDENT`, `PARENT`) | — |
| Permissions | `Permission`, `RolePermission`, `PermissionsGuard` | ✔ права роли и точечные проверки на маршрутах | — |
| Profiles | `UserProfile` в `modules/users` | ✔ | — |
| Courses | `modules/courses/*` | ✔ категории, каталог с фильтрами, мои курсы, сводка, запись | — |
| Lessons | `modules/lessons/*` | ✔ чтение, прогресс, CRUD, публикация | — |
| Homework | `modules/homework/*`, `modules/teacher/*` | ✔ создание/редактирование задания, отправка идемпотентна, проверка с оценкой/возвратом, уведомления и достижения | 5 |
| Quizzes | `modules/tests/*` | ◐ серверная проверка, без конструктора | 5 |
| Schedule | `modules/schedule/*`, `modules/scheduling/*` | ✔ чтение, CRUD, конфликты, переносы, замены, посещаемость | — |
| VideoConference | `modules/live-digital/*`, `modules/scheduling/*`, `websocket/realtime.ts` | ✔ LiveDigital: комнаты, токены, посещаемость, запись, вебхуки; LiveKit — только архив | — |
| Messenger | `modules/messages/*` | ✔ | — |
| Notifications | `modules/notifications/*`, `lib/push.ts` | ✔ запись в БД и рассылка Expo Push | — |
| Wallet | `modules/coins/*` | ✔ транзакции и начисления | — |
| Rewards | `modules/shop/*`, `modules/achievements/*` | ✔ | — |
| AI | `modules/ai/*` | ✔ наставнический промпт, дневной лимит, ключ только на сервере | — |
| Knowledge Base | `modules/knowledge/*` | ✔ | — |
| Analytics | `GET /api/admin/analytics`, `modules/admin`, `apps/web/src/components/Charts.tsx` | ✔ сводки и графики в панели; выгрузок нет | 10 |
| Admin | `modules/admin/*` | ✔ сводка, пользователи, курсы, расписание, работы и тесты, магазин, монеты, аудит | — |
| Storage | `modules/files/*`, `modules/uploads/*`, `lib/file-storage.ts` | ✔ S3/MinIO + локальный fallback, ACL, антивирус, квоты | — |
| Audit | `lib/audit.ts`, `AuditLog` | ✔ пишется на критичных операциях | — |

**Admin Web (`apps/web/src`)**

| Раздел ТЗ | Статус | Этап |
| --- | --- | --- |
| Dashboard | ✔ сводка, графики, активность | — |
| Users | ✔ поиск, фильтр, роль, блокировка | — |
| Students / Teachers / Parents | ◐ только общий список пользователей | 10 |
| Courses / Lessons | ◐ список и расписание без редактирования | — |
| Homework / Quizzes | ✔ очередь работ и попытки тестов | — |
| Schedule / VideoConference | ✔ календарь день/неделя/месяц; видео — в мобильном приложении | — |
| Wallet / Store | ✔ модерация заявок и транзакции IT Coins | — |
| Notifications | ✘ управление рассылками не входит в панель | 10 |
| Analytics | ✔ сводки и графики | — |
| Settings | ✘ | 10 |
| Audit Logs | ✔ | — |

## 3. Технологический стек

| Слой | По ТЗ | Фактически | Статус |
| --- | --- | --- | --- |
| Mobile | React Native, Expo, TypeScript, Expo Router, Zustand, TanStack Query, Axios, RHF, Zod, Reanimated, SecureStore, Notifications | Всё перечисленное, включая `expo-notifications`; Expo SDK 58, RN 0.88, React 19.3; LiveDigital Web SDK в WebView | Соответствует; видео в WebView, push проверяется на устройстве |
| Backend | NestJS, TypeScript, PostgreSQL, Prisma, Redis, Socket.IO, JWT | **NestJS 12** (ядро, auth, users, RBAC), TypeScript, PostgreSQL, Prisma 6, Socket.IO, JWT, Zod, Swagger; Redis 7 для кеша, блокировок и Socket.IO adapter; 10 доменов ещё Express-роутеры | Соответствует; миграция доменов продолжается |
| Админ-панель | React, TypeScript, Vite, React Router, TanStack Query | React 19, Vite 7, React Router 7, TanStack Query 5, Axios, ErrorBoundary | Соответствует |
| Видео | LiveDigital, WebRTC/Web SDK | LiveDigital Moodhood API: комнаты, запись, вебхуки; web и mobile используют официальный Web SDK, mobile — через `react-native-webview`. LiveKit-код оставлен только для старых записей | Работает при настроенных ключах; запись зависит от тарифа LiveDigital |
| Тесты | Unit / Integration / E2E | Vitest: 263 API-теста и 20 mobile; e2e в CI с PostgreSQL/Redis | Unit/API покрыты; локальные e2e без сервисов пропускаются |

### Переход на NestJS: текущее состояние

Backend переведён на NestJS 12. Точка входа — `src/main.ts` (`NestFactory` + `AppModule`). Полноценные
Nest-модули с контроллерами, сервисами, guards и pipes: `auth`, `users`, `roles`, `courses`, `lessons`,
`homework`, `tests`, `exams`, `notifications`, `achievements`, `schedule`, `scheduling`, `backups`,
`support`, `reports`, `integrations` и read-модели профилей. Legacy Express-роутеры остаются для
`admin`, `coins`, `shop`, `messages`, `community`, `uploads`, `ai`, `privacy`, `knowledge` и `files`;
они монтируются в тот же HTTP-сервер из `src/legacy-routers.ts` и используют тот же Prisma/JWT-слой.

Правило дальнейшей работы: **новый модуль пишется сразу на Nest**; существующий переносится целиком
(роутер → контроллер + сервис → строка удаляется из `legacy-routers.ts`).

Почему не перенесено всё сразу: это переписывание ~6 000 строк работающего кода без функционального
выигрыша для продукта. Перенос идёт по этапам вместе с доработкой соответствующих разделов ТЗ.

Особенность сборки: Nest требует метаданных декораторов, поэтому `npm run dev` работает через `tsc-watch`
(компилятор TypeScript), а не через `tsx`/esbuild: esbuild не генерирует `design:paramtypes`, и DI падает.

## 4. Общая схема

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Mobile (Expo)   │   │  Admin Web (Vite)│   │  Landing (Vite)  │
│  Android / iOS   │   │  React Router    │   │  статика         │
└────────┬─────────┘   └────────┬─────────┘   └──────────────────┘
         │ HTTPS / WSS          │ HTTPS
         └──────────┬───────────┘
                    ▼
        ┌───────────────────────────┐
        │  Reverse proxy (nginx)    │   production: TLS, gzip, /api → backend
        └────────────┬──────────────┘
                     ▼
        ┌───────────────────────────┐        ┌──────────────────┐
        │  Backend: NestJS 12       │───────▶│  PostgreSQL 16   │
        │  REST /api + Socket.IO    │        │  Prisma ORM      │
        │  JWT, RBAC, Zod, аудит    │        └──────────────────┘
        └──────┬──────────┬─────────┘        ┌──────────────────┐
               │          │─────────────────▶│  Redis 7         │
               │          │                  │ кеш/локи/adapter │
               ▼          ▼                  └──────────────────┘
     ┌──────────────────────────┐   ┌──────────────────┐
     │ LiveDigital (Moodhood)   │──▶│ S3-хранилище     │
     │ комнаты, Web SDK, запись │   │ файлов/записей   │
     └────────────▲─────────────┘   └──────────────────┘
                  │ вебхуки (HMAC)
        Backend /api/scheduling/livedigital
```

## 5. Backend

### 5.1 Слои

| Слой | Расположение | Ответственность |
| --- | --- | --- |
| Сборка приложения | `src/main.ts` | bootstrap Nest, helmet, CORS, raw-body для вебхуков, JSON, Swagger, монтирование legacy-роутеров, graceful shutdown |
| Корневой модуль | `src/nest/app.module.ts` | модули, порядок глобальных guards, конфигурация Throttler |
| Ядро Nest | `src/nest/**` | `prisma` (единый клиент), `rbac` (права ролей), `common` (decorators, guards, zod-pipe, фильтр ошибок), `modules/auth`, `modules/users` |
| Legacy-слой | `src/legacy-routers.ts`, `src/modules/*/*.routes.ts` | Express-роутеры ещё не перенесённых доменов, монтируются в тот же сервер |
| Конфигурация | `src/config/env.ts` | zod-схема переменных окружения, значения по умолчанию для разработки |
| Маршруты | `src/modules/*/*.controller.ts`, `src/modules/*/*.routes.ts` | HTTP-контракт, проверка ролей и владения, валидация Zod, вызов Prisma |
| Домен | `src/modules/*/*.service.ts`, `grading.ts`, `evaluate.ts`, `livedigital.ts` | Переиспользуемая бизнес-логика: сессии, подсчёт баллов, достижения, комнаты и токены LiveDigital |
| Доступ к данным | `src/lib/prisma.ts` | Единственный экземпляр `PrismaClient` |
| Инфраструктура | `src/lib/{security,errors,audit,mailer}.ts`, `src/websocket/realtime.ts` | Хеши/JWT, единый формат ошибок, аудит, почта, Socket.IO |
| Документация API | `src/docs/openapi.ts` | OpenAPI 3 для `/docs` |

Nest-модуль — контроллер + сервис + `@Module`. Legacy-модуль — отдельный `Router`, монтируемый в
`src/legacy-routers.ts` под своим префиксом. Перенос модуля — замена строки в этом списке на Nest-контроллер;
внешний контракт (пути, тела, коды ответов, формат ошибок) при этом не меняется.

### 5.1.1 RBAC и безопасность

| Механизм | Реализация |
| --- | --- |
| Аутентификация | `JwtAuthGuard` (глобальный): Bearer access-токен, `@Public()` — исключение |
| Роли | `RolesGuard` + `@Roles('TEACHER','ADMIN')`; роль берётся из токена |
| Права | `PermissionsGuard` + `@RequirePermissions('users.manage')`; права читаются из `RolePermission` с кешем 60 с |
| Каталог ролей | Модель `Role` (`code` = enum `RoleName`), `User.role` связан с `Role.code` — одно поле, без дублирования |
| Пароли | bcrypt, 12 раундов (`lib/security.ts`) |
| Сессии | `RefreshSession` с `family`: повторное использование отозванного токена отзывает всё семейство |
| Rate limiting | `@nestjs/throttler`: 120 запросов/минута глобально, 20 попыток входа/регистрации за 15 минут |
| Ошибки | Единый фильтр: `{ error: { code, message, details } }` для Nest и Express-слоя |

### 5.2 Карта модулей

| Модуль | Файлы | Ответственность | Роли |
| --- | --- | --- | --- |
| `auth` (Nest) | `src/modules/auth/*`, `auth.schemas.ts` | регистрация, вход, refresh-rotation, выход, сброс пароля, согласия | все |
| `users` (Nest) | `src/modules/users/*` | профиль, смена пароля, курсы/ученики пользователя, эффективные права, удаление аккаунта | все / TEACHER |
| `courses` (Nest) | `src/modules/courses/*` | категории, каталог с поиском/фильтрами, мои курсы, сводка главного экрана, запись | все / STUDENT |
| `lessons` (Nest) | `src/modules/lessons/*` | урок и материалы, прогресс, завершение, CRUD урока | все / TEACHER |
| `teacher` (Nest) | `src/modules/teacher/*` | сводка кабинета, свои курсы, создание и редактирование ДЗ, проверка работ с начислением монет | TEACHER / ADMIN |
| `schedule` (Nest) | `src/modules/schedule/*` | занятия в периоде, создание с проверкой пересечений | все / TEACHER |
| `homework` (Nest) | `modules/homework/*`, `modules/assessment/*` | задания, версии отправок, проверка, AI-предпроверка | STUDENT / TEACHER |
| `tests` (Nest) | `modules/tests/*`, `modules/assessment/*` | тесты, банк вопросов, попытки, серверная проверка, результаты | STUDENT / TEACHER |
| `exams` (Nest) | `modules/exams/*`, `modules/assessment/*` | экзамены, регистрация, шкалы оценивания | STUDENT / TEACHER |
| `video` | `video.routes.ts`, `livekit.ts` | комнаты, токены, посещаемость, запись, вебхуки | все / TEACHER |
| `messages` | `messages.routes.ts` | диалоги, сообщения, прочтение, жалобы | все |
| `notifications` (Nest) | `modules/notifications/*` | центр уведомлений, каналы, дайджест | все |
| `coins` | `coins.routes.ts` | баланс, история, начисление | все / TEACHER |
| `achievements` (Nest) | `modules/achievements/*` | список достижений, выдача по условиям | STUDENT |
| `backups` (Nest) | `modules/backups/*` | копии, проверка, восстановление со step-up | ADMIN |
| `files` (legacy) | `modules/files/files.routes.ts` | библиотека файлов и ACL | по ACL |
| `shop` | `shop.routes.ts` | товары, заказы, выдача, возврат | STUDENT / ADMIN |
| `knowledge` | `knowledge.routes.ts` | база знаний, избранное, история, рекомендации | все / TEACHER |
| `admin` | `admin.routes.ts` | сводка, пользователи, курсы, аналитика, аудит | ADMIN |

### 5.3 Жизненный цикл запроса

```
Запрос → helmet → CORS → (raw body для /api/video/webhooks) → express.json
       → morgan (кроме test) → Router
       → requireAuth (JWT → req.auth {userId, role, email})
       → requireRole (при необходимости)
       → validate(schema) (Zod: body/query/params)
       → проверка владения/участия через Prisma
       → бизнес-операция (при необходимости $transaction)
       → аудит и уведомление
       → JSON-ответ
Ошибка → AppError | ZodError → errorHandler → { error: { code, message, details } }
```

- Формат ошибки един: `{ "error": { "code": "FORBIDDEN", "message": "...", "details": ... } }`.
- Коды: `BAD_REQUEST` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409,
  `VALIDATION_ERROR` 422, `TOO_MANY_REQUESTS` 429, `INTERNAL_ERROR` 500, `VIDEO_NOT_CONFIGURED` 503.
- Ответы «не найдено» вместо «нет прав» используются намеренно там, где существование объекта скрывается
  от ученика (чужой курс, тест, пользователь).

### 5.4 Аутентификация и сессии

- Пароль: bcrypt (12 раундов), политика от 8 символов, буква, заглавная, цифра (`auth.schemas.ts`).
- Access-токен JWT (15 минут по умолчанию) — `sub`, `role`, `email`.
- Refresh-токен: случайная строка, в БД хранится только SHA-256-хеш, срок 30 дней.
- **Rotation + family:** при обновлении старая сессия отзывается, выдаётся новая в той же `family`.
  Повторное использование отозванного токена отзывает всю семью — защита от кражи refresh-токена.
- Устройства: `UserDevice` (`userId+deviceId` уникальны), `platform`, `pushToken`, `lastSeenAt`.
- Выход: один refresh-токен (`/logout`) или все сессии (`/logout-all`).
- Пароль-reset: одноразовый токен в `PasswordResetToken` (хеш, срок, `usedAt`).
- В мобильном приложении токены лежат в `expo-secure-store`; access-токен передаётся в заголовке
  `Authorization: Bearer`, refresh — только на `/api/auth/refresh`.
- Подтверждение email: `emailVerifiedAt` и письмо со ссылкой; без SMTP письмо пишется в лог (dev).

### 5.5 RBAC

Роли — enum `RoleName` (`ADMIN`, `TEACHER`, `STUDENT`); матрица прав задаётся в маршрутах через
`requireRole` и проверки владения. Таблицы `Permission` и `RolePermission` существуют в схеме для
перехода к настраиваемым правам, но в текущей логике не используются.

| Действие | STUDENT | TEACHER | ADMIN |
| --- | --- | --- | --- |
| Каталог курсов | ✔ | ✔ | ✔ |
| Чужой неопубликованный курс / урок | ✘ | ✔ | ✔ |
| Прогресс, завершение урока | ✔ (свой) | — | — |
| CRUD урока | ✘ | ✔ только свои курсы | ✔ |
| Тесты: прохождение | ✔ (записан) | — | — |
| Тесты: результаты группы | — | ✔ свои курсы | ✔ |
| Домашние задания: отправка | ✔ | — | — |
| Начисление монет | ✘ | ✔ своим ученикам, ≤ 1000 за операцию | ✔ |
| Товары магазина | чтение | чтение | ✔ создание/изменение |
| Заказы магазина | ✔ свои | — | ✔ обработка |
| База знаний | чтение, избранное | ✔ + свои материалы | ✔ все материалы |
| Админ-раздел | ✘ | ✘ | ✔ |
| Чужой профиль | ✘ (404) | ✔ ограниченные поля | ✔ |

Ключевые проверки владения реализованы: урок — `module.course.teacherId === userId`; задание —
`homework.course.teacherId === userId`; тест — `test.course.teacherId === userId`; начисление монет —
ученик записан на курс преподавателя; переписка —
участие в `ConversationParticipant`; видеокомната — преподаватель курса или админ; запись — преподаватель.

Самостоятельно назначить роль невозможно: поле `role` отсутствует в регистрации и в `PATCH /users/me`,
менять роль может только `PATCH /api/admin/users/:id` (ADMIN) с записью в аудит.

### 5.6 Реальное время

Socket.IO поднимается на том же HTTP-сервере (`src/websocket/realtime.ts`). Аутентификация — access-токен в
`socket.handshake.auth.token`; после подключения сокет вступает в личную комнату `user:<id>`.

- `conversation:join` / `conversation:leave` — вход в `conversation:<id>` только после проверки участия в БД.
- `typing` — рассылается участникам комнаты.
- `message:new`, `message:notification` — серверные события после сохранения сообщения через REST.

Отправка сообщений намеренно идёт через REST: сохранение, проверка прав, уведомления и рассылка события
происходят в одной транзакционной цепочке, а сокет остаётся транспортом доставки.

### 5.7 Видеозанятия

1. Преподаватель создаёт комнату: `POST /api/scheduling/schedules/:id/video/room` → проверка доступа к
   занятию → `VideoRoom` с идентификатором комнаты LiveDigital (только после ответа провайдера).
2. Ученик запрашивает вход: `POST /api/scheduling/schedules/:id/video/join` → проверка окна доступа и
   зачисления → короткоживущий signaling-токен и данные участника LiveDigital.
3. Посещаемость: вход создаёт `Attendance` (или обновляет `leftAt = null`), выход закрывает интервал и
   добавляет `durationSeconds`; повторные подключения суммируются.
4. Запись: `POST /api/scheduling/schedules/:id/recording/start|stop` → облачная запись LiveDigital →
   `VideoRecording`; по вебхуку запись переносится в S3-хранилище. Без настроек запись возвращает 503.
5. Вебхуки: `/api/scheduling/livedigital` смонтирован **до** `express.json` с `express.raw`, чтобы проверить
   HMAC-подпись и хеш тела; без валидной подписи запрос отклоняется.
6. Секреты LiveDigital живут только в env сервера. Мобильное приложение получает лишь токен и URL.

### 5.8 Экономика: монеты, достижения, магазин

- Баланс — `CoinBalance` (1:1 к пользователю), каждая операция — строка `CoinTransaction` с причиной и
  автором (`awardedById`). Баланс меняется только вместе с транзакцией в `prisma.$transaction`.
- Начисление преподавателем ограничено суммой и его учениками; причина обязательна; пишется аудит.
- Автоматические начисления (`src/lib/coins.ts`): ДЗ — 2–20 монет пропорционально баллу, тест — 10–20
  по проценту, посещение — 3 монеты. `CoinTransaction.sourceType/sourceId` + уникальный ключ
  `[userId, sourceType, sourceId]` исключают повторное начисление за одно действие; баланс и журнал
  меняются в одной транзакции.
- Достижения: условие хранится в `Achievement.condition` (JSON: `lessons_completed`, `homework_reviewed`,
  `tests_completed`, `courses_completed`, `attendance`, `coins_earned`), проверка — `evaluate.ts`,
  повторная выдача исключена составным ключом `UserAchievement(userId, achievementId)`.
- Магазин: заявка списывает монеты и остаток атомарно; отклонение возвращает и то, и другое отдельными
  операциями в той же транзакции. Статусы: `NEW → APPROVED → ISSUED`, `REJECTED`.
- Идемпотентность отправки ДЗ — уникальный `HomeworkSubmission.idempotencyKey`.

### 5.9 Почта, аудит, документация

- `lib/mailer.ts`: при наличии SMTP отправляет письмо, иначе пишет в лог (dev). Письма — подтверждение email
  и сброс пароля.
- `lib/audit.ts`: `AuditLog` (актор, действие, сущность, id, metadata, ip). Пишутся: удаление аккаунта,
  смена роли/блокировка, начисление монет, обработка заказов, жалобы на сообщения, публикация материалов,
  вход/выход из видеокомнаты, критические изменения уроков.
- Swagger UI — `/docs`, спецификация собирается в `src/docs/openapi.ts`.

## 6. Мобильное приложение

### 6.1 Слои

| Слой | Файлы | Ответственность |
| --- | --- | --- |
| Маршрутизация | `src/app/**` | Expo Router, файловые маршруты, группы по ролям |
| Состояние сессии | `src/store/auth.ts` | Zustand: пользователь, роль, статус гидратации, вход/выход |
| Данные | `src/api/client.ts`, `api.ts`, `session.ts` | Axios, базовый URL, интерсепторы, refresh, разбор ошибок |
| Кеш сервера | компоненты экранов | TanStack Query: `useQuery`/`useMutation`, инвалидация, pull-to-refresh |
| Realtime | `src/services/socket.ts` | подключение Socket.IO с access-токеном |
| Дизайн-система | `src/theme`, `src/components/ui.tsx` | токены, Button, Input, Card, Badge, Modal, Loader, EmptyState, ErrorState, ProgressBar и др. |
| Локализация | `src/i18n/index.ts` | словари ru/ky/en, `useI18n`, `localeLabels` |
| Утилиты | `src/utils/format.ts` | даты, длительность, числа, ошибки |

### 6.2 Навигация

- Корневой `src/app/_layout.tsx` — провайдеры (QueryClient, SafeArea, тема, i18n), гидратация сессии,
  Splash Screen, редирект по роли.
- `(auth)` — приветствие, вход, регистрация, восстановление пароля. Доступно без сессии.
- `(student)` — вкладки: Главная, Курсы, Расписание, Задания, Профиль. Тесты доступны из курса и с главной.
- `(teacher)` — вкладки: Главная, Ученики, Расписание, Задания, Профиль. «Мои курсы» и редактор
  программы открываются с главной; вкладка `courses` скрыта из таббара (`href: null`).
- `(admin)` — мобильный вход администратора; полноценная работа предполагается в `admin-web`.
- Внегрупповые экраны: `course/[id]`, `lesson/[id]`, `test/[id]`, `homework/[id]`, `video/[scheduleId]`,
  `messages`, `messages/[id]`, `notifications`, `knowledge`, `knowledge/[id]`, `coins`, `shop`,
  `achievements`, `teacher-course/[id]`, `teacher-lesson/[id]`, `teacher-homework/[id]`,
  `teacher-submission/[id]`.
- Защита маршрутов: при отсутствии сессии — редирект в `(auth)`; при несовпадении роли — в свою группу.

### 6.3 Слой данных

`src/api/client.ts`:

- базовый URL из `EXPO_PUBLIC_API_URL` (fallback — локальная сеть разработчика);
- request-интерсептор добавляет access-токен;
- response-интерсептор при 401 один раз обновляет токен через `/api/auth/refresh` и повторяет запрос;
  при неудаче очищает сессию и уводит на вход;
- параллельные 401 разделяют одно обновление токена;
- сообщения об ошибках приводятся к тексту из `error.message` сервера.

Токены — только в `expo-secure-store`; в Zustand хранится производное состояние, не сами токены.

### 6.4 Тема, дизайн-система, локализация

- Палитра: `primary #1B2BCF`, `primaryDark #141FA0`, `primarySoft #EEF0FF`, `accent #35D60A`,
  `background #F5F7FB`, `card #FFFFFF`, `text #0F172A`, `textMuted #6B7280`, `border #E5E7EB`,
  `success/warning/danger`. Отступы 4–32, радиусы 8–24, типографика 11–28.
- Тема: светлая и тёмная, переключение и следование системе; выбор сохраняется на устройстве.
- Локализация: ключи вида `profile.language`, словари `ru`/`ky`/`en`, переключение в профиле и на
  приветственном экране; выбор языка сохраняется и передаётся в `PATCH /api/users/me` (`locale`).
- Логотип и иконки — в `apps/mobile/assets/images/`; splash настраивается `expo-splash-screen` в `app.json`.

### 6.5 Ограничения платформы

`@livekit/react-native` — нативные модули WebRTC. Видеозвонки работают только в development/production
build (`npx expo run:android`, `npx expo run:ios`, EAS Build), не в Expo Go. В Expo Go экран занятия
показывает объяснение, а не падает.

## 7. Административная панель

- SPA: React 19 + Vite 7, маршруты через React Router 7, данные — TanStack Query 5 + Axios.
- Вход: `POST /api/auth/login`; токен в памяти/`localStorage`; все запросы идут в `/api/admin/*`, сервер
  требует роль `ADMIN` — панель не является границей безопасности.
- Разделы: обзор (сводка + активность), пользователи (поиск, фильтр по роли, блокировка, смена роли),
  курсы, аудит. Навигация и таблицы — собственные компоненты в `src/layouts/AppLayout.tsx`.
- В dev `/api` проксируется на `http://localhost:4000` (`vite.config.ts`); в production задаётся `VITE_API_URL`.
- Отклонение от ТЗ: разделы преподавателей, расписания, заданий/тестов, магазина, монет, контента и
  расширенной аналитики ещё не реализованы (часть 10).

## 8. Инфраструктура и окружения

| Окружение | Состав |
| --- | --- |
| Локальная разработка | PostgreSQL и Redis в Docker; backend `npm run dev`; Expo dev server; admin `npm run dev` (порт 5174); LiveDigital — облачный провайдер, локальный SFU не нужен |
| Production | nginx (TLS, статика admin и landing, прокси `/api` и WebSocket), backend в контейнере, PostgreSQL + PgBouncer, Redis, MinIO/S3, Prometheus; LiveDigital — внешний сервис |

Порты по умолчанию: backend 4000, admin 5174, Expo 8081, PostgreSQL 5432, Redis 6379.

CORS: `APP_ORIGIN` задаёт единственный разрешённый origin; для мобильного приложения это не ограничение
(нативные запросы не проходят CORS), но для admin-web origin нужно указать точно.

Подробности развёртывания — в [infrastructure/README.md](../../infrastructure/README.md) и [docs/deployment/development.md](../deployment/development.md).

## 9. Сквозные правила

1. **Валидация.** Любое тело/параметры запроса валидируются Zod-схемой в маршруте. Prisma исключает
   SQL-инъекции; «сырых» запросов с интерполяцией строк нет.
2. **Транзакции.** Деньги, остатки, заказы, оценки и посещаемость меняются в `prisma.$transaction`.
3. **Аудит.** Критичные действия пишутся в `AuditLog` до/вместе с ответом.
4. **Уведомления.** Сервер создаёт `Notification` сам; клиент только читает и отмечает прочитанным.
5. **Пагинация.** Админ-разделы — `page`/`limit` (до 100); сообщения — `before`/`limit` (курсорная);
   база знаний — `page`/`limit` (до 50). Списки в приложении — `FlatList` с `onEndReached`.
6. **Время.** В БД — UTC (`timestamptz`), отображение — в часовом поясе пользователя (`Asia/Bishkek`
   по умолчанию). Длительность занятия — `startsAt`/`endsAt`.
7. **Ошибки клиента.** Единый компонент `ErrorState` + повтор запроса; сетевые ошибки не показывают стек.
8. **Локализация.** Новые тексты добавляются во все три словаря одновременно.

## 10. Соответствие ТЗ и пробелы

Код закрывает части 2–6 и большую часть 8–10. Ниже — честный статус по разделам ТЗ.

| Часть ТЗ | Статус | Что отсутствует |
| --- | --- | --- |
| 1. Анализ и архитектура | ✔ выполнено | — |
| 2. Основа приложения, дизайн-система, темы | ✔ в основном | 19 компонентов из ТЗ + `Screen`/`Title` в `src/components/ui/` с темами (светлая/тёмная/системная, выбор в SecureStore), API-клиент с refresh-интерцептором, защита маршрутов по ролям. Не переведены на тему часть доменных экранов (курсы, тесты, магазин); нет `Dropdown`, `Checkbox`, `RadioButton`, `Switch`, `DatePicker`, `TimePicker` из полного списка ТЗ |
| 3. Backend, PostgreSQL, Prisma, авторизация | ✔ в основном | Ядро на NestJS, но 10 доменов ещё Express-роутеры; Redis подключён для кеша, блокировок и Socket.IO adapter |
| 4. Интерфейс ученика | ✔ в основном | Каталог с категориями, поиском, фильтрами и записью; видеоплеер и прогресс готовы. Профиль не показывает посещаемость/оценки в полном объёме |
| 5. Домашние задания и тесты | ◐ частично | Нет категорий статусов на клиенте, черновика с автосохранением, загрузки файлов, истории версий, экрана проверки преподавателем, конструктора тестов; сервер не принимает файлы (только URL) |
| 6. Расписание и видеоконференции | ✔ в основном | Календарь день/неделя/месяц, создание/перенос/отмена и проверка конфликтов, LiveDigital WebView, чат занятия, посещаемость и запись; предэкранная проверка камеры/микрофона выполняется в Web SDK |
| 7. Интерфейс преподавателя | ◐ частично | Нет управления курсами/модулями, создания заданий, проверки работ, статистики, обратной связи; вкладки «Ученики» и «Задания» есть |
| 8. Сообщения, уведомления, монеты, магазин | ◐ частично | Push-уведомления (`expo-notifications`) не подключены, нет настроек категорий; вложения сообщений — только URL; админ-управление магазином в панели отсутствует |
| 9. База знаний, AI, родитель, локализация | ✔ выполнено | AI-центр, роль `PARENT` с привязкой к ученику, политика/согласия/удаление аккаунта, локализация ru/ky/en |
| 10. Админ-панель | ✔ выполнено | 49 route-level страниц: пользователи, курсы, расписание, ДЗ/тесты/экзамены, магазин, IT Coins, финансы, аналитика, отчёты, интеграции, backup, аудит, безопасность |
| 11. Тестирование, безопасность, offline | ✔ в основном | 263 API-теста и 20 mobile; offline-очередь, повторная синхронизация и e2e в CI с PostgreSQL/Redis |
| 12. Подготовка к запуску | ✔ в основном | `eas.json`, production-compose, nginx, backup/restore, CI/CD и документация есть; нужны внешние credentials и сервер |

Обозначения: ✔ — реализовано и проверено типами/тестами; ◐ — часть работает, часть отсутствует; ✘ — нет.

## 11. Точки расширения

**Новый backend-модуль (Nest):** `src/modules/<domain>/` → `@Controller('api/<domain>')` + `@Injectable()`
сервис + `@Module` → импорт в `AppModule` → Zod-схемы и `zodBody(...)` для тел → при необходимости `@Roles`,
`@RequirePermissions`, запись в `AuditLog` и `Notification` → unit-тест чистой логики в `test/`.

**Перенос Express-модуля в Nest:** создать Nest-модуль с теми же путями и телами → убедиться, что
ответы совпадают → удалить строку из `src/legacy-routers.ts` → прогнать `npm run typecheck && npm test`.

**Новый экран приложения:** файл в `src/app/**` (имя = маршрут) → данные через `useQuery` из `src/api/api.ts`
→ компоненты из `src/components/ui.tsx` → тексты в три словаря → проверка `npx tsc --noEmit`.

**Новая роль (например, PARENT):** добавить значение в `RoleName` (миграция) → модели связи
`ParentStudentLink` → маршрут привязки с кодом-приглашением и подтверждением → `requireRole('PARENT')` →
группа маршрутов `(parent)` в приложении → редирект по роли в `_layout.tsx`.

**Новый платёжный/валютный поток:** только через `CoinTransaction` + `CoinBalance` в одной транзакции,
с уникальным ключом идемпотентности.

**Push-уведомления:** сервер уже создаёт `Notification`; добавить `expo-notifications`, регистрацию
`pushToken` в `UserDevice`, отправку через Expo Push API из `lib/`, обработку deep link по `data.route`.

## 12. Технический долг и риски

| Риск | Влияние | План |
| --- | --- | --- |
| Гибридный backend: Nest + 13 Express-роутеров | Два стиля в одном коде, новые разработчики могут выбрать неверный | Переносить по модулю; список оставшихся — `src/legacy-routers.ts` |
| Миграции в CI | Схема может разойтись при ручном деплое | CI выполняет `prisma migrate deploy`; production — сервис `migrate` в compose |
| Фоновые планировщики живут в процессе API | При рестарте возможна задержка, а без Redis несколько реплик могут дублировать работу | Redis-блокировки исключают дубли; при росте нагрузки вынести задачи в отдельный worker/BullMQ |
| Файлы и записи | Нужны диск и антивирус | S3/MinIO + локальный fallback, ACL, квоты, антивирус и `UPLOADS_DIR` на volume |
| Роль PARENT | Кабинет должен быть у всех ролей | Веб- и мобильный кабинеты `(parent)`, связь подтверждает администратор |
| Тестовое покрытие | Регрессии в маршрутах и БД | 263 API-теста, 20 mobile, 9 e2e в CI с PostgreSQL/Redis |
| Данные в `seed.ts` демонстрационные | Не продакшн-контент | Seed только для development; в production — пустая БД и админ через bootstrap-скрипт |

## 13. План дальнейшей разработки

> Историческая таблица: этапы 2–12 реализованы в текущем репозитории и оставлены для трассировки. Актуальный статус и проверки — в [`delivery-plan.md`](delivery-plan.md).

Порядок соответствует частям ТЗ; каждый этап заканчивается проверками (`tsc`, тесты) и отчётом.

| Этап | Содержание | Затрагиваемые модули |
| --- | --- | --- |
| 2 | Фундамент приложения: компоненты дизайн-системы отдельными файлами, `BottomSheet`, `Skeleton`, анимации, логотип на splash/auth/профиле, доступность, единые токены | `apps/mobile/src/theme`, `components`, `assets` |
| 3 | Backend: initial-миграция Prisma, Redis-адаптер лимитов и кеша, Storage (S3/MinIO), политика прав `Permission`/`RolePermission`, интеграционные тесты с тестовой БД | `apps/api/prisma/migrations`, `lib`, `middleware`, `test` |
| 4 | Интерфейс ученика: каталог с 11 категориями и записью, встроенный видеоплеер, профиль с посещаемостью и оценками | `courses`, `lessons`, `users`, `(student)` |
| 5 | Домашние задания и тесты: загрузка файлов, черновик, версии, проверка преподавателем, конструктор тестов | `homework`, `tests`, Storage, `(teacher)` |
| 6 | Расписание и конференции: CRUD занятий с проверкой конфликтов, календарь, чат и демонстрация экрана, предэкранная проверка устройств | `schedule`, `video`, `(student)`, `(teacher)` |
| 7 | Интерфейс преподавателя: курсы, модули, задания, проверка работ, статистика группы | `courses`, `lessons`, `homework`, `(teacher)` |
| 8 | Push-уведомления (`expo-notifications`), настройки категорий, deep linking, вложения сообщений | `notifications`, `messages`, `lib`, `UserDevice` |
| 9 | Роль `PARENT` и привязка к ученику, экраны родителя, AI-помощник на сервере, политика/согласия/удаление аккаунта | `RoleName`, `ParentStudentLink`, новый `ai`-модуль, `(parent)` |
| 10 | Админ-панель: все разделы из ТЗ, графики, подтверждения критичных действий | `apps/web/src/pages`, `admin` |
| 11 | Тестирование и безопасность: integration/E2E, offline-очередь, аудит зависимостей, нагрузочные проверки лимитов | все приложения |
| 12 | Публикация: `eas.json`, APK/AAB, iOS-конфигурация, production-compose, nginx/TLS, бэкапы, мониторинг, документация сборок | `apps/mobile/app.json`, `infrastructure`, README |
