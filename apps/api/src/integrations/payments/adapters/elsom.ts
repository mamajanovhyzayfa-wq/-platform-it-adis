import { AppError } from '../../../lib/errors.js'
import type {
  CheckoutRequest, CheckoutResult, PaymentProviderAdapter, ProviderAccountConfig, ProviderWebhookEvent,
} from './types.js'

/**
 * Elsom (КИКБ), официальная документация «API для партнеров»
 * https://kicb.net/upload/iblock/.../New_API_Merchant_Payment_Partner ... .pdf
 *
 * Подтверждённые методы:
 *  - POST {base}/service/v1/merchant/generateOTP/{tenantId} с объектом IA_Init;
 *  - POST {base}/service/v1/merchant/getPaymentStatus/{tenantId} с PartnerGetPaymentStatus;
 *  - уведомление партнёра PartnerPaymentResult.
 *
 * В документации сервер провайдера выдаётся партнёру индивидуально, поэтому baseUrl
 * обязателен и задаётся в платёжном аккаунте филиала. Возврат онлайн-платежа
 * выполняется в кабинете Elsom: документированного API возврата в этой версии нет.
 */

function unwrap<T>(payload: Record<string, unknown>, key: string): T | undefined {
  const value = payload[key]
  return value && typeof value === 'object' ? (value as T) : undefined
}

function parseElsomResponse(value: unknown): { status: string | null; url?: string } {
  if (Array.isArray(value)) {
    return { status: typeof value[0] === 'string' ? value[0] : null, url: typeof value[1] === 'string' ? value[1] : undefined }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return {
      status: String(record.status ?? record.Status ?? record.result ?? ''),
      url: typeof record.url === 'string' ? record.url : typeof record.redirectUrl === 'string' ? record.redirectUrl : undefined,
    }
  }
  return { status: null }
}

export const elsomAdapter: PaymentProviderAdapter = {
  code: 'elsom',

  async createCheckout(account: ProviderAccountConfig, request: CheckoutRequest): Promise<CheckoutResult> {
    if (!account.baseUrl) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Для Elsom не задан адрес сервера партнёра')
    if (!account.tenantId) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Для Elsom не задан tenant-id')
    if (!account.secret) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Пароль партнёра Elsom не задан')
    const body = {
      IA_Init: {
        CultureInfo: 'ru-RU',
        MSISDN: String(account.settings?.msisdn ?? '0'),
        PmSISDN: String(account.settings?.pmSisdn ?? '0'),
        PartnerCode: account.merchantId,
        ChequeNo: request.invoiceNumber,
        PartnerTrnID: request.invoiceNumber,
        Amount: String(request.amount),
        CashierNo: '0001',
        UDF: 'ITadis',
        Password: account.secret,
      },
    }
    let response: Response
    try {
      response = await fetch(`${account.baseUrl.replace(/\/$/, '')}/service/v1/merchant/generateOTP/${encodeURIComponent(account.tenantId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', `Elsom недоступен: ${error instanceof Error ? error.message : 'сеть'}`)
    }
    const text = await response.text()
    let parsed: unknown = text
    try { parsed = JSON.parse(text) } catch { /* провайдер может вернуть текст */ }
    if (!response.ok) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', `Elsom вернул HTTP ${response.status}`)
    const result = parseElsomResponse(parsed)
    if (result.status && !['success', 'ok', '0'].includes(result.status.toLowerCase())) {
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', `Elsom отклонил платёж: ${result.status}`)
    }
    if (!result.url) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Elsom не вернул URL оплаты')
    return { provider: 'elsom', externalId: request.invoiceNumber, redirectUrl: result.url, raw: parsed }
  },

  async parseWebhook(account: ProviderAccountConfig, rawBody: string): Promise<ProviderWebhookEvent> {
    let payload: Record<string, unknown>
    try { payload = JSON.parse(rawBody) as Record<string, unknown> } catch {
      throw new AppError(400, 'INVALID_CALLBACK', 'Уведомление Elsom не является JSON')
    }
    const event = unwrap<Record<string, unknown>>(payload, 'PartnerPaymentResult') ?? payload
    const externalId = String(event.PartnerTrnID ?? '')
    if (!externalId) throw new AppError(400, 'INVALID_CALLBACK', 'В уведомлении Elsom нет PartnerTrnID')
    const paymentStatus = String(event.PaymentStatus ?? '')
    return {
      provider: 'elsom',
      externalId,
      invoiceId: '',
      amount: 0,
      status: paymentStatus === 'A' ? 'SUCCEEDED' : ['2', '3', '4'].includes(paymentStatus) ? 'FAILED' : 'PENDING',
      message: String(event.Message ?? ''),
      raw: event,
    }
  },

  webhookResponse(event: ProviderWebhookEvent) {
    return {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ Response: { ErrorCode: event.status === 'FAILED' ? '4' : '0', ErrorMsg: event.status === 'FAILED' ? 'Payment failed' : 'Success' } }),
    }
  },
}

/** Официальный запрос статуса Elsom (2.3). Используется для проверки callback. */
export async function elsomPaymentStatus(account: ProviderAccountConfig, partnerTrnId: string): Promise<string | null> {
  if (!account.baseUrl || !account.tenantId || !account.secret) return null
  const response = await fetch(`${account.baseUrl.replace(/\/$/, '')}/service/v1/merchant/getPaymentStatus/${encodeURIComponent(account.tenantId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      PartnerGetPaymentStatus: {
        CultureInfo: 'ru-RU',
        MSISDN: String(account.settings?.msisdn ?? '0'),
        PartnerTrnID: partnerTrnId,
        Password: account.secret,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return null
  const payload = await response.json() as Record<string, unknown>
  const root = unwrap<Record<string, unknown>>(payload, 'Response') ?? payload
  const result = unwrap<Record<string, unknown>>(root, 'Result')
  return result?.PaymentStatus === undefined ? null : String(result.PaymentStatus)
}
