import { randomUUID } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { Prisma, type ConsentType } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { hashPassword, verifyStepUpToken } from '../../lib/security.js'
import { decryptSensitive, encryptSensitive } from '../../lib/crypto.js'

/**
 * Согласия, конфиденциальность и удаление аккаунта.
 *
 * Юридические тексты в проекте носят информационный характер и не являются
 * юридическим заключением. Перед публикацией их должен проверить юрист КР.
 */
export const privacyRouter = Router()

type DocumentKey =
  | 'TERMS'
  | 'PRIVACY'
  | 'DATA_PROCESSING'
  | 'COOKIES'
  | 'MARKETING'
  | 'GUARDIAN'
  | 'COOKIE_ANALYTICS'
  | 'COOKIE_FUNCTIONAL'
  | 'COOKIE_MARKETING'

interface ConsentDocument {
  type: DocumentKey
  title: string
  version: string
  effectiveDate: string
  url: string
  required: boolean
  description: string
}

/** Версии документов. При изменении текста увеличьте версию и дату. */
export const CONSENT_DOCUMENTS: ConsentDocument[] = [
  {
    type: 'TERMS',
    title: 'Пользовательское соглашение',
    version: '1.2',
    effectiveDate: '2026-11-22',
    url: '/terms',
    required: true,
    description: 'Правила использования платформы ITadis, права и обязанности сторон.',
  },
  {
    type: 'PRIVACY',
    title: 'Политика конфиденциальности',
    version: '1.2',
    effectiveDate: '2026-11-22',
    url: '/privacy',
    required: true,
    description: 'Какие данные собираются, зачем, кому передаются и как защищаются.',
  },
  {
    type: 'DATA_PROCESSING',
    title: 'Согласие на обработку персональных данных',
    version: '1.2',
    effectiveDate: '2026-11-22',
    url: '/privacy#data-processing',
    required: true,
    description: 'Отдельное согласие на обработку данных для целей обучения.',
  },
  {
    type: 'COOKIES',
    title: 'Политика использования cookie',
    version: '1.1',
    effectiveDate: '2026-11-22',
    url: '/cookies',
    required: false,
    description: 'Необходимые, аналитические, функциональные и маркетинговые cookie.',
  },
  {
    type: 'COOKIE_ANALYTICS',
    title: 'Аналитические cookie',
    version: '1.1',
    effectiveDate: '2026-11-22',
    url: '/cookies#analytics',
    required: false,
    description: 'Обезличенная статистика посещений и использования разделов.',
  },
  {
    type: 'COOKIE_FUNCTIONAL',
    title: 'Функциональные cookie',
    version: '1.1',
    effectiveDate: '2026-11-22',
    url: '/cookies#functional',
    required: false,
    description: 'Запоминание настроек интерфейса и выбранного филиала.',
  },
  {
    type: 'COOKIE_MARKETING',
    title: 'Маркетинговые cookie',
    version: '1.1',
    effectiveDate: '2026-11-22',
    url: '/cookies#marketing',
    required: false,
    description: 'Персонализация предложений и оценка рекламных кампаний.',
  },
  {
    type: 'MARKETING',
    title: 'Маркетинговые сообщения',
    version: '1.0',
    effectiveDate: '2026-11-01',
    url: '/privacy#marketing',
    required: false,
    description: 'Информация об акциях, новых курсах и событиях.',
  },
  {
    type: 'GUARDIAN',
    title: 'Согласие законного представителя',
    version: '1.1',
    effectiveDate: '2026-11-22',
    url: '/privacy#children',
    required: false,
    description: 'Подтверждение родителя или опекуна для обучающегося младше 14 лет.',
  },
]

const documentByType = new Map(CONSENT_DOCUMENTS.map((document) => [document.type, document]))
const consentTypes = new Set<ConsentType>([
  'TERMS',
  'PRIVACY',
  'DATA_PROCESSING',
  'MARKETING',
  'COOKIES',
  'COOKIE_ANALYTICS',
  'COOKIE_FUNCTIONAL',
  'COOKIE_MARKETING',
  'GUARDIAN',
])

