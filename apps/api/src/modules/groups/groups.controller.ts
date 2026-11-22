import { Controller, Get, Param, Query } from '@nestjs/common'
import { Roles } from '../../nest/common/decorators.js'
import { GroupsService } from './groups.service.js'

@Controller('api/groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  list(@Query() query: Record<string, unknown>) {
    return this.groups.list(query)
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  one(@Param('id') id: string) {
    return this.groups.one(id)
  }
}
