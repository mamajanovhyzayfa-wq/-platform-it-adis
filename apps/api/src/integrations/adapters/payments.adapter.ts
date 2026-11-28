import { env } from '../../config/env.js'
import { probeHttp } from '../core/http.js'
import { missingVariables } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

interface PaymentAdapterInput {
  id: string
  name: string
  description: string
  docsUrl: string
  envVars: string[]
  required: ReadonlyArray<readonly [string, unknown]>
  baseUrl: () => string
}

/**
 * Health-check локального платёжного провайдера.
 *
 * Платёжные API не публикуют отдельный ping-метод, поэтому проверяется
 * доступность хоста провайдера. Ответ 4xx означает, что сервер отвечает, но
 * проверка реквизитов возможна только реальной платёжной сессией — об этом
 * честно сообщает статус degraded.
 */
function paymentAdapter(input: PaymentAdapterInput): IntegrationAdapter {
  const missing = () => missingVariables(input.required)
  return {
    descriptor: {
      id: input.id,
      name: input.name,
      category: 'payments',
      description: input.description,
      docsUrl: input.docsUrl,
      envVars: input.envVars,
    },
    missingEnv: missing,
    isConfigured: () => missing().length === 0,
    async probe(): Promise<IntegrationProbe> {
      const result = await probeHttp(input.baseUrl())
      if (result.status > 0 && result.status < 500) {
        return result.ok
          ? { ok: true }
          : { ok: true, degraded: true, message: `${input.name}: хост отвечает HTTP ${result.status}` }
      }
      return { ok: false, message: `${input.name}: сервис недоступен (${result.message ?? 'нет ответа'})` }
    },
  }
}

/** FreedomPay Кыргызстан — Merchant API, оплата картой и Элсом. */
const freedomPayAdapter: IntegrationAdapter = paymentAdapter({
  id: 'freedompay',
  name: 'FreedomPay Кыргызстан',
  description: 'Онлайн-оплата счетов картой через FreedomPay Merchant API.',
  docsUrl: 'https://freedompay.kg/docs/merchant-api/pay',
  envVars: ['FREEDOMPAY_MERCHANT_ID', 'FREEDOMPAY_SECRET_KEY', 'FREEDOMPAY_BASE_URL'],
  required: [
    ['FREEDOMPAY_MERCHANT_ID', env.FREEDOMPAY_MERCHANT_ID],
    ['FREEDOMPAY_SECRET_KEY', env.FREEDOMPAY_SECRET_KEY],
  ],
  baseUrl: () => env.FREEDOMPAY_BASE_URL,
})

/** Elsom (КИКБ) — интернет-эквайринг, партнёрский API. */
const elsomAdapter: IntegrationAdapter = paymentAdapter({
  id: 'elsom',
  name: 'Elsom / КИКБ',
  description: 'Интернет-эквайринг Elsom: оплата счетов и возвраты.',
  docsUrl: 'https://kicb.net',
  envVars: ['ELSOM_BASE_URL', 'ELSOM_PARTNER_CODE', 'ELSOM_PASSWORD'],
  required: [
    ['ELSOM_BASE_URL', env.ELSOM_BASE_URL],
    ['ELSOM_PARTNER_CODE', env.ELSOM_PARTNER_CODE],
    ['ELSOM_PASSWORD', env.ELSOM_PASSWORD],
  ],
  baseUrl: () => env.ELSOM_BASE_URL ?? '',
})

export const paymentIntegrationAdapters: IntegrationAdapter[] = [freedomPayAdapter, elsomAdapter]
