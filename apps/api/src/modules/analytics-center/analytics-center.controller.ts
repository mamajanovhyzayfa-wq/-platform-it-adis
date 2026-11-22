import { Controller, Get, Inject, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { badRequest } from '../../lib/errors.js'
import { AnalyticsCenterService } from './analytics-center.service.js'

const rangeSchema = z
  .object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() })
  .strict()

/** Аналитический центр: один маршрут, разный набор данных по роли из токена. */
@Controller('api/analytics-center')
export class AnalyticsCenterController {
  constructor(@Inject(AnalyticsCenterService) private readonly analytics: AnalyticsCenterService) {}

  @Roles('STUDENT', 'TEACHER', 'MANAGER', 'ADMIN')
  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query() rawQuery: Record<string, unknown>) {
    const result = rangeSchema.safeParse(rawQuery)
    if (!result.success) throw badRequest('Проверьте период аналитики', result.error.issues)
    return this.analytics.overview(user, result.data)
  }
}
