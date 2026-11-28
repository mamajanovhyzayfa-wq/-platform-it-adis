import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'
import { CookiePolicyController } from './cookie-policy.controller.js'

const cookieTypes = ['COOKIES', 'COOKIE_ANALYTICS', 'COOKIE_FUNCTIONAL', 'COOKIE_MARKETING'] as const

const cookieConsentOptions: ReadModelOptions = {
  slug: 'cookie-consents',
  model: 'consentRecord',
  entity: 'Cookie-согласие',
  roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'],
  baseWhere: { type: { in: [...cookieTypes] } },
  scope: (user) => (user.role === 'ADMIN' ? {} : { userId: user.userId }),
  querySchema: z.object({ type: z.enum(cookieTypes).optional() }),
  filters: (query) => (query.type ? { type: query.type } : {}),
  select: {
    id: true,
    userId: true,
    type: true,
    documentVersion: true,
    granted: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'desc' },
}

const CookieConsentService = createReadService(cookieConsentOptions)
const CookieConsentController = createReadController(cookieConsentOptions, CookieConsentService)

@Module({
  controllers: [CookiePolicyController, CookieConsentController],
  providers: [CookieConsentService],
})
export class CookieModule {}
