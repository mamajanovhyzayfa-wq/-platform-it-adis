import { IntegrationError, isTransientError } from './errors.js'

/**
 * Повторные попытки для внешних вызовов.
 *
 * Используется экспоненциальная задержка с джиттером. Повторяются только
 * временные сбои (сеть, таймаут, 429/5xx): 4xx с неверным ключом повторять
 * бессмысленно, иначе адаптер будет долбить провайдера с плохими реквизитами.
 */
interface RetryOptions {
  /** Всего попыток, включая первую. */
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  retryOn?: (error: unknown) => boolean
  /** Подменяются в тестах, чтобы не ждать реальных пауз. */
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  onAttemptFailed?: (error: unknown, attempt: number, delayMs: number) => void
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function retryDelay(attempt: number, options: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'random'> = {}): number {
  const base = options.baseDelayMs ?? 250
  const max = options.maxDelayMs ?? 5_000
  const random = options.random ?? Math.random
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1))
  // Джиттер 50–100 %: несколько инстансов не повторяют запрос одновременно.
  return Math.round(exponential * (0.5 + random() * 0.5))
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const shouldRetry = options.retryOn ?? isTransientError
  const sleep = options.sleep ?? defaultSleep
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt === attempts || !shouldRetry(error)) throw error
      const delayMs = retryDelay(attempt, options)
      options.onAttemptFailed?.(error, attempt, delayMs)
      await sleep(delayMs)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new IntegrationError('unknown', 'RETRY_FAILED', 'Внешний сервис недоступен')
}
