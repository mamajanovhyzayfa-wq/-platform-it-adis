import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { RoleName, User } from '@prisma/client'
import { APP_ENV } from '../../nest/config/app-config.module.js'
import type { Env } from '../../config/env.js'
import { notFound, unauthorized } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { sendMail } from '../../lib/mailer.js'
import {
  hashPassword,
  newRefreshToken,
  refreshExpiryDate,
  sha256,
  signAccessToken,
  signTwoFactorChallenge,
  verifyPassword,
} from '../../lib/security.js'
import { notifySuspiciousLogin, notifySuspiciousSession } from '../../lib/security-alerts.js'
import {
  accountFailureKey,
  clearFailedLogins,
  failedLoginKey,
  isCaptchaRequired,
  isLoginLocked,
  recordFailedLogin,
  verifyCaptcha,
} from '../../lib/captcha.js'
import { AppError } from '../../lib/errors.js'
import type { LoginInput } from '../../modules/auth/auth.schemas.js'
import { getTenant } from '../../lib/tenant.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'

export interface RequestMeta {
  ip?: string | null
  userAgent?: string | null
  deviceId?: string
  platform?: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: string
}

export interface PublicUser {
  id: string
  email: string
  phone: string | null
  firstName: string
  lastName: string
  role: RoleName
  avatarUrl: string | null
  locale: string
  emailVerifiedAt: Date | null
  createdAt: Date
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  }
}

