import { Injectable, Logger, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PERMISSIONS_KEY, type AuthUser } from '../decorators.js'
import { forbidden, unauthorized } from '../../../lib/errors.js'
import { RbacService } from '../../rbac/rbac.service.js'

/**
 * Проверяет права, привязанные к роли в БД (@RequirePermissions).
 * Роли без нужного права получают 403 — это дополняет грубую проверку RolesGuard.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required?.length) return true

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>()
    if (!request.user) throw unauthorized()

    const granted = await this.rbac.getPermissions(request.user.role)
    const missing = required.filter((permission) => !granted.has(permission))
    if (missing.length) {
      this.logger.warn(`Роль ${request.user.role} без прав: ${missing.join(', ')}`)
      throw forbidden(`Недостаточно прав: ${missing.join(', ')}`)
    }
    return true
  }
}
