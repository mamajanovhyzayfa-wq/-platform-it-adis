# Полный аудит `-platform-it-adis` — 27.11.2026

Аудитор: Lead QA / Code Auditor. Ветка: `audit/full-analysis-2026-11-27` (от `main`).
Все утверждения ниже либо подтверждены командой/логом/ответом API, либо явно помечены как
**НЕ ПРОВЕРЕНО** с причиной.

---

## 0. Как проверялось (окружение)

Docker в этой среде недоступен (`no new privileges`, нет демона), поэтому вместо compose-стека
подняты настоящие серверные процессы:

| Компонент | Что именно | Как |
|---|---|---|
| PostgreSQL | 16.4, отдельный серверный процесс на `127.0.0.1:55432` | официальные бинарники PostgreSQL 16.4 (zonky) |
| Redis | 7.2.5, собран из исходников, `127.0.0.1:6379` | `make MALLOC=libc` |
| API | `node dist/src/main.js` (prod-сборка tsc), `NODE_ENV=development` | реальный процесс, не мок |
| БД филиала B | отдельная база `itadis_branch_e2e_b` + тот же набор миграций | `prisma migrate deploy` |
| Домены | `primary.127.0.0.1.nip.io`, `branch-b.127.0.0.1.nip.io` (резолвятся в 127.0.0.1) | `PRIMARY_DOMAIN` + запись `Branch` |

```

```

Выполненные проверки (все — с реальным выводом, не «на глаз»):

```
npm ci (корень, apps/api, apps/web, apps/mobile)
npx prisma generate / migrate deploy / db seed
npm --prefix apps/api test            → 40 файлов, 324 passed, 9 skipped
npm --prefix apps/api run build       → exit 0
npx vitest run test/e2e               → 9 passed (на живом стеке)
npm --prefix apps/mobile test         → 20 passed
npm run test:worker                   → 7 passed
npx tsc --noEmit (api / web / mobile) → 0 ошибок
npx oxlint                            → 0 errors, 143 warnings
npx vite build (лендинг и apps/web)   → exit 0
shellcheck 0.10.0 -x infrastructure/**/*.sh → 0 замечаний
docker compose -f docker-compose.prod.yml config -q → exit 0
npx prisma migrate diff --from-url … --to-schema-datamodel → "No difference detected."
npx prisma migrate deploy (повторно)  → "No pending migrations to apply."
knip 5 / oxlint strict / собственные SQL- и AST-скрипты для мёртвого кода
```

Размер кодовой базы: `apps/api/src` — 41 672 строки TS в 277 файлах, `apps/web/src` — 28 772,
`apps/mobile/src` — 14 677, лендинг `src/` — 1 128.

---

## 1. Executive Summary

**Общая оценка репозитория: Yellow.** Сборки, типы, линтер и 324 автотеста зелёные, схема БД
совпадает с миграциями, изоляция филиалов проверена на живом стеке. Но в коде есть
подтверждённые дефекты уровня P1 (IDOR на вложениях, общий rate-limit на всех клиентов,
500 от PostgreSQL на NUL-байте) и заметный объём мёртвого кода.

**Оценка production-сайта: Red.** `platform-it-adis-nmtovk.freebuff.site` не обслуживает API
вообще (P0): нет развёрнутого backend и не задан `API_ORIGIN`.

### Критические блокеры (P0)

| ID | Что | Доказательство |
|---|---|---|
| P0-1 | Публичный сайт отдаёт `503 API_NOT_CONFIGURED` на всех `/api/*`, `/healthz` отдаёт 200 с `index.html` | `curl -s -o /dev/null -w '%{http_code}' https://…/api/healthz` → `503`; `/healthz` → `200` и HTML |

Именно этот 503 и показан на скриншоте пользователя («Сервер ITadis временно недоступен»):
текст зашит в `infrastructure/sites/worker.js:46` и отдаётся, когда `env.API_ORIGIN` не задан.
Причина не в коде, а в отсутствии развёрнутого API — см. §5.

### Что исправлено в этой ветке (проверено)

