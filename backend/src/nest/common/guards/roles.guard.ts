import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { RoleName } from '@prisma/client'
import { ROLES_KEY, type AuthUser } from '../decorators.js'
import { forbidden, unauthorized } from '../../../lib/errors.js'

/** Проверяет, что роль пользователя входит в список @Roles(...). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [context.getHandler(), context.getClass()])
    if (!roles?.length) return true

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>()
    if (!request.user) throw unauthorized()
    if (!roles.includes(request.user.role)) throw forbidden('Роль не имеет доступа к этому разделу')
    return true
  }
}
