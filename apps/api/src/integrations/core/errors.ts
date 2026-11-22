/**
 * Ошибка внешней интеграции.
 *
 * Адаптеры не выбрасывают «сырые» ошибки fetch: они переводят их в
 * IntegrationError с понятным кодом и признаком retryable. Верхний слой
 * решает, повторять запрос или вернуть 502/503, а журнал получает
 * обезличенное сообщение без токенов.
 */
export class IntegrationError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
    message: string,
    readonly options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message)
    this.name = 'IntegrationError'
  }

  get status(): number {
    return this.options.status ?? 502
  }

  get retryable(): boolean {
    return this.options.retryable ?? false
  }
}

/** Сетевая ошибка или таймаут — единственные случаи, где повтор почти всегда оправдан. */
export function isTransientError(error: unknown): boolean {
  if (error instanceof IntegrationError) return error.retryable
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError
  }
  return false
}

/** Убирает из текста ошибки всё, что похоже на токен или ключ. */
export function safeErrorMessage(error: unknown, limit = 300): string {
  const raw = error instanceof Error ? error.message : String(error)
  const withoutTokens = raw
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted]')
  return withoutTokens.slice(0, limit)
}
