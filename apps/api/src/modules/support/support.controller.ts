import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import {
  supportCreateSchema,
  supportUpdateSchema,
  type SupportCreateInput,
  type SupportUpdateInput,
} from './support.dto.js'
import { SupportService } from './support.service.js'

@Controller('api/support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(supportCreateSchema)) body: SupportCreateInput,
  ) {
    return this.support.create(user, body)
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    return this.support.list(user, query)
  }

  @Get(':id')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.one(user, id)
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(supportUpdateSchema)) body: SupportUpdateInput,
  ) {
    return this.support.update(user, id, body)
  }
}
