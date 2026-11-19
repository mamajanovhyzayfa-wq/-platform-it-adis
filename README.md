# IT Adis — мобильная образовательная платформа

Монорепозиторий платформы: мобильное приложение (Expo / React Native), API-сервер (NestJS + Prisma + PostgreSQL), административная веб-панель и веб-лендинг с иконкой приложения.

```
.
├── index.html, src/, public/      # лендинг (Vite) + иконка приложения
├── mobile/                        # Expo-приложение (Android / iOS), Expo Router
│   ├── src/app/                   # маршруты: (auth), (student), (teacher), (admin)
│   ├── src/components/ui/         # библиотека компонентов дизайн-системы
│   └── src/theme/                 # токены, светлая и тёмная палитры
├── backend/                       # REST API: NestJS, Prisma, PostgreSQL, Socket.IO
│   ├── src/nest/                  # ядро Nest: модули, guards, RBAC, фильтры
│   └── prisma/                    # схема (49 моделей), миграции, seed
├── admin-web/                     # административная панель: React + Vite
├── infrastructure/                # целевая production-топология и чек-лист запуска
├── docker-compose.yml             # PostgreSQL + Redis + LiveKit + backend
├── .env.example                   # переменные для docker-compose
├── ARCHITECTURE.md                # архитектура и статус по этапам ТЗ
├── API_STRUCTURE.md               # справочник всех маршрутов и Socket.IO
├── DATABASE_STRUCTURE.md          # модели, связи, индексы, правила удаления
├── DEVELOPMENT.md                 # установка, запуск, проверки, типовые проблемы
└── README.md
```

## Документация

| Документ | О чём |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Слои, модули, авторизация, realtime, видео, дизайн-система, **статус по этапам ТЗ и пробелы** |
| [API_STRUCTURE.md](API_STRUCTURE.md) | Все HTTP-маршруты, роли, тела запросов, ошибки, события Socket.IO, вебхуки |
| [DATABASE_STRUCTURE.md](DATABASE_STRUCTURE.md) | 49 моделей Prisma, enum, уникальные ключи, индексы, каскады, транзакции |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Требования, переменные окружения, миграции, seed, проверки, troubleshooting |
| [infrastructure/README.md](infrastructure/README.md) | Production-топология и чек-лист перед публикацией |

## Стек

| Часть | Технологии |
| --- | --- |
| Mobile | React Native, Expo SDK 58, TypeScript, Expo Router, TanStack Query, Zustand, React Hook Form, Zod, Axios, Expo SecureStore |
| Backend | Node.js, NestJS 12, TypeScript, Prisma 6, PostgreSQL, JWT + refresh rotation, RBAC (guards), Zod, Swagger, helmet, rate-limit, bcrypt |
| Админ-панель | React 19, TypeScript, Vite 7, React Router 7, TanStack Query, Axios |
| Инфраструктура | Docker Compose (PostgreSQL 16, Redis 7, LiveKit, backend), Vitest |

## Требования

- Node.js 20+ (проверено на 26), npm 10+
- Docker Desktop (для PostgreSQL/Redis) — иначе нужен любой доступный PostgreSQL 16
- Телефон с Expo Go или эмулятор Android / симулятор iOS

## Быстрый старт

### 1. База и API

```bash
cp .env.example .env
cp backend/.env.example backend/.env
docker compose up -d postgres redis
cd backend
npm install
npx prisma migrate deploy            # применить миграции из prisma/migrations
npm run prisma:seed                  # демо-данные (4 роли)
npm run dev                          # http://localhost:4000, Swagger: /docs
```

Без Docker: поднимите PostgreSQL 16 (или локальный кластер, см. DEVELOPMENT.md), создайте базу `itadis`
и укажите строку подключения в `backend/.env` (`DATABASE_URL`), затем выполните тот же набор команд.

### 2. Мобильное приложение

```bash
cd mobile
npm install
# в mobile/.env или через переменную окружения:
# EXPO_PUBLIC_API_URL=http://<IP-компьютера>:4000/api
npx expo start
```

Для реального телефона `localhost` не работает — укажите IP компьютера в локальной сети. Для Android-эмулятора используйте `http://10.0.2.2:4000/api`.

Если в оболочке уже задана переменная `PORT` (например, `PORT=0`), backend её унаследует и не стартует —
перекройте значение при запуске: `PORT=4000 npm run dev`.

