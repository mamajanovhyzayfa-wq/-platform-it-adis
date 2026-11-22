import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const auditOptions: ReadModelOptions = {
  slug: 'audit',
  model: 'auditLog',
  entity: 'Запись аудита',
  roles: ['ADMIN'],
  searchFields: ['action', 'entity', 'entityId'],
  querySchema: z.object({
    action: z.string().trim().max(80).optional(),
    entity: z.string().trim().max(80).optional(),
    actorId: z.string().uuid().optional(),
  }),
  filters: (query) => ({
    ...(query.action ? { action: query.action } : {}),
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
  }),
  select: {
    id: true,
    actorId: true,
    action: true,
    entity: true,
    entityId: true,
    metadata: true,
    ip: true,
    createdAt: true,
    actor: { select: { id: true, firstName: true, lastName: true, email: true } },
  },
  orderBy: { createdAt: 'desc' },
}

const AuditService = createReadService(auditOptions)
const AuditController = createReadController(auditOptions, AuditService)

@Module({ controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
