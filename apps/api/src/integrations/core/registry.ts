import { recordIntegrationEvent } from './event-log.js'
import { IntegrationError, safeErrorMessage } from './errors.js'
import { withRetry } from './retry.js'
import type { IntegrationAdapter, IntegrationHealth, IntegrationHealthStatus } from './types.js'

/**
 * Реестр адаптеров внешних сервисов.
 *
 * Проверка доступности никогда не выбрасывает исключение наружу: результат
 * приводится к единому статусу (ok / degraded / not_configured / unreachable),
 * а каждая попытка попадает в журнал IntegrationEvent.
 */
export class IntegrationRegistry {
  constructor(private readonly adapters: IntegrationAdapter[]) {}

  list() {
    return this.adapters.map((adapter) => ({
      ...adapter.descriptor,
      configured: adapter.isConfigured(),
      missingEnv: adapter.missingEnv(),
    }))
  }

  get(id: string): IntegrationAdapter | null {
    return this.adapters.find((adapter) => adapter.descriptor.id === id) ?? null
  }

  async check(id: string, actorId: string | null = null): Promise<IntegrationHealth> {
    const adapter = this.get(id)
    if (!adapter) {
      throw new IntegrationError(id, 'ADAPTER_NOT_FOUND', `Адаптер ${id} не зарегистрирован`, { status: 404 })
    }

    const configured = adapter.isConfigured()
    const missingEnv = adapter.missingEnv()
    const checkedAt = new Date().toISOString()
    const base = {
      id,
      name: adapter.descriptor.name,
      category: adapter.descriptor.category,
      configured,
      missingEnv,
      checkedAt,
    }

    if (!configured) {
      const message = missingEnv.length
        ? `Не заданы переменные окружения: ${missingEnv.join(', ')}`
        : 'Интеграция не настроена'
      await recordIntegrationEvent({
        provider: id,
        action: 'health_check',
        status: 'SKIPPED',
        message,
        metadata: { missingEnv },
        actorId,
      })
      return { ...base, status: 'not_configured', latencyMs: null, message }
    }

    const started = performance.now()
    try {
      if (adapter.connect) {
        await withRetry(() => adapter.connect!(), {
          attempts: 2,
          onAttemptFailed: (error, attempt, delayMs) =>
            console.warn(`[integrations] ${id}: попытка ${attempt} не удалась, повтор через ${delayMs} мс`, safeErrorMessage(error, 160)),
        })
        await recordIntegrationEvent({ provider: id, action: 'connect', status: 'OK', actorId })
      }

      const probe = await adapter.probe()
      const latencyMs = Math.round(performance.now() - started)
      const status: IntegrationHealthStatus = probe.ok ? (probe.degraded ? 'degraded' : 'ok') : 'unreachable'
      await recordIntegrationEvent({
        provider: id,
        action: 'health_check',
        status: probe.ok ? 'OK' : 'FAILED',
        durationMs: latencyMs,
        message: probe.message ?? null,
        actorId,
      })
      return { ...base, status, latencyMs, message: probe.message ?? null }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - started)
      const message = safeErrorMessage(error)
      await recordIntegrationEvent({
        provider: id,
        action: 'health_check',
        status: 'FAILED',
        durationMs: latencyMs,
        message,
        actorId,
      })
      return { ...base, status: 'unreachable', latencyMs, message }
    }
  }

  async checkAll(actorId: string | null = null): Promise<IntegrationHealth[]> {
    return Promise.all(this.adapters.map((adapter) => this.check(adapter.descriptor.id, actorId)))
  }
}
