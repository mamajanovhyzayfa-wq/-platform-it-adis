/** OpenAPI-документ для /docs. Держим вручную, чтобы контракт не расходился с кодом. */
const listOperation = (tag: string, summary: string) => ({
  get: {
    tags: [tag],
    summary,
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
      { name: 'search', in: 'query', schema: { type: 'string', maxLength: 120 } },
    ],
    responses: {
      200: { description: 'Постраничный список' },
      401: { description: 'Нет access-токена' },
      403: { description: 'Недостаточно прав' },
    },
  },
})

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'IT Adis API',
    version: '0.1.0',
    description:
      'REST API образовательной платформы IT Adis. Авторизация: Bearer access-токен; обновление — refresh-токен с ротацией.',
  },
  servers: [{ url: 'http://localhost:4000' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { nullable: true },
            },
          },
        },
      },
      TokenPair: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          expiresIn: { type: 'string', example: '15m' },
        },
      },
    },
  },
  paths: {
    '/api/access/registration': {
      post: {
        tags: ['Auth'],
        summary: 'Заявка на регистрацию (создаётся после решения администратора)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'firstName',
                  'lastName',
                  'email',
                  'password',
                  'passwordRepeat',
                  'acceptTerms',
                  'acceptPrivacy',
                  'acceptDataProcessing',
                ],
                properties: {
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  phone: { type: 'string' },
                  password: { type: 'string', minLength: 8 },
                  passwordRepeat: { type: 'string' },
                  role: { type: 'string', enum: ['STUDENT', 'TEACHER', 'PARENT'] },
                  message: { type: 'string', maxLength: 500 },
                  inviteCode: { type: 'string' },
                  acceptTerms: { type: 'boolean' },
                  acceptPrivacy: { type: 'boolean' },
                  acceptDataProcessing: { type: 'boolean' },
                  acceptMarketing: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Заявка создана и ожидает решения администратора' },
          409: { description: 'Аккаунт уже существует или заявка уже ожидает решения', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          422: { description: 'Ошибка валидации' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Вход по email или телефону',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identifier', 'password'],
                properties: {
                  identifier: { type: 'string' },
                  password: { type: 'string' },
                  deviceId: { type: 'string' },
                  platform: { type: 'string', enum: ['ios', 'android', 'web'] },
                  captchaId: { type: 'string' },
                  captchaAnswer: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Пара токенов' }, 401: { description: 'Неверные данные' } },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Обновление access-токена (ротация refresh)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Новая пара токенов' }, 401: { description: 'Сессия недействительна' } },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Выход (отзыв refresh-токена)',
        responses: { 204: { description: 'Сессия закрыта' } },
      },
    },
    '/api/users/me': {
      get: {
        tags: ['Users'],
        summary: 'Профиль текущего пользователя',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Профиль' }, 401: { description: 'Нет доступа' } },
      },
      patch: {
        tags: ['Users'],
        summary: 'Обновление профиля',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Обновлено' } },
      },
    },
    '/api/users/me/courses': {
      get: {
        tags: ['Users'],
        summary: 'Курсы текущего ученика',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Список курсов' } },
      },
    },
    '/api/courses': {
      get: {
        tags: ['Courses'],
        summary: 'Каталог активных курсов',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Список курсов' } },
      },
    },
    '/api/schedule': {
      get: {
        tags: ['Schedule'],
        summary: 'Расписание занятий текущего пользователя',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Список занятий' } },
      },
    },
    '/api/homework': {
      get: {
        tags: ['Homework'],
        summary: 'Домашние задания пользователя',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Список заданий' } },
      },
    },
    '/api/homework/{id}/submit': {
      post: {
        tags: ['Homework'],
        summary: 'Отправка решения (идемпотентно по idempotencyKey)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 201: { description: 'Решение принято' }, 400: { description: 'Срок истёк или уже отправлено' } },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'Центр уведомлений',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Уведомления и число непрочитанных' } },
      },
    },
    '/api/coins/balance': {
      get: {
        tags: ['Coins'],
        summary: 'Баланс изикоинов',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Баланс' } },
      },
    },
    '/api/messages/conversations': {
      get: {
        tags: ['Messages'],
        summary: 'Переписки пользователя с числом непрочитанных',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Список переписок' } },
      },
      post: {
        tags: ['Messages'],
        summary: 'Личный диалог (userId) или чат курса (courseId)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Переписка уже существует' }, 201: { description: 'Создана' }, 403: { description: 'Нет доступа к курсу' } },
      },
    },
    '/api/messages/conversations/{id}/messages': {
      get: {
        tags: ['Messages'],
        summary: 'История переписки (before, limit)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'q', in: 'query', description: 'Поиск по тексту сообщений', schema: { type: 'string', maxLength: 100 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100, default: 30 } },
        ],
        responses: { 200: { description: 'Сообщения и hasMore' }, 403: { description: 'Не участник' } },
      },
      post: {
        tags: ['Messages'],
        summary: 'Отправить сообщение (рассылается событием message:new через Socket.IO)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 201: { description: 'Создано' }, 403: { description: 'Не участник' } },
      },
    },
    '/api/messages/conversations/{id}/read': {
      post: {
        tags: ['Messages'],
        summary: 'Отметить переписку прочитанной',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Прочитано' } },
      },
    },
    '/api/messages/messages/{id}/report': {
      post: {
        tags: ['Messages'],
        summary: 'Жалоба на сообщение (аудит и уведомление администраторам)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 201: { description: 'Жалоба принята' }, 403: { description: 'Не участник' } },
      },
    },
    '/api/coins/award': {
      post: {
        tags: ['Coins'],
        summary: 'Начисление изикоинов (преподаватель/администратор)',
        security: [{ bearerAuth: [] }],
        responses: { 201: { description: 'Начислено' }, 403: { description: 'Нет прав' } },
      },
    },
    '/api/students': listOperation('Students', 'Ученики с профилем и контактами'),
    '/api/mentors': listOperation('Mentors', 'Каталог наставников'),
    '/api/managers': listOperation('Managers', 'Менеджеры филиала'),
    '/api/parents': listOperation('Parents', 'Родители и привязанные ученики'),
    '/api/groups': listOperation('Groups', 'Учебные группы (курс + наставник + состав)'),
    '/api/materials': listOperation('Materials', 'Материалы уроков с контекстом курса'),
    '/api/classrooms': listOperation('Classrooms', 'Аудитории, вместимость и оборудование'),
    '/api/attendance': listOperation('Attendance', 'Посещаемость; ученик видит только свои записи'),
    '/api/exams': listOperation('Exams', 'Экзамены, регистрации и попытки'),
    '/api/ai-automation': listOperation('AI Automation', 'AI-автоматизации и число запусков'),
    '/api/it-coins': listOperation('IT Coins', 'Транзакции изикоинов; студент — только свои'),
    '/api/rewards-store': listOperation('Rewards Store', 'Товары магазина наград'),
    '/api/competitions': listOperation('Competitions', 'Соревнования (CommunityEvent type=COMPETITION)'),
    '/api/payments': listOperation('Payments', 'Платежи по счетам'),
    '/api/invoices': listOperation('Invoices', 'Счета; студент — только свои'),
    '/api/expenses': listOperation('Expenses', 'Расходы филиала по категориям'),
    '/api/messaging': listOperation('Messaging', 'Диалоги текущего участника'),
    '/api/audit': listOperation('Audit', 'Журнал аудита (ADMIN)'),
    '/api/consents': listOperation('Consent', 'История согласий; ADMIN — все, остальные — свои'),
    '/api/cookie-consents': listOperation('Cookie', 'Согласия на cookie по категориям'),
    '/api/cookies/policy': {
      get: {
        tags: ['Cookie'],
        summary: 'Публичная версия и категории cookie-политики',
        responses: { 200: { description: 'Политика cookie' } },
      },
    },
    '/api/support/tickets': {
      get: {
        tags: ['Support'],
        summary: 'Обращения: свои или все для ADMIN/MANAGER',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Постраничный список' }, 401: { description: 'Нет access-токена' } },
      },
      post: {
        tags: ['Support'],
        summary: 'Создать обращение в поддержку',
        security: [{ bearerAuth: [] }],
        responses: { 201: { description: 'Обращение создано' }, 422: { description: 'Ошибка валидации' } },
      },
    },
    '/api/reports/overview': {
      get: {
        tags: ['Reports'],
        summary: 'Сводка: пользователи, курсы, финансы, поддержка, посещаемость',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'Сводный отчёт' }, 403: { description: 'Нет прав' } },
      },
    },
    '/api/integrations': {
      get: {
        tags: ['Integrations'],
        summary: 'Реестр адаптеров: настройка и последний статус (ADMIN)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Список адаптеров без секретов' }, 403: { description: 'Нет прав' } },
      },
    },
    '/api/integrations/status': {
      get: {
        tags: ['Integrations'],
        summary: 'Статус внешних провайдеров без раскрытия секретов (ADMIN)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Статусы интеграций' }, 403: { description: 'Нет прав' } },
      },
    },
    '/api/integrations/events': {
      get: {
        tags: ['Integrations'],
        summary: 'Журнал обращений к внешним сервисам (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'provider', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['OK', 'FAILED', 'SKIPPED'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          200: { description: 'Страница журнала' },
          403: { description: 'Нет прав' },
          422: { description: 'Неверные параметры' },
        },
      },
    },
    '/api/integrations/{id}/check': {
      post: {
        tags: ['Integrations'],
        summary: 'Проверить доступность интеграции и записать событие (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          201: { description: 'Статус проверки: ok, degraded, not_configured или unreachable' },
          403: { description: 'Нет прав' },
          404: { description: 'Адаптер не найден' },
        },
      },
    },
    '/api/integrations/check-all': {
      post: {
        tags: ['Integrations'],
        summary: 'Проверить все интеграции (ADMIN)',
        security: [{ bearerAuth: [] }],
        responses: { 201: { description: 'Результаты по всем адаптерам' }, 403: { description: 'Нет прав' } },
      },
    },
    '/api/integrations/{id}': {
      patch: {
        tags: ['Integrations'],
        summary: 'Включить интеграцию или изменить несекретные настройки (ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                  settings: { type: 'object', additionalProperties: true },
                  secretEnvVars: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Сохранённые настройки' },
          403: { description: 'Нет прав' },
          404: { description: 'Адаптер не найден' },
          422: { description: 'Значение секрета вместо имени переменной' },
        },
      },
    },
    '/api/integrations/accounting/entries': {
      post: {
        tags: ['Integrations'],
        summary: 'Экспорт счёта, платежа, возврата или расхода в бухгалтерию (ADMIN)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type', 'number', 'amount', 'occurredAt'],
                properties: {
                  type: { type: 'string', enum: ['invoice', 'payment', 'refund', 'expense'] },
                  number: { type: 'string' },
                  amount: { type: 'integer', minimum: 1 },
                  currency: { type: 'string', enum: ['KGS'] },
                  occurredAt: { type: 'string', format: 'date-time' },
                  counterparty: { type: 'string' },
                  description: { type: 'string' },
                  externalId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Документ принят бухгалтерией' },
          403: { description: 'Нет прав' },
          422: { description: 'Неверное тело' },
          502: { description: 'Бухгалтерия недоступна' },
          503: { description: 'Интеграция не настроена' },
        },
      },
    },
    '/api/live-digital/status': {
      get: {
        tags: ['LiveDigital'],
        summary: 'Готовность LiveDigital без раскрытия токена',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Статус провайдера' }, 403: { description: 'Нет прав' } },
      },
    },
  },
} as const
