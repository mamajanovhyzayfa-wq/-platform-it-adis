# Технологический стек ITadis

Документ фиксирует фактический стек платформы и обоснование решений по разделу 24 ТЗ.
Версии пакетов проверяются по `package-lock.json`, конфигурация окружений — по
`docker-compose*.yml` и `.github/workflows/`.

## Сводка соответствия

| Требование | Реализация | Статус |
| --- | --- | --- |
| Node.js, NestJS, TypeScript | Node.js 20+, NestJS 12, TypeScript strict | ✔ |
| REST API и WebSocket | REST `/api/*`, Swagger `/docs`, Socket.IO 4 | ✔ |
| PostgreSQL и ORM | PostgreSQL 16, Prisma 6, миграции | ✔ |
| Redis | кеш, распределённые блокировки, Socket.IO adapter | ✔ |
| Docker | dev- и production-compose, отдельные образы API и admin | ✔ |
| React + TypeScript | React 19, Vite 7, React Router 7, TanStack Query 5 | ✔ |
| Mobile | React Native 0.88 / Expo SDK 58 + TypeScript | ✔ |
| Отдельная БД филиала | control DB + база каждого филиала, только миграции | ✔ |
| CI/CD | GitHub Actions: проверки, e2e, образы, CD по тегу | ✔ |
| Объектное хранилище | S3-совместимое хранилище, MinIO в production-контуре | ✔ |
| Резервные копии | планировщик, проверка целостности, восстановление по шагам | ✔ |
| Мониторинг, логи, алерты | `/healthz`, `/metrics`, Prometheus, webhook-алерты, morgan | ✔ |

## Backend

| Слой | Решение | Обоснование |
| --- | --- | --- |
| Runtime | Node.js 20+ (CI и production — Node.js 24) | один язык с web/mobile, неблокирующий I/O |
| Framework | NestJS 12 + TypeScript | модули, DI, guards, pipes и предсказуемая структура; ядро приложения уже на Nest |
| API | REST + Swagger | стабильные контракты для web/mobile, простая отладка и кеширование |
| Realtime | Socket.IO 4 / WebSocket | сообщения, непрочитанные и события занятия в реальном времени |
| ORM | Prisma 6 | типобезопасные запросы, миграции, отдельные клиенты для баз филиалов |
| БД | PostgreSQL 16 | транзакции, JSONB, полнотекстовый поиск, зрелые backup-инструменты |
| Кеш и координация | Redis 7 + ioredis | кеш реестра филиалов, распределённые блокировки фоновых задач, Socket.IO Redis adapter |
| Файлы | S3-совместимое хранилище + локальный fallback | MinIO/S3 в production, простой локальный режим; ACL проверяется на API |
| Контейнеры | Docker + Docker Compose | одинаковый runtime в dev, CI и production |

Ядро backend — NestJS: `src/main.ts` создаёт `NestFactory`, домены подключаются через
`AppModule`. Часть старых доменов ещё смонтирована Express-роутерами из
`src/legacy-routers.ts`, но использует тот же HTTP-сервер, Prisma, JWT и middleware.
Новые модули пишутся сразу на Nest, существующие переносятся целиком.

Redis не является обязательным для одного локального процесса: при отсутствии
`REDIS_URL` кеш и блокировки переходят в память процесса. В production Redis нужен
для нескольких реплик API и корректной работы Socket.IO adapter. Отдельный брокер
очередей (BullMQ и аналоги) не вводился: фоновые задания идемпотентны и выполняются
планировщиками процесса, а повторная обработка ограничивается проверками в БД и
распределёнными блокировками. При переходе к гарантированной доставке фоновых
заданий очередь можно добавить отдельным worker-процессом без изменения REST-контрактов.

## Frontend

- React 19 + TypeScript + Vite 7.
- React Router 7: публичные страницы, защищённые маршруты `RequireAuth`, проверка ролей
  `AllowRoles` и переключатель подтверждённых ролей.
- TanStack Query 5: серверное состояние, кеш, инвалидация после мутаций; Zustand в
  мобильном клиенте для локального состояния.
- Компонентная архитектура: маршруты в `src/app`, route-level страницы в `src/pages`, доменные панели в `src/features`, общий каркас в `src/layouts`, запросы — `src/api`.
- Адаптивная вёрстка: сетки, мобильная навигация, таблицы с горизонтальной прокруткой.
- Локализация: словари в `src/locales`, провайдер в `src/i18n`; русский, кыргызский и английский (`ru`, `ky`, `en`), выбор языка
  сохраняется в профиле и на устройстве; для разделов можно задать отдельный язык.
- Темы: светлая и тёмная, повышенная контрастность и масштаб текста; настройки
  применяются до первой отрисовки.
- Обработка ошибок: единый формат ошибок API, состояния страниц и `ErrorBoundary`
  для непредвиденных ошибок отрисовки React.
- Валидация форм: HTML5-ограничения (`required`, `minLength`, `type`, `pattern`) на
  клиенте и обязательная повторная Zod-валидация на сервере. Отдельная клиентская
  Zod-схема в web-пакете не подключена, поэтому сервер остаётся единственным
  источником истины для бизнес-правил.

## Mobile

React Native 0.88 + Expo SDK 58 + TypeScript, один код для Android и iOS.
Маршрутизация — Expo Router, серверное состояние — TanStack Query, локальное —
Zustand, формы — React Hook Form + Zod, токены — Expo SecureStore.

### LiveDigital SDK

