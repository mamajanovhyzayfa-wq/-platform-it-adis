import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { RoleName } from '@prisma/client'
import { ROLES_KEY, type AuthUser } from '../decorators.js'
import { forbidden, unauthorized } from '../../../lib/errors.js'
import { getTenant } from '../../../lib/tenant.js'

/** Проверяет, что роль пользователя входит в список @Roles(...). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [context.getHandler(), context.getClass()])
    if (!roles?.length) return true

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>()
    if (!request.user) throw unauthorized()
    if (roles.includes(request.user.role)) return true
    // Дополнительные роли: только подтверждённые администратором записи UserRoleGrant из БД.
    const tenant = getTenant()
    if (!tenant) throw forbidden('Роль не имеет доступа к этому разделу')
    const granted = await tenant.prisma.userRoleGrant.findFirst({
      where: { userId: request.user.userId, role: { in: roles }, status: 'APPROVED' },
      select: { id: true },
    })
    if (!granted) throw forbidden('Роль не имеет доступа к этому разделу')
    return true
  }
}
