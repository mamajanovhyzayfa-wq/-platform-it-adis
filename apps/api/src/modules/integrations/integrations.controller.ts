import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { IntegrationsService } from './integrations.service.js'

/**
 * Управление интеграциями доступно только администратору филиала.
 * Ответы не содержат значений токенов и ключей — только имена переменных.
 */
@Controller('api/integrations')
export class IntegrationsController {
  constructor(@Inject(IntegrationsService) private readonly integrations: IntegrationsService) {}

  @Get()
  @Roles('ADMIN')
  list() {
    return this.integrations.list()
  }

  @Get('status')
  @Roles('ADMIN')
  status() {
    return this.integrations.status()
  }

  @Get('events')
  @Roles('ADMIN')
  events(@Query() query: Record<string, unknown>) {
    return this.integrations.events(query)
  }

  @Post('check-all')
  @Roles('ADMIN')
  checkAll(@CurrentUser() user: AuthUser) {
    return this.integrations.checkAll(user)
  }

  @Post('accounting/entries')
  @Roles('ADMIN')
  exportToAccounting(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.integrations.exportToAccounting(body, user)
  }

  @Post(':id/check')
  @Roles('ADMIN')
  check(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.integrations.check(id, user)
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.integrations.update(id, body, user)
  }
}