| ID | Исправление | Проверка |
|---|---|---|
| P1-1 | NUL-байт в любом поле больше не доходит до PostgreSQL: `apps/api/src/lib/input-guard.ts` + подключение в `main.ts` | живой запрос до: `500 INTERNAL_ERROR`, после: `400 BAD_REQUEST «Запрос содержит недопустимый символ NUL»`; 6 новых тестов |
| P1-2 | Доверенные прокси: `TRUST_PROXY_HOPS` (env + `main.ts` + `docker-compose.prod.yml`), лимит запросов и `req.ip`/`req.protocol` перестали быть общими на всех клиентов | A/B-тест: при `0` второй клиент сразу получал `429`, при `1` — `200` |
| P1-3 | `/healthz` сайта больше не маскируется SPA-фолбэком: проксируется на backend или отдаёт 503 JSON | `npm run test:worker` → 7 passed (2 новых) |

---

## 2. Таблица найденных проблем

Severity: **P0** — не работает продукт, **P1** — дыра/потеря функции, **P2** — дефект с обходом
или при нагрузке, **P3** — гигиена.

| ID | Область | Проблема | Крит. | Где | Как воспроизвести | Ожидаемо | Фактически |
|---|---|---|---|---|---|---|---|
| S-2 | Безопасность | Подписанная ссылка `?t=` живёт 365 дней и не привязана ни к пользователю, ни к филиалу: утёкшая ссылка = вечный доступ | P1 | `apps/api/src/lib/security.ts:85-88` | Взять `url` из ответа `POST /api/uploads`, открыть через год/из другого аккаунта | Короткий TTL, привязка к `sub` | Ссылка валидна 365 дней, доступ по ней не требует входа (исправлено, промпт 1) |
| S-1 | Безопасность | IDOR вложений: `/uploads/<name>` отдаётся любому авторизованному пользователю без проверки владельца | P1 | `apps/api/src/lib/tenant.middleware.ts` | `teacher` скачивает файл, загруженный `student` | 403 | **200 + байты PNG** (исправлено, промпт 1) |
| S-3 | Безопасность | NUL-байт в поле → `PrismaClientUnknownRequestError` (PG 22021) → 500 + алерт на каждый запрос | P1 | `apps/api/src/modules/auth/auth.schemas.ts:77` (и любое поле) | `POST /api/auth/login {"identifier":"admin@itadis.kg\u0000","password":"x"}` | 400/422 | **500 `INTERNAL_ERROR`** (исправлено, P1-1) |
| S-4 | Инфраструктура | Без `trust proxy` Express видит всех клиентов как IP контейнера nginx: лимит 120 req/мин общий на платформу, `req.ip` в аудите/согласиях — адрес прокси, `req.protocol` = `http` в ссылках на вложения | P1 | `apps/api/src/main.ts` (до фикса), `apps/api/src/nest/app.module.ts:80` | 130 запросов клиентом A, затем 3 клиентом B | У B свои 120/мин | **B сразу получает 429** (исправлено, P1-2) |
| F-1 | Функционал/мониторинг | `/healthz` сайта отдаёт 200 с `index.html` при полностью мёртвом API | P1 | `infrastructure/sites/worker.js:57` | `curl https://…/healthz` | 503, если API недоступен | 200 + HTML (исправлено, P1-3) |
| D-1 | Данные | Гонка регистрации: две одновременные заявки с одним email создают две `PENDING` записи (проверка и вставка не атомарны, уникального индекса нет) | P2 | `apps/api/src/modules/access/access.service.ts:64-71` | Два параллельных `POST /api/access/registration` с одним email | 201 + 409 | **201 + 201**, в БД `count=2` (исправлено, промпт 1: индекс + 409) |
| D-2 | Данные | 19 внешних ключей с `NO ACTION/RESTRICT` на `User` (`Certificate`, `Course`, `Invoice`, `Homework`…) — удаление пользователя по GDPR-заявке упрётся в FK | P2 | `apps/api/prisma/schema.prisma` (19 `onDelete: Restrict/NoAction`) | Удалить пользователя с курсом/счётом | Понятный сценарий удаления/анонимизации | FK-ошибка (статически; end-to-end не удалял данные). **13 изменены (промпт 2): 3 CASCADE, 10 SET NULL; `Course.teacherId`, `Homework.teacherId`, `Invoice.studentId` осознанно оставлены RESTRICT** |
| D-3 | Производительность БД | 79 FK-колонок без ведущего индекса (39 из них `NO ACTION`): каскадное удаление и джойны идут seq scan по дочерней таблице | P2 | схема, 128 моделей | `pg_constraint` + `pg_index` (см. §3) | Индекс на FK | 79 колонок без индекса (исправлено, промпт 2: 79 `@@index`, на живой БД осталось 0) |
| S-5 | XSS/данные | Значение заявки сохраняется как есть, включая `<script>`; в веб-панели React экранирует (нет `dangerouslySetInnerHTML`), но поле уходит в письма/уведомления без проверки | P2 | `apps/api/src/modules/leads/leads.service.ts` (`leadCreateSchema`) | `POST /api/leads {"name":"<script>alert(1)</script>…"}` | Санитизация/экранирование на выходе | Хранится `<script>…`, отдаётся в JSON как есть (исправлено, промпт 1: санитизация до записи) |
| S-6 | Раскрытие | Swagger `/docs` и Prometheus `/metrics` открыты публично в production-сборке | P2 | `apps/api/src/main.ts:73`, `main.ts:55` | `curl /docs/`, `curl /metrics` | Закрыто или ограничено по IP/роли | 200 без авторизации |
| S-7 | Наблюдаемость | Access-лог `morgan('tiny')` не содержит IP клиента; при разборе 5xx нет адреса | P2 | `apps/api/src/main.ts` | Любой запрос → строка лога | IP в логе | `GET /api/users/me 200 1247 - 5.7 ms` (без IP) |
| F-2 | API-контракт | Ответ `POST /api/uploads?purpose=certificate` содержит URL `/uploads/certificates/<file>`, который **всегда** 404: сертификаты намеренно не отдаются статикой, только через `/api/certificates/:id/file` | P3 | `apps/api/src/modules/uploads/uploads.routes.ts:152`, `certificates.service.ts:342` | Загрузить сертификат, открыть выданный `url` | Либо рабочий URL, либо явно относительный путь | 404 (исправлено, промпт 2: `/api/uploads/certificates/<file>` работает, `toCertificate.fileUrl` → `/api/certificates/:id/file`) |
| F-3 | Валидация | Пустой файл (0 байт) принимается с 201 | P3 | `apps/api/src/modules/uploads/uploads.routes.ts` | `POST /api/uploads` с 0-байтным PNG | 400 | 201 (исправлено, промпт 2: 400 + файл удаляется) |
| S-8 | Утечка деталей | Битый JSON возвращает детали парсера («Expected double-quoted property name … position 20») | P3 | `apps/api/src/nest/common/all-exceptions.filter.ts:46` | `POST /api/auth/login` с обрезанным JSON | Общее «некорректный JSON» | Текст парсера в `error.message` (исправлено, промпт 2: 400 `Некорректный формат JSON`) |
| P-1 | Производительность фронта | Кабинет собирается в один чанк 1.99 МБ (501 КБ gzip), code splitting отсутствует | P3 | `apps/web` | `npx vite build` | Чанки по маршрутам | 1 файл `index-*.js` |
| C-1 | Мёртвый код | 11 неиспользуемых файлов, 6 неиспользуемых зависимостей, 77 неиспользуемых экспортов, 90 неиспользуемых экспортируемых типов, 19 неиспользуемых переменных/импортов, ~10 мёртвых CSS-классов | P2 | см. §3 | `knip`, `oxlint -D no-unused-vars`, AST-скрипт по CSS | — | см. §3 |