const mandatoryTypes = new Set<ConsentType>(['TERMS', 'PRIVACY', 'DATA_PROCESSING'])
const cookieTypes = new Set<ConsentType>(['COOKIE_ANALYTICS', 'COOKIE_FUNCTIONAL', 'COOKIE_MARKETING'])

function ageFromBirthDate(birthDate: Date | null): number | null {
  if (!birthDate) return null
  const now = new Date()
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) age -= 1
  return age
}

function versionFor(type: ConsentType): string {
  return documentByType.get(type as DocumentKey)?.version ?? '1.0'
}

function requireStepUp(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    next(new AppError(401, 'UNAUTHORIZED', 'Требуется авторизация'))
    return
  }
  const token = req.headers['x-step-up-token']
  if (typeof token !== 'string' || !token) {
    next(new AppError(403, 'STEP_UP_REQUIRED', 'Подтвердите действие паролем или кодом 2FA'))
    return
  }
  try {
    if (verifyStepUpToken(token) !== req.auth.userId) {
      next(new AppError(403, 'STEP_UP_INVALID', 'Подтверждение не совпадает с текущим пользователем'))
      return
    }
    next()
  } catch {
    next(new AppError(403, 'STEP_UP_INVALID', 'Подтверждение истекло, повторите ввод пароля'))
  }
}

const consentInput = z.object({
  type: z.enum([
    'TERMS',
    'PRIVACY',
    'DATA_PROCESSING',
    'MARKETING',
    'COOKIES',
    'COOKIE_ANALYTICS',
    'COOKIE_FUNCTIONAL',
    'COOKIE_MARKETING',
    'GUARDIAN',
  ]),
  granted: z.boolean(),
  guardianName: z.string().trim().min(2).max(160).optional(),
  guardianPhone: z.string().trim().min(6).max(30).optional(),
  confirmedByGuardian: z.boolean().optional(),
})

const batchInput = z.object({
  consents: z.array(consentInput).min(1).max(10),
})

const deletionInput = z.object({
  reason: z.string().trim().max(2000).optional(),
})

const reviewInput = z.object({
  approve: z.boolean(),
  comment: z.string().trim().max(2000).optional(),
  legalHold: z.boolean().optional(),
})

async function recordConsent(
  userId: string,
  input: z.infer<typeof consentInput>,
  ip: string | null,
) {
  if (!consentTypes.has(input.type)) throw badRequest('Неизвестный тип согласия')
  if (mandatoryTypes.has(input.type) && !input.granted) {
    throw badRequest('Без согласия с обязательными документами использование платформы невозможно. Для отказа удалите аккаунт.')
  }
  if (cookieTypes.has(input.type) && !input.granted) {
    // Отзыв необязательных cookie фиксируется отдельной записью, без удаления истории.
  }

  if (input.type === 'GUARDIAN') {
    if (input.granted && (!input.guardianName || !input.guardianPhone || !input.confirmedByGuardian)) {
      throw badRequest('Для согласия законного представителя укажите ФИО, телефон и подтверждение')
    }
    await prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        guardianName: input.guardianName ? encryptSensitive(input.guardianName) : null,
        guardianPhone: input.guardianPhone ? encryptSensitive(input.guardianPhone) : null,
        guardianConsentAt: input.granted ? new Date() : null,
      },
      update: {
        ...(input.guardianName ? { guardianName: encryptSensitive(input.guardianName) } : {}),
        ...(input.guardianPhone ? { guardianPhone: encryptSensitive(input.guardianPhone) } : {}),
        guardianConsentAt: input.granted ? new Date() : null,
      },
    })
  }

  const record = await prisma.consentRecord.create({
    data: {
      userId,
      type: input.type,
      documentVersion: versionFor(input.type),
      granted: input.granted,
      ip,
    },
  })

  await writeAudit({
    actorId: userId,
    action: input.granted ? 'privacy.consent.granted' : 'privacy.consent.withdrawn',
    entity: 'consent_record',
    entityId: record.id,
    metadata: { type: input.type, version: record.documentVersion },
    ip,
  })

  return record
}

// Публичный перечень документов и их версий.
privacyRouter.get('/documents', (_req, res) => {
  res.json({ documents: CONSENT_DOCUMENTS })
})