### 3. Админ-панель (`admin-web/`)

```bash
cd admin-web
npm install
npm run dev        # http://localhost:5174, /api проксируется на http://localhost:4000
npm run build      # tsc --noEmit + vite build в dist/
npm run preview    # локальный просмотр production-сборки
```

Вход — только аккаунт с ролью `ADMIN` (`admin@itadis.kg` / `ITadis2026`). Для деплоя за другим доменом
задайте `VITE_API_URL` (например, `https://api.itadis.kg/api`) на этапе сборки.

### Демо-аккаунты (после `npm run prisma:seed`)

| Роль | Email | Телефон | Пароль |
| --- | --- | --- | --- |
| Администратор | admin@itadis.kg | — | `ITadis2026` |
| Преподаватель | teacher@itadis.kg | +996700000001 | `ITadis2026` |
| Ученик | student@itadis.kg | +996700000002 | `ITadis2026` |
| Родитель | parent@itadis.kg | +996700000003 | `ITadis2026` |

Вход возможен по email или телефону. Приложение само перенаправляет в интерфейс роли.

## Переменные окружения

Все секреты хранятся только в `backend/.env` (файл в `.gitignore`) и не попадают в мобильное приложение
или админ-панель. Шаблон — [`backend/.env.example`](backend/.env.example).

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
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Видеозанятия отвечают 503 с инструкцией; для разработки — `docker compose up -d livekit` (`devkey` / `secret`) |
| `RECORDING_S3_ACCESS_KEY`, `RECORDING_S3_SECRET`, `RECORDING_S3_BUCKET`, `RECORDING_S3_REGION`, `RECORDING_S3_ENDPOINT`, `RECORDING_S3_FORCE_PATH_STYLE` | Запись занятий недоступна (503), просмотр занятий работает |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `AI_DAILY_REQUEST_LIMIT` | AI-помощник показывает инструкцию; `/api/ai/status` возвращает `configured: false` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Письма подтверждения и сброса пароля пишутся в лог; в dev ссылка доступна в ответе |
| `EXPO_ACCESS_TOKEN` | Работает и без него, но с меньшими лимитами Expo Push API |
| `UPLOADS_DIR` | Вложения чата сохраняются в `backend/uploads` |

`REDIS_URL` указан в `docker-compose.yml` и `.env.example` как зарезервированный: текущий код его не читает и
не требует — кеш и rate limit работают в памяти процесса. Для горизонтального масштабирования Redis
понадобится подключить (общий rate limit и Socket.IO adapter).

Проект использует **LiveKit**, а не LiveDigital: отдельные ключи LiveDigital не нужны. Если видеосвязь
будет переведена на LiveDigital, потребуются его API URL, ключ и секрет на сервере — клиент ключей не видит.

### Мобильное приложение

| Переменная | Назначение |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Базовый URL API, например `http://192.168.1.10:4000/api` |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Project ID EAS для push-токенов (альтернатива `extra.eas.projectId` в `app.json`) |

`mobile/.env` можно создать вручную; переменные с префиксом `EXPO_PUBLIC_` попадают в клиентский бандл,
поэтому там не должно быть секретов.

## Сборка мобильного приложения (EAS)

Профили описаны в [`mobile/eas.json`](mobile/eas.json):

| Профиль | Что собирает | Команда |
| --- | --- | --- |
| `development` | Dev client с нативными модулями (LiveKit, пуши), APK / iOS simulator | `eas build -p android --profile development` |
| `preview` | Внутренний APK для тестировщиков | `npm run build:android:apk` |
| `production` | AAB для Google Play и сборка для App Store | `npm run build:android:aab`, `npm run build:ios` |

```bash
npm i -g eas-cli
eas login                       # аккаунт Expo
eas init                        # создаёт projectId, добавляет extra.eas.projectId в app.json (нужно для push)
eas build --platform android --profile preview     # APK
eas build --platform android --profile production  # AAB для Google Play
eas build --platform ios --profile production      # IPA для App Store
eas submit --platform android --profile production # загрузка в Play (нужен service account)
```

Перед первой сборкой: `bundleIdentifier` (`kg.itadis.app`) и `package` уже заданы в `mobile/app.json`.
Для `eas submit` заполните `mobile/credentials/play-service-account.json` и параметры Apple в `eas.json`
(в файле стоят заглушки `REPLACE_WITH_*`). Ключи LiveKit и API URL задаются на сервере; для сборки
можно передать `EXPO_PUBLIC_API_URL` через `eas env:create` или EAS secrets.

