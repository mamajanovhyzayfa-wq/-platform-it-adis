import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { RoleName } from '@prisma/client'
import { z } from 'zod'
import { badRequest, forbidden, notFound, unauthorized } from '../../../lib/errors.js'
import { writeAudit } from '../../../lib/audit.js'
import { hashPassword, verifyPassword } from '../../../lib/security.js'
import { registerDeviceToken, unregisterDeviceToken } from '../../../lib/push.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { RbacService } from '../../rbac/rbac.service.js'
import { AuthService, toPublicUser, type PublicUser } from '../auth/auth.service.js'

export const patchMeSchema = z
  .object({
    firstName: z.string().trim().min(2).max(60).optional(),
    lastName: z.string().trim().min(2).max(60).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{9,15}$/)
      .nullable()
      .optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    locale: z.enum(['ru', 'ky', 'en']).optional(),
    timezone: z.string().max(64).optional(),
    bio: z.string().max(500).nullable().optional(),
  })
  .strict()

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128).regex(/\d/, 'Нужна хотя бы одна цифра'),
})

/** Токен Expo Push, полученный приложением у expo-notifications. */
export const pushTokenSchema = z
  .object({
    deviceId: z.string().trim().min(3).max(120),
    platform: z.enum(['ios', 'android', 'web']),
    pushToken: z.string().trim().min(10).max(4096),
  })
  .strict()

export const deviceIdSchema = z
  .object({
    deviceId: z.string().trim().min(3).max(120),
  })
  .strict()

export type PatchMeInput = z.infer<typeof patchMeSchema>
export type PushTokenInput = z.infer<typeof pushTokenSchema>

export interface ProfileResponse extends PublicUser {
  profile: {
    bio: string | null
    timezone: string
    guardianName: string | null
    guardianPhone: string | null
    guardianConsentAt: Date | null
  } | null
  coinBalance: number
  courses: Array<{
    enrollmentId: string
    progress: number
    status: string
    course: { id: string; title: string; coverUrl: string | null; level: string; teacher: string }
  }>
}

