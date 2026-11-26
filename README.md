# IT Adis — мобильная образовательная платформа

Монорепозиторий платформы: мобильное приложение (Expo / React Native), API-сервер (NestJS + Prisma + PostgreSQL), административная веб-панель и веб-лендинг с иконкой приложения.

```
.
├── apps/
│   ├── api/                    # NestJS + Prisma: REST, Socket.IO, jobs, integrations
│   │   ├── src/modules/        # 64 каталога модулей; 41 обязательный из ТЗ
│   │   ├── src/nest/           # guards, filters, RBAC, Prisma, config
│   │   ├── src/lib/            # серверные утилиты
│   │   └── prisma/             # схема, миграции, seed
│   ├── web/                    # административная панель: React + Vite
│   │   ├── src/app/            # маршруты и навигация
│   │   ├── src/features/       # доменные панели: community, scheduling
│   │   ├── src/layouts/        # AppLayout и каркас
│   │   ├── src/locales/        # ru/ky/en
│   │   ├── src/styles/         # CSS по слоям
│   │   └── src/pages/          # route-level страницы
│   └── mobile/                 # Expo / React Native
├── packages/
│   ├── shared-types/           # общие типы ролей, API и модулей
│   ├── validation/             # общие zod-схемы
│   ├── api-client/             # типизированный fetch-клиент
│   ├── ui/                     # дизайн-токены
│   └── config/                 # общий strict tsconfig
├── infrastructure/             # docker, deployment, monitoring, scripts
├── docs/                       # architecture, api, database, deployment
├── index.html, src/, public/   # лендинг (Vite), отдельный Sites-деплой
├── docker-compose.yml          # PostgreSQL + Redis + API
├── docker-compose.prod.yml     # production-топология
├── package.json                # workspace root
├── .env.example
└── README.md
```

## Документация

| Документ | О чём |
| --- | --- |
| [docs/architecture/blueprint.md](docs/architecture/blueprint.md) | Итоговая архитектура, структура, модель данных, план модулей, внешние API и команды PowerShell |
| [docs/architecture/monorepo.md](docs/architecture/monorepo.md) | Структура монорепозитория и правила зависимостей |
| [docs/architecture/overview.md](docs/architecture/overview.md) | Слои, модули, авторизация, realtime, видео, статус по этапам ТЗ |
| [docs/technology-stack.md](docs/technology-stack.md) | Обязательный стек раздела 24, обоснование LiveDigital и офлайна, БД филиалов, инфраструктура |
| [docs/api/modules.md](docs/api/modules.md) | 41 обязательный backend-модуль: маршруты, доступ, DTO и read-модели |
| [docs/api/endpoints.md](docs/api/endpoints.md) | Все HTTP-маршруты, роли, тела запросов, ошибки, Socket.IO, вебхуки |
| [docs/database/schema.md](docs/database/schema.md) | Модели Prisma, enum, индексы, каскады, транзакции |
| [docs/deployment/development.md](docs/deployment/development.md) | Требования, переменные окружения, миграции, seed, проверки |
| [docs/integrations/README.md](docs/integrations/README.md) | Адаптеры внешних сервисов, хранение секретов, health-check, повторы, журнал |
| [docs/testing/strategy.md](docs/testing/strategy.md) | Уровни тестов, покрытие требований, изоляция филиалов, e2e на стенде |
| [docs/architecture/delivery-plan.md](docs/architecture/delivery-plan.md) | Этапы A–G и артефакты каждого этапа |
| [docs/architecture/final-result.md](docs/architecture/final-result.md) | Матрица 30 систем, связность, проверки и внешние ограничения |
| [infrastructure/README.md](infrastructure/README.md) | Production-топология и чек-лист перед публикацией |

## Стек

| Часть | Технологии |
| --- | --- |
| Mobile | React Native, Expo SDK 58, TypeScript, Expo Router, TanStack Query, Zustand, React Hook Form, Zod, Axios, Expo SecureStore |
| Backend | Node.js, NestJS 12, TypeScript, Prisma 6, PostgreSQL, JWT + refresh rotation, RBAC (guards), Zod, Swagger, helmet, rate-limit, bcrypt |
| Админ-панель | React 19, TypeScript, Vite 7, React Router 7, TanStack Query, Axios |
| Инфраструктура | Docker Compose (PostgreSQL 16, Redis 7, MinIO, API, admin, nginx, Prometheus), GitHub Actions, Vitest |

## Требования

- Node.js 20+ (проверено на 26), npm 10+
- Docker Desktop (для PostgreSQL/Redis) — иначе нужен любой доступный PostgreSQL 16
- Телефон с Expo Go или эмулятор Android / симулятор iOS

## Быстрый старт

