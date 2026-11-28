import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { env } from '../../config/env.js'

/**
 * Онлайн-платежи: граница интеграции с провайдером.
 *
 * Соглашение проекта: платёжный провайдер подключается отдельным адаптером,
 * который переводит официальный протокол провайдера в канонический контракт ниже.
 * Пока адаптер конкретного провайдера не реализован и не проверен по официальной
 * документации, модуль честно сообщает `configured: false` и возвращает 503 —
 * он не имитирует успешную оплату и не создаёт платёж без подтверждения.
 *
 * Канонический контракт вебхука (POST /api/finance/webhooks/online):
 *   { "event": "payment.succeeded", "externalId": "...", "invoiceId": "...",
 *     "amount": 4500, "occurredAt": "2026-11-19T10:00:00.000Z" }
 * Заголовок X-ITadis-Signature: hex(HMAC-SHA256(raw body, ONLINE_PAYMENTS_WEBHOOK_SECRET)).
 */

export const ONLINE_PROVIDER_ENV_VARS = [
  'ONLINE_PAYMENTS_PROVIDER',
  'ONLINE_PAYMENTS_MERCHANT_ID',
  'ONLINE_PAYMENTS_API_KEY',
  'ONLINE_PAYMENTS_WEBHOOK_SECRET',
] as const

interface OnlineProviderStatus {
  configured: boolean
  provider: string | null
  missingEnv: string[]
  webhookPath: string
  note: string
}

export function onlineProviderStatus(): OnlineProviderStatus {
  const configuredValues: Record<(typeof ONLINE_PROVIDER_ENV_VARS)[number], string | undefined> = {
    ONLINE_PAYMENTS_PROVIDER: env.ONLINE_PAYMENTS_PROVIDER,
    ONLINE_PAYMENTS_MERCHANT_ID: env.ONLINE_PAYMENTS_MERCHANT_ID,
    ONLINE_PAYMENTS_API_KEY: env.ONLINE_PAYMENTS_API_KEY,
    ONLINE_PAYMENTS_WEBHOOK_SECRET: env.ONLINE_PAYMENTS_WEBHOOK_SECRET,
  }

  const missingEnv = ONLINE_PROVIDER_ENV_VARS.filter((name) => !configuredValues[name])
  const provider = env.ONLINE_PAYMENTS_PROVIDER ?? null

  return {
    configured: missingEnv.length === 0,
    provider,
    missingEnv: [...missingEnv],
    webhookPath: '/api/finance/webhooks/online',
    note:
      missingEnv.length > 0
        ? 'Онлайн-оплата выключена: задайте переменные окружения провайдера на сервере. Наличные и банковский перевод работают.'
        : 'Реквизиты заданы. Для приёма оплаты нужен адаптер официального API провайдера: создание платёжной сессии и разбор его вебхуков в канонический контракт.',
  }
}

/**
 * Проверка подписи вебхука. Пустой секрет означает, что приём вебхуков выключен:
 * иначе любой запрос мог бы подтвердить оплату.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = env.ONLINE_PAYMENTS_WEBHOOK_SECRET
  if (!secret) return false
  if (!signature) return false

  const expected = createHmac('sha256', secret).update(rawBody).digest()
  let provided: Buffer
  try {
    provided = Buffer.from(signature.trim(), 'hex')
  } catch {
    return false
  }
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

export const canonicalWebhookSchema = z
  .object({
    event: z.literal('payment.succeeded'),
    externalId: z.string().trim().min(1).max(200),
    invoiceId: z.string().uuid(),
    amount: z.number().int().min(1),
    occurredAt: z.string().datetime().optional(),
  })
  .strict()
