import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AppError } from '../../../lib/errors.js'
import { verifyStepUpToken } from '../../../lib/security.js'
import { STEP_UP_KEY, type AuthUser } from '../decorators.js'

/**
 * Повторная проверка личности перед важными операциями.
 *
 * Клиент вводит пароль в `POST /api/auth/step-up`, получает токен на 10 минут
 * и передаёт его в заголовке `X-Step-Up-Token`. Токен привязан к пользователю.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [context.getHandler(), context.getClass()])
    if (!required) return true

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>
      user?: AuthUser
    }>()
    const header = request.headers['x-step-up-token']
    const token = Array.isArray(header) ? header[0] : header
    if (!token) {
      throw new AppError(403, 'STEP_UP_REQUIRED', 'Для этой операции подтвердите пароль повторно')
    }
    try {
      if (verifyStepUpToken(token) !== request.user?.userId) {
        throw new Error('Токен другого пользователя')
      }
    } catch {
      throw new AppError(403, 'STEP_UP_REQUIRED', 'Подтверждение устарело, введите пароль ещё раз')
    }
    return true
  }
}