### 1. База и API

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
docker compose up -d postgres redis
cd apps/api
npm install
npx prisma migrate deploy            # применить миграции из prisma/migrations
npm run prisma:seed                  # демо-данные (5 ролей)
npm run dev                          # http://localhost:4000, Swagger: /docs
```

Без Docker: поднимите PostgreSQL 16 (или локальный кластер, см. docs/deployment/development.md), создайте базу `itadis`
и укажите строку подключения в `apps/api/.env` (`DATABASE_URL`), затем выполните тот же набор команд.

### 2. Мобильное приложение

```bash
cd apps/mobile
npm install
# в apps/mobile/.env или через переменную окружения:
# EXPO_PUBLIC_API_URL=http://<IP-компьютера>:4000/api
npx expo start
```

Для реального телефона `localhost` не работает — укажите IP компьютера в локальной сети. Для Android-эмулятора используйте `http://10.0.2.2:4000/api`.

Если в оболочке уже задана переменная `PORT` (например, `PORT=0`), backend её унаследует и не стартует —
перекройте значение при запуске: `PORT=4000 npm run dev`.

### 3. Админ-панель (`apps/web/`)

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5174, /api проксируется на http://localhost:4000
npm run build      # tsc --noEmit + vite build в dist/
npm run preview    # локальный просмотр production-сборки
```

Вход — только аккаунт с ролью `ADMIN` (`admin@itadis.kg` / `ITadis2026`). Для деплоя за другим доменом
задайте `VITE_API_URL` (например, `https://api.itadis.kg/api`) на этапе сборки.

### 4. Публичный сайт (лендинг + кабинет)

Сайт собирается одной командой: лендинг попадает в `dist/`, кабинет — в `dist/app/`.

```bash
npm run build:site   # vite build + apps/web с --base=/app/ + копирование в dist/app/
```

Деплой идёт по манифесту [`freebuff.sites.json`](freebuff.sites.json): воркер
[`infrastructure/sites/worker.js`](infrastructure/sites/worker.js) плюс `assetsDirectory: ./dist`.
Воркер отдаёт `/app/*` из `dist/app/` с SPA-фолбэком и проксирует `/api` и `/socket.io/`
на `API_ORIGIN` (задаётся в настройках сайта).

`npm run build` собирает только лендинг: получившийся `dist/` без `dist/app/` и без воркера даёт
404 на `/app/login` (вход из шапки) и HTML вместо JSON на `/api/*`. Если `/app/login` показывает
«Страница не найдена» — опубликована не та сборка, пересоберите через `build:site`.

### Демо-аккаунты (после `npm run prisma:seed`)

| Роль | Email | Телефон | Пароль |
| --- | --- | --- | --- |
| Администратор | admin@itadis.kg | — | `ITadis2026` |
| Менеджер | manager@itadis.kg | — | `ITadis2026` |
| Преподаватель | teacher@itadis.kg | +996700000001 | `ITadis2026` |
| Ученик | student@itadis.kg | +996700000002 | `ITadis2026` |
| Родитель | parent@itadis.kg | +996700000003 | `ITadis2026` |

Вход возможен по email или телефону. Приложение само перенаправляет в интерфейс роли.

## Переменные окружения

Все секреты хранятся только в `apps/api/.env` (файл в `.gitignore`) и не попадают в мобильное приложение
или админ-панель. Шаблон — [`apps/api/.env.example`](apps/api/.env.example).

Production-окружение: скопируйте [`.env.production.example`](.env.production.example) в
`.env.production`, заполните домены и секреты и запустите `docker compose` по инструкции из
[`infrastructure/deployment/README.md`](infrastructure/deployment/README.md). Шаблон уже содержит
все серверные ключи интеграций; TLS завершается балансировщиком.

### Обязательные

| Переменная | Назначение | Пример |
| --- | --- | --- |
| `DATABASE_URL` | Подключение к PostgreSQL | `postgresql://itadis:itadis@localhost:5432/itadis?schema=public` |
| `JWT_ACCESS_SECRET` | Подпись access-токенов, минимум 16 символов | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Подпись refresh-токенов, минимум 16 символов | отдельное случайное значение |
| `ACCESS_TOKEN_TTL` | Время жизни access-токена | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | Время жизни refresh-токена | `30` |
| `PORT` | Порт API | `4000` |
| `APP_ORIGIN` | Разрешённый origin для CORS | `http://localhost:8081` |

### Внешние сервисы (по необходимости)

