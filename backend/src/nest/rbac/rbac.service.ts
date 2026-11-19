import { Inject, Injectable, Logger } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service.js'

/** Время жизни кеша прав роли: изменения в БД подхватываются без перезапуска. */
const CACHE_TTL_MS = 60_000

export interface RoleSummary {
  code: RoleName
  name: string
  description: string | null
  permissions: string[]
}

/**
 * Читает каталог ролей и привязанные к ним права из БД.
 * Права кешируются на минуту — guard не ходит в БД на каждый запрос.
 */
@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name)
  private readonly cache = new Map<RoleName, { permissions: Set<string>; expiresAt: number }>()

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPermissions(role: RoleName): Promise<Set<string>> {
    const cached = this.cache.get(role)
    if (cached && cached.expiresAt > Date.now()) return cached.permissions

    const links = await this.prisma.client.rolePermission.findMany({
      where: { role },
      select: { permission: { select: { code: true } } },
    })
    const permissions = new Set(links.map((link) => link.permission.code))
    this.cache.set(role, { permissions, expiresAt: Date.now() + CACHE_TTL_MS })
    return permissions
  }

  /** Полный список ролей с правами — используется админкой и проверками. */
  async listRoles(): Promise<RoleSummary[]> {
    const roles = await this.prisma.client.role.findMany({
      orderBy: { code: 'asc' },
      include: { permissions: { include: { permission: { select: { code: true } } } } },
    })
    return roles.map((role) => ({
      code: role.code,
      name: role.name,
      description: role.description,
      permissions: role.permissions.map((link) => link.permission.code).sort(),
    }))
  }

  /** Сбрасывает кеш — вызывается после изменения прав роли в админке. */
  invalidate(role?: RoleName): void {
    if (role) this.cache.delete(role)
    else this.cache.clear()
    this.logger.debug('Кеш прав сброшен')
  }
}
