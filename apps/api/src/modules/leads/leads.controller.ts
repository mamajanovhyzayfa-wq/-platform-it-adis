import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentUser, Public, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { badRequest } from '../../lib/errors.js'
import {
  LeadsService,
  leadCreateSchema,
  leadUpdateSchema,
  leadsQuerySchema,
  type LeadCreateInput,
  type LeadUpdateInput,
  type LeadsQuery,
} from './leads.service.js'

function parseQuery(raw: Record<string, unknown>): LeadsQuery {
  const result = leadsQuerySchema.safeParse(raw)
  if (!result.success) {
    throw badRequest(
      'Некорректные параметры фильтра',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return result.data
}

/**
 * Заявки.
 *
 * POST открыт для лендинга, но ограничен по частоте: 5 заявок за 10 минут с IP.
 * Остальные операции — только для менеджера и администратора филиала.
 */
@Controller('api/leads')
export class LeadsController {
  // @Inject делает зависимость явной: контроллер работает и без emitDecoratorMetadata.
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 10 * 60 * 1000 } })
  @Post()
  create(@Body(zodBody(leadCreateSchema)) body: LeadCreateInput) {
    return this.leads.create(body)
  }

  @Roles('MANAGER', 'ADMIN')
  @Get('stats')
  stats() {
    return this.leads.stats()
  }

  @Roles('MANAGER', 'ADMIN')
  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.leads.list(parseQuery(query))
  }

  @Roles('MANAGER', 'ADMIN')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(leadUpdateSchema)) body: LeadUpdateInput,
  ) {
    return this.leads.update(id, body, user.userId)
  }
}