| Переменные | Без них |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `AI_DAILY_REQUEST_LIMIT` | AI-помощник показывает инструкцию; `/api/ai/status` возвращает `configured: false` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Письма подтверждения и сброса пароля пишутся в лог; в dev ссылка доступна в ответе |
| `EXPO_ACCESS_TOKEN` | Работает и без него, но с меньшими лимитами Expo Push API |
| `APY_TOKEN` | Серверная проверка email в заявке через ApyHub (формат, домен, одноразовые адреса) пропускается; локальная проверка формата остаётся |
| `UPLOADS_DIR` | Вложения чата сохраняются в `apps/api/uploads` |
| `LIVEDIGITAL_API_URL`, `LIVEDIGITAL_API_TOKEN`, `LIVEDIGITAL_SPACE_ID`, `LIVEDIGITAL_WEBHOOK_SECRET` | Видеозанятия отвечают 503 с инструкцией; ключи видны только серверу |
| `GOOGLE_CLIENT_ID`/`APPLE_CLIENT_ID` | Вход через Google/Apple отвечает 503 и не имитирует успех |
| `GOOGLE_CALENDAR_*`, `APPLE_CALDAV_*`, `OUTLOOK_*` | Синхронизация календарей выключена, адаптер показывает `not_configured` |
| `ACCOUNTING_BASE_URL`, `ACCOUNTING_API_KEY` | Экспорт в бухгалтерию отвечает 503 с перечнем недостающих переменных |
| `FREEDOMPAY_*`, `ELSOM_*` | Онлайн-оплата выключена; наличные и банковский перевод работают |

Полный список адаптеров, их переменных и проверок — в
[`docs/integrations/README.md`](docs/integrations/README.md). Секреты задаёт
администратор сервера (в production — секреты платформы); в админ-панель и
мобильное приложение они не попадают.

`REDIS_URL` используется для общего кеша филиалов, распределённых блокировок фоновых задач и
Socket.IO Redis adapter. Без Redis один процесс работает с кешем и блокировками в памяти; для
нескольких реплик API Redis обязателен. Rate limit Express остаётся в памяти процесса.

Видеопровайдер — **LiveDigital** (Moodhood API): комнаты, запись, аналитика и вебхуки. Записи
переносятся в файловое хранилище ITadis. Переменные `LIVEKIT_*` оставлены только для чтения
старых записей, новые занятия идут через LiveDigital.

### Мобильное приложение

| Переменная | Назначение |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Базовый URL API, например `http://192.168.1.10:4000/api` |
| `EXPO_PUBLIC_WEB_URL` | Origin веб-кабинета для видеокомнаты, например `https://itadis.kg`; путь `/app` добавляется автоматически |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Project ID EAS для push-токенов (альтернатива `extra.eas.projectId` в `app.json`) |

`apps/mobile/.env` можно создать вручную; переменные с префиксом `EXPO_PUBLIC_` попадают в клиентский бандл,
поэтому там не должно быть секретов.

## Сборка мобильного приложения (EAS)

Профили описаны в [`apps/mobile/eas.json`](apps/mobile/eas.json):

| Профиль | Что собирает | Команда |
| --- | --- | --- |
| `development` | Dev client с нативными модулями (WebView, пуши), APK / iOS simulator | `eas build -p android --profile development` |
| `preview` | Внутренний APK для тестировщиков | `npm run build:android:apk` |
| `production` | AAB для Google Play и сборка для App Store | `npm run build:android:aab`, `npm run build:ios` |
| `submit` | Загрузка собранной версии в Play Console / App Store Connect | `npm run submit:android`, `npm run submit:ios` |

```bash
npm i -g eas-cli
eas login                       # аккаунт Expo
eas init                        # создаёт projectId, добавляет extra.eas.projectId в app.json (нужно для push)
eas build --platform android --profile preview     # APK
eas build --platform android --profile production  # AAB для Google Play
eas build --platform ios --profile production      # IPA для App Store
eas submit --platform android --profile production # загрузка в Play (нужен service account)
eas submit --platform ios --profile production     # загрузка в App Store Connect
```

Перед первой сборкой: `bundleIdentifier` (`kg.itadis.app`) и `package` уже заданы в `apps/mobile/app.json`.
Для `eas submit` заполните `apps/mobile/credentials/play-service-account.json` и параметры Apple в `eas.json`
(в файле стоят заглушки `REPLACE_WITH_*`). Android-профиль загружает AAB в production-трек Play Console;
для первого релиза можно временно поставить `track: internal`, проверить сборку и переключить обратно.
Apple-сборка загружается в App Store Connect и публикуется после проверки вручную. Ключи LiveDigital
задаются только на сервере; для сборки можно передать `EXPO_PUBLIC_API_URL` и `EXPO_PUBLIC_WEB_URL`
через `eas env:create` или EAS secrets.

## Что реализовано

**Этап 1–3 — каркас, backend, авторизация**

