/**
 * Контракт внешней интеграции.
 *
 * Каждый провайдер (видео, вход через Google/Apple, почта, SMS, push,
 * календари, платежи, бухгалтерия, AI, хранилище) описывается отдельным
 * адаптером. Реестр умеет только перечислять адаптеры, проверять их
 * настройку и запускать проверку доступности — бизнес-логика остаётся в
 * модулях домена.
 */
export type IntegrationCategory =
  | 'video'
  | 'identity'
  | 'email'
  | 'sms'
  | 'push'
  | 'calendar'
  | 'payments'
  | 'accounting'
  | 'ai'
  | 'storage'

export type IntegrationHealthStatus = 'ok' | 'degraded' | 'not_configured' | 'unreachable'

export interface IntegrationDescriptor {
  /** Стабильный идентификатор адаптера: livedigital, google, freedompay, ... */
  id: string
  name: string
  category: IntegrationCategory
  description: string
  /** Документация официального API провайдера. */
  docsUrl: string
  /**
   * Имена переменных окружения, которые нужны адаптеру.
   * Здесь только имена: значения секретов не покидают сервер.
   */
  envVars: string[]
}

export interface IntegrationProbe {
  /** Сервис ответил и готов принимать запросы. */
  ok: boolean
  /** Ответ получен, но часть возможностей недоступна (например, локальный диск вместо S3). */
  degraded?: boolean
  /** Короткое пояснение без секретов и токенов. */
  message?: string
}

export interface IntegrationAdapter {
  readonly descriptor: IntegrationDescriptor
  /** Обязательные переменные окружения, которых не хватает. */
  missingEnv(): string[]
  isConfigured(): boolean
  /**
   * Установка соединения: обмен токена, рукопожатие и т.п.
   * Необязателен: адаптеры без отдельного рукопожатия сразу проверяются probe().
   */
  connect?(): Promise<void>
  /** Проверка доступности. Не должна раскрывать секреты в тексте ошибки. */
  probe(): Promise<IntegrationProbe>
}

export interface IntegrationHealth {
  id: string
  name: string
  category: IntegrationCategory
  configured: boolean
  status: IntegrationHealthStatus
  /** Названия отсутствующих переменных, без значений. */
  missingEnv: string[]
  latencyMs: number | null
  message: string | null
  checkedAt: string
}
