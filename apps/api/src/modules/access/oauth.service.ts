import { Inject, Injectable } from '@nestjs/common'
import { createPublicKey, type JsonWebKey } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { APP_ENV } from '../../nest/config/app-config.module.js'
import type { Env } from '../../config/env.js'
import { AppError, unauthorized } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { signTwoFactorChallenge } from '../../lib/security.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { AuthService, type RequestMeta } from '../auth/auth.service.js'

type OAuthProvider = 'google' | 'apple'

interface ProviderProfile {
  email: string
  firstName: string
  lastName: string
  emailVerified: boolean
}

function notConfigured(provider: OAuthProvider) {
  return new AppError(
    503,
    'OAUTH_NOT_CONFIGURED',
    `Вход через ${provider === 'google' ? 'Google' : 'Apple'} не настроен: администратор платформы должен задать client id`,
  )
}

/**
 * Вход через Google и Apple по ID-токену, полученному на клиенте.
 *
 * Токен проверяется на сервере: Google — через tokeninfo, Apple — по подписи JWKS.
 * Незнакомый email не создаёт аккаунт: возвращается признак registrationRequired,
 * и человек отправляет заявку на регистрацию, как и при обычной регистрации.
 */
@Injectable()
export class OAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private async verifyGoogle(idToken: string): Promise<ProviderProfile> {
    const clientId = this.env.GOOGLE_CLIENT_ID
    if (!clientId) throw notConfigured('google')

    let response: Response
    try {
      response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      throw new AppError(503, 'OAUTH_UNAVAILABLE', 'Google недоступен, попробуйте позже')
    }
    if (!response.ok) throw unauthorized('Google не подтвердил токен')

    const payload = (await response.json()) as {
      aud?: string
      email?: string
      email_verified?: string | boolean
      given_name?: string
      family_name?: string
      name?: string
    }
    if (payload.aud !== clientId || !payload.email) throw unauthorized('Токен выдан другому приложению')
    if (payload.email_verified === false || payload.email_verified === 'false') {
      throw unauthorized('Email в Google не подтверждён')
    }

    return {
      email: payload.email.toLowerCase(),
      firstName: payload.given_name ?? payload.name?.split(' ')[0] ?? 'Пользователь',
      lastName: payload.family_name ?? payload.name?.split(' ').slice(1).join(' ') ?? '',
      emailVerified: true,
    }
  }

  private async verifyApple(idToken: string): Promise<ProviderProfile> {
    const clientId = this.env.APPLE_CLIENT_ID
    if (!clientId) throw notConfigured('apple')

    const decoded = jwt.decode(idToken, { complete: true })
    if (!decoded || typeof decoded === 'string') throw unauthorized('Apple не подтвердил токен')
    const kid = decoded.header.kid
    if (!kid) throw unauthorized('Apple не подтвердил токен')

    let keys: { keys: JsonWebKey[] }
    try {
      const response = await fetch('https://appleid.apple.com/auth/keys', { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error(String(response.status))
      keys = (await response.json()) as { keys: JsonWebKey[] }
    } catch {
      throw new AppError(503, 'OAUTH_UNAVAILABLE', 'Apple недоступен, попробуйте позже')
    }

    const jwk = keys.keys.find((key) => key.kid === kid)
    if (!jwk) throw unauthorized('Ключ подписи Apple не найден')

    const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    let payload: jwt.JwtPayload
    try {
      payload = jwt.verify(idToken, pem, {
        algorithms: ['RS256'],
        audience: clientId,
        issuer: 'https://appleid.apple.com',
      }) as jwt.JwtPayload
    } catch {
      throw unauthorized('Apple не подтвердил токен')
    }

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
    if (!email) throw unauthorized('Apple не передал email')

    return {
      email,
      firstName: 'Пользователь',
      lastName: 'Apple',
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    }
  }

  async login(provider: OAuthProvider, idToken: string, meta: RequestMeta) {
    const profile = provider === 'google' ? await this.verifyGoogle(idToken) : await this.verifyApple(idToken)

    const user = await this.prisma.client.user.findUnique({ where: { email: profile.email } })
    if (!user || user.deletedAt || !user.isActive) {
      return {
        registrationRequired: true as const,
        provider,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
      }
    }

    if (!user.emailVerifiedAt && profile.emailVerified) {
      await this.prisma.client.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })
    }
    if (user.twoFactorEnabledAt) {
      await writeAudit({
        actorId: user.id,
        action: `auth.oauth.${provider}.2fa_required`,
        entity: 'user',
        entityId: user.id,
        ip: meta.ip ?? null,
      })
      return { twoFactorRequired: true as const, challengeToken: signTwoFactorChallenge(user.id) }
    }
    return this.auth.completeLogin(user, meta, `auth.oauth.${provider}`)
  }
}