// История согласий текущего пользователя: последнее состояние по каждому типу + полная история.
privacyRouter.get('/consents', requireAuth, async (req, res, next) => {
  try {
    const userId = req.auth!.userId
    const [records, user] = await Promise.all([
      prisma.consentRecord.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          birthDate: true,
          profile: { select: { guardianName: true, guardianPhone: true, guardianConsentAt: true } },
        },
      }),
    ])

    const latest = new Map<string, (typeof records)[number]>()
    for (const record of records) {
      if (!latest.has(record.type)) latest.set(record.type, record)
    }

    const age = ageFromBirthDate(user?.birthDate ?? null)
    res.json({
      documents: CONSENT_DOCUMENTS,
      latest: [...latest.values()],
      history: records,
      age,
      guardianRequired: age !== null && age < 18,
      guardian: user?.profile
        ? {
            name: decryptSensitive(user.profile.guardianName),
            phone: decryptSensitive(user.profile.guardianPhone),
            confirmedAt: user.profile.guardianConsentAt,
          }
        : null,
    })
  } catch (error) {
    next(error)
  }
})

privacyRouter.post('/consents', requireAuth, async (req, res, next) => {
  try {
    const parsed = consentInput.safeParse(req.body)
    if (!parsed.success) throw badRequest('Проверьте тип и значение согласия')
    const record = await recordConsent(req.auth!.userId, parsed.data, req.ip ?? null)
    res.status(201).json({ consent: record })
  } catch (error) {
    next(error)
  }
})

// Пакетная запись нужна cookie-панели, чтобы не отправлять четыре запроса.
privacyRouter.post('/consents/batch', requireAuth, async (req, res, next) => {
  try {
    const parsed = batchInput.safeParse(req.body)
    if (!parsed.success) throw badRequest('Проверьте категории cookie')
    const records = []
    for (const consent of parsed.data.consents) {
      records.push(await recordConsent(req.auth!.userId, consent, req.ip ?? null))
    }
    res.status(201).json({ consents: records })
  } catch (error) {
    next(error)
  }
})

privacyRouter.get('/account-deletion', requireAuth, async (req, res, next) => {
  try {
    const requests = await prisma.accountDeletionRequest.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { requestedAt: 'desc' },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    })
    res.json({ requests })
  } catch (error) {
    next(error)
  }
})

privacyRouter.post('/account-deletion', requireAuth, async (req, res, next) => {
  try {
    const parsed = deletionInput.safeParse(req.body ?? {})
    if (!parsed.success) throw badRequest('Проверьте причину удаления')
    const userId = req.auth!.userId
    const pending = await prisma.accountDeletionRequest.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
    })
    if (pending) throw conflict('Запрос на удаление уже рассматривается')

    const request = await prisma.accountDeletionRequest.create({
      data: {
        userId,
        reason: parsed.data.reason ?? null,
        events: {
          create: { status: 'PENDING', actorId: userId, comment: 'Запрос создан пользователем' },
        },
      },
      include: { events: true },
    })
    await writeAudit({
      actorId: userId,
      action: 'privacy.deletion.requested',
      entity: 'account_deletion_request',
      entityId: request.id,
      ip: req.ip ?? null,
    })
    res.status(201).json({ request })
  } catch (error) {
    next(error)
  }
})

privacyRouter.delete('/account-deletion/:id', requireAuth, async (req, res, next) => {
  try {
    const requestId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    if (!requestId) throw badRequest('Не передан идентификатор запроса')
    const request = await prisma.accountDeletionRequest.findFirst({
      where: { id: requestId, userId: req.auth!.userId },
    })
    if (!request) throw notFound('Запрос не найден')
    if (request.status !== 'PENDING') throw conflict('Запрос уже обработан')
    const updated = await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: 'CANCELLED',
        reviewedAt: new Date(),
        events: { create: { status: 'CANCELLED', actorId: req.auth!.userId, comment: 'Отменён пользователем' } },
      },
    })
    await writeAudit({
      actorId: req.auth!.userId,
      action: 'privacy.deletion.cancelled',
      entity: 'account_deletion_request',
      entityId: request.id,
      ip: req.ip ?? null,
    })
    res.json({ request: updated })
  } catch (error) {
    next(error)
  }
})

