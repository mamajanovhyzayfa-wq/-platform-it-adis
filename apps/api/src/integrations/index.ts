import { accountingAdapter } from './adapters/accounting.adapter.js'
import { aiAdapter } from './adapters/ai.adapter.js'
import { appleCalendarAdapter } from './adapters/apple-calendar.adapter.js'
import { appleAdapter } from './adapters/apple.adapter.js'
import { apyHubAdapter } from './adapters/apyhub.adapter.js'
import { emailAdapter } from './adapters/email.adapter.js'
import { googleCalendarAdapter } from './adapters/google-calendar.adapter.js'
import { googleAdapter } from './adapters/google.adapter.js'
import { liveDigitalAdapter } from './adapters/livedigital.adapter.js'
import { outlookAdapter } from './adapters/outlook.adapter.js'
import { paymentIntegrationAdapters } from './adapters/payments.adapter.js'
import { pushAdapter } from './adapters/push.adapter.js'
import { smsAdapter } from './adapters/sms.adapter.js'
import { storageAdapter } from './adapters/storage.adapter.js'
import { IntegrationRegistry } from './core/registry.js'

/**
 * Единственный реестр внешних сервисов платформы.
 *
 * Адаптеры не знают о Nest и Express: их можно вызывать из любого модуля.
 * Секреты берутся из переменных окружения сервера, поэтому этот файл
 * импортируется только в backend.
 */
export const integrationRegistry = new IntegrationRegistry([
  liveDigitalAdapter,
  googleAdapter,
  appleAdapter,
  emailAdapter,
  apyHubAdapter,
  smsAdapter,
  pushAdapter,
  googleCalendarAdapter,
  appleCalendarAdapter,
  outlookAdapter,
  ...paymentIntegrationAdapters,
  accountingAdapter,
  aiAdapter,
  storageAdapter,
])

export { IntegrationRegistry } from './core/registry.js'
export { IntegrationError, isTransientError, safeErrorMessage } from './core/errors.js'
export { retryDelay, withRetry } from './core/retry.js'
export { isSecretName, maskTail, missingVariables, readSecret, redact, REDACTED } from './core/secrets.js'
export { recordIntegrationEvent } from './core/event-log.js'
export { probeHttp, requestJson } from './core/http.js'
export type {
  IntegrationAdapter,
  IntegrationCategory,
  IntegrationDescriptor,
  IntegrationHealth,
  IntegrationHealthStatus,
  IntegrationProbe,
} from './core/types.js'
