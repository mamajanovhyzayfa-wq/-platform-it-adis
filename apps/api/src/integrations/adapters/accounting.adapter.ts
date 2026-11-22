import { env } from '../../config/env.js'
import { IntegrationError, safeErrorMessage } from '../core/errors.js'
import { recordIntegrationEvent } from '../core/event-log.js'
import { probeHttp, requestJson } from '../core/http.js'
import { missingVariables, readSecret } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

/**
 * Бухгалтерские системы (1С и совместимые по протоколу HTTP).
 *
 * Экспорт документов идёт на сервер бухгалтерии с API-ключом из переменной
 * окружения; ключ не хранится в браузере и не пишется в журнал. Повторы и
 * журналирование выполняются общими средствами интеграционного слоя.
 */
export interface AccountingEntry {
  type: 'invoice' | 'payment' | 'refund' | 'expense'
  /** Номер документа в системе платформы. */
  number: string
  amount: number
  currency: 'KGS'
  occurredAt: string
  counterparty?: string
  description?: string
  /** Идентификатор объекта платформы: счёт, платёж, возврат, расход. */
  externalId?: string
}

function missing(): string[] {
  return missingVariables([
    ['ACCOUNTING_BASE_URL', env.ACCOUNTING_BASE_URL],
    ['ACCOUNTING_API_KEY', env.ACCOUNTING_API_KEY],
  ])
}

function baseUrl(): string {
  return (env.ACCOUNTING_BASE_URL ?? '').replace(/\/$/, '')
}

function requireConfigured(): void {
  const absent = missing()
  if (absent.length > 0) {
    throw new IntegrationError(
      'accounting',
      'NOT_CONFIGURED',
      `Бухгалтерия не настроена: задайте ${absent.join(', ')}`,
      { status: 503 },
    )
  }
}

export const accountingAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'accounting',
    name: 'Бухгалтерская система',
    category: 'accounting',
    description: 'Экспорт счетов, платежей, возвратов и расходов в 1С или совместимую систему.',
    docsUrl: 'https://1c-dn.com',
    envVars: ['ACCOUNTING_PROVIDER', 'ACCOUNTING_BASE_URL', 'ACCOUNTING_API_KEY'],
  },
  missingEnv: missing,
  isConfigured: () => missing().length === 0,
  async probe(): Promise<IntegrationProbe> {
    const result = await probeHttp(`${baseUrl()}/health`, {
      headers: { 'X-API-Key': readSecret('ACCOUNTING_API_KEY') ?? '' },
    })
    if (result.ok) return { ok: true }
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: 'Бухгалтерия: API-ключ отклонён' }
    }
    if (result.status === 404) {
      return { ok: true, degraded: true, message: 'Бухгалтерия: эндпоинт /health не найден, доступность не подтверждена' }
    }
    return { ok: false, message: `Бухгалтерия: ${result.message ?? 'нет ответа'}` }
  },
}

/** Отправляет документ в бухгалтерскую систему с повторами и записью в журнал. */
export async function sendAccountingEntry(entry: AccountingEntry, actorId: string | null = null): Promise<unknown> {
  requireConfigured()
  const started = performance.now()
  try {
    const result = await requestJson<unknown>({
      provider: 'accounting',
      url: `${baseUrl()}/documents`,
      method: 'POST',
      headers: { 'X-API-Key': readSecret('ACCOUNTING_API_KEY') ?? '' },
      body: entry,
    })
    await recordIntegrationEvent({
      provider: 'accounting',
      action: 'request',
      status: 'OK',
      durationMs: Math.round(performance.now() - started),
      metadata: { type: entry.type, number: entry.number },
      actorId,
    })
    return result
  } catch (error) {
    await recordIntegrationEvent({
      provider: 'accounting',
      action: 'request',
      status: 'FAILED',
      durationMs: Math.round(performance.now() - started),
      message: safeErrorMessage(error),
      metadata: { type: entry.type, number: entry.number },
      actorId,
    })
    throw error
  }
}
