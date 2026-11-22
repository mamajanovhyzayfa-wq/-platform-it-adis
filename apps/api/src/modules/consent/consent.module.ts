import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const consentOptions: ReadModelOptions = {
  slug: 'consents',
  model: 'consentRecord',
  entity: 'Согласие',
  roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'],
  scope: (user) => (user.role === 'ADMIN' ? {} : { userId: user.userId }),
  querySchema: z.object({ type: z.string().max(40).optional(), granted: z.enum(['true', 'false']).optional() }),
  filters: (query) => ({
    ...(query.type ? { type: query.type } : {}),
    ...(query.granted ? { granted: query.granted === 'true' } : {}),
  }),
  select: {
    id: true,
    userId: true,
    type: true,
    documentVersion: true,
    granted: true,
    ip: true,
    createdAt: true,
    user: { select: { id: true, firstName: true, lastName: true, email: true } },
  },
  orderBy: { createdAt: 'desc' },
}

const ConsentService = createReadService(consentOptions)
const ConsentController = createReadController(consentOptions, ConsentService)

@Module({ controllers: [ConsentController], providers: [ConsentService] })
export class ConsentModule {}
