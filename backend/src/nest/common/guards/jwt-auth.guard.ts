import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY, type AuthUser } from '../decorators.js'
import { AppError, unauthorized } from '../../../lib/errors.js'
import { verifyAccessToken } from '../../../lib/security.js'

/**
 * Проверяет Bearer access-токен и кладёт пользователя в запрос.
 *
 * Глобальный guard: закрыты все маршруты, кроме помеченных @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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
      request.user = { userId: payload.sub, role: payload.role, email: payload.email }
      return true
    } catch (error) {
      if (error instanceof AppError) throw error
      throw unauthorized('Access-токен истёк или недействителен')
    }
  }
}
