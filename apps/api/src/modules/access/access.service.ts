import { Inject, Injectable } from '@nestjs/common'
import { randomBytes, randomInt } from 'node:crypto'
import type { RoleName } from '@prisma/client'
import { APP_ENV } from '../../nest/config/app-config.module.js'
import type { Env } from '../../config/env.js'
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { sendMail } from '../../lib/mailer.js'
import { sendSms } from '../../lib/sms.js'
import { hashPassword, sha256, verifyPassword, verifyTwoFactorChallenge } from '../../lib/security.js'
import { generateTotpSecret, totpUri, verifyTotpCode } from '../../lib/totp.js'
import { decryptSensitive, encryptSensitive } from '../../lib/crypto.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { AuthService, toPublicUser, type PublicUser, type RequestMeta, type TokenPair } from '../auth/auth.service.js'
import type {
  InvitationAcceptInput,
  InvitationCreateInput,
  RegistrationApplyInput,
} from '../../modules/access/access.schemas.js'

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Нарушение уникального индекса PostgreSQL (Prisma P2002). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

function inviteCode(): string {
  let code = ''
  for (let index = 0; index < 8; index += 1) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]
  return code
}

/** Временный пароль, который администратор передаёт пользователю лично. */
function temporaryPassword(): string {
  return `It${randomBytes(6).toString('base64url')}7`
}

/** Подтверждение представителя хранится в consentVersions заявки. */
function guardianWasConfirmed(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).guardian)
}