- Prisma-схема на 128 моделей: пользователи, роли, профили, согласия, устройства, курсы, модули, уроки, материалы, прогресс, ДЗ и сдачи, тесты/вопросы/попытки, расписание, видеокомнаты и записи, посещаемость, чаты и сообщения, уведомления, изикоины и транзакции, товары и заказы, достижения, обратная связь, AI-запросы, аудит.
- Регистрация с валидацией пароля, согласиями, полем законного представителя для несовершеннолетних; вход по email/телефону; refresh-rotation с детекцией повторного использования токена и отзывом всей семьи сессий; выход и выход со всех устройств; сброс пароля.
- `GET/PATCH /api/users/me`, смена пароля, `GET /api/users/me/courses`, `GET /api/users/me/students`, `GET /api/users/:id`, удаление аккаунта с обезличиванием.
- Курсы (каталог, карточка с модулями и уроками), уроки (материалы, отметка о завершении, пересчёт прогресса курса, сохранение позиции видео), расписание, домашние задания (список, детали, отправка с `idempotencyKey`), уведомления, изикоины.
- Кабинет преподавателя (`/api/teacher`): сводка, свои курсы, программа с модулями и уроками, создание/переименование/удаление модулей и уроков с публикацией, создание и редактирование домашних заданий (дедлайн, максимальный балл, повторная сдача), очередь работ, оценка, комментарий и возврат на доработку с уведомлением ученика и пересчётом достижений. Доступ к чужим курсам и работам закрыт на сервере.
- Движок тестов: 6 типов вопросов, попытки с лимитом и таймером, серверная проверка ответов и подсчёт баллов (`modules/tests/grading.ts`), разбор ошибок, результаты для преподавателя. Клиент не получает правильные ответы до отправки.
- Видеозанятия LiveDigital (`/api/scheduling/schedules/:id/video/*`): комнаты, короткоживущие signaling-токены, окно входа для учеников, посещаемость с переподключениями, запись по настройкам филиала/группы/занятия, перенос в хранилище ITadis, вебхуки с HMAC-подписью и защищённые ссылки на записи.
- IT Coins (`/api/economy`): баланс и полная история, автоматические начисления за учёбу и мероприятия, магазин филиала с автоматической выдачей цифровых наград, уровни, достижения, задания, серии, сезоны, рейтинг внутри группы, антифрод-подтверждения, обжалования и родительский просмотр.
- Сообщения (`/api/messages` + Socket.IO): личные диалоги и чаты курсов, история с пагинацией, отметка прочтения и счётчик непрочитанных, уведомления, жалоба на сообщение в аудит.
- База знаний (`/api/knowledge`): категории, материалы (видео, документы, презентации, ссылки), поиск, фильтр и сортировка, избранное, история просмотров и персональные рекомендации; создание и публикация материалов преподавателями и администраторами.
- Достижения (`/api/economy/achievements`): условия на сервере (`lessons_completed`, `homework_reviewed`, `tests_completed`, `perfect_tests`, `courses_completed`, `attendance`, `coins_earned`, `active_days`, `event_participations`, `contest_podiums`, `teacher_lessons`, `teacher_reviews`), редкость, коллекции, прогресс, дата получения, награда изикоинами и уведомление.
- Администрирование (`/api/admin`, только роль ADMIN): сводка платформы, пользователи с поиском/фильтрами/пагинацией, смена роли и блокировка с записью в аудит, список курсов, аналитика (записи, сдачи, тесты, посещаемость, популярные курсы), журнал аудита.
- Безопасность: bcrypt, JWT, rate limiting, helmet, zod-валидация всех входных данных, единый формат ошибок, аудит критических действий, Swagger `/docs`.

**Мобильное приложение**

- Экран приветствия с анимацией и переключателем языка (ru/ky/en), вход, регистрация (RHF + Zod), восстановление пароля.
- Определение роли после входа и отдельные навигации: ученик (Главная, Курсы, Расписание, Задания, Профиль), преподаватель (Главная, Ученики, Расписание, Задания, Профиль), менеджер (сводка филиала и заявки), родитель (дети, успеваемость, задания и платежи), администратор. Группы `(manager)` и `(parent)` защищены `RoleGate` и используют те же API, что и веб-кабинеты.
- Кабинет преподавателя: «Мои курсы», редактор программы курса (создание модулей и уроков, публикация, удаление), конструктор заданий с календарём дедлайна, максимальным баллом и повторной сдачей, экран урока с конспектом и видео, очередь работ с фильтрами и экран проверки (балл, комментарий, возврат на доработку).
- Экран курса (модули → уроки), экран урока с материалами, отметкой о завершении и переходами между уроками, список тестов и прохождение теста с таймером, навигацией по вопросам и экраном результата.
- Онлайн-занятие: подключение из расписания, плитки участников, микрофон/камера/смена камеры, завершение занятия и запись для преподавателя; при отсутствии настроек или нативной сборки экран показывает понятное объяснение.
- Данные только с API: TanStack Query (кеш, `keepPreviousData`, инвалидация после мутаций), pull-to-refresh, состояния загрузки и пустых списков, централизованные ошибки.
- Длинные списки (каталог курсов, уведомления, IT Coins, очередь проверки) — на `FlatList` с бесконечной
  подгрузкой по offset и общим компонентом `ListScreen`; заголовок и фильтры уходят в `ListHeaderComponent`,
  поэтому нет вложенных виртуализированных списков внутри ScrollView.
