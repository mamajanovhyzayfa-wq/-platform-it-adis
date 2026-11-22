import { Controller, Get, Query } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { ReportsService } from './reports.service.js'

@Controller('api/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview')
  @Roles('ADMIN', 'MANAGER')
  overview(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    return this.reports.overview(query, user.role)
  }

  @Get('finance')
  @Roles('ADMIN')
  finance(@Query() query: Record<string, unknown>) {
    return this.reports.finance(query)
  }

  @Get('academic')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  academic(@Query() query: Record<string, unknown>) {
    return this.reports.academic(query)
  }
}
