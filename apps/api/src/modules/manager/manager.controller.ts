import { Controller, Get, Query } from '@nestjs/common'
import { Roles } from '../../nest/common/decorators.js'
import { badRequest } from '../../lib/errors.js'
import {
  ManagerService,
  managerStudentsQuerySchema,
  type ManagerStudentsQuery,
} from './manager.service.js'

function parseQuery(raw: Record<string, unknown>): ManagerStudentsQuery {
  const result = managerStudentsQuerySchema.safeParse(raw)
  if (!result.success) {
    throw badRequest(
      'Некорректные параметры фильтра',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return result.data
}

/** Кабинет менеджера: операционная сводка и справочник учеников. */
@Roles('MANAGER', 'ADMIN')
@Controller('api/manager')
export class ManagerController {
  constructor(private readonly manager: ManagerService) {}

  @Get('overview')
  overview() {
    return this.manager.overview()
  }

  @Get('students')
  students(@Query() query: Record<string, unknown>) {
    return this.manager.students(parseQuery(query))
  }
}