---

## 3. Мёртвый код

### 3.1 Неиспользуемые файлы (11)

```
apps/api/scripts/create-admin.ts
apps/api/scripts/verify-learning-api.mjs
apps/api/scripts/verify-learning-flow-api.mjs
apps/api/scripts/verify-nest-api.mjs
apps/api/scripts/verify-security-api.mjs
apps/api/scripts/verify-teacher-api.mjs
apps/api/src/bootstrap.ts                ← ложное срабатывание: это entrypoint, CI запускает dist/src/bootstrap.js
apps/api/src/modules/schedule/schedule.routes.ts   ← вытеснен Nest-контроллером
apps/api/src/modules/video/video.routes.ts         ← вытеснен Nest-контроллером
apps/web/src/pages/Courses.tsx                     ← страница не подключена к роутеру
infrastructure/clamav/rest.mjs                     ← запускается контейнером ClamAV, не импортируется
```

`apps/api/src/bootstrap.ts` и `infrastructure/clamav/rest.mjs` — ложные срабатывания (entrypoint и
сервисный скрипт образа). Реально мёртвых: **5 скриптов `verify-*.mjs`/`create-admin.ts`,
2 legacy-роутера, 1 страница** (≈ 9 файлов).

### 3.2 Неиспользуемые зависимости

