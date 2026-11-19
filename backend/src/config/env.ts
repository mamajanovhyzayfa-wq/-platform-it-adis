import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.string().default('http://localhost:8081'),
  DATABASE_URL: z.string().default('postgresql://itadis:itadis@localhost:5432/itadis?schema=public'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('IT Adis <no-reply@itadis.local>'),
  // Видеозанятия (LiveKit). Без этих переменных модуль возвращает 503 с понятным сообщением.
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  LIVEKIT_EGRESS_URL: z.string().url().optional(),
  // S3-совместимое хранилище для записей занятий (нужно только для записи).
  RECORDING_S3_ACCESS_KEY: z.string().optional(),
  RECORDING_S3_SECRET: z.string().optional(),
  RECORDING_S3_BUCKET: z.string().optional(),
  RECORDING_S3_REGION: z.string().optional(),
  RECORDING_S3_ENDPOINT: z.string().url().optional(),
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
  // Необязательный токен Expo для повышенных лимитов push-рассылки.
  EXPO_ACCESS_TOKEN: z.string().optional(),
})

export const env = schema.parse(process.env)
export type Env = typeof env
