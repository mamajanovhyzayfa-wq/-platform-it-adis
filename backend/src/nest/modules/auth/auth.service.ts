import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { RoleName, User } from '@prisma/client'
import { APP_ENV } from '../../config/app-config.module.js'
import type { Env } from '../../../config/env.js'
import { conflict, unauthorized } from '../../../lib/errors.js'
import { writeAudit } from '../../../lib/audit.js'
import { sendMail } from '../../../lib/mailer.js'
import {
  hashPassword,
  newRefreshToken,
  refreshExpiryDate,
  sha256,
  signAccessToken,
  verifyPassword,
} from '../../../lib/security.js'
import type { LoginInput, RegisterInput } from '../../../modules/auth/auth.schemas.js'
import { PrismaService } from '../../prisma/prisma.service.js'

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

  private async issueTokens(user: User, meta: RequestMeta, family: string = randomUUID()): Promise<TokenPair> {
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
      accessToken: signAccessToken({ sub: user.id, role: user.role, email: user.email }),
      refreshToken,
      expiresIn: this.env.ACCESS_TOKEN_TTL,
    }
  }

  async register(input: RegisterInput, meta: RequestMeta): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const existing = await this.prisma.client.user.findFirst({
      where: { OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])] },
      select: { id: true },
    })
    if (existing) throw conflict('Пользователь с таким email или телефоном уже зарегистрирован')

    const passwordHash = await hashPassword(input.password)
    const isMinor =
      input.birthDate !== undefined && (Date.now() - input.birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000) < 18

    const user = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          birthDate: input.birthDate,
          locale: input.locale,
          role: 'STUDENT',
          profile: {
            create: {
              guardianName: isMinor ? input.guardianName : null,
              guardianPhone: isMinor ? input.guardianPhone : null,
              guardianConsentAt: isMinor ? new Date() : null,
            },
          },
          studentProfile: { create: {} },
          coinBalance: { create: { balance: 0 } },
          consents: {
            create: [
              { type: 'TERMS', documentVersion: '1.0', granted: true, ip: meta.ip ?? null },
              { type: 'PRIVACY', documentVersion: '1.0', granted: true, ip: meta.ip ?? null },
              { type: 'DATA_PROCESSING', documentVersion: '1.0', granted: true, ip: meta.ip ?? null },
            ],
          },
        },
      })

      if (meta.deviceId && meta.platform) {
        await tx.userDevice.create({
          data: { userId: created.id, deviceId: meta.deviceId, platform: meta.platform },
        })
      }

      return created
    })

    await writeAudit({
      actorId: user.id,
      action: 'auth.register',
      entity: 'user',
      entityId: user.id,
      ip: meta.ip ?? null,
    })
    const tokens = await this.issueTokens(user, meta)
    return { user: toPublicUser(user), tokens }
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const isEmail = input.identifier.includes('@')
    const user = await this.prisma.client.user.findFirst({
      where: isEmail
        ? { email: input.identifier.toLowerCase() }
        : { phone: input.identifier.replace(/[^\d+]/g, '') },
    })

    if (!user || user.deletedAt || !user.isActive) {
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
      await writeAudit({
        actorId: user.id,
        action: 'auth.login.failed',
        entity: 'user',
        entityId: user.id,
        ip: meta.ip ?? null,
      })
      throw unauthorized('Неверный email/телефон или пароль')
    }

    await this.prisma.client.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    if (meta.deviceId && meta.platform) {
      await this.prisma.client.userDevice.upsert({
        where: { userId_deviceId: { userId: user.id, deviceId: meta.deviceId } },
        update: { lastSeenAt: new Date(), platform: meta.platform },
        create: { userId: user.id, deviceId: meta.deviceId, platform: meta.platform },
      })
    }

    const tokens = await this.issueTokens(user, meta)
    await writeAudit({ actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip: meta.ip ?? null })
    return { user: toPublicUser(user), tokens }
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const session = await this.prisma.client.refreshSession.findUnique({ where: { tokenHash: sha256(refreshToken) } })
    if (!session) throw unauthorized('Refresh-токен недействителен')

    if (session.revokedAt) {
      // Повторное использование отозванного токена — признак кражи: отзываем семейство.
      await this.prisma.client.refreshSession.updateMany({
        where: { family: session.family, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      await writeAudit({
        actorId: session.userId,
        action: 'auth.refresh.reuse_detected',
        entity: 'refresh_session',
        entityId: session.id,
        ip: meta.ip ?? null,
      })
      throw unauthorized('Сессия отозвана, войдите заново')
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw unauthorized('Срок действия сессии истёк, войдите заново')
    }

    const user = await this.prisma.client.user.findUnique({ where: { id: session.userId } })
    if (!user || !user.isActive || user.deletedAt) throw unauthorized('Аккаунт недоступен')

    await this.prisma.client.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    const tokens = await this.issueTokens(user, meta, session.family)
    return { user: toPublicUser(user), tokens }
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
