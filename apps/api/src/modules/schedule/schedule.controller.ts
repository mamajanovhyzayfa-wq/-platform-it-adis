import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { badRequest } from '../../lib/errors.js'
import {
  ScheduleService,
  scheduleCreateSchema,
  scheduleQuerySchema,
  type ScheduleCreateInput,
  type ScheduleQuery,
} from './schedule.service.js'

/** Ошибка в query должна быть 400, а не 500: клиент присылает диапазон дат. */
function parseQuery(raw: Record<string, unknown>): ScheduleQuery {
  const result = scheduleQuerySchema.safeParse(raw)
  if (!result.success) {
    throw badRequest(
      'Некорректный период расписания',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return result.data
}

/** Расписание занятий: чтение по роли, создание — только преподаватель своего курса. */
@Controller('api/schedule')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    return this.schedule.list(user.userId, user.role, parseQuery(query))
  }

  @Roles('TEACHER', 'ADMIN')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(zodBody(scheduleCreateSchema)) body: ScheduleCreateInput) {
    return this.schedule.create(body, user.userId, user.role)
  }
}
