/** OpenAPI-документ для /docs. Держим вручную, чтобы контракт не расходился с кодом. */
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
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Регистрация ученика',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['firstName', 'lastName', 'email', 'password', 'passwordRepeat', 'acceptTerms', 'acceptPrivacy'],
                properties: {
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  phone: { type: 'string' },
                  password: { type: 'string', minLength: 8 },
                  passwordRepeat: { type: 'string' },
                  birthDate: { type: 'string', format: 'date' },
                  locale: { type: 'string', enum: ['ru', 'ky', 'en'] },
                  acceptTerms: { type: 'boolean' },
                  acceptPrivacy: { type: 'boolean' },
                  guardianName: { type: 'string' },
                  guardianPhone: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Создан' },
          409: { description: 'Пользователь уже существует', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
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
  },
} as const