| Пакет | Где | Комментарий |
|---|---|---|
| `express-rate-limit` | `apps/api/package.json` | лимиты делает `@nestjs/throttler`; импортов нет |
| `events` | `apps/web/package.json` | полифилл не импортируется ни разу |
| `expo-build-properties` | `apps/mobile` | нет ни в `app.json` plugins, ни в импортах |
| `expo-font` | `apps/mobile` | не импортируется |
| `expo-glass-effect` | `apps/mobile` | не импортируется |
| `expo-web-browser` | `apps/mobile` | не импортируется |
| `cypress` | корень (devDeps) | ни конфига, ни тестов Cypress в репозитории |
| `@playwright/mcp` | корень (devDeps) | E2E написан на vitest+fetch, MCP-пакет не используется |

Проверка — `grep` по всем `import`/`require` в `apps/`, `packages/`, `src/`, `infrastructure/`,
`scripts/` дал 0 совпадений для каждого из пакетов выше.

### 3.3 Неиспользуемые экспорты (77 сущностей) и типы (90)

Наиболее показательные (полный вывод — `npx knip`):

- `apps/api/src/integrations/index.ts` — реэкспортирует 13 функций, которые никто не импортирует
  (`withRetry`, `retryDelay`, `probeHttp`, `requestJson`, `recordIntegrationEvent`, …);
- `apps/api/src/lib/totp.ts` — `base32Encode`, `base32Decode`, `generateTotpCode`;
- `apps/api/src/lib/file-storage.ts` — `objectExists`, `writeLocalFile`;
- `apps/api/src/lib/redis.ts` — `getRedis`;
- `apps/api/src/lib/push.ts` — `sendPushToUser`;
- `apps/api/src/lib/errors.ts` — `notFoundHandler`;
- `apps/api/src/modules/**/*.module.ts` — 12 одинаковых `*Options`-объектов (`examsOptions`,
  `auditOptions`, …), не используемых ни контроллерами, ни тестами;
- `apps/api/src/integrations/adapters/payments.adapter.ts` — `freedomPayAdapter`, `elsomAdapter`;
- 90 экспортируемых интерфейсов, из которых живы только внутри своего файла (в основном
  `*Props` в мобильных UI-компонентах).

### 3.4 Неиспользуемые переменные и импорты (oxlint, 19)

```
apps/mobile/src/components/ui/ProgressBar.tsx:2    'radius' импортирован, не используется
apps/mobile/src/components/ui/ErrorState.tsx:1     'View' импортирован, не используется
apps/api/src/modules/support/support.service.ts:9          'supportCreateSchema'
apps/api/src/modules/access/access.controller.ts:1         'HttpCode'
apps/api/src/modules/scheduling/scheduling.service.ts:15   'cancelSchema'
apps/api/src/modules/scheduling/scheduling.service.ts:16   'changeDecisionSchema'
apps/api/src/modules/scheduling/scheduling.service.ts:30   'localWeekday'
apps/api/src/modules/scheduling/scheduling.service.ts:32   'minutesOfDay'
apps/api/src/modules/community/community.routes.ts:135     функция 'isStaff' объявлена и не вызывается
apps/api/src/lib/prisma.ts:21                              параметр 'receiver' (осознанно: Proxy)
apps/api/src/modules/community/community.routes.ts:199     shadow: 'courses'
apps/mobile/src/app/(teacher)/schedule.tsx:74              shadow: 'mode'
… (ещё 7 — тот же класс: unused import/param, shadow)
```