- Токены в SecureStore, автоматический refresh по 401; локализация вынесена в JSON (`src/i18n/locales/ru.json`, `ky.json`, `en.json`), язык переключается в настройках и сохраняется. Новые экраны (чат, магазин, достижения, уведомления, AI, приватность) полностью на ключах; часть старых экранов (профиль, база знаний, курсы) ещё содержит встроенные строки — их перевод продолжается.
- Мессенджер: личные диалоги и чаты курсов, текст/фото/файлы, отметки прочтения и живые обновления по Socket.IO.
- Push-уведомления на новые задания, сообщения, начало занятий и проверку работ; нажатие открывает нужный экран.
- Офлайн-режим: учебные GET-ответы кешируются, материалы урока скачиваются в `documentDirectory`, черновики решений сохраняются автоматически, а отправка решения, прогресс урока и сообщения ставятся в очередь. После восстановления сети очередь уходит автоматически.
- Разбор конфликтов: серверный отказ не удаляет локальную копию. На экране «Офлайн-очередь» видно сохранённый текст и причину отказа; решение можно вернуть в черновик и отправить заново, сообщение — передать через «Поделиться», действие — повторить или удалить вручную. Для ДЗ используется `idempotencyKey`, поэтому повтор после обрыва ответа не создаёт вторую работу.
- Смартфоны и планшеты: адаптивная ширина контента, поворот экрана и полноэкранное видео; `supportsTablet` включён для iOS.
- IT Coins и достижения: баланс, уровень, серия, задания, история, магазин с поиском/категориями/избранным, оформление заявки, статусы и прогресс коллекций.
- База знаний с поиском и избранным, AI-помощник по коду (серверный ключ, лимит запросов) без выдачи готовых решений.
- Приватность: политика конфиденциальности и удаление аккаунта с обезличиванием данных на сервере.
- Дизайн-система: токены (отступы, радиусы, типографика), светлая и тёмная палитры в `src/theme`, библиотека компонентов в `src/components/ui` (Button, Input, Card, Modal, BottomSheet, Toast, DatePicker и др.). Перевод существующих экранов на активную тему продолжается: сейчас экраны используют светлую палитру через совместимый экспорт `colors`.

## Требует внешних сервисов или следующего этапа

| Функция | Статус |
| --- | --- |
| Видеосвязь LiveDigital | Нужны `LIVEDIGITAL_API_TOKEN` и `LIVEDIGITAL_SPACE_ID`; без них видео отвечает 503 с инструкцией. Веб-комната открывается в браузере, мобильная — в WebView с официальным Web SDK |
| Запись занятий | Облачная запись LiveDigital и S3-совместимый бакет (`S3_*`); при недоступности провайдера запись возвращает 503 |
| Встроенный видеоплеер урока | ✔ `expo-video`: управление, полноэкранный режим, сохранение позиции просмотра |
| AI-помощник | ✔ серверный `/api/ai/chat` с наставническим промптом и дневным лимитом. Нужен `OPENAI_API_KEY` в `apps/api/.env`; без ключа экран показывает инструкцию |
| Push-уведомления | ✔ `expo-notifications`, токен устройства в `UserDevice`, рассылка через Expo Push API. Реальная доставка требует EAS-проекта и проверяется на физическом устройстве |
| Родительский доступ | ✔ роль `PARENT`, привязка к ученику с подтверждением администратором, веб- и мобильный кабинет, просмотр успеваемости, заданий и платежей |
| Сборки в сторах | ✔ `apps/mobile/eas.json`: development / preview (APK) / production (AAB и iOS), скрипты `build:android:apk`, `build:android:aab`, `build:ios`, `submit:android`, `submit:ios`; для публикации нужны EAS-аккаунт и credentials |
| CI/CD | ✔ GitHub Actions: миграции и тесты API, e2e с PostgreSQL/Redis, сборка admin, `tsc`/тесты mobile; по тегу `v*` публикуются образы API/admin в GHCR и выполняется CD по SSH при заданных `DEPLOY_*` secrets. Мобильные сборки в магазины — EAS |

## Проверки

