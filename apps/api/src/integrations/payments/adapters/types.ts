/** Канонический контракт адаптера локального платёжного провайдера. */

export type ProviderCode = 'freedompay' | 'elsom'

export interface ProviderAccountConfig {
  id?: string
  provider: ProviderCode
  label: string
  merchantId: string
  tenantId?: string | null
  /** Значение секрета берётся из env по имени secretEnvVar, не из БД. */
  secret: string
  webhookSecret?: string
  baseUrl?: string
  testing?: boolean
  settings?: Record<string, unknown>
}

export interface CheckoutRequest {
  invoiceId: string
  invoiceNumber: string
  amount: number
  description: string
  studentEmail?: string | null
  studentPhone?: string | null
  callbackUrl: string
  returnUrl: string
}

export interface CheckoutResult {
  provider: ProviderCode
  externalId: string
  redirectUrl: string
  raw: unknown
}

export interface ProviderWebhookEvent {
  provider: ProviderCode
  externalId: string
  invoiceId: string
  amount: number
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING'
  message?: string
  raw: unknown
}

export interface PaymentProviderAdapter {
  readonly code: ProviderCode
  createCheckout(account: ProviderAccountConfig, request: CheckoutRequest): Promise<CheckoutResult>
  parseWebhook(account: ProviderAccountConfig, rawBody: string, contentType?: string): Promise<ProviderWebhookEvent>
  /** Ответ провайдеру в его формате; тело и content-type задаёт адаптер. */
  webhookResponse(event: ProviderWebhookEvent): { status: number; contentType: string; body: string }
}
