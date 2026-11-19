# Структура базы данных ITadis

PostgreSQL 16 + Prisma ORM. Схема — `backend/prisma/schema.prisma` (**49 моделей, 17 enum**).
Демо-данные — `backend/prisma/seed.ts`. Миграции лежат в `backend/prisma/migrations`
(initial — `20261114115123_nest_rbac_roles`, категории каталога — `20261114125455_add_course_categories`);
новая создаётся командой `npx prisma migrate dev --name <name>`.

## Содержание

- [1. Принципы](#1-принципы)
- [2. Перечисления](#2-перечисления)
- [3. Identity и доступ](#3-identity-и-доступ)
- [4. Обучение](#4-обучение)
- [5. Домашние задания](#5-домашние-задания)
- [6. Тесты](#6-тесты)
- [7. Расписание и видео](#7-расписание-и-видео)
- [8. Сообщения и уведомления](#8-сообщения-и-уведомления)
- [9. Экономика и мотивация](#9-экономика-и-мотивация)
- [10. База знаний](#10-база-знаний)
- [11. Прочее](#11-прочее)
- [12. Связи между доменами](#12-связи-между-доменами)
- [13. Индексы и ограничения](#13-индексы-и-ограничения)
- [14. Правила удаления](#14-правила-удаления)
- [15. Транзакции и целостность](#15-транзакции-и-целостность)
- [16. Пробелы относительно ТЗ](#16-пробелы-относительно-тз)

---

## 1. Принципы

1. **UUID первичные ключи** (`@default(uuid())`) — кроме узких таблиц, где естественный составной ключ
   лучше (участник переписки, избранное, достижение пользователя, роль-право).
2. **`createdAt`/`updatedAt`** у изменяемых сущностей; `updatedAt` обновляется Prisma.
3. **Мягкое удаление пользователя:** `deletedAt` + обезличивание, а не физическое удаление, чтобы не
   ломать историю оценок, аудита и транзакций.
4. **Деньги только через транзакции:** `CoinTransaction` — журнал, `CoinBalance` — материализованный
   баланс. Обе таблицы меняются в одном `$transaction`.
5. **Уникальные ключи — защита от дублей:** повторная запись на курс, повторная выдача достижения,
   повторная сдача с одним `idempotencyKey`.
6. **Индексы под реальные запросы:** списки по пользователю и дате (уведомления, сообщения, транзакции,
   аудит), расписание по курсу и дате.

---

## 2. Перечисления

| Enum | Значения |
| --- | --- |
| `RoleName` | `ADMIN`, `TEACHER`, `STUDENT`, `PARENT` |
| `ParentRelation` | `MOTHER`, `FATHER`, `GUARDIAN`, `OTHER` |
| `CourseLevel` | `BEGINNER`, `INTERMEDIATE`, `ADVANCED` |
| `CourseStatus` | `DRAFT`, `ACTIVE`, `ARCHIVED` |
| `EnrollmentStatus` | `PENDING`, `ACTIVE`, `PAUSED`, `COMPLETED` |
| `ProgressStatus` | `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED` |
| `HomeworkStatus` | `ASSIGNED`, `SUBMITTED`, `REVIEWED`, `RETURNED`, `EXPIRED` |
| `SubmissionStatus` | `SUBMITTED`, `REVIEWED`, `RETURNED` |
| `QuestionType` | `SINGLE`, `MULTIPLE`, `TEXT`, `MATCHING`, `NUMBER`, `BOOLEAN` |
| `AttemptStatus` | `IN_PROGRESS`, `SUBMITTED`, `EXPIRED` |
| `MaterialType` | `VIDEO`, `DOCUMENT`, `PRESENTATION`, `IMAGE`, `LINK` |
| `ScheduleStatus` | `SCHEDULED`, `ONGOING`, `COMPLETED`, `CANCELLED`, `RESCHEDULED` |
| `RoomStatus` | `CREATED`, `LIVE`, `ENDED` |
| `NotificationType` | `HOMEWORK_ASSIGNED`, `HOMEWORK_DUE_SOON`, `HOMEWORK_REVIEWED`, `GRADE_RECEIVED`, `LESSON_PUBLISHED`, `SCHEDULE_CHANGED`, `LESSON_STARTING`, `VIDEO_STARTED`, `MESSAGE_RECEIVED`, `COINS_AWARDED`, `ACHIEVEMENT_UNLOCKED`, `SHOP_ORDER`, `SYSTEM` |
| `ConversationType` | `DIRECT`, `COURSE` |
| `ShopOrderStatus` | `NEW`, `APPROVED`, `REJECTED`, `ISSUED` |
| `ConsentType` | `TERMS`, `PRIVACY`, `DATA_PROCESSING`, `MARKETING` |

> `HomeworkStatus` используется не для сдачи, а для жизненного цикла задания (в текущей логике сдача
> хранит свой `SubmissionStatus`). `RoleName` совпадает с `Role.code`, поэтому роли в БД и в JWT токене
> всегда согласованы.

---

## 3. Identity и доступ

### User

| Поле | Тип | Ограничения |
| --- | --- | --- |
| `id` | String | PK, uuid |
| `email` | String | **unique**, приводится к нижнему регистру на входе |
| `phone` | String? | **unique**, `+996700000000` |
| `passwordHash` | String | bcrypt |
| `firstName`, `lastName` | String | 2–60 символов |
| `role` | RoleName | default `STUDENT`; FK-связь `roleRef` → `Role.code` (`Restrict`) |
| `avatarUrl` | String? | URL |
| `locale` | String | default `ru` (`ru`, `ky`, `en`) |
| `birthDate` | DateTime? | для проверки возраста |
| `emailVerifiedAt` | DateTime? | подтверждение почты |
| `isActive` | Boolean | default `true`; `false` — блокировка |
| `lastLoginAt` | DateTime? | |
| `createdAt`, `updatedAt` | DateTime | |
| `deletedAt` | DateTime? | мягкое удаление |

Связи: `profile` (1:1), `studentProfile`/`teacherProfile`/`parentProfile` (1:1 по роли), `roleRef`,
`coinBalance` (1:1), `refreshSessions`, `devices`, `consents`, `enrollments`,
`taughtCourses`, `lessonProgress`, `submissions`, `reviewedReviews`, `attempts`, `notifications`,
`coinTransactions`, `achievements`, `shopOrders`, `sentMessages`, `conversationLinks`, `attendance`,
`auditLogs`, `feedbackGiven`, `feedbackReceived`, `aiRequests`, `createdRooms`, `knowledgeAuthored`,
`knowledgeViews`, `knowledgeFavorites`, `createdHomework`, `passwordResets`.

### UserProfile (1:1 к User)

`userId` unique → `User.id` (`Cascade`). Поля: `bio`, `timezone` (`Asia/Bishkek`),
`guardianName`, `guardianPhone`, `guardianConsentAt`.

### Role

Каталог ролей: `id`, `code` (RoleName, **unique**), `name`, `description?`, `isSystem`, `createdAt`,
`updatedAt`. Связи: `users` (по `code`), `permissions`.
Код роли — это же значение enum `User.role`, поэтому роль пользователя хранится в одном поле: нет
дублирования и рассинхронизации между «ролью» и «ссылкой на роль».

### Permission / RolePermission

- `Permission`: `id`, `code` **unique**, `description`.
- `RolePermission`: составной PK `(role, permissionId)`, FK на `Permission` (`Cascade`) и на `Role.code`
  (`Cascade`), индекс по `permissionId`.
- Используется `PermissionsGuard`: право проверяется по `@RequirePermissions('users.manage')`, набор прав роли
  кешируется на 60 секунд.

### Student (1:1 к User)

`userId` **unique** → `User.id` (`Cascade`), `gradeLevel?`, `schoolName?`, `notes?`, `createdAt`,
`updatedAt`; индекс по `gradeLevel`. Создаётся при регистрации ученика. Связи: `parentLinks`.

### Teacher (1:1 к User)

`userId` **unique** → `User.id` (`Cascade`), `specialization?`, `headline?`, `experienceYears?`,
`createdAt`, `updatedAt`; индекс по `specialization`.

### Parent (1:1 к User)

`userId` **unique** → `User.id` (`Cascade`), `workplace?`, `createdAt`, `updatedAt`. Связи: `childLinks`.

### ParentStudentLink

Связь родителя и ученика: `parentId` → `Parent` (`Cascade`), `studentId` → `Student` (`Cascade`),
`relation` (`ParentRelation`, default `GUARDIAN`), `isPrimary`, `verifiedAt?`, `createdAt`.
**Уникально `(parentId, studentId)`**; индексы `(studentId)` и `(parentId, isPrimary)`.
Пара удаляется каскадом с любой стороны, поэтому нет «висячих» привязок.

### RefreshSession

`id`, `userId` (FK, `Cascade`, индекс), `tokenHash` **unique** (SHA-256), `family` (индекс),
`userAgent`, `ip`, `expiresAt`, `revokedAt`, `createdAt`.
Ротация: новая строка в той же `family`, старая получает `revokedAt`. Повторное использование
отозванного токена → отзыв всей семьи.

### PasswordResetToken

`id`, `userId` (FK, `Cascade`, индекс), `tokenHash` **unique**, `expiresAt`, `usedAt`, `createdAt`.

### UserDevice

`id`, `userId` (FK, `Cascade`), `deviceId`, `platform`, `pushToken`, `lastSeenAt`, `createdAt`.
**Уникально `(userId, deviceId)`** — одно устройство не дублируется при повторных входах.
Индексы `(userId, lastSeenAt)` и `(pushToken)` — для рассылки push и списка «активные устройства».

### ConsentRecord

`id`, `userId` (FK, `Cascade`), `type` (`ConsentType`), `documentVersion`, `granted`, `ip`, `createdAt`.
Индексы `(userId, type)` и `(userId, createdAt)`. История согласий не перезаписывается.

### AuditLog

`id`, `actorId?` (FK на User, `SetNull` — журнал переживает удаление актора), `action`, `entity`,
`entityId?`, `metadata` (JSON), `ip`, `createdAt`. Индексы `(entity, createdAt)`, `(actorId, createdAt)`,
`(action)`.
Пишутся: удаление аккаунта, смена роли/блокировка, начисление монет, обработка заказов, жалобы,
видеовходы, публикация материалов.

---

## 4. Обучение

### CourseCategory

`id`, `slug` **unique**, `title`, `icon?`, `position` (индекс), `createdAt`.
Справочник направлений каталога: JavaScript, Python, React, React Native, Backend, Дизайн.
Связь `courses` — один ко многим.

### Course

`id`, `title`, `slug` **unique**, `description`, `coverUrl?`, `level` (`CourseLevel`),
`status` (`CourseStatus`, default `DRAFT`), `teacherId` (FK → User, индекс), `categoryId?`
(FK → CourseCategory, `SetNull`, индекс), `startDate?`, `endDate?`, `createdAt`, `updatedAt`.

Связи: `teacher`, `category`, `modules`, `enrollments`, `homework`, `tests`, `schedule`, `conversations`.
Индекс `status` — каталог выбирает только `ACTIVE`.

### CourseEnrollment

`id`, `courseId` (FK, `Cascade`), `studentId` (FK, `Cascade`, индекс), `status`
(`EnrollmentStatus`, default `ACTIVE`), `progress` Int 0–100, `enrolledAt`.
**Уникально `(courseId, studentId)`** — повторная запись невозможна.

### Module

`id`, `courseId` (FK, `Cascade`, индекс), `title`, `description?`, `position`.
Порядок внутри курса — `position`.

### Lesson

`id`, `moduleId` (FK, `Cascade`, индекс), `title`, `description?`, `content?` (конспект),
`videoUrl?`, `durationMinutes`, `position`, `publishedAt?`, `createdAt`, `updatedAt`.
`publishedAt = null` — черновик, скрыт от учеников.

Связи: `materials`, `progress`, `homework`.

### LessonMaterial

`id`, `lessonId` (FK, `Cascade`), `type` (`MaterialType`), `title`, `url`, `mimeType?`, `sizeBytes?`,
`createdAt`. Файлы хранятся во внешнем хранилище, в БД — ссылка.

### LessonProgress

`id`, `lessonId` (FK, `Cascade`), `studentId` (FK, `Cascade`, индекс), `status` (`ProgressStatus`),
`watchedSeconds`, `lastPositionSeconds`, `completedAt?`, `updatedAt`.
**Уникально `(lessonId, studentId)`** — одна запись прогресса на пару.

`CourseEnrollment.progress` пересчитывается после завершения урока как доля завершённых
опубликованных уроков курса.

---

## 5. Домашние задания

### Homework

`id`, `courseId` (FK, `Cascade`, индекс), `lessonId?` (FK, `SetNull` — задание переживает удаление урока),
`teacherId` (FK → User), `title`, `description`, `dueAt`, `maxScore` (default 10),
`allowResubmit` (default false), `createdAt`.

### HomeworkSubmission

`id`, `homeworkId` (FK, `Cascade`), `studentId` (FK, `Cascade`, индекс), `attempt` (default 1),
`text?`, `projectUrl?`, `files` (JSON: `[{ name, url }]`), `status` (`SubmissionStatus`, default `SUBMITTED`),
`submittedAt`, `reviewedAt?`, `reviewerId?`, `score?`, `idempotencyKey?` **unique**.
**Уникально `(homeworkId, studentId, attempt)`** — история версий сохраняется как последовательность попыток.

### HomeworkReview

`id`, `submissionId` **unique** (FK, `Cascade`), `reviewerId` (FK → User), `score`, `comment?`,
`returnForRevision` (default false), `createdAt`.

> Схема готова к проверке преподавателем; HTTP-маршрут ревью ещё не реализован (часть 7 ТЗ).

---

## 6. Тесты

### Test

`id`, `courseId` (FK, `Cascade`), `title`, `description?`, `timeLimitMinutes` (default 30),
`passingScore` (default 60, проценты), `attemptsAllowed` (default 3), `shuffleQuestions`,
`shuffleOptions`, `isPublished` (default false), `createdAt`.

### TestQuestion

`id`, `testId` (FK, `Cascade`), `type` (`QuestionType`), `prompt`, `points` (default 1), `position`,
`matchPairs` (JSON: `[{ left, right }]` для `MATCHING`), `correctNumber` (Float? для `NUMBER`),
`correctBoolean` (Boolean? для `BOOLEAN`).

### TestOption

`id`, `questionId` (FK, `Cascade`), `text`, `isCorrect` (default false), `position`.
Используется для `SINGLE` и `MULTIPLE`; правильность хранится здесь и не отдаётся клиенту.

### TestAttempt

`id`, `testId` (FK, `Cascade`), `studentId` (FK, `Cascade`), `status` (`AttemptStatus`, default
`IN_PROGRESS`), `startedAt`, `expiresAt`, `submittedAt?`, `score?` (проценты).
Индекс `(testId, studentId)`. Лимит попыток проверяется по количеству строк.

### TestAnswer

`id`, `attemptId` (FK, `Cascade`), `questionId` (FK, `Cascade`), `answer` (JSON), `isCorrect?`,
`pointsAwarded` (default 0). **Уникально `(attemptId, questionId)`** — один ответ на вопрос в попытке.

---

## 7. Расписание и видео

### Schedule

`id`, `courseId` (FK, `Cascade`), `teacherId` (FK → User, в схеме без обратной связи), `title`,
`description?`, `startsAt`, `endsAt`, `timezone` (default `Asia/Bishkek`),
`status` (`ScheduleStatus`, default `SCHEDULED`), `createdAt`, `updatedAt`.
Индексы `(courseId, startsAt)` и `(teacherId, startsAt)` — выборка расписания и проверка пересечений
по времени (сервер ищет занятия преподавателя и курса, пересекающиеся с новым интервалом).

### VideoRoom

`id`, `scheduleId` **unique** (FK, `Cascade`) — одна комната на занятие,
`provider` (default `livekit`), `roomName` **unique**, `createdById` (FK → User),
`status` (`RoomStatus`, default `CREATED`), `startedAt?`, `endedAt?`, `recordingUrl?`, `createdAt`.

### VideoRecording

`id`, `roomId` (FK, `Cascade`), `egressId` **unique** (идемпотентность вебхуков), `status`
(default `STARTING`), `url?`, `startedById`, `startedAt`, `endedAt?`. Индекс `(roomId, startedAt)`.

### Attendance

`id`, `scheduleId` (FK, `Cascade`), `userId` (FK, `Cascade`), `joinedAt`, `leftAt?`,
`durationSeconds` (default 0). **Уникально `(scheduleId, userId)`** — агрегированная запись:
повторные входы суммируются в `durationSeconds`, а не создают новые строки.

---

## 8. Сообщения и уведомления

### Conversation

`id`, `type` (`ConversationType`, default `DIRECT`), `title?`, `courseId?` (FK, `SetNull` — переписка
курса сохраняется при удалении курса), `createdAt`.

### ConversationParticipant

Составной PK `(conversationId, userId)`, FK на `Conversation` (`Cascade`) и `User` (`Cascade`),
`lastReadAt?`. Участие — единственная проверка доступа к переписке.

### Message

`id`, `conversationId` (FK, `Cascade`), `senderId` (FK, `Cascade`), `body`, `attachments` (JSON:
`[{ name, url, mimeType }]`), `createdAt`. Индекс `(conversationId, createdAt)` — лента и курсорная пагинация.

### Notification

`id`, `userId` (FK, `Cascade`), `type` (`NotificationType`), `title`, `body`, `data` (JSON),
`readAt?`, `createdAt`. Индекс `(userId, createdAt)`.

Push-токены хранятся в `UserDevice.pushToken`; рассылка идёт через Expo Push API (`backend/src/lib/push.ts`), недействительные токены удаляются по ответу провайдера.

---

## 9. Экономика и мотивация

### CoinBalance

`userId` **PK** (FK, `Cascade`), `balance` (default 0), `updatedAt`. Один баланс на пользователя.

### CoinTransaction

`id`, `userId` (FK, `Cascade`, индекс `(userId, createdAt)`), `amount` (положительный — начисление,
отрицательный — списание), `reason`, `awardedById?`, `sourceType` (`CoinSource?`, default `MANUAL`),
`sourceId?` (идентификатор действия), `createdAt`. Журнал неизменяем.

Уникальный ключ `(userId, sourceType, sourceId)` — одно начисление за одно действие: работа (`HOMEWORK`),
попытка теста (`TEST`), занятие (`ATTENDANCE`), достижение (`ACHIEVEMENT`). Источники: `MANUAL`,
`HOMEWORK`, `TEST`, `ATTENDANCE`, `ACHIEVEMENT`, `SHOP`.

Инвариант: `CoinBalance.balance = SUM(CoinTransaction.amount)` для пользователя; любое изменение —
в одной транзакции с записью журнала (`src/lib/coins.ts`).

### Achievement / UserAchievement

- `Achievement`: `id`, `code` **unique**, `title`, `description`, `iconUrl?`, `condition` (JSON).
- `UserAchievement`: PK `(userId, achievementId)`, `awardedAt`; FK `Cascade`.
  Составной ключ — гарантия однократной выдачи.

### ShopProduct

`id`, `title`, `description`, `imageUrl?`, `category`, `priceCoins`, `stock` (default 0),
`isActive` (default true), `terms?`.

### ShopOrder

`id`, `productId` (FK, без каскада — товар нельзя удалить, если есть заказы), `userId` (FK, `Cascade`,
индекс), `status` (`ShopOrderStatus`, default `NEW`), `comment?`, `processedById?`, `createdAt`, `updatedAt`.

Заявка — центр денежной операции: создание списывает монеты и остаток, `REJECTED` возвращает оба.

---

## 10. База знаний

### KnowledgeCategory

`id`, `slug` **unique**, `title`, `icon?`, `position`, `createdAt`.

### KnowledgeMaterial

`id`, `categoryId` (FK, `Cascade`), `authorId` (FK, `Cascade`), `title`, `description`, `coverUrl?`,
`type` (`MaterialType`, default `VIDEO`), `videoUrl?`, `content?`, `fileUrl?`, `durationMinutes`,
`isPublished` (default true), `createdAt`, `updatedAt`.
Индексы `(categoryId, createdAt)` и `(type)` — каталог, фильтры, сортировка.

### KnowledgeView / KnowledgeFavorite

- `KnowledgeView`: PK `(materialId, userId)`, `viewedAt`; индекс `(userId, viewedAt)` для истории.
- `KnowledgeFavorite`: PK `(materialId, userId)`, `createdAt`; индекс `(userId)`.

Просмотр обновляет `viewedAt`, а не создаёт дубли; избранное идемпотентно по ключу.

---

## 11. Прочее

### Feedback

`id`, `teacherId` (FK → User, `Cascade`), `studentId` (FK → User, `Cascade`), `courseId?` (просто
строковый идентификатор без FK), `message`, `score?`, `createdAt`. Индекс `(studentId)`.
Обратная связь преподавателя ученику; маршрут пока не реализован.

### AiRequest

`id`, `userId` (FK, `Cascade`, индекс `(userId, createdAt)`), `prompt`, `response?`, `tokens`,
`createdAt`. Журнал запросов к AI-помощнику (`/api/ai/chat`). Дневной лимит считается в памяти процесса;
при горизонтальном масштабировании счётчик нужно вынести в общий кеш (Redis).

---

## 12. Связи между доменами

```
User ─1:1─ UserProfile
User ─1:1─ CoinBalance ─1:N─ CoinTransaction
User ─1:N─ RefreshSession / UserDevice / ConsentRecord / PasswordResetToken
CourseCategory ─1:N─ Course ─1:N─ Module ─1:N─ Lesson
User ─1:N─ CourseEnrollment ─N:1─ Course
                                          │            ├─1:N─ LessonMaterial
                                          │            ├─1:N─ LessonProgress ─N:1─ User
                                          │            └─1:N─ Homework
                                          ├─1:N─ Test ─1:N─ TestQuestion ─1:N─ TestOption
                                          │                   └─1:N─ TestAnswer ─N:1─ TestAttempt
                                          ├─1:N─ Schedule ─1:1─ VideoRoom ─1:N─ VideoRecording
                                          │                   └─1:N─ Attendance ─N:1─ User
                                          └─1:N─ Conversation ─N:M─ User (ConversationParticipant)
                                                             └─1:N─ Message

Homework ─1:N─ HomeworkSubmission ─1:1─ HomeworkReview
User ─N:M─ Achievement (UserAchievement)
User ─1:N─ ShopOrder ─N:1─ ShopProduct
KnowledgeCategory ─1:N─ KnowledgeMaterial ─N:M─ User (views/favorites)
User ─1:N─ Notification / AuditLog / AiRequest
```

Агрегаты, которые нужно считать, а не хранить вручную: `CourseEnrollment.progress`
(из `LessonProgress`), `Test.score` (из `TestAnswer`), `Attendance.durationSeconds`,
`CoinBalance.balance` (из журнала).

---

## 13. Индексы и ограничения

### Уникальные ключи

| Таблица | Ключ | Назначение |
| --- | --- | --- |
| `User` | `email`, `phone` | защита от дублей аккаунтов |
| `CourseCategory` | `slug` | стабильные фильтры каталога |
| `Course` | `slug` | публичные адреса |
| `CourseEnrollment` | `(courseId, studentId)` | одна запись на курс |
| `LessonProgress` | `(lessonId, studentId)` | один прогресс на урок |
| `HomeworkSubmission` | `(homeworkId, studentId, attempt)`, `idempotencyKey` | версии и идемпотентность |
| `HomeworkReview` | `submissionId` | одно ревью на сдачу |
| `TestAnswer` | `(attemptId, questionId)` | один ответ на вопрос |
| `VideoRoom` | `scheduleId`, `roomName` | одна комната на занятие |
| `VideoRecording` | `egressId` | идемпотентность вебхуков |
| `Attendance` | `(scheduleId, userId)` | агрегированная посещаемость |
| `ConversationParticipant` | `(conversationId, userId)` | уникальное участие |
| `UserAchievement` | `(userId, achievementId)` | однократная выдача |
| `KnowledgeView` | `(materialId, userId)` | один просмотр на пару |
| `KnowledgeFavorite` | `(materialId, userId)` | идемпотентное избранное |
| `UserDevice` | `(userId, deviceId)` | уникальное устройство |
| `Permission` | `code` | стабильные коды прав |

### Индексы под запросы

`AuditLog(entity, createdAt)` — журнал; `Notification(userId, createdAt)` — центр уведомлений;
`Message(conversationId, createdAt)` — лента чата; `CoinTransaction(userId, createdAt)` — история;
`Attendance` через FK + уникальный ключ; `Schedule(courseId, startsAt)`, `Schedule(teacherId, startsAt)` —
календарь и проверка конфликтов;
`KnowledgeMaterial(categoryId, createdAt)`, `(type)` — каталог; `KnowledgeView(userId, viewedAt)` —
история; `LessonProgress(studentId)`, `CourseEnrollment(studentId)`, `TestAttempt(testId, studentId)`,
`ShopOrder(userId)`, `RefreshSession(userId)`, `(family)`.

### Ограничения на уровне приложения

Prisma не выражает часть бизнес-правил, поэтому они проверяются в коде:

- `CourseEnrollment.progress` ∈ [0, 100];
- `Test.score` — процент, 0–100; `passingScore` 0–100;
- `HomeworkSubmission.score` ≤ `Homework.maxScore`;
- `CoinTransaction.amount` ≠ 0; баланс не может стать отрицательным (проверка перед списанием);
- `ShopProduct.stock >= 0`;
- сумма прогресса/оценок не хранится денормализованно, кроме `progress` курса и `score` попытки.

---

## 14. Правила удаления

| Родитель → потомок | Правило | Смысл |
| --- | --- | --- |
| `User` → `UserProfile`, `CoinBalance`, `RefreshSession`, `UserDevice`, `ConsentRecord`, `LessonProgress`, `TestAttempt`, `Notification`, `CoinTransaction`, `UserAchievement`, `ShopOrder`, `Attendance`, `KnowledgeView`, `KnowledgeFavorite`, `AiRequest`, `Message` | `Cascade` | личные данные уходят вместе с аккаунтом |
| `Course` → `Module`, `Lesson`, `Homework`, `Test`, `Schedule`, `CourseEnrollment` | `Cascade` | структура курса не существует отдельно |
| `CourseCategory` → `Course` | `SetNull` | удаление категории не удаляет курсы |
| `Module` → `Lesson` | `Cascade` | |
| `Lesson` → `LessonMaterial`, `LessonProgress` | `Cascade` | |
| `Homework` → `HomeworkSubmission` | `Cascade` | |
| `HomeworkSubmission` → `HomeworkReview` | `Cascade` | |
| `Test` → `TestQuestion` → `TestOption`, `TestAnswer` | `Cascade` | |
| `Schedule` → `VideoRoom`, `Attendance` | `Cascade` | |
| `VideoRoom` → `VideoRecording` | `Cascade` | |
| `Conversation` → `ConversationParticipant`, `Message` | `Cascade` | |
| `KnowledgeMaterial` → `KnowledgeView`, `KnowledgeFavorite` | `Cascade` | |
| `Homework.lessonId` | `SetNull` | задание переживает удаление урока |
| `Conversation.courseId` | `SetNull` | переписка переживает удаление курса |
| `AuditLog.actorId` | `SetNull` | журнал нельзя терять |
| `ShopOrder.productId` | без каскада (`Restrict` по умолчанию) | нельзя удалить товар с заказами |
| `ShopOrder` | не удаляется | история заявок и денег сохраняется |

Пользователь физически не удаляется: `DELETE /api/users/me` обезличивает запись и оставляет историю
оценок/аудита. Это сознательный компромисс между правом на удаление и целостностью учебных данных;
для полного удаления нужен отдельный admin-сценарий (часть 9/10 ТЗ).

---

## 15. Транзакции и целостность

Обязательно в `prisma.$transaction`:

1. **Начисление монет:** `CoinTransaction.create` + `CoinBalance.upsert(increment)` + уведомление.
2. **Покупка в магазине:** проверка баланса/остатка → списание монет → `stock decrement` →
   `ShopOrder.create`.
3. **Отклонение заявки:** `ShopOrder.update` + возврат монет (`CoinTransaction` + `CoinBalance`) +
   `stock increment`.
4. **Завершение урока:** `LessonProgress.update` + пересчёт `CourseEnrollment.progress`.
5. **Отправка теста:** сохранение `TestAnswer[]` + `TestAttempt.update(score, status)` + `awardCoins`
   за пройденный тест (уникальный ключ не даёт начислить дважды).
6. **Проверка ДЗ:** `HomeworkSubmission.update` + `HomeworkReview.upsert` + `awardCoins` +
   `Notification` одной интерактивной транзакцией.
7. **Вход в комнату занятия:** `Attendance.upsert` + `awardCoins` за посещение.
6. **Удаление аккаунта:** обезличивание `User` + удаление профиля + отзыв сессий и устройств.

Защита от повторов: уникальные ключи (`idempotencyKey`, `egressId`, `(userId, achievementId)`),
проверка статуса перед операцией, вебхуки проверяются по подписи и обрабатываются идемпотентно.

Уровень изоляции — по умолчанию PostgreSQL (`READ COMMITTED`); для денежных операций используются
атомарные `increment/decrement` и проверки в той же транзакции. При высокой конкуренции за остаток
товара потребуется `SELECT ... FOR UPDATE` или уникальная блокировка (этап 11).

---

## 16. Пробелы относительно ТЗ

| Требование ТЗ | Состояние |
| --- | --- |
| Модели `Student`, `Teacher`, `Parent`, `ParentStudentLink` | Отсутствуют. Роль и связи выражены через `User.role`, `CourseEnrollment`, `Course.teacherId`. Родительский доступ требует новых таблиц и роли `PARENT` |
| Отдельная модель `Role` | Нет: роль — enum `RoleName`; `Permission`/`RolePermission` есть |
| `UserDevice.pushToken` + push | Реализовано: токен устройства, Expo Push API, удаление недействительных токенов |
| Запись занятий | `VideoRecording` есть, URL заполняется вебхуком Egress |
| Магазин: статус «Подготовлена» | В `ShopOrderStatus` нет отдельного значения (`APPROVED` покрывает подготовку) |
| Категории магазина | Строка `ShopProduct.category`, без справочника |
| Файлы/вложения | Загрузка на локальный диск (`modules/uploads`, `UPLOADS_DIR`) и JSON-ссылки; таблицы файлов и объектного хранилища нет |
| История версий ДЗ | Реализована как `attempt` + уникальный ключ, отдельной таблицы версий нет |
| Согласия и документы | `ConsentRecord` есть; таблицы версий документов/privacy policy нет |
| AI | Модуль `/api/ai/*` есть; дневной лимит хранится в памяти процесса, отдельной таблицы лимитов нет |
| Мягкое удаление курсов/заданий | Только у `User` (`deletedAt`); у остальных — физическое удаление или статус |
| Каталог миграций | Отсутствует в репозитории; создать на машине с PostgreSQL |

Все пробелы закрываются на этапах 5, 7, 9 и 10 без изменения уже работающих таблиц, кроме добавления
новых моделей и полей.
