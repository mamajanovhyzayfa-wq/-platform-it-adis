

/**
 * Работа с секретами интеграций.
 *
 * Правила проекта:
 *  - ключи и токены живут только в переменных окружения сервера либо в
 *    зашифрованном виде в БД (AES-256-GCM, DATA_ENCRYPTION_KEY);
 *  - клиенту (web, mobile) секреты не передаются никогда — только имена
 *    отсутствующих переменных и результат проверки доступности;
 *  - в журнал событий попадает редактированная копия метаданных.
 */
const SECRET_NAME = /(secret|token|password|passwd|api[_-]?key|apikey|private[_-]?key|credential|cookie|authorization)/i

const REDACTED = '[redacted]'

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name)
}

/** Читает секрет по имени переменной окружения; пустая строка считается «не задано». */
export function readSecret(name: string): string | null {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : null
}

/** Имена переменных без значений. */
export function missingVariables(pairs: ReadonlyArray<readonly [string, unknown]>): string[] {
  return pairs.filter(([, value]) => !value).map(([name]) => name)
}

/** Для логов и диагностики: хвост значения не помогает подобрать ключ целиком. */
export function maskTail(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length <= 4 ? REDACTED : `***${value.slice(-4)}`
}

/** Рекурсивно заменяет значения секретных полей на [redacted]. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as T
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1)) as T
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSecretName(key) ? REDACTED : redact(item, depth + 1)
    }
    return result as T
  }
  return value
}
