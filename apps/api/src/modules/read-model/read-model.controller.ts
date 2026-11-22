import { Controller, Get, Inject, Param, Query, type Type } from '@nestjs/common'
import { CurrentUser, Roles, type AuthUser } from '../../nest/common/decorators.js'
import type { ReadModelOptions } from './read-model.types.js'

interface DomainReadService {
  listDomain: (query: Record<string, unknown>, user: AuthUser) => Promise<unknown>
  oneDomain: (id: string) => Promise<unknown>
}

/** Фабрика контроллера: маршруты и RBAC задаются один раз в описании модуля. */
export function createReadController(options: ReadModelOptions, serviceToken: Type<DomainReadService>) {
  @Controller(`api/${options.slug}`)
  class DomainReadController {
    constructor(@Inject(serviceToken) private readonly service: DomainReadService) {}

    @Get()
    @Roles(...options.roles)
    list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
      return this.service.listDomain(query, user)
    }

    @Get(':id')
    @Roles(...options.roles)
    one(@Param('id') id: string) {
      return this.service.oneDomain(id)
    }
  }

  return DomainReadController
}
