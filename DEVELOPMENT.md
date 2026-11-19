# Руководство по разработке ITadis

Практическое руководство: как поднять проект с нуля, какие команды действительно работают и как
проверять изменения. Все команды приведены для структуры этого репозитория.

## Содержание

- [1. Требования](#1-требования)
- [2. Быстрый старт](#2-быстрый-старт)
- [3. Переменные окружения](#3-переменные-окружения)
- [4. База данных](#4-база-данных)
- [5. Backend](#5-backend)
- [6. Мобильное приложение](#6-мобильное-приложение)
- [7. Административная панель](#7-административная-панель)
- [8. LiveKit](#8-livekit)
- [9. Проверки перед коммитом](#9-проверки-перед-коммитом)
- [10. Демо-аккаунты](#10-демо-аккаунты)
- [11. Типовые проблемы](#11-типовые-проблемы)
- [12. Соглашения разработки](#12-соглашения-разработки)

---

## 1. Требования

| Инструмент | Версия | Проверено |
| --- | --- | --- |
| Node.js | 20 LTS или новее | 26.13.0 |
| npm | 10+ | 11.20.0 |
| PostgreSQL | 16 | не проверялось локально (нет Docker) |
| Docker Desktop | любая актуальная | **отсутствует на текущей машине** |
| Redis | 7 (опционально) | не требуется кодом |
| Android Studio / эмулятор | для `expo run:android` | — |
| Xcode | только macOS, для iOS | — |
| EAS CLI | для сборок | — |

Мобильное приложение можно запустить в Expo Go для большинства экранов, но **видеозвонки требуют
development build** (`@livekit/react-native` — нативные модули).

## 2. Быстрый старт

```bash
# 1. Переменные окружения
cp .env.example .env
cp backend/.env.example backend/.env

# 2. Инфраструктура (PostgreSQL, Redis, LiveKit)
docker compose up -d postgres redis livekit

# 3. Backend
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
# → http://localhost:4000, Swagger: http://localhost:4000/docs

# 4. Мобильное приложение (новый терминал)
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<IP-компьютера>:4000/api npx expo start

# 5. Админ-панель (новый терминал)
cd admin-web
npm install
npm run dev
# → http://localhost:5174
```

> На текущей машине Docker не установлен. Для проверки миграций, seed и API поднят локальный кластер
> PostgreSQL 16 (см. «Запуск PostgreSQL без Docker» в §4).

Порты:

| Сервис | Порт |
| --- | --- |
| Backend API + Socket.IO | 4000 |
| Swagger UI | 4000 (`/docs`) |
| Expo dev server | 8081 |
| Admin web (Vite) | 5174 |
| Лендинг (Vite) | 5173 |
| PostgreSQL | 5432 |
| Redis | 6379 |
| LiveKit HTTP / RTC / UDP | 7880 / 7881 / 7882 |

## 3. Переменные окружения

### Корень `.env` (для docker compose)

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `REDIS_PORT`, `BACKEND_PORT`,
`LIVEKIT_*`. Значения по умолчанию работают для локальной разработки.

### `backend/.env`

Обязательные:

```dotenv
DATABASE_URL="postgresql://itadis:itadis@localhost:5432/itadis?schema=public"
PORT=4000
NODE_ENV=development
APP_ORIGIN=http://localhost:8081
JWT_ACCESS_SECRET="не короче 16 символов"
JWT_REFRESH_SECRET="другой секрет, не короче 16 символов"
```

Опциональные:

| Переменная | Назначение | Без неё |
| --- | --- | --- |
| `ACCESS_TOKEN_TTL` | срок access-токена (по умолчанию `15m`) | 15 минут |
| `REFRESH_TOKEN_TTL_DAYS` | срок refresh (по умолчанию 30) | 30 дней |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | письма подтверждения и сброса | письмо пишется в лог (dev) |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | видеозанятия | `/api/video/*` отвечает 503 |
| `LIVEKIT_EGRESS_URL` | отдельный адрес Egress | используется `LIVEKIT_URL` |
| `RECORDING_S3_*` | запись занятий | старт записи отвечает 503 |
| `AI_DAILY_REQUEST_LIMIT` | задел для AI-модуля | модуль не реализован |

`backend/src/config/env.ts` валидирует переменные через Zod при старте: при некорректном значении
процесс падает с понятной ошибкой, а не с неясным 500 позже.

### `mobile`

Переменная одна: `EXPO_PUBLIC_API_URL` — базовый URL API **вместе с `/api`**.

- физическое устройство: `http://192.168.x.x:4000/api` (localhost с телефона недоступен);
- Android-эмулятор: `http://10.0.2.2:4000/api`;
- iOS-симулятор: `http://localhost:4000/api`.

Значение встраивается в бандл на этапе сборки, поэтому после изменения нужен перезапуск Expo.

### `admin-web`

`VITE_API_URL` — только для production, если панель и API на разных доменах
(например, `https://api.itadis.kg/api`). В dev используется прокси `/api` → `localhost:4000`.

Разделы панели и маршруты API: обзор (`/admin/dashboard`, `/admin/analytics`), пользователи
(`/admin/users`), курсы (`/admin/courses`), расписание (`/admin/schedule`), проверка работ
(`/admin/submissions`, `/admin/test-attempts`), магазин (`/admin/shop-orders`, модерация через
`PATCH /shop/orders/:id`), IT Coins (`/admin/coin-transactions`), аудит (`/admin/audit-logs`).
Доступ проверяется на входе по роли `ADMIN` и повторно на каждом маршруте сервера.

## 4. База данных

### Запуск PostgreSQL

```bash
docker compose up -d postgres
```

### Запуск PostgreSQL без Docker

Если Docker не установлен, а PostgreSQL 16 есть (Windows-установка, `/c/Program Files/PostgreSQL/16/bin`),
можно поднять изолированный кластер внутри проекта — он не затрагивает системный экземпляр и исключён из git:

```bash
cd backend
PGBIN="/c/Program Files/PostgreSQL/16/bin"
"$PGBIN/initdb" -D .pgdata -U itadis --auth=trust -E UTF8 --locale=C
"$PGBIN/pg_ctl" -D .pgdata -o "-p 55432" -l ../pg-local.log start
"$PGBIN/createdb" -h 127.0.0.1 -p 55432 -U itadis itadis
```

В `backend/.env` для такого кластера:

```dotenv
DATABASE_URL="postgresql://itadis@127.0.0.1:55432/itadis?schema=public"
```

Остановка: `"$PGBIN/pg_ctl" -D .pgdata stop`. Порт 55432 выбран, чтобы не конфликтовать с системным 5432.

### Миграции и seed

```bash
cd backend
npx prisma generate                 # клиент Prisma
npx prisma migrate deploy           # применить миграции из prisma/migrations
npm run prisma:seed                 # демо-данные
npx prisma validate                 # проверка схемы
npx prisma studio                   # визуальный просмотр БД (опционально)
```

Каталог `backend/prisma/migrations` хранится в репозитории: `20261114115123_nest_rbac_roles` —
initial-миграция (49 моделей, 17 enum) вместе с RBAC-каталогом и категориями курсов.
Создание новой миграции после правки схемы: `npx prisma migrate dev --name <название>`.

### Сброс базы

```bash
cd backend
npx prisma migrate reset   # удалит данные, применит миграции и выполнит seed
```

### Seed

`prisma/seed.ts` создаёт четыре роли (`ADMIN`, `TEACHER`, `STUDENT`, `PARENT`), каталог прав и матрицу
`RolePermission`, профили `Student`/`Teacher`/`Parent` со связью `ParentStudentLink`, пользователей
admin/teacher/student/parent, курсы с модулями и уроками, расписание, домашние задания, тест с вопросами,
товары магазина, достижения и категории базы знаний. Seed идемпотентен (`upsert` по email/коду роли).
**Это демонстрационные данные для development, не для production.**

## 5. Backend

```bash
cd backend
npm run dev          # tsc-watch → node dist/src/main.js (перезапуск при изменениях)
npm run build        # tsc → dist/
npm start            # node dist/src/main.js
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run prisma:validate
node scripts/verify-nest-api.mjs   # сквозная проверка API на запущенном сервере
```

> `npm run dev` использует `tsc-watch`, а не `tsx`: Nest строит DI на метаданных декораторов
> (`design:paramtypes`), которые esbuild не генерирует. С `tsx` приложение падает на старте с ошибкой
> внедрения зависимостей.

Что поднимается в `main.ts`: Nest-приложение (`AppModule`), Socket.IO на том же HTTP-сервере, legacy
Express-роутеры из `src/legacy-routers.ts`, graceful shutdown по `SIGINT`/`SIGTERM`.

Добавление маршрута в Nest-модуль:

1. `src/nest/modules/<domain>/<domain>.controller.ts` — `@Controller('api/<domain>')`;
2. тело запроса — zod-схема и `@Body(zodBody(schema))`;
3. авторизация — глобальный `JwtAuthGuard`; роли — `@Roles(...)`, права — `@RequirePermissions(...)`;
4. `@Injectable()`-сервис с `@Inject(PrismaService)` — вся логика и проверка владения в нём;
5. зарегистрировать модуль в `src/nest/app.module.ts`;
6. при записи — `writeAudit`, при событии для пользователя — `Notification`;
7. прогнать `npm run typecheck && npm test`.

Что обязательно помнить:

- внедрение зависимостей — через `@Inject(Token)`; без метаданных это единственный надёжный способ;
- порядок глобальных guard'ов задан в `AppModule`: throttle → JWT → роли → права;
- публичные маршруты помечать `@Public()` — иначе `JwtAuthGuard` закроет их;
- новый Express-модуль (если модуль ещё не перенесён) монтируется в `src/legacy-routers.ts`.

Чистую логику (подсчёт баллов, политику паролей, подпись токенов) выносить в отдельный модуль и
покрывать unit-тестом в `test/` — именно так устроены `grading.ts`, `security.ts`, `livekit.ts`.

## 6. Мобильное приложение

```bash
cd mobile
npm install
npx expo start          # QR для Expo Go / выбор платформы
npx expo start --web    # проверка в браузере (без нативных модулей)
npx expo run:android    # development build с LiveKit
npx expo run:ios        # только macOS
npx tsc --noEmit        # проверка типов
```

Expo Router: маршрут = файл в `src/app`. Группы `(auth)`, `(student)`, `(teacher)`, `(admin)` задают
навигацию по ролям. Новый экран: создать файл, добавить ссылку/`router.push`, тексты — в
`src/i18n/index.ts` (ru/ky/en).

Важно:

- после изменения `app.json` или нативных зависимостей нужен перезапуск с `--clear` и новая
  development-сборка;
- LiveKit в Expo Go не работает — это ожидаемое поведение, экран показывает объяснение;
- `EXPO_PUBLIC_*` попадает в бандл: секретов там быть не должно;
- тема и язык хранятся на устройстве; токены — только в `expo-secure-store`.

## 7. Административная панель

```bash
cd admin-web
npm install
npm run dev        # http://localhost:5174, прокси /api → :4000
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit + vite build
npm run preview
```

Вход — пользователь с ролью `ADMIN`. Панель не заменяет серверную проверку: все `/api/admin/*`
требуют роль на backend. При ошибке 403 панель показывает отказ, а не пустой экран.

## 8. LiveKit

Локальный сервер (ключи `devkey` / `secret`):

```bash
docker compose up -d livekit
```

`backend/.env`:

```dotenv
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Проверка: `GET /api/video/status` должен вернуть `{ "enabled": true, "recording": false }`.

Для записи нужен LiveKit Egress и S3-совместимое хранилище (`RECORDING_S3_*`). В dev-режиме без них
запись недоступна — это ожидаемо.

Для телефона в локальной сети `ws://localhost:7880` не подойдёт: укажите IP компьютера в
`LIVEKIT_URL` и убедитесь, что порты 7880/TCP, 7881/TCP и 7882/UDP доступны.

## 9. Проверки перед коммитом

```bash
# Backend
cd backend && npm run typecheck && npm test && npx prisma validate
# сквозные проверки API при запущенном сервере
node scripts/verify-teacher-api.mjs
node scripts/verify-learning-flow-api.mjs

# Mobile
cd mobile && npx tsc --noEmit

# Admin
cd admin-web && npm run typecheck && npm run build

# Лендинг (корень)
npm run lint && npm run build
```

Текущий статус (17.11.2026):

| Проверка | Результат |
| --- | --- |
| `backend: tsc --noEmit` | ✔ без ошибок |
| `backend: vitest run` | ✔ 4 файла, 28 тестов |
| `backend: prisma validate` | ✔ схема валидна (команда требует созданного `backend/.env` с `DATABASE_URL`, иначе падает на отсутствии переменной) |
| `mobile: tsc --noEmit` | ✔ без ошибок (чат, push, AI, приватность, локализация) |
| `admin-web: tsc --noEmit && vite build` | ✔ сборка в `dist/` без ошибок |
| Миграции/seed | ✔ схема применена на локальном PostgreSQL 16 (порт 55432), seed выполнен |
| `verify-teacher-api.mjs` | ✔ все проверки: курсы, модули, уроки, публикация, задания, очередь, оценка, возврат, RBAC |
| `verify-learning-flow-api.mjs` | ✔ 31 проверка: расписание и конфликты, сдача ДЗ с файлами, повторная сдача, монеты за ДЗ/тест без дублей, история |
| Живой API: админ-разделы | ✔ `submissions`, `test-attempts`, `coin-transactions`, `schedule`, `shop-orders`, `analytics` отвечают 200 |
| Живой API: мессенджер | ✔ личный и курсовой чаты, непрочитанные, отметка прочтения |
| Живой API: магазин | ✔ заявка списывает монеты и остаток, отклонение возвращает их одной транзакцией |
| `admin-web` в браузере | ✔ вход ADMIN, обзор с графиками, расписание (день/неделя/месяц), проверка работ и тестов, магазин, IT Coins — без ошибок в консоли и сети |

Правило: не коммитить, пока не проходят typecheck и тесты затронутого пакета. Если проверку выполнить
нельзя (нет БД, нет нативной сборки) — явно указать это, а не выдавать за успех.

`npm run prisma:validate` читает `DATABASE_URL` из `backend/.env`; без файла проверьте схему так:

```bash
DATABASE_URL="postgresql://itadis:itadis@localhost:5432/itadis?schema=public" npx prisma validate
```

## 10. Демо-аккаунты

Создаются `npm run prisma:seed` (только development):

| Роль | Email | Телефон | Пароль |
| --- | --- | --- | --- |
| ADMIN | `admin@itadis.kg` | `+996700000001` | `ITadis2026` |
| TEACHER | `teacher@itadis.kg` | `+996700000002` | `ITadis2026` |
| STUDENT | `student@itadis.kg` | `+996700000003` | `ITadis2026` |

Пароль соответствует политике (8+ символов, заглавная, цифра). В production эти аккаунты должны
отсутствовать: первого администратора создавать отдельным bootstrap-скриптом.

## 11. Типовые проблемы

| Симптом | Причина | Решение |
| --- | --- | --- |
| `Can't reach database server` | PostgreSQL не запущен | `docker compose up -d postgres`, проверить `DATABASE_URL` |
| `P1001`/`P2021` в Prisma | нет миграций или неверная база | `npx prisma migrate dev`, проверить имя БД |
| `Unknown argument` / нет типов Prisma | не сгенерирован клиент | `npx prisma generate` |
| Мобильное приложение не видит API | `localhost` на телефоне | указать IP компьютера в `EXPO_PUBLIC_API_URL` |
| 401 после долгого простоя | истёк refresh/отозвана семья | войти заново; проверить часы устройства |
| LiveKit: 503 | не заданы ключи | заполнить `LIVEKIT_*`, перезапустить backend |
| Видео не подключается в Expo Go | нативные модули | `npx expo run:android` / EAS development build |
| CORS в админке | `APP_ORIGIN` не совпадает | указать точный origin панели в `backend/.env` |
| Expo кеш после смены конфига | старый бандл | `npx expo start --clear` |
| Порт занят | другой процесс | проверить `netstat`/`lsof`, сменить `PORT` |

Диагностика backend: лог `morgan` в dev, `GET /healthz`, `GET /docs` (Swagger). Ошибки с кодом
`INTERNAL_ERROR` печатаются в консоль сервера — смотреть там, а не в ответе API.

## 12. Соглашения разработки

### Код

- TypeScript strict; в backend ESM (`"type": "module"`), импорты с расширением `.js`.
- Валидация — Zod в маршруте, не в компоненте.
- Проверка прав — до выборки данных; для скрытых сущностей отдавать `404`, не `403`.
- Ошибки — через `AppError` (`badRequest`, `forbidden`, `notFound`, `conflict`), не `res.status` вручную.
- Никаких `any` без причины и `@ts-ignore` для обхода ошибок.
- Комментарии — по-русски, только там, где объясняют неочевидное правило.

### Файлы и именование

- Backend: `modules/<domain>/<domain>.routes.ts`, доменная логика — `<domain>.service.ts`.
- Mobile: экран — `src/app/<route>.tsx`; переиспользуемое — `src/components`; данные — `src/api/api.ts`.
- Admin: страница — `src/pages/<Name>.tsx`, запросы — `src/api/admin.ts`.

### Работа с репозиторием

- В корне **нет git-репозитория**, а в `mobile/` есть вложенный `.git`. Перед первым общим коммитом
  нужно согласовать удаление вложенного репозитория и инициализацию корневого.
- Не удалять чужие изменения и не использовать `git add -A`; коммитить только свои файлы.
- Не коммитить `.env`, ключи LiveKit/S3/SMTP, токены и `node_modules`.
- После изменения схемы Prisma — новая миграция, а не правка уже применённой.