Проверено дополнительно на unreachable/constant/dead-branch правилах
(`no-unreachable`, `no-constant-condition`, `no-dupe-else-if`, `no-unmodified-loop-condition`):
**мёртвых ветвей и недостижимого кода не найдено**. Единственные два срабатывания
`no-unmodified-loop-condition` (`analytics-center.service.ts:46`) — ложные: счётчик —
мутируемый объект `Date`.

### 3.5 Мёртвые CSS-классы

AST-скрипт: 35 CSS-файлов, 850 классов, 48 не встречаются в разметке. Из них **34 — динамические**
(`badge-${status}`, `course-tone-${i}`, `stat-${tone}`, `progress-ring-${size}`, …) и не являются
мёртвыми. Реально не используются:

```
balance-value, search-results, lock-card, lock-icon, stat-muted (content.css)
avatar-lg, avatar-md, quick-tile-muted, quick-tile-success, quick-tile-warning (redesign/lists.css)
modal-sm (landing/commercial.css), form-note-icon (landing/modals.css), kv (files.css)
span-8 (redesign/dashboard.css + responsive.css)
```

### 3.6 Закомментированный код старше месяца

**Не найдено.** Скрипт разобрал все `.ts/.tsx/.js/.jsx/.css` на строки вида
`// const … / return … / await … / if (…)` и прогнал `git blame -L` по каждому совпадению:
0 кандидатов. Комментарии в коде — пояснения, а не выключенный код.

### 3.7 Диагностика таблиц БД

- сиротских записей по всем 187 одноколоночным FK — **0**;
- дублей email в `User` — **0**;
- `prisma migrate deploy` на чистой базе — 33 миграции применились; повторный запуск — «No pending
  migrations»; `migrate diff` БД ↔ схема — «No difference detected»;
- планы запросов (`EXPLAIN ANALYZE`): `User.email`, `RefreshSession.tokenHash`,
  `CoinTransaction(userId, createdAt)`, `Lead(status, createdAt)` — все идут по индексу
  (0.02–0.1 мс на 210 пользователях).

---

## 4. Статус функционала

Проверено на живом API (реальный PostgreSQL + Redis). «Не проверено» — честно, с причиной.

