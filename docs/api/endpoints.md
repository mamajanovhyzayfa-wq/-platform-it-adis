# API ITadis
> Карта всех доменных модулей, их доступов и read-моделей: [modules.md](modules.md).


REST API + Socket.IO. Документ описывает **существующие** маршруты и их контракты. Источник истины —
код в `apps/api/src/modules/**` (auth, users) и `apps/api/src/modules/**` (остальные домены);
интерактивная спецификация — Swagger UI на `/docs`.

- Базовый URL (dev): `http://localhost:4000/api`
- Формат: JSON, `Content-Type: application/json`
- Аутентификация: `Authorization: Bearer <accessToken>`
- Все даты — ISO 8601 UTC (`2026-11-13T09:00:00.000Z`)

## Содержание

- [1. Общие правила](#1-общие-правила)
- [2. Auth](#2-auth)
- [3. Users](#3-users)
- [4. Courses и Lessons](#4-courses-и-lessons)
- [5. Homework](#5-homework)
- [6. Tests](#6-tests)
- [7. Schedule](#7-schedule)
- [8. Video: LiveDigital и исторический LiveKit](#8-video-livedigital-и-исторический-livekit)
- [9. Messages](#9-messages)
- [10. Notifications](#10-notifications)
- [11. Coins](#11-coins)
- [12. Achievements](#12-achievements)
- [13. Shop](#13-shop)
- [14. Knowledge](#14-knowledge)
- [15. Admin](#15-admin)
- [16. Socket.IO](#16-socketio)
- [17. Вебхуки](#17-вебхуки)
- [18. Коды и форматы ошибок](#18-коды-и-форматы-ошибок)
- [19. AI-помощник и загрузки](#19-ai-помощник-и-загрузки)

---

## 1. Общие правила

### Аутентификация

| Тип | Передача | Время жизни |
| --- | --- | --- |
| Access-токен (JWT) | `Authorization: Bearer ...` | `ACCESS_TOKEN_TTL`, по умолчанию 15 минут |
| Refresh-токен (opaque) | Тело `POST /api/auth/refresh` и `/logout` | `REFRESH_TOKEN_TTL_DAYS`, по умолчанию 30 дней |

Полезная нагрузка access-токена: `{ sub: userId, role: 'ADMIN'|'TEACHER'|'STUDENT'|'PARENT', email }`.
Роль в токене проверяется `RolesGuard`; набор прав роли читается из БД (`PermissionsGuard`) — см. `/users/me/permissions`.

Ответы авторизации:

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "8f2c...",
  "user": { "id": "...", "email": "...", "phone": null, "firstName": "...", "lastName": "...",
    "role": "STUDENT", "avatarUrl": null, "locale": "ru", "emailVerifiedAt": null,
    "createdAt": "2026-11-13T09:00:00.000Z" }
}
```

### Роли и обозначения

`—` — без авторизации, `A` — любой авторизованный, `S`/`T`/`AD`/`P` — STUDENT / TEACHER / ADMIN / PARENT,
`owner` — дополнительно проверяется владение объектом или участие.

### Формат ошибок

Любая ошибка (Nest и Express-слои) возвращается в одном виде:

```json
{ "error": { "code": "NOT_FOUND", "message": "Маршрут не найден" } }
```

`code` — машиночитаемый (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`TOO_MANY_REQUESTS`, `INTERNAL_ERROR`), `details` присутствует у ошибок валидации.

### Пагинация

| Стиль | Параметры | Где используется |
| --- | --- | --- |
| Страничная | `page` (с 1), `limit` (1–100) | `/api/admin/*` |
| Страничная | `page`, `limit` (1–50) | `/api/knowledge/materials` |
| Курсорная | `before` (ISO datetime), `limit` (1–100) | `/api/messages/conversations/:id/messages` |
| Ограниченная выборка | `limit` | `/api/coins/history` |

Ответ страничных списков: `{ "items": [...], "total": 123, "page": 1, "limit": 20 }` (админ) или
`{ "items": [...] }` (остальные).

### Валидация

Все тела и query-параметры проходят Zod-валидацию. При ошибке — `422 VALIDATION_ERROR`:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Проверьте правильность заполнения полей",
  "details": [{ "path": "email", "message": "Некорректный email" }] } }
```

### Rate limiting

Глобально — 120 запросов в минуту с одного IP (`@nestjs/throttler`).
`POST /api/access/registration`, `/api/auth/login`, `/forgot-password`, `/reset-password` — строже: 20 запросов за 15 минут.
При превышении — `429 TOO_MANY_REQUESTS`.

### Идемпотентность

`POST /api/homework/:id/submit` принимает обязательный `idempotencyKey` (8–120 символов).
Повторный запрос с тем же ключом не создаёт новую сдачу.

---

## 2. Регистрация, вход и защита аккаунта

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| POST | `/access/registration` | — | Заявка на регистрацию; аккаунт создаётся только после одобрения |
| GET | `/access/registrations` | ADMIN | Список заявок (`status=PENDING\|APPROVED\|REJECTED\|ALL`) |
| POST | `/access/registrations/:id/decision` | ADMIN + step-up | Одобрить или отклонить заявку |
| POST | `/access/invitations` | ADMIN + step-up | Приглашение ссылкой, кодом, email или телефоном |
| GET | `/access/invitations` | ADMIN | Выданные приглашения |
| GET | `/access/invitations/:code` | — | Предпросмотр приглашения |
| POST | `/access/invitations/accept` | — | Активация приглашения и создание аккаунта |
| POST | `/auth/login` | — | Вход по email/телефону; при 2FA возвращает challenge |
| POST | `/auth/2fa/verify` | — (challenge) | Проверка TOTP/резервного кода и завершение входа |
| POST | `/auth/2fa/setup` | A | Секрет TOTP и otpauth-ссылка |
| POST | `/auth/2fa/enable` | A | Включение 2FA после пароля и кода |
| POST | `/auth/2fa/disable` | A | Отключение 2FA после повторного пароля |
| POST | `/auth/oauth/google` | — | Вход по Google ID-токену |
| POST | `/auth/oauth/apple` | — | Вход по Apple ID-токену |
| POST | `/auth/password/request` | — | Код восстановления на email или телефон |
| POST | `/auth/password/confirm` | — (код) | Новый пароль по коду |
| POST | `/auth/step-up` | A | Повторный пароль для важной операции |
| POST | `/access/users/:id/reset-access` | ADMIN + step-up | Восстановление доступа администратором |
| POST | `/auth/refresh` | — (refresh-токен) | Ротация пары токенов |
| POST | `/auth/logout` | — (refresh-токен) | Отзыв одной сессии |
| POST | `/auth/logout-all` | A | Отзыв всех сессий пользователя |
| GET | `/auth/sessions` | A | Активные сессии без токенов и хешей |
| DELETE | `/auth/sessions/:id` | A | Завершить свою сессию по идентификатору |

### POST /access/registration

```json
{
  "firstName": "Айбек",
  "lastName": "Асанов",
  "email": "student@example.com",
  "phone": "+996700000003",
  "password": "ITadis2026",
  "passwordRepeat": "ITadis2026",
  "birthDate": "2008-05-01",
  "locale": "ru",
  "guardianName": "Асан Асанов",
  "guardianPhone": "+996700000099",
  "guardianConsent": true,
  "inviteCode": "ABCD2345",
  "acceptTerms": true,
  "acceptPrivacy": true,
  "acceptDataProcessing": true
}
```

Ответ `201` — `{ id, status: "PENDING", message }`. Пользователь **не создаётся** и сессия не выдаётся
до решения администратора. Дубликат аккаунта или ожидающей заявки — `409 CONFLICT`.

Если указан `inviteCode`, проверяются срок действия и контакт приглашения; роль берётся из приглашения.
`birthDate` обязательна. Для заявителя младше 18 лет обязательны `guardianName`, `guardianPhone` и
`guardianConsent: true`; без подтверждения представителя заявка не принимается, а аккаунт не создаётся.
После одобрения данные переносятся в `UserProfile`, поля представителя шифруются, создаётся согласие
`GUARDIAN`. Администратор проверяет заявку и при необходимости связывается с представителем.

Одобрение: `POST /access/registrations/:id/decision` с `{ "approve": true }`; отклонение —
`{ "approve": false, "reason": "..." }`. Требуется `X-Step-Up-Token` (повторный пароль администратора).
При одобрении создаётся аккаунт, заявка получает статус `APPROVED`, приглашение гасится, а пользователю
отправляется письмо.

### POST /auth/login

```json
{ "identifier": "student@itadis.kg", "password": "ITadis2026", "deviceId": "uuid-устройства", "platform": "android" }
```

`identifier` — email или телефон. `platform`: `ios` | `android` | `web`. Устройство upsert-ится в `UserDevice`.
Ответ — объект сессии. Если включена 2FA, вместо токенов возвращается
`{ "twoFactorRequired": true, "challengeToken": "..." }`; после `POST /auth/2fa/verify` выдаются токены.
Неверные данные — `401 UNAUTHORIZED`; заблокированный аккаунт — `403 FORBIDDEN`. После 5 ошибок
требуется CAPTCHA, после 10 — `429 LOGIN_LOCKED` на 15 минут (счётчик по IP+идентификатору и отдельно
по идентификатору, чтобы смена IP не обходила блокировку).

OAuth (`google`/`apple`) принимает `{ "idToken": "..." }`. Незнакомый email возвращает
`registrationRequired` — аккаунт создаётся только через заявку. Для аккаунта с 2FA OAuth также
возвращает challenge. Все успешные способы входа проходят общий `completeLogin`: обновляют устройство/IP,
`lastLoginAt` и при новом устройстве или IP создают уведомление о подозрительном входе.

### Восстановление пароля

`POST /auth/password/request` с `{ "identifier": "email или телефон" }` отправляет код
на email или SMS. `POST /auth/password/confirm` с `{ "identifier", "code", "password", "passwordRepeat" }`
меняет пароль и отзывает сессии. Ответ запроса не раскрывает существование аккаунта.

### Приглашения

`POST /access/invitations` — `{ "channel": "LINK\|CODE\|EMAIL\|PHONE", "role": "STUDENT", "email", "phone", "ttlHours" }`.
Ссылка имеет вид `/join/:token`. Активация принимает `{ code, firstName, lastName, email, phone, birthDate,
password, passwordRepeat }`; для лица младше 18 лет также `guardianName`, `guardianPhone`, `guardianConsent: true`.
Для приглашения на email/телефон контакты должны совпадать с приглашением, иначе `403`.

### Восстановление доступа администратором

`POST /access/users/:id/reset-access` требует `X-Step-Up-Token`, полученный через `/auth/step-up`
повторным паролем. Администратор задаёт временный пароль (или генерирует его), все сессии пользователя
отзываются, пароль отправляется на email.

### POST /auth/refresh

```json
{ "refreshToken": "..." }
```

Старый refresh-токен отзывается, выдаётся новая пара в той же `family`. Повторное использование уже
отозванного токена отзывает **все** сессии пользователя, отправляет уведомление и возвращает `401`.
Если одновременно сменились IP и User-Agent, сессии также завершаются автоматически. Просроченный
токен — `401`.

### POST /auth/logout

```json
{ "refreshToken": "..." }
```

`204 No Content`. Сессия помечается отозванной. Идемпотентно.

### POST /auth/logout-all

Требует access-токен, тело не нужно. `204`. Отзывает все активные refresh-сессии пользователя.

---

## 3. Users

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/users/me` | A | Профиль текущего пользователя |
| PATCH | `/users/me` | A | Изменение профиля |
| POST | `/users/me/password` | A | Смена пароля |
| GET | `/users/me/courses` | A | Курсы пользователя (ученик — зачисления, преподаватель — свои) |
| GET | `/users/me/permissions` | A | Действующие права роли (для скрытия разделов на клиенте) |
| GET | `/users/me/students` | T, AD + право `analytics.view` | Ученики преподавателя с прогрессом |
| GET | `/users/:id` | A / owner | Публичный профиль |
| DELETE | `/users/me` | A | Удаление аккаунта с обезличиванием |

### GET /users/me

```json
{
  "id": "...", "email": "...", "phone": null, "firstName": "...", "lastName": "...",
  "role": "STUDENT", "avatarUrl": null, "locale": "ru", "emailVerifiedAt": null,
  "createdAt": "...",
  "profile": { "bio": null, "timezone": "Asia/Bishkek", "guardianName": null },
  "coinBalance": 120,
  "courses": [{ "enrollmentId": "...", "progress": 40, "status": "ACTIVE",
    "course": { "id": "...", "title": "React", "coverUrl": null, "level": "BEGINNER", "teacher": "Айгуль Осмонова" } }]
}
```

### PATCH /users/me

Разрешённые поля: `firstName`, `lastName`, `phone` (можно `null`), `avatarUrl` (URL, `null`),
`locale` (`ru|ky|en`), `timezone`, `bio` (`null`). Роль и email изменить нельзя.

### POST /users/me/password

```json
{ "currentPassword": "...", "newPassword": "..." }
```

`newPassword` — ≥ 8 символов и хотя бы одна цифра. Смена пароля автоматически отзывает все сессии
пользователя (кроме текущей пары сервер не выдаёт — нужно войти заново). Успех — `204`.

### GET /users/me/permissions

```json
{ "role": "TEACHER", "permissions": ["analytics.view", "coins.award", "courses.manage", "homework.review"] }
```

Права берутся из `RolePermission` и кешируются на 60 секунд. Используются для навигации и скрытия кнопок;
решение о доступе всегда принимает сервер (`@RequirePermissions`).

### GET /users/me/courses

Ученик: активные и завершённые зачисления с `progress`. Преподаватель: курсы, где он `teacherId`.
Элемент: `{ id, title, coverUrl, level, progress, status, studentsCount? }`.

### GET /users/me/students

Только `TEACHER`/`ADMIN` с правом `analytics.view` (у обеих ролей оно есть в seed). Список учеников своих курсов:
`{ id, firstName, lastName, email, avatarUrl, courseTitle, progress, lastActivity }`.

### GET /users/:id

Ученик может получить только себя (иначе `404`). Преподаватель и админ — любого неудалённого пользователя.
Поля: `id`, `firstName`, `lastName`, `role`, `avatarUrl`, `bio`, `coinBalance`, `createdAt`.

Поля `email` и `phone` в чужом профиле не отдаются.

### DELETE /users/me

Обезличивание в транзакции: email заменяется на `deleted+<id>@itadis.invalid`, телефон и аватар
очищаются, пароль перегенерируется, профиль удаляется, все сессии и устройства отзываются,
`deletedAt` заполняется. `204`. Запись в аудит: `user.deleted`.

---

## 4. Courses и Lessons

Модули — Nest: `apps/api/src/modules/courses/*` и `.../lessons/*`.

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/courses/categories` | A | Категории каталога и число активных курсов |
| GET | `/courses` | A | Каталог с поиском, категорией, уровнем, сортировкой |
| GET | `/courses/my` | A | Курсы ученика с прогрессом и следующим уроком |
| GET | `/courses/overview` | A | Сводка главного экрана: баланс, прогресс, занятие, курсы |
| GET | `/courses/:id` | A | Курс с модулями и уроками (уроки закрыты без записи) |
| POST | `/courses/:id/enroll` | S | Запись на активный курс (идемпотентно) |
| GET | `/lessons/:id` | A / enrolled | Урок с материалами и прогрессом |
| PATCH | `/lessons/:id/progress` | S | Сохранение позиции/просмотра видео |
| POST | `/lessons/:id/complete` | S | Завершение урока и пересчёт прогресса курса |
| POST | `/lessons` | T (свой курс), AD | Создание урока |
| PATCH | `/lessons/:id` | T (свой курс), AD | Изменение и публикация урока |
| DELETE | `/lessons/:id` | T (свой курс), AD | Удаление неопубликованного урока |
| POST | `/courses/:id/modules` | T (свой курс), AD | Создание модуля |
| PATCH | `/modules/:id` | T (свой курс), AD | Название, описание, позиция модуля |
| DELETE | `/modules/:id` | T (свой курс), AD | Удаление пустого модуля |

### GET /courses

Query: `search` (название/описание), `category` (slug), `level` (`BEGINNER|INTERMEDIATE|ADVANCED`),
`sort` (`new|popular|title`), `mine=true` — только свои курсы, `limit` 1–50, `offset`.
Поиск и фильтры выполняются в PostgreSQL; прогресс считается на сервере.

```json
{ "items": [{ "id": "...", "title": "React Native с нуля", "slug": "react-native-start",
    "description": "...", "coverUrl": null, "level": "BEGINNER",
    "teacher": { "id": "...", "name": "Нурсултан Асанов" },
    "category": { "id": "...", "slug": "react-native", "title": "React Native", "icon": "📱" },
    "modulesCount": 2, "lessonsCount": 5, "durationMinutes": 140, "studentsCount": 3,
    "enrolled": true, "progress": 40 }],
  "total": 6, "hasMore": false,
  "filters": { "search": null, "category": null, "level": null, "sort": "new", "mine": false } }
```

### GET /courses/categories

`{ "items": [{ "id", "slug", "title", "icon", "coursesCount" }] }`, порядок — `position`.

### GET /courses/my

Курсы, на которые записан ученик: `enrollmentId`, `enrollmentStatus`, `progress`, `lessonsCount`,
`completedLessons`, `course` (карточка и длительность) и `nextLesson` — первый незавершённый урок
(`id`, `title`, `moduleTitle`, `durationMinutes`) или `null`.

### GET /courses/overview

Один запрос для главного экрана: `coinBalance`, `activeCoursesCount`, `completedCoursesCount`,
`overallProgress` (средний прогресс активных курсов), `totalLessons`, `completedLessons`,
`activeCourses` (до 4 курсов), `continueLearning` (курс, урок, прогресс) и `nextClass`
(ближайшее занятие ученика: время, преподаватель, наличие комнаты) или `null`.

### GET /courses/:id

Доступен любому авторизованному пользователю: ученик видит опубликованные уроки и получает
`locked: true`, пока не записан на курс; уроки без записи не открываются (`404` на `/lessons/:id`).
Ответ: `id`, `title`, `slug`, `description`, `coverUrl`, `level`, `status`, `category`,
`teacher: { id, name }`, `enrollment` (или `null`), `isEnrolled`, `progress`, `completedLessons`,
`lessonsCount`, `durationMinutes`, `modules: [{ id, title, description, position, lessonsCount,
completedLessons, lessons: [{ id, title, description, durationMinutes, publishedAt, materialsCount,
status, lastPositionSeconds, locked }] }]`.

### POST /courses/:id/enroll

Записывает ученика на активный курс; повторный вызов не создаёт дубль. Ответ:
`{ enrollment: { id, status, progress, enrolledAt }, created }`. Неопубликованный курс — `404`.

### GET /lessons/:id

Ученик открывает только опубликованный урок курса, на который записан; преподаватель — уроки
своих курсов; иначе `404`/`403`. Ответ: `id`, `title`, `description`, `content` (конспект), `videoUrl`,
`durationMinutes`, `publishedAt`, `materials: [{ id, type, title, url, mimeType, sizeBytes }]`,
`course: { id, title, progress, lessonsCount, completedLessons }`, `module: { id, title }`,
`progress: { status, lastPositionSeconds, watchedSeconds, completedAt }` (или `null`),
`prevLesson` и `nextLesson` (`{ id, title }` или `null`) — по порядку модулей и уроков курса.

### PATCH /lessons/:id/progress

```json
{ "positionSeconds": 420 }
```

Обновляет `LessonProgress` (создаёт при необходимости), статус `IN_PROGRESS`. Завершённый урок
не переводится обратно в «в процессе». Ответ — `{ status, lastPositionSeconds }`.

### POST /lessons/:id/complete

Тело не нужно. Ставит `COMPLETED`, пересчитывает `CourseEnrollment.progress` (при 100% — статус
`COMPLETED`), запускает выдачу достижений. Ответ:
`{ progress, totalLessons, completedLessons, lessonCompleted, awarded: ["Первый урок"] }`.

### POST /lessons

```json
{ "moduleId": "uuid", "title": "...", "description": "...", "content": "...",
  "videoUrl": "https://...", "durationMinutes": 25, "position": 0, "published": false }
```

Преподаватель может добавить урок только в модуль своего курса (иначе `403`).

### PATCH /lessons/:id

Любое подмножество полей урока + `published: boolean`. Публикация выставляет/снимает `publishedAt`.

### DELETE /lessons/:id

Опубликованный урок удалить нельзя (`400`): сначала `published: false`.

### POST /courses/:id/modules

```json
{ "title": "Введение в JavaScript", "description": "...", "position": 0 }
```

Преподаватель создаёт модуль только в своём курсе, администратор — в любом. Если `position`
не передан, модуль встаёт в конец программы. Ответ `201`: `{ id, title, description, position }`.

### PATCH /modules/:id

Любое подмножество `title`, `description`, `position`. Владение курсом проверяется на сервере.

### DELETE /modules/:id

Пустой модуль удаляется (`204`). Если в модуле есть уроки — `400`: сначала удалите или перенесите их.

---

## 5. Homework

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/homework` | A | Задания: ученик — своих курсов, преподаватель — свои |
| GET | `/homework/:id` | A / owner | Детали задания и последняя сдача |
| POST | `/homework/:id/submit` | S enrolled | Отправка работы |

### GET /homework

```json
{ "items": [{ "id": "...", "title": "Лендинг на Flexbox", "description": "...",
  "dueAt": "2026-11-20T18:00:00.000Z", "maxScore": 10, "allowResubmit": true,
  "course": { "id": "...", "title": "HTML/CSS" },
  "submission": { "id": "...", "status": "REVIEWED", "score": 9, "submittedAt": "..." } }] }
```

`submission` — последняя попытка ученика (`null`, если не отправлял). Статусы сдачи:
`SUBMITTED`, `REVIEWED`, `RETURNED`. Просроченность вычисляется клиентом по `dueAt`
(отдельного статуса `EXPIRED` в сдаче нет).

### GET /homework/:id

Поля задания целиком (`id`, `title`, `description`, `dueAt`, `maxScore`, `allowResubmit`, `courseId`,
`lessonId`, `teacherId`), `course: { id, title }` и `mySubmission` — последняя попытка ученика
с вложенным `review` (`score`, `comment`, `returnForRevision`) или `null`.

### POST /homework/:id/submit

```json
{
  "text": "Ссылка на репозиторий и описание решения",
  "projectUrl": "https://github.com/user/project",
  "files": [{ "name": "report.pdf", "url": "https://cdn.example.com/report.pdf" }],
  "idempotencyKey": "hw-8f3c1a9e-2026-11-13"
}
```

- хотя бы одно из `text` / `projectUrl` / `files` должно быть заполнено;
- `files` — до 10 элементов, каждый `{ name, url }` (файлы уже загружены во внешнее хранилище);
- ученик должен быть записан на курс задания;
- при `allowResubmit = false` повторная отправка после проверки — `400`;
- работа со статусом `RETURNED` принимается повторно всегда, даже после дедлайна и без `allowResubmit`;
- `idempotencyKey` обязателен (8–120 символов).

Ответ `201`: `{ id, attempt, status }`; повтор с тем же ключом — `200` и `repeated: true`.
Проверенная работа начисляет IT Coins (см. раздел 11).

### Кабинет преподавателя (`/teacher/*`)

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/teacher/overview` | T, AD | Сводка: курсы, ученики, работы на проверке, средний прогресс, ближайшее занятие |
| GET | `/teacher/courses` | T, AD | Курсы преподавателя со счётчиками модулей, уроков, учеников и проверок |
| GET | `/teacher/courses/:id` | T owner, AD | Программа курса: модули, уроки, задания и средний прогресс |
| POST | `/teacher/courses/:courseId/homework` | T owner, AD | Создание задания с дедлайном и баллом |
| GET | `/teacher/homework/:id` | T owner, AD | Задание для редактора |
| PATCH | `/teacher/homework/:id` | T owner, AD | Дедлайн, максимальный балл, повторная сдача |
| GET | `/teacher/submissions` | T, AD | Очередь работ: `status` (`PENDING\|REVIEWED\|RETURNED\|ALL`), `courseId`, `limit` |
| GET | `/teacher/submissions/:id` | T owner, AD | Работа ученика, задание и выставленный отзыв |
| POST | `/teacher/submissions/:id/review` | T owner, AD | Оценка, комментарий или возврат на доработку |

Задание создаётся только в своём курсе; `dueAt` — ISO 8601, `maxScore` — целое 1–100,
`allowResubmit` управляет повторной сдачей, `lessonId` опционален и должен принадлежать тому же курсу.
При создании активные ученики курса получают уведомление `HOMEWORK_ASSIGNED`. `PATCH` принимает
подмножество полей. Проверка работы начисляет IT Coins пропорционально баллу; повторная проверка
не дублирует начисление, возврат на доработку (`returnForRevision`) монет не даёт. Ответ — карточка задания: `id`, `title`, `description`, `dueAt`, `maxScore`,
`allowResubmit`, `lessonId`, `lesson`, `createdAt`, `pendingSubmissions`.

`PENDING` — это работы со статусом `SUBMITTED`; в ответе очереди элементы уже содержат
`student`, `homework` и (после проверки) `review`.

```json
{ "score": 8, "comment": "Хорошая работа, поправьте оформление.", "returnForRevision": false }
```

- `score` — целое 0–100, но не больше `homework.maxScore` (иначе `400`), некорректное тело — `422`;
- при `returnForRevision: true` работа получает `RETURNED` и требует комментарий в мобильном клиенте;
- успешный ответ `201`: `{ id, status, score, review }`; повторная проверка обновляет отзыв, а не создаёт второй;
- ученику создаётся уведомление `GRADE_RECEIVED` или `HOMEWORK_REVIEWED`; после оценки
  пересчитываются достижения (например, «Первое домашнее задание»);
- преподаватель видит только работы своих курсов (иначе `403`), ученику весь раздел `/teacher/*` закрыт.

---

## 6. Tests

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/tests` | A | Список тестов с попытками |
| GET | `/tests/:id` | A / owner | Тест и вопросы без правильных ответов |
| POST | `/tests/:id/start` | S enrolled | Начать попытку |
| POST | `/tests/:id/submit` | S enrolled | Отправить ответы, получить результат |
| GET | `/tests/:id/results` | A / owner | Результаты: свои или группы |

### GET /tests

Ученик видит только опубликованные тесты своих курсов. Элемент:
`{ id, title, description, course, timeLimitMinutes, passingScore, attemptsAllowed, questionsCount,
isPublished, myAttempts, bestScore, hasActiveAttempt }`.

### GET /tests/:id

```json
{
  "id": "...", "title": "...", "course": { "id": "...", "title": "..." },
  "timeLimitMinutes": 30, "passingScore": 60, "attemptsAllowed": 3, "attemptsLeft": 2,
  "questions": [{
    "id": "...", "type": "SINGLE", "prompt": "Что вернёт typeof null?", "points": 1,
    "options": [{ "id": "...", "text": "object" }],
    "matchPairsLeft": null, "matchPairsRight": null
  }],
  "attempts": [{ "id": "...", "status": "SUBMITTED", "startedAt": "...", "submittedAt": "...",
    "score": 8, "answers": [{ "questionId": "...", "isCorrect": true, "pointsAwarded": 1 }] }]
}
```

Ученик видит свои последние 20 попыток, преподаватель — до 200 попыток всех учеников.

Ключи правильных ответов (`TestOption.isCorrect`, `correctNumber`, `correctBoolean`, `matchPairs`)
клиенту **не отдаются**. Для `MATCHING` левая колонка идёт в исходном порядке, правая — перемешана.
При `shuffleQuestions`/`shuffleOptions` сервер перемешивает порядок.

Типы вопросов: `SINGLE`, `MULTIPLE`, `TEXT`, `NUMBER`, `BOOLEAN`, `MATCHING`.

### POST /tests/:id/start

Тело не нужно. Если есть активная непросроченная попытка — она возвращается с `resumed: true` и
сохранёнными ответами. Просроченная попытка закрывается как `EXPIRED`; при исчерпании лимита — `409`.

```json
{ "attemptId": "...", "expiresAt": "...", "resumed": false,
  "questions": [ /* те же вопросы без ключей */ ],
  "savedAnswers": [{ "questionId": "...", "value": "..." }] }
```

### POST /tests/:id/submit

```json
{
  "attemptId": "uuid",
  "answers": [
    { "questionId": "uuid", "value": "option-id" },
    { "questionId": "uuid", "value": ["option-1", "option-2"] },
    { "questionId": "uuid", "value": 42 },
    { "questionId": "uuid", "value": true },
    { "questionId": "uuid", "value": "текстовый ответ" },
    { "questionId": "uuid", "value": ["left-1::right-2", "left-2::right-1"] }
  ]
}
```

- `value` зависит от типа: строка (SINGLE — id опции, TEXT — текстовый ответ), массив id строк
  (MULTIPLE), число (NUMBER), boolean (BOOLEAN), массив строк вида `"лево::право"` (MATCHING);
- TEXT сравнивается без учёта регистра и пробелов с текстом правильной опции (`TestOption.isCorrect`);
- принимается в пределах таймера + 60 секунд (`TEST_GRACE_MS`), позже — `EXPIRED` и результат по
  сохранённым ответам;
- подсчёт выполняет только сервер (`modules/tests/grading.ts`).

Ответ:

```json
{
  "attemptId": "...", "score": 8, "maxScore": 10, "percent": 80, "passed": true,
  "correctCount": 8, "incorrectCount": 2, "totalQuestions": 10,
  "review": [{ "questionId": "...", "isCorrect": false, "pointsAwarded": 0 }],
  "coins": { "awarded": true, "amount": 18, "balance": 138 }
}
```

`score` — сумма набранных баллов, `percent` — процент от максимума, `passed` — `percent >= passingScore`.
В разборе не раскрываются правильные ответы — только факт и набранные баллы.
За пройденный тест в пределах таймера сервер начисляет IT Coins той же транзакцией (`coins.awarded`).

### GET /tests/:id/results

Ученик — свои попытки; преподаватель — всех учеников своих курсов (до 200):
`{ id, student, status, score, startedAt, submittedAt, correctCount, answersCount }`.

---

## 7. Schedule

Nest-модуль `src/modules/schedule`.

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/schedule` | A | Занятия пользователя в периоде `from`…`to` (до 500) |
| POST | `/schedule` | T owner, AD | Создать занятие с проверкой пересечений |

```json
{ "items": [{ "id": "...", "title": "Разбор макетов", "description": null,
  "startsAt": "...", "endsAt": "...", "timezone": "Asia/Bishkek", "status": "SCHEDULED",
  "course": { "id": "...", "title": "UI/UX" }, "teacher": "Айгуль Осмонова",
  "hasRoom": true }],
  "range": { "from": "...", "to": "..." } }
```

Query: `from`, `to` — ISO 8601 (по умолчанию −7 дней…+60 дней, максимум 120 дней, иначе `400`),
`courseId` — необязательный фильтр. Scope: ученик — занятия курсов, на которые записан;
преподаватель — своих курсов; админ — все. Статусы: `SCHEDULED`, `ONGOING`, `COMPLETED`,
`CANCELLED`, `RESCHEDULED`.

### POST /schedule

```json
{ "courseId": "uuid", "title": "Разбор макетов", "description": "Необязательно",
  "startsAt": "2026-11-20T10:00:00.000Z", "durationMinutes": 60 }
```

`durationMinutes` — 15–480; `endsAt` считает сервер; занятие должно заканчиваться в будущем.
Преподаватель может создавать занятия только в своих курсах. Сервер проверяет пересечение по времени
с любым занятием преподавателя и с занятиями того же курса (кроме `CANCELLED`) и возвращает
`409 CONFLICT` с названием, курсом и временем конфликтующего занятия. При создании активные ученики
курса получают уведомление `SCHEDULE_CHANGED`, действие пишется в аудит.

---

## 8. Video: LiveDigital и исторический LiveKit

> **Актуальный контракт.** Новые видеоинтеграции используют
> `/api/scheduling/schedules/:id/video/*` и LiveDigital (см. `docs/api/modules.md`).
> Статус: `GET /api/scheduling/video/status`; комната, вход, выход, завершение,
> запись и аналитика — вложенные маршруты `schedules/:id/video/*` и
> `schedules/:id/recording/*`. Раздел ниже описывает старый контракт `/api/video/*`;
> он оставлен как исторический и не должен использоваться для новых клиентов.
> Переменные `LIVEKIT_*` относятся только к архиву старых записей.

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/video/status` | A | Настроен ли LiveKit и хранилище записей |
| POST | `/video/rooms` | T (свой курс), AD | Создать/получить комнату занятия |
| POST | `/video/rooms/join` | A / owner | Токен участника и URL |
| POST | `/video/rooms/:id/leave` | A | Отметить выход, закрыть интервал |
| POST | `/video/rooms/:id/end` | T, AD | Завершить занятие |
| POST | `/video/rooms/:id/recording/start` | T, AD | Запустить запись (Egress) |
| POST | `/video/rooms/:id/recording/stop` | T, AD | Остановить запись по `recordingId` |
| GET | `/video/rooms/:id/attendance` | T, AD | Посещаемость занятия |
| GET | `/video/recordings` | A / owner | Записи доступных занятий |

### GET /video/status

```json
{ "enabled": true, "recording": false }
```

`enabled` — заданы `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; `recording` — заданы
`RECORDING_S3_*`. При `enabled: false` остальные маршруты отвечают `503 VIDEO_NOT_CONFIGURED`.

### POST /video/rooms

```json
{ "scheduleId": "uuid" }
```

Если комната существует — возвращается она же (`200`), иначе `201`:
`{ id, roomName, status }`. Проверяется доступ преподавателя к курсу занятия.

### POST /video/rooms/join

```json
{ "scheduleId": "uuid" }
```

Проверки: комната существует (`404`, если преподаватель ещё не создал её); занятие не завершено (`409`);
ученик записан на курс; окно доступа — с 15 минут до начала до окончания занятия (+ допуск). Ответ:

```json
{ "roomId": "...", "roomName": "schedule-...", "url": "wss://livekit.example.com",
  "token": "eyJ...", "expiresAt": "...", "canPublish": true, "isModerator": false,
  "schedule": { "id": "...", "title": "...", "startsAt": "...", "endsAt": "..." },
  "course": { "id": "...", "title": "..." }, "teacher": "Айгуль Осмонова" }
```

Токен короткоживущий, содержит `roomJoin` и права публикации; `isModerator` истинно для преподавателя
и админа. При входе создаётся/переоткрывается `Attendance`; первая комната переходит в `LIVE`.

### POST /video/rooms/:id/leave

Тело не нужно. Закрывает `leftAt` и добавляет длительность интервала. `204`.

### POST /video/rooms/:id/end

Только преподаватель курса или админ. Статус комнаты `ENDED`, `endedAt`. `204`.

### Запись

- `POST /rooms/:id/recording/start` → `{ recordingId, egressId, status }`; без S3 — `503`.
- `POST /rooms/:id/recording/stop` → `{ recordingId, egressId, status: "STOPPING" }`.
- URL записи появляется после вебхука `egress_ended`.

### GET /video/rooms/:id/attendance

```json
{ "items": [{ "userId": "...", "name": "Айбек Асанов", "role": "STUDENT",
  "joinedAt": "...", "leftAt": "...", "durationSeconds": 1830 }] }
```

Для ещё не вышедших участников длительность считается от `joinedAt` до текущего момента.

### GET /video/recordings

Только записи занятий, доступных пользователю (свои курсы/зачисления; админ — все):
`{ id, status, url, startedAt, endedAt, schedule: { id, title, startsAt, course: { id, title } } }`.
`url` появляется после обработки вебхука `egress_ended`.

---

## 9. Messages

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/messages/conversations` | A | Список переписок с непрочитанными |
| POST | `/messages/conversations` | A | Создать/получить личный или курс-чат |
| GET | `/messages/conversations/:id` | participant | Переписка и участники |
| GET | `/messages/conversations/:id/messages` | participant | История (`before`, `limit`, `q`) |
| POST | `/messages/conversations/:id/messages` | participant | Отправить сообщение |
| POST | `/messages/conversations/:id/read` | participant | Отметить прочитанным |
| POST | `/messages/messages/:id/report` | participant | Жалоба на сообщение (аудит) |

### POST /messages/conversations

```json
{ "type": "DIRECT", "userId": "uuid" }
```

или

```json
{ "type": "COURSE", "courseId": "uuid" }
```

`DIRECT` — обязателен `userId`, `COURSE` — `courseId`. Повторный запрос возвращает существующую переписку.
Чат курса доступен преподавателю курса, записанным ученикам и админу.

### GET /messages/conversations

```json
{ "items": [{ "id": "...", "type": "COURSE", "title": "HTML/CSS", "courseId": "...",
  "participants": [{ "userId": "...", "name": "Айбек Асанов" }],
  "lastMessage": { "id": "...", "body": "...", "senderName": "...", "createdAt": "..." },
  "unread": 3, "lastReadAt": "..." }], "unreadTotal": 3 }
```

### GET /messages/conversations/:id/messages

Query: `before` (ISO, для подгрузки старых), `limit` (1–100, по умолчанию 30), `q` (поиск по тексту).
Ответ: `{ items: [{ id, body, attachments, createdAt, isMine, sender: { id, firstName, lastName, avatarUrl } }], hasMore }`.
Сервер выбирает последние `limit` сообщений и возвращает их **в хронологическом порядке**.
`hasMore` — есть ли более старые сообщения для подгрузки через `before`.

### POST /messages/conversations/:id/messages

```json
{
  "body": "Привет! Вопрос по заданию",
  "attachments": [{ "name": "screenshot.png", "url": "https://cdn...", "mimeType": "image/png" }]
}
```

`body` 1–4000 символов, вложений до 5. Создаёт `Notification` получателям и рассылает `message:new`
в комнату переписки. Ответ `201` — сохранённое сообщение.

### POST /messages/conversations/:id/read

Отмечает прочтение до текущего момента (`ConversationParticipant.lastReadAt`). Ответ: `{ "ok": true }`.
Фактический счётчик непрочитанных возвращает `GET /messages/conversations`.

### POST /messages/messages/:id/report

Тело не требуется. Проверяет участие в переписке, пишет `AuditLog` (`action: "message.report"`) и
уведомляет всех администраторов. Повторная жалоба того же пользователя не дублируется.
Ответ `201 { "ok": true }`; для повторной — `200 { "ok": true, "duplicate": true }`.

---

## 10. Notifications

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/notifications` | A | Последние уведомления и счётчик непрочитанных |
| PATCH | `/notifications/:id/read` | owner | Отметить одно прочитанным |
| POST | `/notifications/read-all` | A | Отметить все прочитанными |

Query: `limit` (по умолчанию 30, максимум 100).

```json
{ "items": [{ "id": "...", "type": "HOMEWORK_REVIEWED", "title": "Работа проверена",
  "body": "Оценка 9/10", "data": { "homeworkId": "..." }, "readAt": null, "createdAt": "..." }],
  "unread": 4 }
```

`PATCH /notifications/:id/read` возвращает обновлённое уведомление; `POST /notifications/read-all` —
`{ "updated": 4 }`.

Типы: `HOMEWORK_ASSIGNED`, `HOMEWORK_DUE_SOON`, `HOMEWORK_REVIEWED`, `GRADE_RECEIVED`,
`LESSON_PUBLISHED`, `SCHEDULE_CHANGED`, `LESSON_STARTING`, `VIDEO_STARTED`, `MESSAGE_RECEIVED`,
`COINS_AWARDED`, `ACHIEVEMENT_UNLOCKED`, `SHOP_ORDER`, `SYSTEM`.

Push-уведомления пока не отправляются: сервер создаёт записи в центре уведомлений.

---

## 11. Coins

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/coins/balance` | A | Текущий баланс |
| GET | `/coins/history` | A | Транзакции пользователя (`limit` ≤ 200) |
| POST | `/coins/award` | T (свои ученики), AD | Начислить монеты |

### GET /coins/balance

```json
{ "balance": 120 }
```

### GET /coins/history

```json
{ "items": [{ "id": "...", "amount": 10, "reason": "Активность на занятии",
  "awardedById": "...", "createdAt": "..." }], "balance": 120 }
```

```json
{ "items": [{ "id": "...", "amount": 10, "reason": "Домашнее задание: Лендинг",
  "sourceType": "HOMEWORK", "sourceId": "submission-uuid", "createdAt": "..." }],
  "balance": 120, "totals": { "earned": 170, "spent": 50 } }
```

`amount` положительный при начислении и отрицательный при списании (магазин). `sourceType` — 
`MANUAL`, `HOMEWORK`, `TEST`, `ATTENDANCE`, `ACHIEVEMENT` или `SHOP`; `sourceId` — идентификатор
действия (работа, попытка теста, занятие). Уникальный ключ `[userId, sourceType, sourceId]` не даёт
начислить награду за одно действие дважды.

### Автоматические начисления

| Действие | Монеты | Условие |
| --- | --- | --- |
| Проверка ДЗ | 2–20 | `score / maxScore`, только статус `REVIEWED` |
| Пройденный тест | 10–20 | `percent >= passingScore`, попытка не истекла |
| Посещение занятия | 3 | первое подключение ученика к комнате занятия |
| Достижение | из условия | `Achievement.condition.rewardCoins` |

Все начисления выполняются в `src/lib/coins.ts` внутри транзакции вместе с балансом и уведомлением.

### POST /coins/award

```json
{ "studentId": "uuid", "amount": 25, "reason": "Лучший проект модуля" }
```

`amount` 1–1000, `reason` 3–200 символов. Преподаватель может начислять только ученикам своих курсов.
Операция атомарна: `CoinTransaction` + `CoinBalance` в одной транзакции, затем `Notification` и `AuditLog`.
Ответ `201`: `{ transaction, balance }`.

---

## 12. Achievements

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/achievements` | A | Все достижения с прогрессом и датой получения |
| POST | `/achievements/check` | A | Пересчитать и выдать доступные |

```json
{ "items": [{ "id": "...", "code": "FIRST_LESSON", "title": "Первый урок",
  "description": "Завершите первый урок", "iconUrl": null, "current": 1, "target": 1,
  "earnedAt": "2026-11-01T10:00:00.000Z" }], "earned": 3, "total": 7 }
```

`current`/`target` — прогресс условия; `earnedAt = null` — достижение ещё не получено.
`POST /achievements/check` возвращает `{ "awarded": [...] }` — только что выданные достижения.

Условия (`condition`): `lessons_completed`, `homework_reviewed`, `tests_completed`,
`courses_completed`, `attendance`, `coins_earned`. Выдача идемпотентна (составной ключ), награда —
монеты + уведомление.

---

## 13. Shop

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/shop/products` | A | Активные товары |
| POST | `/shop/orders` | S | Заявка на товар (списание монет) |
| GET | `/shop/orders` | A | Свои заявки (админ — все) |
| PATCH | `/shop/orders/:id` | AD | Обработка заявки |
| POST | `/shop/products` | AD | Создать товар |
| PATCH | `/shop/products/:id` | AD | Изменить товар |

### Товар

```json
{ "id": "...", "title": "Худи ITadis", "description": "...", "imageUrl": null,
  "category": "Мерч", "priceCoins": 500, "stock": 10, "isActive": true, "terms": null }
```

### POST /shop/orders

```json
{ "productId": "uuid", "comment": "Размер M" }
```

Атомарно: проверка остатка и баланса, списание монет, уменьшение остатка, заявка `NEW`.
Недостаточно монет или остатка — `409`, товар недоступен — `404`. Уведомление ученику.
Ответ `201`: `{ id, status, createdAt, product: { id, title, priceCoins } }`.

### PATCH /shop/orders/:id

```json
{ "status": "REJECTED" }
```

Допустимо: `APPROVED`, `ISSUED`, `REJECTED`. При `REJECTED` монеты и остаток возвращаются отдельными
операциями в той же транзакции; ученик получает уведомление. Пишется аудит.

Статусы заявки: `NEW → APPROVED → ISSUED`, `REJECTED`.

---

## 14. Knowledge

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/knowledge/categories` | A | Категории с количеством материалов |
| GET | `/knowledge/materials` | A | Каталог: поиск, категория, тип, сортировка, страницы |
| GET | `/knowledge/materials/:id` | A | Материал, фиксация просмотра |
| POST | `/knowledge/materials/:id/favorite` | A | В избранное |
| DELETE | `/knowledge/materials/:id/favorite` | A | Из избранного |
| GET | `/knowledge/favorites` | A | Избранные материалы |
| GET | `/knowledge/history` | A | История просмотров |
| GET | `/knowledge/recommendations` | A | Рекомендации по просмотренным категориям |
| POST | `/knowledge/materials` | T (автор), AD | Создать материал |
| PATCH | `/knowledge/materials/:id` | T (автор), AD | Изменить/опубликовать |

Query для `/knowledge/materials`: `search` (≤120), `category` (slug), `type`
(`VIDEO|DOCUMENT|PRESENTATION|IMAGE|LINK`), `sort` (`new|popular`), `page`, `limit` (≤50).

Категории: `{ items: [{ id, slug, title, icon, materials }] }`.

Список материалов: `{ items, total, page, limit }`; элемент — `id`, `title`, `description`, `coverUrl`,
`type`, `durationMinutes`, `createdAt`, `category { id, slug, title }`, `author` (строка «Имя Фамилия»),
`views`, `isFavorite`.

Карточка материала добавляет `videoUrl`, `content`, `fileUrl`; `author` — тоже строка, `views`
увеличен на текущий просмотр. Ученик получает только опубликованные материалы.

Просмотр записывается в `KnowledgeView` (обновляется `viewedAt`). Рекомендации не повторяют уже
просмотренные материалы.

---

## 15. Admin

Все маршруты `/api/admin/*` требуют роль `ADMIN` (middleware на весь роутер). Отказ — `403`.

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/admin/dashboard` | Сводка платформы и активность за неделю |
| GET | `/admin/users` | Пользователи: `search`, `role`, `onlyBlocked`, `page`, `limit` |
| PATCH | `/admin/users/:id` | Изменить имя/фамилию, роль, блокировку |
| GET | `/admin/courses` | Курсы: `search`, `status`, `page`, `limit` |
| GET | `/admin/submissions` | Домашние работы: `status` (`SUBMITTED`, `REVIEWED`, `RETURNED`, `ALL`), `search` |
| GET | `/admin/test-attempts` | Попытки тестов: балл, проходной балл, статус |
| GET | `/admin/coin-transactions` | Транзакции IT Coins: `sourceType`, `search`, итоги `awarded`/`spent` |
| GET | `/admin/schedule` | Расписание за период `from`/`to` |
| GET | `/admin/shop-orders` | Заявки магазина: `status` (`NEW`, `APPROVED`, `ISSUED`, `REJECTED`, `ALL`) |
| GET | `/admin/analytics` | Аналитика: сдачи, тесты, посещаемость, популярные курсы |
| GET | `/admin/audit-logs` | Журнал аудита: `action`, `entity`, `page`, `limit` |

Модерация заявки магазина выполняется существующим маршрутом `PATCH /api/shop/orders/:id`
(`APPROVED`, `ISSUED`, `REJECTED`). При `REJECTED` сервер в одной транзакции возвращает монеты и остаток
товара, создаёт уведомление и запись аудита.

### GET /admin/dashboard

```json
{
  "users": { "students": 128, "teachers": 9, "admins": 1, "total": 138 },
  "courses": { "active": 14, "draft": 3, "completedEnrollments": 22 },
  "upcomingLessons": 42,
  "homeworkTotal": 31,
  "activity": { "newUsers": 12, "activeLastWeek": 74 },
  "recentAudit": [{ "id": "...", "action": "admin.user.update", "entity": "User",
    "createdAt": "...", "actor": "Айгуль Осмонова" }]
}
```

### PATCH /admin/users/:id

```json
{ "role": "TEACHER" }
```

Допустимо: `firstName`, `lastName`, `role`, `isActive`. Хотя бы одно поле.Изменения ролей и блокировка пишутся в `AuditLog` (`admin.user.update`, `entity: "User"`,
`metadata: { before, after }`). Админ не может изменить собственную роль или заблокировать себя — `400`
(проверка в маршруте).

### GET /admin/audit-logs

```json
{ "items": [{ "id": "...", "actor": { "id": "...", "firstName": "...", "lastName": "..." },
  "action": "coins.awarded", "entity": "user", "entityId": "...",
  "metadata": { "amount": 25 }, "ip": "127.0.0.1", "createdAt": "..." }],
  "total": 500, "page": 1, "limit": 20 }
```

---

## 16. Socket.IO

Подключение на том же origin, что и API:

```ts
import { io } from 'socket.io-client'
const socket = io(API_ORIGIN, { auth: { token: accessToken }, transports: ['websocket', 'polling'] })
```

| Направление | Событие | Payload | Правила |
| --- | --- | --- | --- |
| client → server | `conversation:join` | `conversationId: string` | вход в комнату только после проверки участия |
| client → server | `conversation:leave` | `conversationId: string` | — |
| client → server | `typing` | `{ conversationId, name? }` | только для комнат, где сокет уже состоит |
| server → client | `message:new` | `{ conversationId, message }` | после сохранения через REST |
| server → client | `message:notification` | `{ conversationId, title, body, message }` | личная комната `user:<id>` |
| server → client | `typing` | `{ conversationId, userId, name }` | остальным участникам комнаты |

Аутентификация: access-токен в `handshake.auth.token`; истёкший токен — отказ подключения. Клиент
переподключается с новым токеном после refresh. Отправка сообщений — только REST (сервер сохраняет,
проверяет права, создаёт уведомления).

---

## 17. Вебхуки

`POST /api/scheduling/livedigital` — актуальный вебхук LiveDigital: без пользовательской авторизации,
но с проверкой HMAC-подписи и хеша сырого тела. Старый `POST /api/video/webhooks/livekit` относится
только к архиву записей LiveKit и для новых интеграций не используется.

Правила:

- тело читается как raw (`express.raw`), чтобы проверка подписи не зависела от сериализации;
- неверная подпись/хеш — `401`, событие не применяется;
- `egress_ended` записывает `url` в `VideoRecording`;
- обработка идемпотентна по `egressId`/`roomName`.

---

## 18. Коды и форматы ошибок

```json
{ "error": { "code": "FORBIDDEN", "message": "Роль не имеет доступа к этому разделу" } }
```

| HTTP | Код | Когда |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Некорректная бизнес-операция (опубликованный урок, нет монет) |
| 401 | `UNAUTHORIZED` | Нет/просрочен access-токен, неверный refresh, неверная подпись вебхука |
| 403 | `FORBIDDEN` | Роль не допущена, чужая сущность, заблокированный аккаунт |
| 404 | `NOT_FOUND` | Объект отсутствует или скрыт от роли |
| 409 | `CONFLICT` | Дубликат email/телефона, повторная сдача без права |
| 422 | `VALIDATION_ERROR` | Ошибка Zod; `details[]` с путями и сообщениями |
| 429 | `TOO_MANY_REQUESTS` | Превышен лимит попыток |
| 500 | `INTERNAL_ERROR` | Необработанная ошибка (детали только в логе сервера) |
| 503 | `VIDEO_NOT_CONFIGURED` | Не заданы ключи LiveKit/S3 |

Правила безопасности ответов: внутренние сообщения ошибок и стек не отдаются клиенту; для скрытых
объектов используется `404`, а не `403`; проверка прав выполняется до обращения к данным.

---

## 19. AI-помощник и загрузки

Ключ модели хранится только в `apps/api/.env` (`OPENAI_API_KEY`, опционально `OPENAI_BASE_URL`,
`OPENAI_MODEL`, `AI_DAILY_REQUEST_LIMIT`). Клиент ключ не получает.

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/ai/status` | A | Настроен ли помощник, модель, дневной лимит и расход |
| POST | `/ai/chat` | A | Диалог: `{ messages: [{ role: "user"\|"assistant", content }], topic? }` |

`POST /ai/chat` возвращает `{ reply, usage: { used, limit }, model }`. Системный промпт требует
наставничества: помощник объясняет причину ошибки и следующий шаг, но не выдаёт готовое решение.
Лимит на пользователя в сутки (`AI_DAILY_REQUEST_LIMIT`, по умолчанию 30) проверяется на сервере;
превышение — `429`. Если ключ не задан — `503 AI_NOT_CONFIGURED`, ошибка провайдера — `502`.

Загрузка вложений чата и решений: `POST /api/uploads` (multipart, поле `file`, до 10 МБ; изображения
и документы), ответ — `{ name, url, mimeType, size, isImage }`. Файлы раздаются статически из `/uploads`
(локальный каталог `UPLOADS_DIR`), поэтому в продакшене каталог нужно заменить объектным хранилищем.