/**
 * Регистрация через заявку, приглашения, двухфакторная аутентификация и
 * восстановление доступа.
 *
 * Самостоятельная регистрация не создаёт аккаунт: она создаёт заявку, которую
 * рассматривает администратор филиала. Приглашение, выданное администратором,
 * считается предварительным одобрением и создаёт аккаунт сразу.
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  // ---------- заявки на регистрацию ----------

  async apply(input: RegistrationApplyInput, meta: RequestMeta) {
    const existing = await this.prisma.client.user.findFirst({
      where: { OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])] },
      select: { id: true },
    })
    if (existing) throw conflict('Аккаунт с таким email или телефоном уже существует')

    const pending = await this.prisma.client.registrationRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])],
      },
      select: { id: true },
    })
    if (pending) throw conflict('Заявка уже отправлена и ждёт рассмотрения администратором')

    let inviteId: string | null = null
    let invitedRole: RoleName | null = null
    if (input.inviteCode) {
      const invitation = await this.findInvitation(input.inviteCode)
      this.assertInvitationContact(invitation, input.email, input.phone)
      inviteId = invitation.id
      invitedRole = invitation.role
    }

    // Вставка атомарна: частичный уникальный индекс `lower(email)` для PENDING
    // превращает вторую одновременную заявку в P2002, а не в дубль в очереди.
    const created = await this.prisma.client.registrationRequest
      .create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone ?? null,
          passwordHash: await hashPassword(input.password),
          requestedRole: invitedRole ?? input.role,
          message: input.message ?? null,
          birthDate: input.birthDate,
          guardianName: input.guardianName ? encryptSensitive(input.guardianName) : null,
          guardianPhone: input.guardianPhone ? encryptSensitive(input.guardianPhone) : null,
          locale: input.locale,
          inviteId,
          consentAcceptedAt: new Date(),
          consentVersions: {
            terms: '1.2',
            privacy: '1.2',
            dataProcessing: '1.2',
            marketing: input.acceptMarketing ? '1.0' : null,
            guardian: input.guardianConsent ? '1.1' : null,
          },
          marketingOptIn: input.acceptMarketing,
          ip: meta.ip ?? null,
        },
        select: { id: true, status: true, email: true, createdAt: true },
      })
      .catch((error: unknown): never => {
        if (isUniqueViolation(error)) {
          throw conflict('Заявка с таким email уже отправлена и ждёт рассмотрения администратором')
        }
        throw error
      })

    await writeAudit({
      action: 'registration.request',
      entity: 'RegistrationRequest',
      entityId: created.id,
      metadata: { email: created.email, role: input.role },
      ip: meta.ip ?? null,
    })
    await sendMail({
      to: created.email,
      subject: 'ITadis: заявка на регистрацию получена',
      text: 'Здравствуйте! Заявка на регистрацию получена. Администратор филиала рассмотрит её и сообщит о решении.',
    })

    return {
      id: created.id,
      status: created.status,
      message: 'Заявка отправлена. Администратор филиала рассмотрит её.',
    }
  }

  async listRegistrations(status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL') {
    const items = await this.prisma.client.registrationRequest.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        requestedRole: true,
        message: true,
        birthDate: true,
        guardianName: true,
        guardianPhone: true,
        locale: true,
        status: true,
        inviteId: true,
        createdAt: true,
        decidedAt: true,
        rejectReason: true,
      },
    })
    return items.map((item) => ({
      ...item,
      guardianName: decryptSensitive(item.guardianName),
      guardianPhone: decryptSensitive(item.guardianPhone),
    }))
  }

  async decideRegistration(adminId: string, requestId: string, approve: boolean, reason?: string) {
    const request = await this.prisma.client.registrationRequest.findUnique({ where: { id: requestId } })
    if (!request) throw notFound('Заявка не найдена')
    if (request.status !== 'PENDING') throw conflict('Заявка уже рассмотрена')

    if (!approve) {
      const rejected = await this.prisma.client.registrationRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', decidedById: adminId, decidedAt: new Date(), rejectReason: reason ?? null },
        select: { id: true, status: true },
      })
      await sendMail({
        to: request.email,
        subject: 'ITadis: заявка на регистрацию отклонена',
        text: `К сожалению, заявка отклонена.${reason ? ` Причина: ${reason}` : ''} Обратитесь в филиал, чтобы обсудить детали.`,
      })
      await writeAudit({
        actorId: adminId,
        action: 'registration.reject',
        entity: 'RegistrationRequest',
        entityId: requestId,
        metadata: { email: request.email },
      })
      return rejected
    }

    const duplicate = await this.prisma.client.user.findFirst({
      where: {
        OR: [{ email: request.email }, ...(request.phone ? [{ phone: request.phone }] : [])],
      },
      select: { id: true },
    })
    if (duplicate) throw conflict('Пользователь с таким email уже существует')

    // Заявка по приглашению должна погасить именно это приглашение, иначе
    // код можно было бы использовать повторно после одобрения.
    const invitation = request.inviteId
      ? await this.prisma.client.invitation.findUnique({ where: { id: request.inviteId } })
      : null
    if (invitation?.usedAt) throw conflict('Приглашение уже использовано')

    const user = await this.createAccount({
      firstName: request.firstName,
      lastName: request.lastName,
      email: request.email,
      phone: request.phone,
      passwordHash: request.passwordHash,
      role: request.requestedRole,
      emailVerified: true,
      birthDate: request.birthDate,
      guardianName: decryptSensitive(request.guardianName),
      guardianPhone: decryptSensitive(request.guardianPhone),
      guardianConfirmed: guardianWasConfirmed(request.consentVersions),
      locale: request.locale,
    })

    await this.prisma.client.$transaction([
      this.prisma.client.registrationRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', decidedById: adminId, decidedAt: new Date() },
      }),
      ...(invitation
        ? [
            this.prisma.client.invitation.update({
              where: { id: invitation.id },
              data: { usedAt: new Date(), usedById: user.id },
            }),
          ]
        : []),
    ])
    await sendMail({
      to: user.email,
      subject: 'ITadis: регистрация подтверждена',
      text: `Здравствуйте, ${user.firstName}! Регистрация подтверждена. Войдите на страницу входа филиала со своим email и паролем.`,
    })
    await writeAudit({
      actorId: adminId,
      action: 'registration.approve',
      entity: 'RegistrationRequest',
      entityId: requestId,
      metadata: { userId: user.id, role: user.role },
    })

    return { id: requestId, status: 'APPROVED' as const, userId: user.id }
  }

  // ---------- приглашения ----------

  async createInvitation(actorId: string, input: InvitationCreateInput) {
    const token = randomBytes(24).toString('base64url')
    const code = inviteCode()
    const invitation = await this.prisma.client.invitation.create({
      data: {
        token,
        code,
        channel: input.channel,
        role: input.role,
        email: input.email ?? null,
        phone: input.phone ?? null,
        note: input.note ?? null,
        createdById: actorId,
        expiresAt: new Date(Date.now() + input.ttlHours * 60 * 60 * 1000),
      },
    })

    const link = `${this.env.APP_ORIGIN}/join?code=${code}`
    const text = `Приглашение в ITadis. Код: ${code}. Ссылка: ${link}. Действует ${input.ttlHours} ч.`
    if (input.channel === 'EMAIL' && input.email) {
      await sendMail({ to: input.email, subject: 'Приглашение в ITadis', text })
    }
    if (input.channel === 'PHONE' && input.phone) {
      await sendSms({ to: input.phone, text })
    }
    await writeAudit({
      actorId,
      action: 'invitation.create',
      entity: 'Invitation',
      entityId: invitation.id,
      metadata: { channel: input.channel, role: input.role },
    })

    return invitation
  }

  listInvitations() {
    return this.prisma.client.invitation.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  }

  private async findInvitation(codeOrToken: string) {
    const invitation = await this.prisma.client.invitation.findFirst({
      where: { OR: [{ code: codeOrToken }, { token: codeOrToken }] },
    })
    if (!invitation) throw notFound('Приглашение не найдено')
    if (invitation.usedAt) throw conflict('Приглашение уже использовано')
    if (invitation.expiresAt.getTime() < Date.now()) throw badRequest('Срок действия приглашения истёк')
    return invitation
  }

  async previewInvitation(codeOrToken: string) {
    const invitation = await this.findInvitation(codeOrToken)
    return {
      code: invitation.code,
      role: invitation.role,
      email: invitation.email,
      phone: invitation.phone,
      expiresAt: invitation.expiresAt,
      note: invitation.note,
    }
  }

  /** Приглашение на email/телефон нельзя использовать с чужими контактами. */
  private assertInvitationContact(
    invitation: { email: string | null; phone: string | null },
    email: string,
    phone?: string | null,
  ) {
    if (invitation.email && invitation.email.toLowerCase() !== email.toLowerCase()) {
      throw forbidden('Приглашение выдано на другой email')
    }
    if (invitation.phone) {
      const expected = invitation.phone.replace(/\D/g, '')
      const actual = (phone ?? '').replace(/\D/g, '')
      if (!actual || actual !== expected) throw forbidden('Приглашение выдано на другой телефон')
    }
  }

  async acceptInvitation(input: InvitationAcceptInput, meta: RequestMeta): Promise<{
    user: PublicUser
    tokens: TokenPair
  }> {
    const invitation = await this.findInvitation(input.code)
    this.assertInvitationContact(invitation, input.email, input.phone)

    const existing = await this.prisma.client.user.findFirst({
      where: { OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])] },
      select: { id: true },
    })
    if (existing) throw conflict('Аккаунт с таким email или телефоном уже существует')

    const user = await this.createAccount({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role: invitation.role,
      emailVerified: invitation.channel === 'EMAIL',
      birthDate: input.birthDate,
      guardianName: input.guardianName,
      guardianPhone: input.guardianPhone,
      guardianConfirmed: input.guardianConsent,
    })

    await this.prisma.client.invitation.update({
      where: { id: invitation.id },
      data: { usedAt: new Date(), usedById: user.id },
    })
    await writeAudit({
      actorId: user.id,
      action: 'invitation.accept',
      entity: 'Invitation',
      entityId: invitation.id,
      ip: meta.ip ?? null,
    })

    const tokens = await this.auth.issueTokens(user, meta)
    return { user: toPublicUser(user), tokens }
  }

  // ---------- аккаунты ----------

  private async createAccount(input: {
    firstName: string
    lastName: string
    email: string
    phone?: string | null
    passwordHash: string
    role: RoleName
    emailVerified: boolean
    birthDate?: Date | null
    guardianName?: string | null
    guardianPhone?: string | null
    guardianConfirmed?: boolean
    locale?: string
  }) {
    const isMinor = input.birthDate ? (Date.now() - input.birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000) < 18 : false
    if (isMinor && (!input.guardianName || !input.guardianPhone || !input.guardianConfirmed)) {
      throw badRequest('Для несовершеннолетнего нужны данные и подтверждение законного представителя')
    }
    return this.prisma.client.user.create({
      data: {
        email: input.email,
        phone: input.phone ?? null,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        birthDate: input.birthDate ?? null,
        locale: input.locale ?? 'ru',
        role: input.role,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
        profile: {
          create: {
            guardianName: isMinor && input.guardianName ? encryptSensitive(input.guardianName) : null,
            guardianPhone: isMinor && input.guardianPhone ? encryptSensitive(input.guardianPhone) : null,
            guardianConsentAt: isMinor && input.guardianConfirmed ? new Date() : null,
          },
        },
        ...(input.role === 'STUDENT'
          ? { studentProfile: { create: {} }, coinBalance: { create: { balance: 0 } } }
          : {}),
        ...(input.role === 'TEACHER' ? { teacherProfile: { create: {} } } : {}),
        ...(input.role === 'PARENT' ? { parentProfile: { create: {} } } : {}),
        consents: {
          create: [
            { type: 'TERMS', documentVersion: '1.2', granted: true },
            { type: 'PRIVACY', documentVersion: '1.2', granted: true },
            { type: 'DATA_PROCESSING', documentVersion: '1.2', granted: true },
            ...(isMinor && input.guardianConfirmed
              ? [{ type: 'GUARDIAN' as const, documentVersion: '1.1', granted: true }]
              : []),
          ],
        },
      },
    })
  }

  /**
   * Сброс доступа администратором: задаёт временный пароль, отзывает все сессии
   * и отправляет пароль пользователю на email. Требует step-up подтверждения.
   */
  async adminResetAccess(adminId: string, targetUserId: string, newPassword?: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: targetUserId } })
    if (!user || user.deletedAt) throw notFound('Пользователь не найден')

    const password = newPassword ?? temporaryPassword()
    const passwordHash = await hashPassword(password)
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.client.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])

    await sendMail({
      to: user.email,
      subject: 'ITadis: доступ восстановлен администратором',
      text: `Администратор филиала установил новый пароль: ${password}. Войдите и сразу смените его. Все активные сессии завершены.`,
    })
    await writeAudit({
      actorId: adminId,
      action: 'access.admin_reset',
      entity: 'user',
      entityId: user.id,
      metadata: { generated: !newPassword },
    })

    return {
      userId: user.id,
      temporaryPassword: newPassword ? null : password,
      message: 'Пароль изменён, сессии завершены, данные отправлены пользователю на email.',
    }
  }

  // ---------- восстановление пароля по email или SMS ----------

  async requestPasswordRecovery(identifier: string, meta: RequestMeta) {
    const isEmail = identifier.includes('@')
    const user = await this.prisma.client.user.findFirst({
      where: isEmail
        ? { email: identifier.toLowerCase() }
        : { phone: identifier.replace(/[^\d+]/g, '') },
    })

    const channel: 'email' | 'sms' = isEmail ? 'email' : 'sms'
    const message = 'Если аккаунт существует, код восстановления отправлен'
    if (!user || user.deletedAt || !user.isActive) return { channel, message }
    if (channel === 'sms' && !user.phone) return { channel, message }

    const code = String(randomInt(100000, 1000000))
    await this.prisma.client.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(code), expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
    })

    if (channel === 'email') {
      await sendMail({
        to: user.email,
        subject: 'ITadis: код восстановления доступа',
        text: `Код восстановления: ${code}. Действует 15 минут. Если вы не запрашивали восстановление, смените пароль.`,
      })
    } else if (user.phone) {
      await sendSms({ to: user.phone, text: `ITadis: код восстановления ${code}. Действует 15 минут.` })
    }
    await writeAudit({
      actorId: user.id,
      action: 'auth.recovery.requested',
      entity: 'user',
      entityId: user.id,
      metadata: { channel },
      ip: meta.ip ?? null,
    })
    return { channel, message }
  }

  async confirmPasswordRecovery(identifier: string, code: string, password: string) {
    const isEmail = identifier.includes('@')
    const user = await this.prisma.client.user.findFirst({
      where: isEmail
        ? { email: identifier.toLowerCase() }
        : { phone: identifier.replace(/[^\d+]/g, '') },
    })
    if (!user) throw badRequest('Код недействителен или истёк')

    const record = await this.prisma.client.passwordResetToken.findFirst({
      where: { userId: user.id, tokenHash: sha256(code), usedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (!record || record.expiresAt.getTime() < Date.now()) {
      throw badRequest('Код недействителен или истёк')
    }

    const passwordHash = await hashPassword(password)
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.client.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.client.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])

    await sendMail({
      to: user.email,
      subject: 'ITadis: пароль изменён',
      text: 'Пароль изменён, все сессии завершены. Если это были не вы, свяжитесь с администратором филиала.',
    })
    await writeAudit({ actorId: user.id, action: 'auth.recovery.confirmed', entity: 'user', entityId: user.id })
  }

  // ---------- двухфакторная аутентификация ----------

  async setupTwoFactor(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabledAt: true },
    })
    if (!user) throw notFound('Пользователь не найден')
    if (user.twoFactorEnabledAt) throw conflict('Двухфакторная аутентификация уже включена')

    const secret = generateTotpSecret()
    await this.prisma.client.user.update({ where: { id: userId }, data: { twoFactorSecret: encryptSensitive(secret) } })
    return { secret, otpauthUrl: totpUri(secret, user.email), digits: 6, periodSeconds: 30 }
  }

  async enableTwoFactor(userId: string, password: string, code: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } })
    if (!user) throw notFound('Пользователь не найден')
    if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Неверный пароль')
    if (user.twoFactorEnabledAt) throw conflict('Двухфакторная аутентификация уже включена')
    const secret = decryptSensitive(user.twoFactorSecret)
    if (!secret) throw badRequest('Сначала запустите настройку: секрет не создан')
    if (!verifyTotpCode(secret, code)) throw badRequest('Неверный код подтверждения')

    const backupCodes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'))
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id: userId }, data: { twoFactorEnabledAt: new Date() } }),
      this.prisma.client.twoFactorBackupCode.deleteMany({ where: { userId } }),
      this.prisma.client.twoFactorBackupCode.createMany({
        data: backupCodes.map((value) => ({ userId, codeHash: sha256(value) })),
      }),
    ])
    await writeAudit({ actorId: userId, action: 'auth.2fa.enabled', entity: 'user', entityId: userId })

    return { backupCodes, message: 'Двухфакторная аутентификация включена. Сохраните резервные коды.' }
  }

  async disableTwoFactor(userId: string, password: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } })
    if (!user) throw notFound('Пользователь не найден')
    if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Неверный пароль')
    if (!user.twoFactorEnabledAt) throw conflict('Двухфакторная аутентификация не включена')

    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: { twoFactorSecret: null, twoFactorEnabledAt: null },
      }),
      this.prisma.client.twoFactorBackupCode.deleteMany({ where: { userId } }),
    ])
    await writeAudit({ actorId: userId, action: 'auth.2fa.disabled', entity: 'user', entityId: userId })
  }

  /** Второй шаг входа: код из приложения или резервный код. */
  async verifyTwoFactor(challengeToken: string, code: string, meta: RequestMeta): Promise<{
    user: PublicUser
    tokens: TokenPair
  }> {
    let userId: string
    try {
      userId = verifyTwoFactorChallenge(challengeToken)
    } catch {
      throw unauthorized('Проверка устарела, войдите заново')
    }

    const user = await this.prisma.client.user.findUnique({ where: { id: userId } })
    if (!user || !user.isActive || user.deletedAt) throw unauthorized('Аккаунт недоступен')
    if (!user.twoFactorEnabledAt || !user.twoFactorSecret) throw badRequest('Двухфакторная аутентификация не включена')

    const secret = decryptSensitive(user.twoFactorSecret)
    if (!secret) throw badRequest('Секрет двухфакторной аутентификации повреждён, настройте её заново')
    let valid = verifyTotpCode(secret, code)
    if (!valid) {
      const backup = await this.prisma.client.twoFactorBackupCode.findFirst({
        where: { userId, codeHash: sha256(code.trim()), usedAt: null },
        select: { id: true },
      })
      if (backup) {
        await this.prisma.client.twoFactorBackupCode.update({
          where: { id: backup.id },
          data: { usedAt: new Date() },
        })
        valid = true
      }
    }

    if (!valid) {
      await writeAudit({
        actorId: userId,
        action: 'auth.2fa.failed',
        entity: 'user',
        entityId: userId,
        ip: meta.ip ?? null,
      })
      throw unauthorized('Неверный код подтверждения')
    }

    // Второй фактор не должен обходить проверку нового устройства/IP и
    // уведомление пользователя о подозрительном входе.
    return this.auth.completeLogin(user, meta, 'auth.2fa.login')
  }

  /** Повторный ввод пароля для важных операций: возвращает короткоживущий токен. */
  async stepUp(userId: string, password: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } })
    if (!user) throw notFound('Пользователь не найден')
    if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Неверный пароль')
    return { message: 'Личность подтверждена на 10 минут' }
  }
}