| Фича | Статус | Доказательство |
|---|---|---|
| Вход по паролю (admin/teacher/student/manager/parent) | Работает | `POST /api/auth/login` → 200 + пара токенов для всех 5 ролей |
| Неверный пароль / неизвестный email | Работает | 401, одинаковый текст «Неверный email/телефон или пароль» (анти-энумерация) |
| Access-токен: подпись, alg=none, подмена `role`, refresh вместо access | Работает | все 4 кейса → 401 |
| Refresh-ротация и обнаружение повторного использования | Работает | повторный `refresh` старым токеном → 401 «Сессия отозвана», ротированный токен тоже мёртв |
| Восстановление пароля (анти-энумерация) | Работает | существующий и несуществующий email → одинаковый 202 и один текст |
| Сброс пароля с неверным кодом | Работает | 422 (валидация), без 500 |
| 2FA (setup/enable/verify/disable, TOTP) | **НЕ ПРОВЕРЕНО** | нужен реальный аутентификатор и включённый секрет; unit-тестов на полный цикл нет |
| OAuth Google/Apple | **НЕ ПРОВЕРЕНО** | нет `GOOGLE_CLIENT_ID`/`APPLE_*`; по коду без них отдаётся 503, а не имитация успеха |
| RBAC: студент → `/api/leads`, `/api/access/registrations`, `/api/admin/*` | Работает | 403 во всех трёх случаях; преподаватель на `/api/admin/dashboard` → 403 |
| Эскалация роли через `PATCH /api/users/me` (`role`, `isAdmin`, `__proto__`) | Работает (заблокировано) | 422 Unrecognized key |
| Чужой профиль `GET /api/users/:id` | Работает (заблокировано) | 404 вместо данных |
| Заявки с лендинга (`POST /api/leads`) | Работает | 201, видна админу в списке; без `consent` → 422 |
| SQL-инъекция в login / leads / поиске | Работает (не проходит) | инъекции сохраняются как текст, таблица `Lead` цела, вход → 401 |
| NUL-байт в любом поле | Исправлено в этой ветке | было 500, стало 400 + тест |
| Ограничение частоты запросов | Работает, но было общим на всех | см. S-4; после фикса — персонально на IP |
| Загрузка файла (PNG, MIME-фильтр, 11 МБ, пустой файл) | Работает | 201 для PNG; `text/html` → 400; 11 МБ → 413; пустой файл → 400 (исправлено, промпт 2) |
| Скачивание вложения владельцем | Работает | 200 + байты по `?t=` (15 минут) и по Bearer |
| Скачивание чужого вложения | Исправлено (промпт 1) | 403 `FORBIDDEN` по Bearer и по ссылке другого владельца (S-1) |
| Сертификаты: загрузка админом, запрет студенту, скачивание через API | Работает | 201 админу / 403 студенту; файл отдаётся `/api/certificates/:id/file` с проверкой владельца |
| Path traversal `/uploads/..%2f..%2fetc%2fpasswd` | Работает (не проходит) | 404, `basename` + проверка каталога |
| Изоляция филиалов (токен A на домене B, подмена в query/body/заголовке) | Работает | e2e-сценарии 8 и 9 → 401/игнор подмены |
| Обработка ошибок 400/401/403/404 | Работает | единый формат `{error:{code,message}}`, stack trace наружу не уходит |
| 500 без утечки стека | Работает | тело `INTERNAL_ERROR` без деталей (детали только в лог/алерт) |
| `/healthz` (API) | Работает | `{"status":"ok","database":"up","redis":"up"}` |
| `/metrics` | Работает | Prometheus-формат отдаётся (публично — S-6) |
| Swagger `/docs` | Работает | 200 (публично — S-6) |
| Резервное копирование pg_dump/pg_restore | **НЕ ПРОВЕРЕНО локально** | в бинарниках PostgreSQL для этой среды нет `pg_dump`/`psql`; в CI есть отдельный шаг с восстановлением в `itadis_restore_check` |
| MinIO / S3 | **НЕ ПРОВЕРЕНО** | нет MinIO; локально работает fallback на диск (`storage: local`). S3-ветка проверяется только в CI-стеке |
| ClamAV | **НЕ ПРОВЕРЕНО** | `ANTIVIRUS_SCAN_URL` не задан; локально работает сигнатурная проверка (`file-scan`) |
| PgBouncer | **НЕ ПРОВЕРЕНО** | нет Docker; проверено только, что URL без `schema=public` не ломает подключение |
| Веб-кабинет: клики по сценариям студента/админа | **НЕ ПРОВЕРЕНО** | сборка и типы зелёные, но браузерный прогон не делался (в этой среде нет пользовательской сессии/стенда); см. §6 |
| Мобильное приложение | Частично | `tsc --noEmit` — 0 ошибок, 20 unit-тестов офлайн-очереди проходят; запуск на устройстве не проверялся |
| Лендинг (форма заявки) | Частично | `vite build` — ok; отправка формы проверена только на уровне API |

---

## 5. План исправления

### Уже сделано в ветке `audit/full-analysis-2026-11-27`

1. **S-3 / P1-1** — `apps/api/src/lib/input-guard.ts`: NUL-байт в body/query/params → 400 до
   обращения к БД; подключён в `main.ts`; 6 тестов (`test/input-guard.test.ts`).
2. **S-4 / P1-2** — `TRUST_PROXY_HOPS` в `env.ts`, `app.set('trust proxy', N)` в `main.ts`,
   значение `2` в `docker-compose.prod.yml` (caddy → edge → admin), комментарии в обоих
   `.env*.example`. Проверено A/B-тестом.
3. **F-1 / P1-3** — `/healthz` в `infrastructure/sites/worker.js` проксируется на API либо отдаёт
   503 JSON; 2 теста в `worker.test.mjs`.

### Сделано в промпте 1 (безопасность, та же ветка)

