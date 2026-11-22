import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY, type AuthUser } from '../decorators.js'
import { AppError, unauthorized } from '../../../lib/errors.js'
import { verifyAccessToken } from '../../../lib/security.js'
import { getTenant } from '../../../lib/tenant.js'
import { ACTIVE_ROLE_HEADER, isStandardRole, readActiveRoleHeader } from '../../../lib/roles.js'
import { resolveActiveRole } from '../../../lib/active-role.js'

/**
 * Проверяет Bearer access-токен и кладёт пользователя в запрос.
 *
 * Глобальный guard: закрыты все маршруты, кроме помеченных @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  // @Inject делает зависимость явной: guard работает и без emitDecoratorMetadata.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown>; user?: AuthUser }>()
    const header = request.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw unauthorized('Не передан access-токен')
    }

    try {
      const payload = verifyAccessToken(header.slice(7))
      if (!payload.role || typeof payload.sub !== 'string') {
        throw unauthorized('Требуется токен пользователя филиала')
      }
      const tenant = getTenant()
      if (tenant) {
        if (payload.branchId && payload.branchId !== tenant.branchId) {
          throw unauthorized('Токен выдан для другого филиала')
        }
        if (!payload.branchId && !tenant.isPrimary) {
          throw unauthorized('Токен не привязан к филиалу, войдите заново')
        }
      }
      const requestedRole = readActiveRoleHeader(request.headers[ACTIVE_ROLE_HEADER])
      const finish = (role: typeof payload.role): boolean => {
        request.user = { userId: payload.sub, role, primaryRole: payload.role, email: payload.email }
        return true
      }
      // Для основной роли не нужен запрос к БД. Дополнительная роль проверяется
      // по подтверждённому UserRoleGrant в текущем филиале.
      if (!requestedRole || requestedRole === payload.role || !isStandardRole(requestedRole)) {
        return finish(payload.role)
      }
      return resolveActiveRole(payload.sub, payload.role, requestedRole).then(finish)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw unauthorized('Access-токен истёк или недействителен')
    }
  }
}