У LiveDigital есть официальные iOS/Android SDK и Web SDK, но нет React Native-пакета.
Нативные SDK потребовали бы отдельного экрана и моста в Expo для каждой платформы.
Поэтому мобильное приложение открывает официальный Web SDK LiveDigital внутри
`react-native-webview` (`src/app/video/[scheduleId].tsx`): камера, микрофон,
демонстрация экрана, чат и запись работают на стороне провайдера, а приложение
остаётся одним React Native-кодом.

Это осознанный компромисс:

- плюс — один код и одна интеграция для Android/iOS, обновления Web SDK не требуют
  выпуска новой нативной сборки;
- минус — видеокомната требует сети и WebView; для офлайн-сценариев она и не нужна,
  офлайн-режим относится к учебным материалам, заданиям и очередям отправки;
- если появятся требования к фоновому аудио, нативному screen sharing или
  специфическим push-сценариям, нативный мост можно добавить точечно, не меняя
  остальное приложение.

`@livedigital/client` подключён только в web-панели. В мобильном пакете его нет;
используется WebView и официальный Web SDK.

### Офлайн-режим

- AsyncStorage хранит кеш учебных GET-ответов и черновики.
- NetInfo определяет восстановление сети.
- `expo-file-system` скачивает материалы урока в `documentDirectory`.
- Очередь отправки хранит решения ДЗ, прогресс урока и сообщения; после восстановления
  сети она уходит автоматически.
- Для домашних заданий используется `idempotencyKey`, поэтому повтор после обрыва
  ответа не создаёт вторую работу.
- Серверный отказ не удаляет локальную копию: пользователь видит причину и может
  вернуть решение в черновик, повторить действие или удалить его вручную.

### Производительность

- Hermes и включённый Fabric/New Architecture в Expo SDK 58.
- `FlatList` с пагинацией и общим `ListScreen`; заголовки и фильтры вынесены в
  `ListHeaderComponent`, чтобы не вкладывать виртуализированные списки в ScrollView.
- `expo-image` для кеша изображений, ленивая загрузка экранов и материалов.
- Тяжёлая бизнес-логика и проверки прав остаются на сервере; WebView используется
  только для видеокомнаты, а не для всего интерфейса.
- Сборки — EAS Build (`development`, `preview`, `production`), версии и
  `buildNumber`/`versionCode` задаются в `app.json`.

## База данных

- PostgreSQL 16 — основная СУБД.
- Control DB хранит реестр филиалов, платформенные настройки, заявки на восстановление
  и другие общие данные. Каждый филиал получает отдельную базу; имя базы хранится в
  `Branch.databaseName`, клиент выбирается tenant-контекстом по домену запроса.
- Запросы филиала не выполняются в общей базе: tenant middleware подставляет
  соответствующий Prisma Client, а `ALLOW_PRIMARY_FALLBACK` в production выключен.
- Все изменения схемы — только через Prisma-миграции. В production сервис `migrate`
  выполняет `prisma migrate deploy` до старта API; ручные `ALTER TABLE` запрещены.
- Резервное копирование и восстановление учитывают control DB и базы филиалов;
  проверяются структура дампа, количество файлов и SHA-256.

## Инфраструктура

| Компонент | Реализация |
| --- | --- |
| Облачный сервер | production-compose рассчитан на Linux-сервер с Docker; параметры PostgreSQL/PgBouncer и лимиты файловых дескрипторов заданы в `docker-compose.prod.yml` |
| Docker | `docker-compose.yml` — локальный контур; `docker-compose.prod.yml` — PostgreSQL, PgBouncer, Redis, MinIO, API, admin, nginx, Prometheus |
| Окружения | development — локальный compose; test — CI с PostgreSQL 16 и Redis 7; production — отдельный `.env.production`, private network и TLS на nginx |
| CI | `.github/workflows/ci.yml`: миграции на чистой БД, сборка API, unit-тесты, e2e с PostgreSQL/Redis, сборка admin, `tsc` и тесты mobile |
| CD | `.github/workflows/release.yml`: сборка и публикация образов API/admin в GHCR по тегу; job деплоя по SSH включается при заданных `DEPLOY_*` secrets |
| Объектное хранилище | S3-совместимый бакет; в production — MinIO, в development — локальный fallback или внешний S3 |
| Резервные копии | планировщик в API (`BACKUP_SCHEDULER_ENABLED=true` в production), копии БД и файлов, retention, проверка целостности, восстановление по шагам |
| Мониторинг | `/healthz` (БД, Redis, storage, scheduler), `/metrics` Prometheus, `infrastructure/monitoring/prometheus.yml` и `alerts.yml` |
| Логирование | morgan для HTTP в dev, структурированные сообщения приложения, json-file с ротацией в production |
| Оповещения | `ALERT_WEBHOOK_URL` для ошибок 5xx, backup и integrity; алерты Prometheus |
| Realtime | Socket.IO с Redis adapter; комнаты включают `branchId`, поэтому события филиалов не пересекаются |

### Что требует внешней настройки

CI/CD-файлы и production-compose находятся в репозитории, но фактические секреты и
серверы не коммитятся. Для включения CD задайте в GitHub Environment `production`:
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_PATH`
и при необходимости `DEPLOY_PORT`. Для LiveDigital, S3/MinIO, SMTP, Expo Push и
платёжных адаптеров нужны соответствующие ключи в окружении сервера. Мобильные
сборки в магазины требуют EAS-аккаунта и credentials; e2e-тесты без PostgreSQL и
Redis локально пропускаются, а в CI выполняются на сервисных контейнерах.