## Что реализовано

**Этап 1–3 — каркас, backend, авторизация**

- Prisma-схема на 40+ моделей: пользователи, роли, профили, согласия, устройства, курсы, модули, уроки, материалы, прогресс, ДЗ и сдачи, тесты/вопросы/попытки, расписание, видеокомнаты и записи, посещаемость, чаты и сообщения, уведомления, изикоины и транзакции, товары и заказы, достижения, обратная связь, AI-запросы, аудит.
- Регистрация с валидацией пароля, согласиями, полем законного представителя для несовершеннолетних; вход по email/телефону; refresh-rotation с детекцией повторного использования токена и отзывом всей семьи сессий; выход и выход со всех устройств; сброс пароля.
- `GET/PATCH /api/users/me`, смена пароля, `GET /api/users/me/courses`, `GET /api/users/me/students`, `GET /api/users/:id`, удаление аккаунта с обезличиванием.
- Курсы (каталог, карточка с модулями и уроками), уроки (материалы, отметка о завершении, пересчёт прогресса курса, сохранение позиции видео), расписание, домашние задания (список, детали, отправка с `idempotencyKey`), уведомления, изикоины.
- Кабинет преподавателя (`/api/teacher`): сводка, свои курсы, программа с модулями и уроками, создание/переименование/удаление модулей и уроков с публикацией, создание и редактирование домашних заданий (дедлайн, максимальный балл, повторная сдача), очередь работ, оценка, комментарий и возврат на доработку с уведомлением ученика и пересчётом достижений. Доступ к чужим курсам и работам закрыт на сервере.
- Движок тестов: 6 типов вопросов, попытки с лимитом и таймером, серверная проверка ответов и подсчёт баллов (`modules/tests/grading.ts`), разбор ошибок, результаты для преподавателя. Клиент не получает правильные ответы до отправки.
- Видеозанятия (`/api/video`): комнаты LiveKit, короткоживущие токены участников, окно входа для учеников, аудит-вход в комнату, посещаемость с длительностью, запись через LiveKit Egress, вебхуки с проверкой подписи и хеша тела, защищённые ссылки на записи.
- Магазин наград (`/api/shop`): каталог, заявка ученика с атомарным списанием изикоинов и остатка, история заявок, подтверждение/выдача/отклонение администратором с автоматическим возвратом монет и остатка.
- Сообщения (`/api/messages` + Socket.IO): личные диалоги и чаты курсов, история с пагинацией, отметка прочтения и счётчик непрочитанных, уведомления, жалоба на сообщение в аудит.
- База знаний (`/api/knowledge`): категории, материалы (видео, документы, презентации, ссылки), поиск, фильтр и сортировка, избранное, история просмотров и персональные рекомендации; создание и публикация материалов преподавателями и администраторами.
- Достижения (`/api/achievements`): условия на сервере (`lessons_completed`, `homework_reviewed`, `tests_completed`, `courses_completed`, `attendance`, `coins_earned`), выдача после урока/теста и из экрана достижений, награда изикоинами и уведомление.
- Администрирование (`/api/admin`, только роль ADMIN): сводка платформы, пользователи с поиском/фильтрами/пагинацией, смена роли и блокировка с записью в аудит, список курсов, аналитика (записи, сдачи, тесты, посещаемость, популярные курсы), журнал аудита.
- Безопасность: bcrypt, JWT, rate limiting, helmet, zod-валидация всех входных данных, единый формат ошибок, аудит критических действий, Swagger `/docs`.

**Мобильное приложение**

- Экран приветствия с анимацией и переключателем языка (ru/ky/en), вход, регистрация (RHF + Zod), восстановление пароля.
- Определение роли после входа и отдельные навигации: ученик (Главная, Курсы, Расписание, Задания, Профиль), преподаватель (Главная, Ученики, Расписание, Задания, Профиль), администратор.
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
- Магазин наград и достижения: каталог, оформление заявки, история и статусы, прогресс достижений.
- База знаний с поиском и избранным, AI-помощник по коду (серверный ключ, лимит запросов) без выдачи готовых решений.
- Приватность: политика конфиденциальности и удаление аккаунта с обезличиванием данных на сервере.
- Дизайн-система: токены (отступы, радиусы, типографика), светлая и тёмная палитры в `src/theme`, библиотека компонентов в `src/components/ui` (Button, Input, Card, Modal, BottomSheet, Toast, DatePicker и др.). Перевод существующих экранов на активную тему продолжается: сейчас экраны используют светлую палитру через совместимый экспорт `colors`.

