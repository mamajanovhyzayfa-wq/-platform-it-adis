# ER-диаграмма

Диаграмма отражает связи доменов, а не полный список полей: поля и ограничения
описаны в [`schema.md`](schema.md), актуальная схема — `apps/api/prisma/schema.prisma`
(128 моделей, 64 enum на 20.11.2026).

Обозначения Mermaid: `||--o{` — один ко многим, `||--o|` — один к нулю или одному,
`}o--o{` — многие ко многим через связующую таблицу.

## 1. Identity, доступ и филиалы

```mermaid
erDiagram
  USER ||--o| USER_PROFILE : "профиль"
  USER ||--o| STUDENT : "ученик"
  USER ||--o| TEACHER : "наставник"
  USER ||--o| PARENT : "родитель"
  STUDENT ||--o{ PARENT_STUDENT_LINK : "дети"
  PARENT ||--o{ PARENT_STUDENT_LINK : "родители"
  USER ||--o{ REFRESH_SESSION : "сессии"
  USER ||--o{ PASSWORD_RESET_TOKEN : "сброс пароля"
  USER ||--o{ USER_DEVICE : "устройства и push"
  USER ||--o{ CONSENT_RECORD : "согласия"
  USER ||--o{ AUDIT_LOG : "действия"
  ROLE ||--o{ USER : "роль"
  ROLE ||--o{ ROLE_PERMISSION : "права роли"
  PERMISSION ||--o{ ROLE_PERMISSION : "в ролях"
  USER ||--o{ USER_ROLE_GRANT : "доп. права"
  USER ||--o{ STORAGE_FILE : "файлы"
  BRANCH ||--o| BRANCH_SETTINGS : "настройки"
  BRANCH ||--o{ BACKUP_RUN : "бэкапы"

  USER {
    uuid id PK
    string email UK
    string phone UK
    string passwordHash
    enum role
    datetime deletedAt
  }
  BRANCH {
    uuid id PK
    string domain UK
    string databaseName
    boolean isActive
  }
  STUDENT {
    uuid userId PK
    string gradeLevel
  }
  PARENT_STUDENT_LINK {
    uuid parentId FK
    uuid studentId FK
    enum relation
    boolean isPrimary
  }
  ROLE {
    uuid id PK
    string code UK
    boolean isSystem
  }
```

Филиал — граница данных: у каждого филиала своя база, поэтому `Branch` живёт в
управляющей БД и не имеет внешних ключей на доменные таблицы.

## 2. Обучение и аттестация

```mermaid
erDiagram
  COURSE_CATEGORY ||--o{ COURSE : "категория"
  USER ||--o{ COURSE : "преподаватель"
  COURSE ||--o{ MODULE : "модули"
  MODULE ||--o{ LESSON : "уроки"
  LESSON ||--o{ LESSON_MATERIAL : "материалы"
  COURSE ||--o{ COURSE_ENROLLMENT : "записи"
  USER ||--o{ COURSE_ENROLLMENT : "ученик"
  LESSON ||--o{ LESSON_PROGRESS : "прогресс"
  USER ||--o{ LESSON_PROGRESS : "ученик"
  COURSE ||--o{ HOMEWORK : "задания"
  HOMEWORK ||--o{ HOMEWORK_SUBMISSION : "сдачи"
  USER ||--o{ HOMEWORK_SUBMISSION : "ученик"
  HOMEWORK_SUBMISSION ||--o| HOMEWORK_REVIEW : "проверка"
  COURSE ||--o{ TEST : "тесты"
  TEST ||--o{ TEST_QUESTION : "вопросы"
  TEST_QUESTION ||--o{ TEST_OPTION : "варианты"
  TEST ||--o{ TEST_ATTEMPT : "попытки"
  USER ||--o{ TEST_ATTEMPT : "ученик"
  TEST_ATTEMPT ||--o{ TEST_ANSWER : "ответы"
  TEST_QUESTION ||--o{ TEST_ANSWER : "ответ"
  COURSE ||--o{ EXAM : "экзамены"
  EXAM ||--o{ EXAM_REGISTRATION : "регистрации"
  USER ||--o{ EXAM_REGISTRATION : "ученик"
  GRADING_SCALE ||--o{ GRADING_BAND : "диапазоны"

  COURSE {
    uuid id PK
    string slug UK
    enum status
    uuid teacherId FK
  }
  HOMEWORK_SUBMISSION {
    uuid id PK
    uuid homeworkId FK
    uuid studentId FK
    int attempt
    string idempotencyKey UK
  }
  TEST_ATTEMPT {
    uuid id PK
    uuid testId FK
    uuid studentId FK
    enum status
    float score
  }
```