/**
 * Профиль пользователя: чтение, редактирование, смена пароля, курсы и ученики.
 * Все методы работают только с данными из access-токена либо проверяют права.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /** Эффективные права текущей роли — по ним клиент скрывает недоступные разделы. */
  async getEffectivePermissions(role: RoleName): Promise<{ role: RoleName; permissions: string[] }> {
    const permissions = await this.rbac.getPermissions(role)
    return { role, permissions: [...permissions].sort() }
  }

  async getProfile(userId: string): Promise<ProfileResponse> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        coinBalance: true,
        enrollments: {
          include: { course: { include: { teacher: { select: { firstName: true, lastName: true } } } } },
        },
      },
    })
    if (!user || user.deletedAt) throw unauthorized('Аккаунт недоступен')

    return {
      ...toPublicUser(user),
      profile: user.profile
        ? {
            bio: user.profile.bio,
            timezone: user.profile.timezone,
            guardianName: user.profile.guardianName,
            guardianPhone: user.profile.guardianPhone,
            guardianConsentAt: user.profile.guardianConsentAt,
          }
        : null,
      coinBalance: user.coinBalance?.balance ?? 0,
      courses: user.enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        progress: enrollment.progress,
        status: enrollment.status,
        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          coverUrl: enrollment.course.coverUrl,
          level: enrollment.course.level,
          teacher: `${enrollment.course.teacher.firstName} ${enrollment.course.teacher.lastName}`,
        },
      })),
    }
  }

  async updateProfile(userId: string, input: PatchMeInput): Promise<ProfileResponse> {
    const { timezone, bio, ...userFields } = input

    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...userFields,
        profile: timezone !== undefined || bio !== undefined ? { update: { timezone, bio } } : undefined,
      },
    })

    await writeAudit({ actorId: userId, action: 'user.profile.updated', entity: 'user', entityId: userId })
    return this.getProfile(userId)
  }

  /**
   * Регистрация токена устройства для push-уведомлений.
   * Токен привязан к паре (пользователь, устройство), поэтому вход другим аккаунтом
   * на том же устройстве переназначает доставку без дублей.
   */
  async registerPushToken(userId: string, input: PushTokenInput): Promise<{ registered: boolean }> {
    await registerDeviceToken({ userId, ...input })
    return { registered: true }
  }

  async removePushToken(userId: string, deviceId: string): Promise<{ registered: boolean }> {
    await unregisterDeviceToken(userId, deviceId)
    return { registered: false }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } })
    if (!user) throw unauthorized()

    const ok = await verifyPassword(currentPassword, user.passwordHash)
    if (!ok) throw badRequest('Текущий пароль неверен')

    await this.prisma.client.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    })
    // Смена пароля завершает все активные сессии.
    await this.auth.logoutAll(userId)
    await writeAudit({ actorId: userId, action: 'user.password.changed', entity: 'user', entityId: userId })
  }

  async getMyCourses(userId: string) {
    const enrollments = await this.prisma.client.courseEnrollment.findMany({
      where: { studentId: userId },
      include: {
        course: {
          include: {
            teacher: { select: { firstName: true, lastName: true } },
            modules: { include: { lessons: { select: { id: true } } } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    })

    return {
      items: enrollments.map((enrollment) => ({
        id: enrollment.course.id,
        title: enrollment.course.title,
        description: enrollment.course.description,
        coverUrl: enrollment.course.coverUrl,
        level: enrollment.course.level,
        status: enrollment.status,
        progress: enrollment.progress,
        teacher: `${enrollment.course.teacher.firstName} ${enrollment.course.teacher.lastName}`,
        lessonsCount: enrollment.course.modules.reduce((sum, module) => sum + module.lessons.length, 0),
      })),
    }
  }

  async getMyStudents(userId: string, role: RoleName) {
    if (role !== 'TEACHER' && role !== 'ADMIN') throw forbidden('Раздел доступен преподавателю')

    const enrollments = await this.prisma.client.courseEnrollment.findMany({
      where: role === 'ADMIN' ? {} : { course: { teacherId: userId } },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true, lastLoginAt: true },
        },
        course: { select: { title: true } },
      },
      orderBy: { enrolledAt: 'desc' },
    })

    return {
      items: enrollments.map((enrollment) => ({
        id: enrollment.student.id,
        firstName: enrollment.student.firstName,
        lastName: enrollment.student.lastName,
        email: enrollment.student.email,
        avatarUrl: enrollment.student.avatarUrl,
        courseTitle: enrollment.course.title,
        progress: enrollment.progress,
        lastActivity: enrollment.student.lastLoginAt,
      })),
    }
  }

  /** Публичная карточка пользователя: ученик видит только себя. */
  async getById(targetId: string, requesterId: string, requesterRole: RoleName) {
    if (requesterRole === 'STUDENT' && requesterId !== targetId) throw notFound('Пользователь не найден')

    const user = await this.prisma.client.user.findFirst({
      where: { id: targetId, deletedAt: null },
      include: { profile: true, coinBalance: true },
    })
    if (!user) throw notFound('Пользователь не найден')

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      avatarUrl: user.avatarUrl,
      bio: user.profile?.bio ?? null,
      coinBalance: user.coinBalance?.balance ?? 0,
      createdAt: user.createdAt,
    }
  }

  /** Обезличивание: персональные данные удаляются, аккаунт помечается удалённым. */
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@itadis.invalid`,
          phone: null,
          firstName: 'Удалённый',
          lastName: 'Пользователь',
          avatarUrl: null,
          passwordHash: await hashPassword(randomUUID()),
          isActive: false,
          deletedAt: new Date(),
        },
      }),
      this.prisma.client.userProfile.deleteMany({ where: { userId } }),
      this.prisma.client.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.client.userDevice.deleteMany({ where: { userId } }),
    ])

    await writeAudit({ actorId: userId, action: 'user.deleted', entity: 'user', entityId: userId })
  }
}
