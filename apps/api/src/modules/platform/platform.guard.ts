import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { env } from '../../config/env.js'
import { forbidden, unauthorized } from '../../lib/errors.js'
import { normalizeHost } from '../../lib/branch-registry.js'
import { verifyPlatformToken } from '../../lib/security.js'

export function assertPlatformHost(host: string): void {
  // В production консоль не должна открываться на домене филиала, даже если
  // пароль главного администратора каким-то образом стал известен.
  if (!env.PLATFORM_DOMAIN) {
    if (env.NODE_ENV === 'production') {
      throw forbidden('PLATFORM_DOMAIN не настроен: консоль главного администратора отключена')
    }
    return
  }
  if (normalizeHost(host) !== normalizeHost(env.PLATFORM_DOMAIN)) {
    throw forbidden('Консоль главного администратора доступна только на домене управления')
  }
}

@Injectable()
export class PlatformGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    assertPlatformHost(request.hostname)

    const header = request.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw unauthorized('Требуется вход в консоль главного администратора')
    }

    try {
      verifyPlatformToken(header.slice(7))
    } catch {
      throw unauthorized('Токен консоли недействителен или истёк')
    }
    return true
  }
}