4. **S-1 / P1** — владение вложениями: модель `Attachment` (`name`, `originalName`, `mimeType`,
   `sizeBytes`, `ownerId` → `User.id`, `ON DELETE CASCADE`), миграция
   `20261127120000_attachment_owner_and_pending_email`. `POST /api/uploads` записывает владельца,
   `tenantUploadsStatic` отдаёт файл только владельцу или `ADMIN` (решение —
   `apps/api/src/lib/attachment-access.ts`). Файлы без записи в реестре открыты только админу.
   13 тестов: `test/uploads-access.test.ts`.
   *Следствие:* вложения чата и решений открываются владельцем по Bearer или его ссылке `?t=`
   (15 минут); постоянный доступ участникам чата/проверяющему требует отдельного гранта — это
   следующая задача, в промпт не входила.
5. **S-2 / P1** — `signFileToken(name, ownerId)`: TTL 15 минут вместо 365 дней, владелец в `sub`;
   `verifyFileToken` отклоняет токены без `sub` и ссылки на чужой файл, а Bearer другого
   пользователя не даёт воспользоваться чужой ссылкой. 8 тестов: `test/file-token.test.ts`.
6. **S-5 / P2** — `apps/api/src/lib/sanitize.ts` и `transform` в `leadCreateSchema`/`leadUpdateSchema`:
   `script`/`style` удаляются вместе с содержимым, теги и управляющие символы — до записи в БД.
   8 тестов: `test/leads-sanitize.test.ts` + кейс в `test/leads-api.test.ts`.
7. **D-1 / P2** — частичный уникальный индекс
   `"RegistrationRequest_pending_email_key" ON (lower(email)) WHERE status = 'PENDING'`;
   нарушение `P2002` в `access.service.ts` → 409 с понятным текстом. 2 теста:
   `test/registration-conflict.test.ts`. Миграция прогнана на реальном PostgreSQL 16: две
   параллельные вставки → одна запись + `P2002`, рассмотренные заявки с тем же email вставляются,
   FK вложения на пользователя работает (`migrate deploy` — все миграции применены).

### Сделано в промпте 2 (база данных и контракты API)

8. **D-2 / P2** — правила удаления для FK на `User`: 3 `TeacherSubstitution*` → `CASCADE`
   (связка замен без участников не нужна), 10 полей авторства → `SET NULL`
   (`Certificate.issuedById`, `CoursePriceHistory.changedById`, `Exam.createdById`, `Expense.createdById`,
   `HomeworkReview.reviewerId`, `InvoiceDiscount.createdById`, `PaymentAdjustment.adjustedById`,
   `Refund.requestedById`, `ScheduleSeries.teacherId`, `VideoRoom.createdById`).
   `Course.teacherId`, `Homework.teacherId` и `Invoice.studentId` остались `RESTRICT` осознанно:
   курс/задание не могут остаться без преподавателя, счёт — документ учёта; рабочий сценарий —
   обезличивание (`privacy.routes.ts`). В коде — безопасные фолбэки (`Не указан`, подпись записи
   берётся у преподавателя курса).
9. **D-3 / P2** — 79 `@@index([fk])` в `schema.prisma` и в миграции; на живой PostgreSQL
   `pg_index` показывает 0 FK-колонок без ведущего индекса (было 79).
10. **F-2 / P3** — `POST /api/uploads?purpose=certificate` возвращает рабочую ссылку
    `/api/uploads/certificates/<file>` (только ADMIN, `nosniff`), а `toCertificate.fileUrl` —
    `/api/certificates/:id/file`; `isCertificateFileUrl` принимает оба формата; старые записи
    в `/uploads/...` продолжают открываться. 4 теста в `test/uploads-route.test.ts`.
11. **F-3 / P3** — файл 0 байт → `400 BAD_REQUEST`, временный файл удаляется; 2 теста там же.
12. **S-8 / P3** — битый JSON → `400 {"error":{"code":"BAD_REQUEST","message":"Некорректный формат JSON"}}`
    в Express-слое и Nest-фильтре (`isJsonSyntaxError`/`sendJsonParseError` в `lib/errors.ts`);
    5 тестов в `test/json-body.test.ts`. Формат ошибки оставлен единым для API (`error.code/message`).

### Требует отдельной задачи (в этом PR не менялось)