```bash
cd apps/api && npm run typecheck && npm test && npx prisma validate   # prisma validate требует apps/api/.env
cd apps/mobile && npx tsc --noEmit && npm test
cd apps/web && npm run typecheck && npm run build

# e2e против запущенного API, PostgreSQL и seed (в CI — отдельная job e2e)
cd apps/api
E2E_BASE_URL=http://localhost:4000 \
E2E_ADMIN_EMAIL=admin@itadis.kg \
E2E_ADMIN_PASSWORD='ITadis2026' \
E2E_BRANCH_B_URL=http://branch-b.example.com \
npm run test:e2e

# сквозные проверки на запущенном API (:4000) и прогружённом seed
cd apps/api && node scripts/verify-security-api.mjs
node scripts/verify-learning-api.mjs
node scripts/verify-teacher-api.mjs
```

Финальная проверка безопасности и пагинации — `node scripts/verify-security-api.mjs` (25 проверок):

- RBAC: без токена админка отдаёт `401`, ученик и преподаватель — `403` на всех `/api/admin/*`; ученик
  не может создать занятие, модуль или урок и не видит чужой профиль.
- Ошибки: единый формат `{ error: { code, message, details } }`; недопустимая роль — `422 VALIDATION_ERROR`,
  некорректный UUID — `404`, неизвестный маршрут — `404`.
- Prisma: строки `' OR 1=1 --` и `' OR '1'='1` в поиске курсов и пользователей возвращают пустой результат
  без утечки данных — все запросы идут через параметризованный Prisma Client, `$queryRaw` используется
  только для `SELECT 1` в health-проверке.
- Пагинация: `/api/admin/users?page=…`, `/api/notifications?offset=…`, `/api/coins/history?offset=…`,
  `/api/teacher/submissions?offset=…` возвращают корректные `items`, `total` и следующую страницу.

Проверено локально: `tsc` без ошибок в мобильном и backend-пакетах, `vite build` в `apps/web` без ошибок, 263 API-теста и 20 мобильных тестов: политика паролей, хеширование, JWT и refresh-токены, схемы валидации auth/поддержки/групп/отчётов, ответы всех 6 типов вопросов, подсчёт баллов, права и срок жизни видеотокенов, подпись вебхуков, расчёты счетов и возвратов, каналы уведомлений, повторы внешних вызовов, реестр интеграций и отсутствие утечки секретов, подпись вебхуков LiveDigital, награды IT Coins, ключи файлового хранилища с префиксом филиала, область видимости обращений поддержки, RBAC и изоляция филиалов на HTTP, WebSocket и уровне Prisma-прокси, доступ по чужому ID, HTTP-контракт `/api/integrations`, матрица доступа к курсам/урокам/ДЗ/тестам/экзаменам/магазину/аналитике, восстановление пароля и защита ключа AI от попадания в лог; Prisma-схема валидна. Миграции и seed применены на локальном PostgreSQL 16; сквозные сценарии `apps/api/scripts/verify-teacher-api.mjs` (курсы, модули, уроки, задания, очередь, оценка, возврат, RBAC) и `apps/api/scripts/verify-learning-flow-api.mjs` (расписание с проверкой конфликтов, сдача ДЗ с текстом/ссылкой/файлом, повторная сдача, IT Coins за ДЗ и тест без повторных начислений, история монет) проходят без ошибок. Дополнительно проверены на живом API: админские разделы (`submissions`, `test-attempts`, `coin-transactions`, `schedule`, `shop-orders`), личный и курсовой чаты с отметкой прочтения, а также полный цикл магазина — списание при заявке и автоматический возврат монет и остатка при отклонении. Панель администратора проверена в браузере: вход только с ролью `ADMIN`, все разделы открываются, запросы возвращают 200, ошибок в консоли нет.

## Сообщения и реальное время

REST: `GET /api/messages/conversations`, `POST /api/messages/conversations` (`DIRECT` с `userId` или `COURSE` с `courseId`), `GET /api/messages/conversations/:id`, `GET /api/messages/conversations/:id/messages` (`before`, `limit`, `q`), `POST /api/messages/conversations/:id/messages`, `POST /api/messages/conversations/:id/read`, `POST /api/messages/messages/:id/report`.

Socket.IO подключается на том же хосте, что и API, с access-токеном в `auth.token`. События: `conversation:join` / `conversation:leave` (сервер проверяет участие), `typing`, `message:new` и `message:notification`. Отправка сообщения идёт через REST: сервер сохраняет его, обновляет прочтение, создаёт уведомления и рассылает событие в комнату переписки.

Доступ проверяется по участию в переписке; чат курса доступен преподавателю, записанным ученикам и администратору. В приложении: список переписок с непрочитанными, экран чата с историей, индикатором набора и длинным нажатием для жалобы.

## Push-уведомления

