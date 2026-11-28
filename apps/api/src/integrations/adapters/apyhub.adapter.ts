import { IntegrationError } from '../core/errors.js'
import { probeHttp, requestJson } from '../core/http.js'
import { missingVariables, readSecret } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'
import { interpretProbe } from './helpers.js'

/** Документированный endpoint: формат, MX-записи домена и одноразовые адреса. */
const VERIFY_URL = 'https://api.eu.apyhub.com/apyhub/verify-email-validity-and-deliverability'
/** Публичный каталог регионов: health-check не тратит атомы и не проверяет чужой адрес. */
const REGIONS_URL = 'https://apyhub.com/api/public/regions'

/** Форма заявки ждёт ответа, поэтому таймаут короче фоновых интеграций. */
const APYHUB_TIMEOUT_MS = 8_000

/** Токен читается только на сервере; пустая строка считается «не задано». */
function token(): string | null {
  return readSecret('APY_TOKEN')
}

export function isApyHubConfigured(): boolean {
  return token() !== null
}

/**
 * Проверяет email через ApyHub и возвращает поле `data` как boolean.
 *
 * `true` — формат корректен, домен принимает почту и адрес не одноразовый.
 * `false` — адрес отклонён по одному из этих признаков; это не проверка
 * существования конкретного ящика.
 * Таймаут, 429 и 5xx приходят как retryable IntegrationError, чтобы вызывающий
 * код не выдавал сбой сервиса за неверный email.
 */
export async function verifyEmailDeliverability(email: string): Promise<boolean> {
  const apyToken = token()
  if (!apyToken) {
    throw new IntegrationError('ApyHub', 'NOT_CONFIGURED', 'ApyHub: не задан APY_TOKEN', { status: 503 })
  }

  const payload = await requestJson<{ data?: unknown }>({
    provider: 'ApyHub',
    url: VERIFY_URL,
    method: 'POST',
    // Секрет уходит только в заголовке и не попадает в текст ошибки.
    headers: { 'apy-token': apyToken },
    // disposable_checks: true сохраняет политику отказа от одноразовых адресов.
    body: { email, disposable_checks: true },
    timeoutMs: APYHUB_TIMEOUT_MS,
    // Форму не задерживаем повторами: пользователь может отправить заявку снова.
    attempts: 1,
  })

  if (typeof payload?.data !== 'boolean') {
    throw new IntegrationError('ApyHub', 'INVALID_RESPONSE', 'ApyHub: в ответе нет boolean-поля data')
  }
  return payload.data
}

export const apyHubAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'apyhub',
    name: 'ApyHub (проверка email)',
    category: 'email',
    description: 'Формат, MX-записи домена и одноразовые адреса для формы заявки.',
    docsUrl: 'https://apyhub.com/apyhub/service/verify-email-validity-and-deliverability',
    envVars: ['APY_TOKEN'],
  },
  missingEnv: () => missingVariables([['APY_TOKEN', token()]]),
  isConfigured: () => token() !== null,
  async probe(): Promise<IntegrationProbe> {
    const result = await probeHttp(REGIONS_URL, {}, 5_000)
    return interpretProbe('ApyHub', result)
  },
}