/**
 * Аутентификация: регистрация, вход, ротация refresh-токенов, сброс пароля.
 *
 * Refresh-токены хранятся как sha256-хэши и объединены в семейство (family):
 * повторное использование отозванного токена означает кражу — тогда отзывается
 * всё семейство сессий.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /** Выпуск пары токенов. Публичный: им пользуются приглашения и OAuth-вход. */
  async issueTokens(user: User, meta: RequestMeta, family: string = randomUUID()): Promise<TokenPair> {
    const tenant = getTenant()
    const refreshToken = newRefreshToken()
    await this.prisma.client.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        family,
        expiresAt: refreshExpiryDate(),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    })

    return {
      accessToken: signAccessToken({
        sub: user.id,
        role: user.role,
        email: user.email,
        ...(tenant ? { branchId: tenant.branchId } : {}),
      }),
      refreshToken,
      expiresIn: this.env.ACCESS_TOKEN_TTL,
    }
  }

  /**
   * Общее завершение входа после пароля, второго фактора или OAuth.
   *
   * Здесь фиксируются устройство и IP, выпускаются токены и отправляется
   * уведомление о подозрительном входе. Один путь нужен, чтобы 2FA и OAuth
   * не обходили защиту и не пропускали оповещения.
   */
  async completeLogin(
    user: User,
    meta: RequestMeta,
    action: 'auth.login' | 'auth.2fa.login' | 'auth.oauth.google' | 'auth.oauth.apple',
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const knownDevice = meta.deviceId
      ? await this.prisma.client.userDevice.findUnique({
          where: { userId_deviceId: { userId: user.id, deviceId: meta.deviceId } },
          select: { id: true },
        })
      : null
    const knownIp = meta.ip
      ? await this.prisma.client.refreshSession.findFirst({
          where: { userId: user.id, ip: meta.ip },
          select: { id: true },
        })
      : null

    await this.prisma.client.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    if (meta.deviceId && meta.platform) {
      await this.prisma.client.userDevice.upsert({
        where: { userId_deviceId: { userId: user.id, deviceId: meta.deviceId } },
        update: { lastSeenAt: new Date(), platform: meta.platform },
        create: { userId: user.id, deviceId: meta.deviceId, platform: meta.platform },
      })
    }

    const tokens = await this.issueTokens(user, meta)
    await writeAudit({ actorId: user.id, action, entity: 'user', entityId: user.id, ip: meta.ip ?? null })

    if (!knownDevice || !knownIp) {
      await notifySuspiciousLogin({
        userId: user.id,
        email: user.email,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        newDevice: !knownDevice,
        newIp: !knownIp,
      })
    }

    return { user: toPublicUser(user), tokens }
  }

  async login(
    input: LoginInput,
    meta: RequestMeta,
  ): Promise<{ user: PublicUser; tokens: TokenPair } | { twoFactorRequired: true; challengeToken: string }> {
    const captchaKey = failedLoginKey(meta.ip, input.identifier)
    const accountKey = accountFailureKey(input.identifier)
    if (isLoginLocked(captchaKey) || isLoginLocked(accountKey)) {
      throw new AppError(429, 'LOGIN_LOCKED', 'Слишком много неудачных попыток. Повторите вход через 15 минут')
    }
    if (isCaptchaRequired(captchaKey) && !verifyCaptcha(input.captchaId, input.captchaAnswer)) {
      throw new AppError(400, 'CAPTCHA_REQUIRED', 'Подтвердите, что вы не робот, и повторите вход')
    }

    const isEmail = input.identifier.includes('@')
    const user = await this.prisma.client.user.findFirst({
      where: isEmail
        ? { email: input.identifier.toLowerCase() }
        : { phone: input.identifier.replace(/[^\d+]/g, '') },
    })

    if (!user || user.deletedAt || !user.isActive) {
      recordFailedLogin(captchaKey)
      recordFailedLogin(accountKey)
      await writeAudit({
        action: 'auth.login.failed',
        entity: 'user',
        metadata: { identifier: input.identifier },
        ip: meta.ip ?? null,
      })
      throw unauthorized('Неверный email/телефон или пароль')
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash)
    if (!passwordOk) {
      recordFailedLogin(captchaKey)
      recordFailedLogin(accountKey)
      await writeAudit({
        actorId: user.id,
        action: 'auth.login.failed',
        entity: 'user',
        entityId: user.id,
        ip: meta.ip ?? null,
      })
      throw unauthorized('Неверный email/телефон или пароль')
    }

    clearFailedLogins(captchaKey)
    clearFailedLogins(accountKey)

    if (user.twoFactorEnabledAt) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.login.2fa_required',
        entity: 'user',
        entityId: user.id,
        ip: meta.ip ?? null,
      })
      return { twoFactorRequired: true, challengeToken: signTwoFactorChallenge(user.id) }
    }

    return this.completeLogin(user, meta, 'auth.login')
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const session = await this.prisma.client.refreshSession.findUnique({ where: { tokenHash: sha256(refreshToken) } })
    if (!session) throw unauthorized('Refresh-токен недействителен')

    if (session.revokedAt) {
      // Повторное использование отозванного токена — признак кражи. Завершаем
      // все сессии аккаунта, а не только семейство: украденный токен мог быть
      // уже использован для входа в другом месте.
      await this.prisma.client.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      const user = await this.prisma.client.user.findUnique({
        where: { id: session.userId },
        select: { email: true },
      })
      await writeAudit({
        actorId: session.userId,
        action: 'auth.refresh.reuse_detected',
        entity: 'refresh_session',
        entityId: session.id,
        metadata: { allSessionsRevoked: true },
        ip: meta.ip ?? null,
      })
      if (user) {
        await notifySuspiciousSession({
          userId: session.userId,
          email: user.email,
          reason: 'token_reuse',
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        })
      }
      throw unauthorized('Сессия отозвана, войдите заново')
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw unauthorized('Срок действия сессии истёк, войдите заново')
    }

    const user = await this.prisma.client.user.findUnique({ where: { id: session.userId } })
    if (!user || !user.isActive || user.deletedAt) throw unauthorized('Аккаунт недоступен')

    // Смена и IP, и клиента одновременно — нетипичное поведение для ротации
    // токена. Завершаем сессии и требуем повторный вход.
    if (
      session.ip &&
      meta.ip &&
      session.ip !== meta.ip &&
      session.userAgent &&
      meta.userAgent &&
      session.userAgent !== meta.userAgent
    ) {
      await this.prisma.client.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      await writeAudit({
        actorId: session.userId,
        action: 'auth.refresh.fingerprint_changed',
        entity: 'refresh_session',
        entityId: session.id,
        metadata: { previousIp: session.ip, newIp: meta.ip },
        ip: meta.ip ?? null,
      })
      await notifySuspiciousSession({
        userId: session.userId,
        email: user.email,
        reason: 'fingerprint_changed',
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      })
      throw unauthorized('Сессия завершена из-за смены устройства. Войдите заново')
    }

    await this.prisma.client.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    const tokens = await this.issueTokens(user, meta, session.family)
    return { user: toPublicUser(user), tokens }
  }

  /** Активные сессии пользователя: без refresh-токенов и их хешей. */
  async listSessions(userId: string) {
    const sessions = await this.prisma.client.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
    })
    return {
      items: sessions.map((session) => ({
        ...session,
        current: false,
      })),
    }
  }

  /** Завершение отдельной сессии; чужой идентификатор не раскрывается. */
  async revokeSession(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    const session = await this.prisma.client.refreshSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
      select: { id: true },
    })
    if (!session) throw notFound('Сессия не найдена или уже завершена')
    await this.prisma.client.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    })
    await writeAudit({
      actorId: userId,
      action: 'auth.session.revoked',
      entity: 'refresh_session',
      entityId: session.id,
      ip: meta.ip ?? null,
    })
  }

  async logout(refreshToken: string, meta: RequestMeta): Promise<void> {
    const session = await this.prisma.client.refreshSession.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    })
    if (!session) return
    await this.prisma.client.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    await writeAudit({
      actorId: session.userId,
      action: 'auth.logout',
      entity: 'refresh_session',
      entityId: session.id,
      ip: meta.ip ?? null,
    })
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.client.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await writeAudit({ actorId: userId, action: 'auth.logout_all', entity: 'user', entityId: userId })
  }

  /** Не раскрывает, зарегистрирован ли email: ответ всегда одинаковый. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { email } })
    if (!user) return

    const token = newRefreshToken()
    await this.prisma.client.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    })

    const link = `${this.env.APP_ORIGIN}/reset-password?token=${token}`
    await sendMail({
      to: user.email,
      subject: 'Сброс пароля ITadis',
      text: `Ссылка для сброса пароля действует 30 минут: ${link}`,
    })
    await writeAudit({ actorId: user.id, action: 'auth.password.reset_requested', entity: 'user', entityId: user.id })
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.prisma.client.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } })
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw unauthorized('Ссылка сброса пароля недействительна или устарела')
    }

    const passwordHash = await hashPassword(password)
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.client.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.client.refreshSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])

    await writeAudit({ actorId: record.userId, action: 'auth.password.reset', entity: 'user', entityId: record.userId })
  }
}