Клиент получает Expo-токен (`ensurePushRegistered`) и отправляет его на `POST /api/users/me/push-token`
вместе с `deviceId` и платформой; при выходе токен снимается, чтобы следующий пользователь устройства
не получал чужие уведомления. Сервер хранит токены в `UserDevice` и рассылает через Expo Push API
(`lib/push.ts`) на новые задания, сообщения, напоминания о занятиях и результаты проверки. Нажатие
на уведомление открывает соответствующий экран (`openFromNotification`).

Для реальной доставки нужен EAS-проект: `projectId` берётся из `app.json` (`extra.eas.projectId`)
или из `EXPO_PUBLIC_EAS_PROJECT_ID`. Проверять следует на физическом устройстве — эмуляторы и Expo Go
не выдают push-токен. Кнопка разрешения и статус находятся в профиле.

## AI-помощник

`GET /api/ai/status` и `POST /api/ai/chat` — диалог с моделью на сервере. Ключ провайдера читается
только из `apps/api/.env` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`), в приложение не попадает.
Системный промпт разрешает объяснять ошибки и задавать наводящие вопросы, но запрещает выдавать
готовое решение; дневной лимит запросов (`AI_DAILY_REQUEST_LIMIT`) защищает ключ от исчерпания.
Экран `app/ai.tsx` открывается из профиля, показывает модель и остаток лимита, хранит историю диалога
в памяти экрана и очищается кнопкой.

## База знаний

Маршруты: `GET /api/knowledge/categories`, `GET /api/knowledge/materials` (поиск, категория, тип, сортировка `new|popular`, пагинация), `GET /api/knowledge/materials/:id`, `POST|DELETE /api/knowledge/materials/:id/favorite`, `GET /api/knowledge/favorites`, `GET /api/knowledge/history`, `GET /api/knowledge/recommendations`, `POST /api/knowledge/materials` и `PATCH /api/knowledge/materials/:id` (преподаватель — только свои материалы).

Просмотр фиксируется в `knowledge_views` (обновляется время последнего открытия), избранное — в `knowledge_favorites`. Рекомендации строятся по категориям уже просмотренных материалов без повторного показа.

В приложении: раздел открывается из профиля; в списке доступны поиск, категории и сортировка, на карточке — избранное, внутри материала — конспект, видео/файл и добавление в избранное.

## IT Coins, магазин и достижения

Единый API экономики: `GET /api/economy/overview`, `GET /api/economy/transactions`, `POST /api/economy/awards`, `POST /api/economy/penalties`, `POST /api/economy/transactions/:id/{approve,reject,reverse,appeal}`, `GET/PATCH /api/economy/rules`, `GET /api/economy/levels`, `GET /api/economy/achievements`, `GET/POST /api/economy/quests*`, `GET /api/economy/season`, `GET /api/economy/leaderboard`, `GET /api/economy/parent/:studentId`, `GET/POST/PATCH /api/economy/shop/*`. Легаси-маршруты `/api/coins`, `/api/shop` и `/api/achievements` сохранены для старых клиентов.

IT Coins — виртуальная валюта без вывода и переводов между учениками; академические баллы она не меняет. Начисления идут через одну транзакцию `CoinTransaction` + `CoinBalance`: посещение занятия, проверенная домашняя работа, тест, завершение курса, участие и призовые места в мероприятиях, задания, серии, достижения и сезон. Для учебных действий используется `sourceId`, поэтому повторная проверка, пересдача или повторный запрос не создают вторую награду. Правила начислений, дневные/недельные лимиты, порог подозрительной суммы, подтверждение крупных списаний и параметры серий настраивает администратор филиала.

Магазин изолирован уровнем базы данных филиала: у каждого филиала собственный каталог, заказы и избранное, поэтому главный администратор ITadis не управляет магазинами других филиалов. Категории: цифровые награды, скидки, учебные материалы, привилегии и физические подарки. Новые награды по умолчанию без ограничения запасов. Цифровые награды выдаются автоматически; физический подарок создаётся только с ручным согласованием получения. Покупка атомарно списывает монеты и остаток, при отклонении или отмене возвращает и то, и другое; ученик получает уведомление.

Достижения проверяются после учебных действий и из экрана достижений. Условие, редкость, коллекция и награда хранятся в `achievements.condition`; прогресс и дата получения — в `user_achievements`, повторная выдача исключена уникальным ключом. Уровни считаются из учебного прогресса, активности, достижений и заданий. Ежедневные, недельные и сезонные задания выдают награду после подтверждения выполнения; серии активности настраиваются правилами филиала. Рейтинг показывается только по курсу/группе ученика. Наставники получают собственные достижения за проведённые занятия и проверенные работы.

В веб-панели раздел «IT Coins» объединяет обзор, журнал операций, начисления, подтверждения, списания и обжалования, правила, достижения и рейтинг групп. В мобильном приложении доступны баланс, уровень, серия, задания, история и магазин с поиском, категориями и избранным.

## Административная панель (`apps/web/`)

Отдельное веб-приложение на React + Vite, работает с тем же backend.

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5174, /api проксируется на :4000
npm run build      # tsc --noEmit + vite build в dist/
```

Вход — любой аккаунт платформы (демо-администратор: `admin@itadis.kg` / `ITadis2026`); после входа открывается кабинет роли: `ADMIN`, `MANAGER`, `TEACHER`, `STUDENT` или `PARENT`. Разделы администратора: обзор с графиками (доли записей, очередь ДЗ, популярные курсы), пользователи (поиск, смена роли, блокировка), курсы, расписание (день/неделя/месяц), проверка домашних работ и тестов, модерация магазина, транзакции IT Coins, отчёты, интеграции, резервное копирование, поддержка и журнал аудита. Ученик, родитель и наставник видят в разделе «Поддержка» только свои обращения и могут создать новое; администратор и менеджер обрабатывают все обращения филиала.

API панели: `GET /api/admin/dashboard`, `GET /api/admin/users`, `PATCH /api/admin/users/:id`, `GET /api/admin/courses`, `GET /api/admin/submissions`, `GET /api/admin/test-attempts`, `GET /api/admin/coin-transactions`, `GET /api/admin/schedule`, `GET /api/admin/shop-orders`, `GET /api/admin/analytics`, `GET /api/admin/audit-logs`; модерация заявки — `PATCH /api/shop/orders/:id`. Все маршруты требуют access-токен администратора; изменения ролей и блокировки пишутся в `audit_logs`, отклонение заявки возвращает монеты и остаток.

Поддержка: `GET/POST /api/support/tickets`, `PATCH /api/support/tickets/:id` (только ADMIN/MANAGER). Резервное копирование: `GET /api/backups/overview`, `POST /api/backups/runs` (`DATABASE`/`FILES`), `POST /api/backups/runs/:id/verify`, `PATCH /api/backups/branches/:id/settings`, `GET/POST /api/backups/restores`; подтверждение и запуск восстановления требуют step-up токен в `X-Step-Up-Token` и точную фразу `RESTORE {slug}`.

Для деплоя за другим доменом задайте `VITE_API_URL` (например, `https://api.itadis.kg/api`) при сборке.

## Видеозанятия (LiveDigital)

Единственный видеопровайдер — LiveDigital. Ключи создаются в личном кабинете LiveDigital и задаются
только на сервере (`apps/api/.env`):

```
LIVEDIGITAL_API_URL=https://moodhood-api.livedigital.space/v1
LIVEDIGITAL_API_TOKEN=<персональный токен владельца space>
LIVEDIGITAL_SPACE_ID=<идентификатор space>
LIVEDIGITAL_WEBHOOK_SECRET=<секрет вебхука из кабинета LiveDigital>
```

Вебхук указывает на `https://<api>/api/scheduling/livedigital/webhook`; подпись проверяется по HMAC-SHA256
от тела события. Комната создаётся автоматически при добавлении онлайн-занятия (`POST /api/scheduling/schedules`,
серии и изменения расписания тоже вызывают `ensureRoom`).

Маршруты: `POST /api/scheduling/schedules/:id/video/room|join|leave|end`,
`POST /api/scheduling/schedules/:id/recording/start|stop`, `GET /api/scheduling/schedules/:id/video/analytics`,
`GET /api/scheduling/recordings`, `GET /api/scheduling/recordings/:id/file`,
`POST /api/scheduling/recordings/:id/transfer/retry`.

Запись настраивается на уровне филиала, группы (курса) и занятия; при входе наставника LiveDigital запускает
её автоматически, если включён флаг `isAutoRecordingAllowed`. После `record_finished` сервер скачивает файл
в `UPLOADS_DIR/recordings` с тремя повторами; при ошибке сохраняется технический отчёт и уведомляются
наставник и администраторы. Срок хранения — до `Course.endDate`, затем файл и запись у провайдера удаляются.

Веб-кабинет использует официальный Web SDK `@livedigital/client` (Chrome 90+, Safari 15+). Мобильное
приложение открывает тот же Web SDK в нативном `react-native-webview`: у LiveDigital нет React Native-пакета,
а официальные iOS/Android SDK требуют отдельного нативного экрана. Токены передаются в WebView и
синхронизируются обратно в SecureStore при refresh; камера и микрофон разрешены в `app.json`.

## Переименование приложения

Название задаётся в `apps/mobile/app.json` (`expo.name`, `extra.appName`, `slug`, `scheme`) и в текстах `apps/mobile/src/i18n/index.ts`; иконка и splash — `apps/mobile/assets/images/`.
# -platform-it-adis
