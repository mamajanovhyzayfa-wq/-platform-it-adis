import { createHash, randomBytes } from 'node:crypto'
import { AppError } from '../../../lib/errors.js'
import type {
  CheckoutRequest, CheckoutResult, PaymentProviderAdapter, ProviderAccountConfig, ProviderWebhookEvent,
} from './types.js'

/**
 * FreedomPay Kyrgyzstan, Merchant API.
 * Официальная документация: https://freedompay.kg/docs/merchant-api/pay
 *
 * Реализованы только подтверждённые официальные методы:
 *  - POST https://api.freedompay.kg/init_payment.php — создание платёжной страницы;
 *  - Result URL (application/x-www-form-urlencoded) — итоговый статус платежа.
 * Подпись: md5(script;отсортированные поля;secret), см. официальное «Введение».
 */

const SCRIPT = 'init_payment.php'
const CALLBACK_SCRIPT = 'freedompay'

function sortedSignature(fields: Record<string, string>, script: string, secret: string): string {
  const values = Object.entries(fields)
    .filter(([key]) => key !== 'pg_sig')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
  return createHash('md5').update([script, ...values, secret].join(';')).digest('hex')
}

function tag(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim()
}

/** Возвратная ссылка уже может содержать query-параметры (например, invoice). */
function withQueryParam(url: string, key: string, value: string): string {
  const target = new URL(url)
  target.searchParams.set(key, value)
  return target.toString()
}

export const freedomPayAdapter: PaymentProviderAdapter = {
  code: 'freedompay',

  async createCheckout(account: ProviderAccountConfig, request: CheckoutRequest): Promise<CheckoutResult> {
    if (!account.secret) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Секрет FreedomPay не задан')
    const baseUrl = (account.baseUrl || 'https://api.freedompay.kg').replace(/\/$/, '')
    const fields: Record<string, string> = {
      pg_merchant_id: account.merchantId,
      pg_order_id: request.invoiceId,
      pg_amount: String(request.amount),
      pg_description: request.description.slice(0, 255),
      pg_currency: 'KGS',
      pg_salt: randomBytes(8).toString('hex'),
      pg_result_url: `${request.callbackUrl}/freedompay`,
      // Не добавляем второй «?», если returnUrl уже содержит invoice и другие параметры.
      pg_success_url: withQueryParam(request.returnUrl, 'paid', '1'),
      pg_failure_url: withQueryParam(request.returnUrl, 'failed', '1'),
      pg_site_url: request.returnUrl,
      pg_language: 'ru',
      pg_request_method: 'POST',
      ...(request.studentEmail ? { pg_user_contact_email: request.studentEmail } : {}),
      ...(request.studentPhone ? { pg_user_phone: request.studentPhone.replace(/\D/g, '') } : {}),
      ...(account.testing ? { pg_testing_mode: '1' } : {}),
    }
    fields.pg_sig = sortedSignature(fields, SCRIPT, account.secret)

    let response: Response
    try {
      response = await fetch(`${baseUrl}/${SCRIPT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', `FreedomPay недоступен: ${error instanceof Error ? error.message : 'сеть'}`)
    }
    const xml = await response.text()
    if (!response.ok) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', `FreedomPay вернул HTTP ${response.status}`)
    const status = tag(xml, 'pg_status')
    if (status !== 'ok') {
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', tag(xml, 'pg_error_description') || tag(xml, 'pg_description') || 'FreedomPay отклонил платёж')
    }
    const redirectUrl = tag(xml, 'pg_redirect_url')
    const externalId = tag(xml, 'pg_payment_id')
    if (!redirectUrl || !externalId) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'FreedomPay не вернул платёжную ссылку')
    return { provider: 'freedompay', externalId, redirectUrl, raw: xml }
  },

  async parseWebhook(account: ProviderAccountConfig, rawBody: string): Promise<ProviderWebhookEvent> {
    const fields = Object.fromEntries(new URLSearchParams(rawBody).entries())
    if (!fields.pg_sig) throw new AppError(401, 'INVALID_SIGNATURE', 'В уведомлении FreedomPay нет подписи')
    const expected = sortedSignature(fields, CALLBACK_SCRIPT, account.secret)
    if (expected !== fields.pg_sig.toLowerCase()) throw new AppError(401, 'INVALID_SIGNATURE', 'Подпись уведомления FreedomPay неверна')
    const invoiceId = fields.pg_order_id
    const externalId = fields.pg_payment_id
    if (!invoiceId || !externalId) throw new AppError(400, 'INVALID_CALLBACK', 'В уведомлении нет счёта или платежа')
    return {
      provider: 'freedompay',
      externalId,
      invoiceId,
      amount: Number(fields.pg_amount || 0),
      status: fields.pg_result === '1' ? 'SUCCEEDED' : fields.pg_result === '0' ? 'FAILED' : 'PENDING',
      message: fields.pg_failure_description || fields.pg_description,
      raw: fields,
    }
  },

  webhookResponse() {
    return {
      status: 200,
      contentType: 'application/xml; charset=utf-8',
      body: '<?xml version="1.0" encoding="utf-8"?><response><pg_status>ok</pg_status></response>',
    }
  },
}
