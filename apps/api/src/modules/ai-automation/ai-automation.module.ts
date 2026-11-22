import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const aiAutomationOptions: ReadModelOptions = {
  slug: 'ai-automation',
  model: 'aiAutomation',
  entity: 'AI-автоматизация',
  roles: ['ADMIN', 'MANAGER'],
  searchFields: ['name', 'description', 'triggerType'],
  querySchema: z.object({ enabled: z.enum(['true', 'false']).optional() }),
  filters: (query) => (query.enabled ? { enabled: query.enabled === 'true' } : {}),
  select: {
    id: true,
    name: true,
    description: true,
    enabled: true,
    triggerType: true,
    triggerConfig: true,
    conditions: true,
    actions: true,
    schedule: true,
    requiresApproval: true,
    createdById: true,
    lastRunAt: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { runs: true } },
  },
  orderBy: { createdAt: 'desc' },
}

const AiAutomationService = createReadService(aiAutomationOptions)
const AiAutomationController = createReadController(aiAutomationOptions, AiAutomationService)

@Module({ controllers: [AiAutomationController], providers: [AiAutomationService] })
export class AIAutomationModule {}

/** Публичное имя домена из ТЗ; класс остаётся прежним для обратной совместимости. */
export { AIAutomationModule as AiAutomationModule }