// Администрирование запросов. Список доступен только ADMIN.
privacyRouter.get(
  '/admin/account-deletion',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const requests = await prisma.accountDeletionRequest.findMany({
        where: status && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)
          ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' }
          : undefined,
        orderBy: { requestedAt: 'desc' },
        take: 200,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
              role: true,
              createdAt: true,
              deletedAt: true,
            },
          },
          events: { orderBy: { createdAt: 'asc' } },
          reviewedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      })
      res.json({ requests })
    } catch (error) {
      next(error)
    }
  },
)

privacyRouter.patch(
  '/admin/account-deletion/:id',
  requireAuth,
  requireRole('ADMIN'),
  requireStepUp,
  async (req, res, next) => {
    try {
      const parsed = reviewInput.safeParse(req.body)
      if (!parsed.success) throw badRequest('Укажите решение по запросу')
      const adminId = req.auth!.userId
      const requestId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
      if (!requestId) throw badRequest('Не передан идентификатор запроса')
      const request = await prisma.accountDeletionRequest.findUnique({
        where: { id: requestId },
        include: { user: true },
      })
      if (!request) throw notFound('Запрос не найден')
      if (request.status !== 'PENDING') throw conflict('Запрос уже обработан')
      if (parsed.data.approve && parsed.data.legalHold) {
        throw badRequest('Нельзя удалить данные, удерживаемые по закону. Отклоните запрос с указанием причины.')
      }

      if (parsed.data.approve) {
        const newPasswordHash = await hashPassword(randomUUID())
        const summary = await prisma.$transaction(async (tx) => {
          // Пользовательский контент, в котором могут быть персональные данные,
          // обезличивается. Оценки, платежи, налоговые и аудиторские записи
          // сохраняются в объёме, необходимом по закону.
          const messages = await tx.message.updateMany({
            where: { senderId: request.userId },
            data: { body: '[Удалено по запросу пользователя]', attachments: Prisma.DbNull },
          })
          const comments = await tx.lessonComment.updateMany({
            where: { userId: request.userId },
            data: { body: '[Удалено по запросу пользователя]', attachments: Prisma.DbNull },
          })
          const submissions = await tx.homeworkSubmission.updateMany({
            where: { studentId: request.userId },
            data: {
              text: null,
              projectUrl: null,
              files: Prisma.DbNull,
              comments: Prisma.DbNull,
              aiFeedback: Prisma.DbNull,
            },
          })
          const supportTickets = await tx.supportTicket.updateMany({
            where: { userId: request.userId },
            data: { subject: 'Удалено', message: '[Удалено по запросу пользователя]', resolution: null },
          })
          const files = await tx.storageFile.updateMany({
            where: { ownerId: request.userId },
            data: {
              title: 'Удалено',
              originalName: 'deleted',
              description: null,
              tags: [],
              deletedAt: new Date(),
            },
          })
          const aiRequests = await tx.aiRequest.deleteMany({ where: { userId: request.userId } })
          const notifications = await tx.notification.deleteMany({ where: { userId: request.userId } })
          await tx.notificationPreference.deleteMany({ where: { userId: request.userId } })
          const notes = await tx.lessonNote.deleteMany({ where: { userId: request.userId } })
          const bookmarks = await tx.materialBookmark.deleteMany({ where: { userId: request.userId } })
          const highlights = await tx.materialHighlight.deleteMany({ where: { userId: request.userId } })
          await tx.conversationParticipant.deleteMany({ where: { userId: request.userId } })
          await tx.twoFactorBackupCode.deleteMany({ where: { userId: request.userId } })
          await tx.passwordResetToken.deleteMany({ where: { userId: request.userId } })
          await tx.registrationRequest.updateMany({
            where: { email: request.user.email },
            data: {
              firstName: 'Удалённый',
              lastName: 'Пользователь',
              email: `deleted+request-${request.userId}@itadis.invalid`,
              phone: null,
              birthDate: null,
              guardianName: null,
              guardianPhone: null,
              passwordHash: newPasswordHash,
              ip: null,
            },
          })
          await tx.userProfile.deleteMany({ where: { userId: request.userId } })
          const sessions = await tx.refreshSession.updateMany({
            where: { userId: request.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          })
          const devices = await tx.userDevice.deleteMany({ where: { userId: request.userId } })
          await tx.user.update({
            where: { id: request.userId },
            data: {
              email: `deleted+${request.userId}@itadis.invalid`,
              phone: null,
              firstName: 'Удалённый',
              lastName: 'Пользователь',
              avatarUrl: null,
              birthDate: null,
              locale: 'ru',
              lastLoginAt: null,
              emailVerifiedAt: null,
              twoFactorSecret: null,
              twoFactorEnabledAt: null,
              passwordHash: newPasswordHash,
              isActive: false,
              deletedAt: new Date(),
            },
          })
          await tx.accountDeletionRequest.update({
            where: { id: request.id },
            data: {
              status: 'APPROVED',
              reviewedAt: new Date(),
              reviewedById: adminId,
              adminComment: parsed.data.comment ?? null,
              events: {
                create: {
                  status: 'APPROVED',
                  actorId: adminId,
                  comment:
                    parsed.data.comment ??
                    `Персональные данные удалены, обязательные сведения сохранены. Обезличено: сообщений ${messages.count}, комментариев ${comments.count}, работ ${submissions.count}, обращений ${supportTickets.count}, файлов ${files.count}. Удалено AI-запросов: ${aiRequests.count}, уведомлений: ${notifications.count}, заметок: ${notes.count}, закладок: ${bookmarks.count}, выделений: ${highlights.count}. Завершено сессий: ${sessions.count}, удалено устройств: ${devices.count}.`,
                },
              },
            },
          })
          return { messages: messages.count, submissions: submissions.count, files: files.count }
        })
        await writeAudit({
          actorId: adminId,
          action: 'privacy.deletion.approved',
          entity: 'account_deletion_request',
          entityId: request.id,
          metadata: {
            userId: request.userId,
            anonymized: summary,
            retained: ['payments', 'invoices', 'certificates', 'grades', 'audit_logs', 'consent_records'],
          },
          ip: req.ip ?? null,
        })
      } else {
        await prisma.accountDeletionRequest.update({
          where: { id: request.id },
          data: {
            status: 'REJECTED',
            legalHold: parsed.data.legalHold ?? false,
            reviewedAt: new Date(),
            reviewedById: adminId,
            adminComment: parsed.data.comment ?? null,
            events: {
              create: {
                status: 'REJECTED',
                actorId: adminId,
                comment:
                  parsed.data.comment ??
                  (parsed.data.legalHold
                    ? 'Отклонено: данные должны храниться по законодательству'
                    : 'Отклонено администратором'),
              },
            },
          },
        })
        await writeAudit({
          actorId: adminId,
          action: 'privacy.deletion.rejected',
          entity: 'account_deletion_request',
          entityId: request.id,
          metadata: { legalHold: parsed.data.legalHold ?? false },
          ip: req.ip ?? null,
        })
      }

      const updated = await prisma.accountDeletionRequest.findUnique({
        where: { id: request.id },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      })
      res.json({ request: updated })
    } catch (error) {
      if (error instanceof AppError) {
        next(error)
        return
      }
      next(error)
    }
  },
)

// Журнал файловых операций для администратора.
privacyRouter.get(
  '/admin/file-audit',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res, next) => {
    try {
      const action = req.query.action
      const logs = await prisma.fileAuditLog.findMany({
        where: action === 'UPLOAD' || action === 'DOWNLOAD' ? { action } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      })
      res.json({ logs })
    } catch (error) {
      next(error)
    }
  },
)

// Напоминание для UI: запрет отзыва обязательных согласий без удаления аккаунта.
privacyRouter.get('/requirements', (_req, res) => {
  res.json({
    mandatory: [...mandatoryTypes],
    optional: ['MARKETING', 'COOKIES', 'COOKIE_ANALYTICS', 'COOKIE_FUNCTIONAL', 'COOKIE_MARKETING'],
    guardianAge: 18,
    disclaimer:
      'Материалы носят информационный характер и не являются юридическим заключением. Перед публикацией требуется проверка юристом Кыргызской Республики.',
  })
})
