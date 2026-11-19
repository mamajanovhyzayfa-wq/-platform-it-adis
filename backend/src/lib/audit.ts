import { prisma } from './prisma.js'

interface AuditInput {
  actorId?: string | null
  action: string
  entity: string
  entityId?: string | null
  metadata?: Record<string, unknown>
  ip?: string | null
}

/** Критические действия пишутся в audit_logs; ошибка аудита не должна ломать основной запрос. */
export async function writeAudit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        metadata: input.metadata ? (input.metadata as never) : undefined,
        ip: input.ip ?? null,
      },
    })
  } catch (error) {
    console.error('[audit] не удалось записать событие', input.action, error)
  }
}