## 3. Расписание, аудитории и видео

```mermaid
erDiagram
  COURSE ||--o{ SCHEDULE : "занятия"
  USER ||--o{ SCHEDULE : "преподаватель"
  CLASSROOM ||--o{ SCHEDULE : "аудитория"
  SCHEDULE_SERIES ||--o{ SCHEDULE : "серия"
  SCHEDULE ||--o| VIDEO_ROOM : "комната"
  VIDEO_ROOM ||--o{ VIDEO_RECORDING : "записи"
  SCHEDULE ||--o{ ATTENDANCE : "посещаемость"
  USER ||--o{ ATTENDANCE : "участник"
  SCHEDULE ||--o{ SCHEDULE_CHANGE : "переносы"
  SCHEDULE ||--o{ SCHEDULE_MESSAGE : "чат занятия"
  SCHEDULE ||--o{ EXTRA_SESSION_ENROLLMENT : "доп. запись"
  USER ||--o{ CALENDAR_CONNECTION : "календари"

  SCHEDULE {
    uuid id PK
    uuid courseId FK
    uuid teacherId FK
    uuid classroomId FK
    datetime startsAt
    datetime endsAt
    enum status
  }
  VIDEO_ROOM {
    uuid id PK
    uuid scheduleId UK
    string provider
    string roomName UK
    enum status
  }
  ATTENDANCE {
    uuid scheduleId PK
    uuid userId PK
    int durationSeconds
  }
```

Конфликты занятий проверяются по `(teacherId, startsAt)`, `(courseId, startsAt)`
и `classroomId`: пересечение интервалов `startsAt`/`endsAt` не допускается.

## 4. Экономика, коммуникации и интеграции

```mermaid
erDiagram
  USER ||--o| COIN_BALANCE : "баланс"
  USER ||--o{ COIN_TRANSACTION : "история монет"
  USER ||--o{ USER_COIN_PROFILE : "уровень"
  COIN_LEVEL ||--o{ USER_COIN_PROFILE : "уровень"
  USER ||--o{ COIN_APPEAL : "апелляции"
  SHOP_PRODUCT ||--o{ SHOP_ORDER : "заказы"
  USER ||--o{ SHOP_ORDER : "покупатель"
  ACHIEVEMENT ||--o{ USER_ACHIEVEMENT : "выдачи"
  USER ||--o{ USER_ACHIEVEMENT : "получатель"
  CONVERSATION ||--o{ CONVERSATION_PARTICIPANT : "участники"
  USER ||--o{ CONVERSATION_PARTICIPANT : "участие"
  CONVERSATION ||--o{ MESSAGE : "сообщения"
  USER ||--o{ MESSAGE : "автор"
  USER ||--o{ NOTIFICATION : "уведомления"
  USER ||--o{ NOTIFICATION_PREFERENCE : "настройки каналов"
  USER ||--o{ SUPPORT_TICKET : "обращения"
  USER ||--o{ AI_REQUEST : "AI-запросы"
  COMMUNITY_EVENT ||--o{ EVENT_REGISTRATION : "участники"
  COMMUNITY_EVENT ||--o{ EVENT_RESULT : "результаты"

  COIN_TRANSACTION {
    uuid id PK
    uuid userId FK
    int amount
    enum sourceType
    string sourceId
  }
  SHOP_ORDER {
    uuid id PK
    uuid productId FK
    uuid userId FK
    enum status
  }
  INTEGRATION_CONFIG {
    uuid id PK
    string provider UK
    boolean enabled
  }
  INTEGRATION_EVENT {
    uuid id PK
    string provider
    enum status
    string message
  }
  SUPPORT_TICKET {
    uuid id PK
    uuid requesterId FK
    enum status
    enum priority
  }
```

`IntegrationConfig`/`IntegrationEvent` намеренно не связаны внешним ключом:
журнал интеграций хранит провайдера строкой и переживает удаление настройки.
Секреты интеграций в БД не хранятся — только имена переменных окружения.

## Связь с изоляцией филиалов

1. Каждая доменная таблица находится в БД своего филиала; сквозных FK между
   филиалами нет.
2. `Branch` и `BackupRun` живут в управляющей БД и не читают доменные данные.
3. Все запросы выполняются через Prisma-клиент, созданный для БД филиала из
   `Host`; `branchId` из тела запроса игнорируется.
4. Realtime-комнаты включают `branchId`, поэтому подписка на чужую комнату
   невозможна даже при валидном токене другого филиала.