## Требует внешних сервисов или следующего этапа

| Функция | Статус |
| --- | --- |
| Сервер LiveKit | Нужны `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; для разработки поднимается `docker compose up -d livekit` (ключи `devkey`/`secret`) |
| Запись занятий | LiveKit Egress + S3-совместимый бакет (`RECORDING_S3_*`); без них запись возвращает 503 с инструкцией |
| Встроенный видеоплеер урока | ✔ `expo-video`: управление, полноэкранный режим, сохранение позиции просмотра |
| AI-помощник | ✔ серверный `/api/ai/chat` с наставническим промптом и дневным лимитом. Нужен `OPENAI_API_KEY` в `backend/.env`; без ключа экран показывает инструкцию |
| Push-уведомления | ✔ `expo-notifications`, токен устройства в `UserDevice`, рассылка через Expo Push API. Реальная доставка требует EAS-проекта и проверяется на физическом устройстве |
| Родительский доступ | Следующий этап: роль `PARENT`, связь с учеником и отдельные экраны |
| Сборки в сторах | ✔ `mobile/eas.json`: development / preview (APK) / production (AAB и iOS), скрипты `build:android:apk`, `build:android:aab`, `build:ios` |
| CI/CD-пайплайн | Следующий этап: автоматические сборки по тегу (сейчас — ручной `eas build`) |

## Проверки

```bash
cd backend && npm run typecheck && npm test && npx prisma validate   # prisma validate требует backend/.env
cd mobile && npx tsc --noEmit
cd admin-web && npm run typecheck && npm run build

# сквозные проверки на запущенном API (:4000) и прогружённом seed
cd backend && node scripts/verify-security-api.mjs
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

