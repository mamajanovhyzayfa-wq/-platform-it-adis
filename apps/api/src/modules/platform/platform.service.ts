import { Injectable } from '@nestjs/common'
import { env } from '../../config/env.js'
import { AppError, unauthorized } from '../../lib/errors.js'
import { safeCompare, signPlatformToken, verifyPassword } from '../../lib/security.js'
import { assertPlatformHost } from './platform.guard.js'

@Injectable()
export class PlatformService {
  async login(host: string, email: string, password: string) {
    assertPlatformHost(host)
    if (!env.PLATFORM_ADMIN_PASSWORD && !env.PLATFORM_ADMIN_PASSWORD_HASH) {
      throw new AppError(
        503,
        'PLATFORM_LOGIN_DISABLED',
        'Вход в консоль не настроен: задайте PLATFORM_ADMIN_PASSWORD или PLATFORM_ADMIN_PASSWORD_HASH',
      )
    }

    const emailOk = safeCompare(email.toLowerCase(), env.PLATFORM_ADMIN_EMAIL.toLowerCase())
    const passwordOk = env.PLATFORM_ADMIN_PASSWORD_HASH
      ? await verifyPassword(password, env.PLATFORM_ADMIN_PASSWORD_HASH)
      : safeCompare(password, env.PLATFORM_ADMIN_PASSWORD ?? '')
    if (!emailOk || !passwordOk) {
      throw unauthorized('Неверный email или пароль главного администратора')
    }

    return {
      token: signPlatformToken(env.PLATFORM_ADMIN_EMAIL),
      email: env.PLATFORM_ADMIN_EMAIL,
      expiresIn: '4h',
    }
  }
}
