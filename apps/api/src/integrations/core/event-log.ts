import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { safeErrorMessage } from './errors.js'
import { redact } from './secrets.js'

/**
 * Журнал событий интеграций.
 *
 * Хранит только метаданные: провайдер, действие, результат, длительность,
 * количество попыток и очищенное сообщение. Секреты и тела запросов с
 * токенами сюда не попадают. Ошибка записи журнала не ломает основной запрос.
 */
type IntegrationEventAction = 'health_check' | 'connect' | 'request' | 'webhook' | 'config'

type IntegrationEventOutcome = 'OK' | 'FAILED' | 'SKIPPED'

interface IntegrationEventInput {
  provider: string
  action: IntegrationEventAction
  status: IntegrationEventOutcome
  attempts?: number
  durationMs?: number | null
  message?: string | null
  metadata?: Record<string, unknown> | null
  actorId?: string | null
}

export async function recordIntegrationEvent(input: IntegrationEventInput): Promise<void> {
  try {
    await prisma.integrationEvent.create({
      data: {
        provider: input.provider,
        action: input.action,
        status: input.status,
        attempts: input.attempts ?? 1,
        durationMs: input.durationMs ?? null,
        message: input.message ? safeErrorMessage(input.message, 500) : null,
        metadata: input.metadata ? (redact(input.metadata) as Prisma.InputJsonValue) : undefined,
        actorId: input.actorId ?? null,
      },
    })
  } catch (error) {
    console.error('[integrations] не удалось записать событие журнала', input.provider, input.action, error)
  }
}