13. **D-2 остаток (P2)** — три FK остались `RESTRICT` (`Course.teacherId`, `Homework.teacherId`,
   `Invoice.studentId`). Нужно продуктовое решение: переназначение курсов/заданий перед жёстким
   удалением и судьба бухгалтерских счетов. До этого удаление аккаунта — только обезличивание.
14. **S-6 (P2)** — закрыть `/docs` и `/metrics` в `NODE_ENV=production` (или отдавать только с
    loopback/по токену).
15. **S-7 (P2)** — перейти на `morgan` с форматом, включающим `:remote-addr`, либо логировать
    `req.ip` структурно.
16. **C-1 (P2)** — удалить 9 мёртвых файлов, 8 неиспользуемых зависимостей, 19 неиспользуемых
    импортов/переменных; после этого включить в `.oxlintrc.json` правило `no-unused-vars` как
    `error`, чтобы мёртвый код не возвращался.

### Что нужно от владельца проекта (без этого не проверить/не починить)

| Что | Зачем |
|---|---|
| VPS/сервер с Docker (или доступ к раннеру) | поднять `docker-compose.prod.yml`, проверить PgBouncer, MinIO, ClamAV, pg_dump/restore на реальном стеке |
| `API_ORIGIN` в настройках сайта Sites (после деплоя API) | снять P0-1: сайт перестанет отдавать 503 на `/api/*` |
| `GH_TOKEN` с правом `pull_request:write` | открыть PR и смержить (push ветки доступен, создание PR — нет) |
| Тестовые аккаунты Google/Apple OAuth | проверить OAuth-вход |
| Доступ к прод-логам backend | подтвердить, что 500-ошибки не повторяются после деплоя |

---

## 6. Чего я НЕ проверял (и почему)

1. **Docker Compose на реальном стеке** (`pgbouncer`, `minio`, `clamav`, `caddy`, `edge`) — в среде
   нет Docker-демона (`sudo` запрещён флагом `no new privileges`). Проверено только
   `docker compose config -q` (exit 0) и то, что переменные подставляются (`TRUST_PROXY_HOPS: "2"`).
2. **Клики по веб-кабинету** (студент/учитель/админ, модалки, адаптивность, скроллы) — нужен
   поднятый кабинет + API на одном origin и браузерная сессия; в этой сессии браузерный прогон не
   выполнялся. Сборка и типы зелёные, но это не заменяет UI-проверку. **НЕ ПРОВЕРЕНО.**
3. **Мобильное приложение на устройстве/эмуляторе** — нужен Android/iOS рантайм; проверены только
   типы и 20 unit-тестов.
4. **E2E через nginx/Caddy и HTTPS** — проверен прямой доступ к API; TLS-терминация и CORS на
   реальном домене не воспроизводились.
5. **pg_dump/pg_restore, планировщик бэкапов** — в используемых бинарниках PostgreSQL нет
   клиентских утилит; в CI этот путь проверяется отдельным шагом.
6. **OAuth, 2FA, LiveDigital, FreedomPay/Elsom, SMTP/Twilio** — внешние сервисы без ключей;
   проверено только, что без конфигурации они отдают 503, а не имитируют успех.
7. **Нагрузочное тестирование и профилирование под реальным объёмом** — БД содержит 210
   пользователей из seed; выводы об индексах сделаны по планам запросов, а не по боевым объёмам.

---

## 7. Приложение: полный лог дефектов из живых прогонов

Скрипты прогонов лежат в `.tmp/` (каталог в `.gitignore`) и запускаются одной командой:

```
node .tmp/probe.mjs      # 46 кейсов: авторизация, RBAC, ошибки, лимиты, гонка регистрации
node .tmp/uploads.mjs    # 14 кейсов: ACL вложений, сертификаты, MIME, размер
node .tmp/db-audit.mjs   # FK/индексы/сироты/планы запросов (из apps/api)
node .tmp/css-audit.mjs  # мёртвые CSS-классы
```

Итоги прогонов на 27.11.2026: `probe` — 2 отклонения (NUL → 500, общий rate-limit; оба
исправлены), `uploads` — 2 отклонения (IDOR, пустой файл), `db-audit` — 79 FK без индекса,
0 сирот, 1 дубль заявки после теста гонки, `css-audit` — 48 «сиротских» классов (34 динамических).
