import { IntegrationError, safeErrorMessage } from './errors.js'
import { withRetry } from './retry.js'

/**
 * HTTP-обёртки для адаптеров: таймаут, повторные попытки и единый формат ошибок.
 * Заголовки с секретами никогда не попадают в текст ошибки или журнал.
 */
export interface JsonRequestOptions {
  provider: string
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  attempts?: number
}

export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000
  return withRetry(
    async () => {
      let response: Response
      try {
        response = await fetch(options.url, {
          method: options.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(options.headers ?? {}),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        const reason = error instanceof Error ? error.name : 'network'
        throw new IntegrationError(
          options.provider,
          'NETWORK_ERROR',
          `${options.provider}: сеть недоступна (${reason})`,
          { retryable: true },
        )
      }

      const text = await response.text().catch(() => '')
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        throw new IntegrationError(
          options.provider,
          'HTTP_ERROR',
          `${options.provider}: HTTP ${response.status}${text ? ` — ${safeErrorMessage(text, 200)}` : ''}`,
          { retryable },
        )
      }
      if (!text) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new IntegrationError(options.provider, 'INVALID_RESPONSE', `${options.provider}: ответ не является JSON`)
      }
    },
    { attempts: options.attempts ?? 3 },
  )
}

export interface HttpProbe {
  ok: boolean
  status: number
  message?: string
}

/**
 * Одиночная проверка доступности без повторов: health-check должен быть быстрым,
 * а повторные попытки выполняет вызывающий код, если это нужно.
 */
export async function probeHttp(url: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<HttpProbe> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return { ok: false, status: 0, message: safeErrorMessage(error, 160) }
  }
}
