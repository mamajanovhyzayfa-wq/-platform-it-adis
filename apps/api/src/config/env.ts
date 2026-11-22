import 'dotenv/config'
import { z } from 'zod'

// Пустая строка в .env означает «переменная не задана», а не пустое значение.
// Особенно важно для compose: он передаёт необязательные ключи как "".
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.string().default('http://localhost:8081'),
  DATABASE_URL: z.string().default('postgresql://itadis:itadis@localhost:5432/itadis?schema=public'),
  // Прямое подключение для миграций, pg_dump/pg_restore и провижининга филиалов.
  // В production DATABASE_URL указывает на PgBouncer, а этот URL — на PostgreSQL.
  DIRECT_DATABASE_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  // Размер пула одного PrismaClient. Это не лимит пользователей: PgBouncer
  // мультиплексирует клиентские соединения реплик в небольшой пул PostgreSQL.
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_POOL_TIMEOUT: z.coerce.number().int().min(1).max(120).default(10),
  // Пустая строка в .env означает «не задано», а не пустое значение.
  // Управляющая БД с реестром филиалов. По умолчанию совпадает с основной БД.
  CONTROL_DATABASE_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  // Домен консоли главного администратора. На остальных доменах консоль недоступна.
  PLATFORM_DOMAIN: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  // Домен основного филиала. Применяется при старте API к записи isPrimary.
  // Нужен, чтобы production работал без fallback «любой домен → основная БД».
  PRIMARY_DOMAIN: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  PLATFORM_ADMIN_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().default('platform@itadis.kg'),
  ),
  PLATFORM_ADMIN_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(8).optional(),
  ),
  PLATFORM_ADMIN_PASSWORD_HASH: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  // В разработке неизвестный домен может обслуживаться основной БД. В production
  // fallback выключен по умолчанию: иначе опечатка в домене открывала бы чужие данные.
  ALLOW_PRIMARY_FALLBACK: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value ? value === 'true' : process.env.NODE_ENV !== 'production')),
  BRANCH_DATABASE_PREFIX: z.string().default('itadis_branch_'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me'),
  // Отдельный ключ AES-256-GCM для чувствительных полей (2FA-секреты и т.п.).
  DATA_ENCRYPTION_KEY: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(16).optional()),
  // Необязательный внешний антивирусный HTTP-сканер. Без него работает сигнатурная проверка.
  ANTIVIRUS_SCAN_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
  ANTIVIRUS_API_KEY: z.string().optional(),
  // Формат запроса к внешнему сканеру: ClamAV REST принимает сырое тело файла,
  // Cloudmersive и MetaDefender — multipart. Неизвестное значение не даст
  // приложению стартовать, чтобы файлы не проверялись «не тем» запросом.
  ANTIVIRUS_PROVIDER: z.enum(['clamav', 'cloudmersive', 'metadefender']).default('clamav'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Вход через Google/Apple. Без client id провайдер отвечает 503 и не имитирует успех.
  // Секреты обмена кода (client secret, ключ подписи Apple) читает только сервер.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  // Календари: OAuth-токены и учётные данные CalDAV хранятся только на сервере.
  GOOGLE_CALENDAR_CLIENT_ID: z.string().optional(),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALENDAR_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().default('primary'),
  APPLE_CALDAV_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
  APPLE_CALDAV_USERNAME: z.string().optional(),
  APPLE_CALDAV_PASSWORD: z.string().optional(),
  OUTLOOK_TENANT_ID: z.string().optional(),
  OUTLOOK_CLIENT_ID: z.string().optional(),
  OUTLOOK_CLIENT_SECRET: z.string().optional(),
  // Бухгалтерская система (1С или совместимая): адрес API и ключ только на сервере.
  ACCOUNTING_PROVIDER: z.enum(['1c', 'generic']).default('generic'),
  ACCOUNTING_BASE_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
  ACCOUNTING_API_KEY: z.string().optional(),
  // SMS для кодов восстановления: Twilio-совместимый API.
  SMS_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['twilio']).optional()),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('IT Adis <no-reply@itadis.local>'),
  // ApyHub: серверная проверка email в форме заявки (формат, MX-записи,
  // одноразовые адреса). Токен читает только сервер; без него проверка пропускается.
  APY_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  // Видеозанятия: единственный провайдер — LiveDigital (Moodhood API + Web SDK).
  // Без токена и spaceId модуль возвращает 503 и не имитирует видеосвязь.
  LIVEDIGITAL_API_URL: z.string().url().default('https://moodhood-api.livedigital.space/v1'),
  LIVEDIGITAL_API_TOKEN: z.string().optional(),
  LIVEDIGITAL_SPACE_ID: z.string().optional(),
  LIVEDIGITAL_WEBHOOK_SECRET: z.string().optional(),
  // Публичный адрес API нужен для ссылки на ICS-календарь.
  API_PUBLIC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  // Устаревшие настройки LiveKit оставлены только для чтения старых записей.
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  LIVEKIT_EGRESS_URL: z.string().url().optional(),
  // S3-совместимое хранилище для записей занятий (нужно только для записи).
  RECORDING_S3_ACCESS_KEY: z.string().optional(),
  RECORDING_S3_SECRET: z.string().optional(),
  RECORDING_S3_BUCKET: z.string().optional(),
  RECORDING_S3_REGION: z.string().optional(),
  RECORDING_S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  RECORDING_S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  // AI-помощник: ключ только на сервере, клиент его не видит.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  // Локальный каталог вложений чата и решений (в продакшене — объектное хранилище).
  UPLOADS_DIR: z.string().default('uploads'),
  // Redis: кеш, распределённые блокировки и временные данные. Без URL — локальный fallback.
  REDIS_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
  // Локальный fallback объектного хранилища библиотеки. Не отдаётся статикой:
  // доступ только через проверяемый API /api/files/:id/download.
  STORAGE_DIR: z.string().default('storage'),
  // S3-совместимое объектное хранилище библиотеки файлов и резервных копий.
  // Без полного набора переменных используется локальный диск (один сервер).
  S3_ENDPOINT: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  // Каталог резервных копий на сервере (не отдаётся через /uploads).
  BACKUP_DIR: z.string().default('backups'),
  BACKUP_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  BACKUP_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(20 * 60 * 1000),
  // Вебхук для оповещений об ошибках/сбоях backup и 5xx. Не задан — только лог.
  ALERT_WEBHOOK_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
  // Необязательный токен Expo для повышенных лимитов push-рассылки.
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Онлайн-платежи: реквизиты провайдера. Без них приём онлайн-оплаты выключен,
  // а модуль возвращает понятный статус вместо имитации успешного платежа.
  ONLINE_PAYMENTS_PROVIDER: z.string().optional(),
  ONLINE_PAYMENTS_MERCHANT_ID: z.string().optional(),
  ONLINE_PAYMENTS_API_KEY: z.string().optional(),
  ONLINE_PAYMENTS_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  // FreedomPay Kyrgyzstan Merchant API. Секрет не хранится в БД филиала.
  FREEDOMPAY_MERCHANT_ID: z.string().optional(),
  FREEDOMPAY_SECRET_KEY: z.string().optional(),
  FREEDOMPAY_BASE_URL: z.string().url().default('https://api.freedompay.kg'),
  FREEDOMPAY_TESTING_MODE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  // Elsom: адрес сервера партнёра выдаётся индивидуально, поэтому без него адаптер выключен.
  ELSOM_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  ELSOM_TENANT_ID: z.string().optional(),
  ELSOM_PARTNER_CODE: z.string().optional(),
  ELSOM_PASSWORD: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return

  const requireProductionSecret = (field: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET' | 'DATA_ENCRYPTION_KEY') => {
    const secret = value[field]
    if (!secret || secret.length < 32 || secret.includes('change-me') || secret.includes('dev-')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} в production должен быть случайным секретом не короче 32 символов`,
      })
    }
  }

  requireProductionSecret('JWT_ACCESS_SECRET')
  requireProductionSecret('JWT_REFRESH_SECRET')
  requireProductionSecret('DATA_ENCRYPTION_KEY')

  if (value.DATA_ENCRYPTION_KEY && value.DATA_ENCRYPTION_KEY === value.JWT_ACCESS_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATA_ENCRYPTION_KEY'],
      message: 'DATA_ENCRYPTION_KEY должен отличаться от JWT_ACCESS_SECRET',
    })
  }
  if (!value.ANTIVIRUS_SCAN_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ANTIVIRUS_SCAN_URL'],
      message: 'В production требуется внешний антивирусный сканер ANTIVIRUS_SCAN_URL',
    })
  }
  try {
    const origin = new URL(value.APP_ORIGIN)
    if (origin.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_ORIGIN'],
        message: 'APP_ORIGIN в production должен использовать https',
      })
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['APP_ORIGIN'], message: 'APP_ORIGIN должен быть URL' })
  }
})

export const env = schema.parse(process.env)
export type Env = typeof env