Проверено локально: `tsc` без ошибок в мобильном и backend-пакетах, `npm run build` в `admin-web` (tsc + Vite) без ошибок, 28 unit-тестов (политика паролей, хеширование, JWT, refresh-токены, схемы валидации, проверка ответов всех 6 типов вопросов, подсчёт баллов, права и срок жизни токенов LiveKit, подпись вебхуков), Prisma-схема валидна. Миграции и seed применены на локальном PostgreSQL 16; сквозные сценарии `backend/scripts/verify-teacher-api.mjs` (курсы, модули, уроки, задания, очередь, оценка, возврат, RBAC) и `backend/scripts/verify-learning-flow-api.mjs` (расписание с проверкой конфликтов, сдача ДЗ с текстом/ссылкой/файлом, повторная сдача, IT Coins за ДЗ и тест без повторных начислений, история монет) проходят без ошибок. Дополнительно проверены на живом API: админские разделы (`submissions`, `test-attempts`, `coin-transactions`, `schedule`, `shop-orders`), личный и курсовой чаты с отметкой прочтения, а также полный цикл магазина — списание при заявке и автоматический возврат монет и остатка при отклонении. Панель администратора проверена в браузере: вход только с ролью `ADMIN`, все разделы открываются, запросы возвращают 200, ошибок в консоли нет.

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
только из `backend/.env` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`), в приложение не попадает.
Системный промпт разрешает объяснять ошибки и задавать наводящие вопросы, но запрещает выдавать
готовое решение; дневной лимит запросов (`AI_DAILY_REQUEST_LIMIT`) защищает ключ от исчерпания.
Экран `app/ai.tsx` открывается из профиля, показывает модель и остаток лимита, хранит историю диалога
в памяти экрана и очищается кнопкой.

## База знаний

Маршруты: `GET /api/knowledge/categories`, `GET /api/knowledge/materials` (поиск, категория, тип, сортировка `new|popular`, пагинация), `GET /api/knowledge/materials/:id`, `POST|DELETE /api/knowledge/materials/:id/favorite`, `GET /api/knowledge/favorites`, `GET /api/knowledge/history`, `GET /api/knowledge/recommendations`, `POST /api/knowledge/materials` и `PATCH /api/knowledge/materials/:id` (преподаватель — только свои материалы).

Просмотр фиксируется в `knowledge_views` (обновляется время последнего открытия), избранное — в `knowledge_favorites`. Рекомендации строятся по категориям уже просмотренных материалов без повторного показа.

В приложении: раздел открывается из профиля; в списке доступны поиск, категории и сортировка, на карточке — избранное, внутри материала — конспект, видео/файл и добавление в избранное.

## Магазин и достижения

Маршруты: `GET /api/shop/products`, `POST /api/shop/orders`, `GET /api/shop/orders`, `PATCH /api/shop/orders/:id` (админ), `POST/PATCH /api/shop/products` (админ), `GET /api/achievements`, `POST /api/achievements/check`.

Покупка — одна транзакция: проверка остатка и баланса, списание монет, уменьшение остатка и заявка `NEW`. При `REJECTED` администратор возвращает монеты и остаток автоматически, ученик получает уведомление. Баланс меняется только на сервере.

Достижения проверяются после завершения урока, сдачи теста и при открытии экрана достижений. Условие и награда хранятся в `achievements.condition`, повторная выдача исключена уникальным ключом `user_achievements`.

В приложении: `Магазин наград` и `Достижения` открываются из профиля ученика.

## Административная панель (`admin-web/`)

Отдельное веб-приложение на React + Vite, работает с тем же backend.

```bash
cd admin-web
npm install
npm run dev        # http://localhost:5174, /api проксируется на :4000
npm run build      # tsc --noEmit + vite build в dist/
```

Вход — аккаунт с ролью `ADMIN` (демо: `admin@itadis.kg` / `ITadis2026`); аккаунты других ролей в панель не пускаются. Разделы: обзор с графиками (доли записей, очередь ДЗ, популярные курсы), пользователи (поиск, смена роли, блокировка), курсы, расписание (день/неделя/месяц), проверка домашних работ и тестов, модерация магазина, транзакции IT Coins, журнал аудита.

API панели: `GET /api/admin/dashboard`, `GET /api/admin/users`, `PATCH /api/admin/users/:id`, `GET /api/admin/courses`, `GET /api/admin/submissions`, `GET /api/admin/test-attempts`, `GET /api/admin/coin-transactions`, `GET /api/admin/schedule`, `GET /api/admin/shop-orders`, `GET /api/admin/analytics`, `GET /api/admin/audit-logs`; модерация заявки — `PATCH /api/shop/orders/:id`. Все маршруты требуют access-токен администратора; изменения ролей и блокировки пишутся в `audit_logs`, отклонение заявки возвращает монеты и остаток.

Для деплоя за другим доменом задайте `VITE_API_URL` (например, `https://api.itadis.kg/api`) при сборке.

## Видеозанятия (LiveKit)

Локальный сервер для разработки (ключи `devkey` / `secret`, адрес `ws://localhost:7880`):

```bash
docker compose up -d livekit
```

`backend/.env`:

```
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Маршруты: `POST /api/video/rooms`, `POST /api/video/rooms/join`, `POST /api/video/rooms/:id/leave`, `POST /api/video/rooms/:id/end`, `POST /api/video/rooms/:id/recording/start|stop`, `GET /api/video/rooms/:id/attendance`, `GET /api/video/recordings`, `POST /api/video/webhooks/livekit`.

Запись идёт через LiveKit Egress и требует S3-совместимого хранилища: `RECORDING_S3_ACCESS_KEY`, `RECORDING_S3_SECRET`, `RECORDING_S3_BUCKET`, `RECORDING_S3_REGION` (опционально `RECORDING_S3_ENDPOINT`, `RECORDING_S3_FORCE_PATH_STYLE`). Ссылка на запись появляется после вебхука `egress_ended`.

Мобильная часть использует `@livekit/react-native` — это нативные WebRTC-модули: видеозвонки работают в development-сборке (`npx expo run:android`, `npx expo run:ios` или EAS development build), но не в Expo Go. В Expo Go экран занятия показывает объяснение вместо подключения.

## Переименование приложения

Название задаётся в `mobile/app.json` (`expo.name`, `extra.appName`, `slug`, `scheme`) и в текстах `mobile/src/i18n/index.ts`; иконка и splash — `mobile/assets/images/`.
#   - p l a t f o r m - i t - a d i s  
 