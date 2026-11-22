import type { Prisma } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'
import { notifyUsers } from '../../lib/notify.js'
import { emitConversationRead, emitNewMessage } from '../../websocket/realtime.js'

export const messagesRouter = Router()

const createConversationSchema = z
  .object({
    type: z.enum(['DIRECT', 'COURSE', 'GROUP', 'TOPIC', 'PARENT_TEACHER']).default('DIRECT'),
    userId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    participantIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .refine(
    (value) =>
      value.type === 'DIRECT' || value.type === 'PARENT_TEACHER'
        ? Boolean(value.userId)
        : value.type === 'GROUP'
          ? Boolean(value.title && value.participantIds?.length)
          : Boolean(value.courseId),
    { message: 'Не хватает данных для выбранного типа чата' },
  )

const messageSchema = z
  .object({
    body: z.string().trim().max(4000).default(''),
    attachments: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          url: z.string().url().max(2048),
          mimeType: z.string().trim().max(120).optional(),
        }),
      )
      .max(5)
      .optional(),
  })
  .refine((value) => value.body.length > 0 || (value.attachments?.length ?? 0) > 0, {
    message: 'Сообщение не может быть пустым',
  })

const messagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

async function assertParticipant(conversationId: string, userId: string) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: {
      conversation: {
        include: {
          participants: {
            select: {
              userId: true,
              lastReadAt: true,
              user: { select: { firstName: true, lastName: true, role: true, avatarUrl: true } },
            },
          },
          course: { select: { id: true, title: true } },
        },
      },
    },
  })
  if (!participant) throw forbidden('Нет доступа к этой переписке')
  return participant
}

function participantNames(participants: Array<{ userId: string; user: { firstName: string; lastName: string; role: string } }>) {
  return participants.map((item) => ({
    userId: item.userId,
    name: `${item.user.firstName} ${item.user.lastName}`.trim(),
    role: item.user.role,
  }))
}

/**
 * Круг общения ограничен ролью: ученик и родитель видят только сотрудников,
 * наставник — своих учеников и коллег, администрация — всех.
 */
function communicationAudience(role: string, studentIds: string[]): Prisma.UserWhereInput {
  if (role === 'ADMIN' || role === 'MANAGER') return {}
  if (role === 'TEACHER') {
    return {
      OR: [
        { id: { in: studentIds } },
        { role: { in: ['ADMIN', 'MANAGER', 'TEACHER'] } },
      ],
    }
  }
  return { role: { in: ['ADMIN', 'MANAGER', 'TEACHER'] } }
}

/** Статус доставки сообщения по отметкам прочтения участников. */
function deliveryStatus(readCount: number, recipientCount: number): 'SENT' | 'DELIVERED' | 'READ' {
  if (recipientCount > 0 && readCount >= recipientCount) return 'READ'
  if (readCount > 0) return 'DELIVERED'
  return 'SENT'
}

messagesRouter.get('/users', requireAuth, async (req, res) => {
  const auth = req.auth!
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  let studentIds: string[] = []
  if (auth.role === 'TEACHER') {
    const courses = await prisma.course.findMany({
      where: { teacherId: auth.userId },
      select: { enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } },
    })
    studentIds = [...new Set(courses.flatMap((course) => course.enrollments.map((item) => item.studentId)))]
  }

  const users = await prisma.user.findMany({
    where: {
      id: { not: auth.userId },
      deletedAt: null,
      isActive: true,
      AND: [
        communicationAudience(auth.role, studentIds),
        ...(q
          ? [
              {
                OR: [
                  { firstName: { contains: q, mode: 'insensitive' as const } },
                  { lastName: { contains: q, mode: 'insensitive' as const } },
                  { email: { contains: q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, avatarUrl: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: 30,
  })
  res.json({ items: users.map((user) => ({ ...user, name: `${user.firstName} ${user.lastName}`.trim() })) })
})

messagesRouter.get('/conversations', requireAuth, async (req, res) => {
  const userId = req.auth!.userId
  const requestedType = typeof req.query.type === 'string' ? req.query.type : undefined
  const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''

  const links = await prisma.conversationParticipant.findMany({
    where: { userId, ...(requestedType ? { conversation: { type: requestedType as never } } : {}) },
    include: {
      conversation: {
        include: {
          participants: { select: { userId: true, user: { select: { firstName: true, lastName: true, role: true } } } },
          course: { select: { id: true, title: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { sender: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  })

  const items = await Promise.all(
    links.map(async (link) => {
      const conversation = link.conversation
      const names = participantNames(conversation.participants)
      const others = names.filter((item) => item.userId !== userId)
      const unread = await prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: userId },
          ...(link.lastReadAt ? { createdAt: { gt: link.lastReadAt } } : {}),
        },
      })
      const lastMessage = conversation.messages[0]

      return {
        id: conversation.id,
        type: conversation.type,
        description: conversation.description,
        title:
          conversation.type === 'COURSE' || conversation.type === 'TOPIC' || conversation.type === 'GROUP'
            ? conversation.title ?? conversation.course?.title ?? 'Чат курса'
            : others.map((item) => item.name).join(', ') || 'Диалог',
        courseId: conversation.course?.id ?? null,
        participants: names,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              body: lastMessage.body,
              senderName: `${lastMessage.sender.firstName} ${lastMessage.sender.lastName}`,
              createdAt: lastMessage.createdAt,
            }
          : null,
        unread,
        lastReadAt: link.lastReadAt,
        updatedAt: conversation.updatedAt,
        isPinned: conversation.isPinned,
      }
    }),
  )

  // Поиск охватывает название, описание и последнее сообщение диалога.
  const filtered = search
    ? items.filter((item) =>
        `${item.title} ${item.description ?? ''} ${item.lastMessage?.body ?? ''}`.toLowerCase().includes(search),
      )
    : items
  const resultItems = filtered.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0
    return bTime - aTime
  })

  res.json({ items: resultItems, unreadTotal: resultItems.reduce((sum, item) => sum + item.unread, 0) })
})

/** Личный чат создаётся один раз; чат курса доступен только участникам курса. */
messagesRouter.post('/conversations', requireAuth, validate(createConversationSchema), async (req, res) => {
  const auth = req.auth!
  const { type, userId, courseId } = req.body

  if (type === 'GROUP') {
    if (!['ADMIN', 'MANAGER', 'TEACHER'].includes(auth.role)) throw forbidden('Групповые чаты создают сотрудники')
    const participantIds = [...new Set([...(req.body.participantIds ?? []), auth.userId])]
    const users = await prisma.user.findMany({ where: { id: { in: participantIds }, deletedAt: null, isActive: true }, select: { id: true } })
    if (users.length !== participantIds.length) throw badRequest('Один из участников не найден или заблокирован')
    const conversation = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        title: req.body.title,
        description: req.body.description ?? null,
        createdById: auth.userId,
        participants: { create: participantIds.map((id) => ({ userId: id })) },
      },
    })
    await notifyUsers(participantIds.filter((id) => id !== auth.userId), {
      type: 'MESSAGE_RECEIVED',
      title: 'Новый групповой чат',
      body: req.body.title ?? 'Вас добавили в групповой чат',
      data: { conversationId: conversation.id },
    })
    res.status(201).json({ id: conversation.id, created: true })
    return
  }

  if (type === 'TOPIC') {
    if (!req.body.courseId || !req.body.title) throw badRequest('Для обсуждения нужны курс и тема')
    const course = await prisma.course.findUnique({
      where: { id: req.body.courseId },
      select: { id: true, title: true, teacherId: true, enrollments: { select: { studentId: true } } },
    })
    if (!course) throw notFound('Курс не найден')
    const memberIds = [...new Set([course.teacherId, ...course.enrollments.map((item) => item.studentId), auth.userId])]
    const isMember = auth.role === 'ADMIN' || memberIds.includes(auth.userId)
    if (!isMember) throw forbidden('Обсуждение доступно участникам курса')
    const conversation = await prisma.conversation.create({
      data: {
        type: 'TOPIC',
        courseId: course.id,
        title: req.body.title,
        description: req.body.description ?? null,
        createdById: auth.userId,
        participants: { create: memberIds.map((id) => ({ userId: id })) },
      },
    })
    res.status(201).json({ id: conversation.id, created: true })
    return
  }

  if (type === 'DIRECT' || type === 'PARENT_TEACHER') {
    if (!userId) throw badRequest('Выберите собеседника')
    if (userId === auth.userId) throw badRequest('Нельзя начать диалог с собой')
    const target = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, role: true } })
    if (!target) throw notFound('Пользователь не найден')

    // Чат «родитель — наставник» доступен только родителю и наставнику,
    // который действительно ведёт занятия у его ребёнка.
    if (type === 'PARENT_TEACHER') {
      const parentUserId = auth.role === 'PARENT' ? auth.userId : userId
      const teacherUserId = auth.role === 'TEACHER' ? auth.userId : userId
      if (auth.role !== 'PARENT' && auth.role !== 'TEACHER') {
        throw forbidden('Чат «родитель — наставник» создаётся родителем или наставником')
      }
      if (target.role !== 'PARENT' && target.role !== 'TEACHER') {
        throw badRequest('Второй участник чата должен быть родителем или наставником')
      }
      const linked = await prisma.parentStudentLink.findFirst({
        where: {
          parent: { userId: parentUserId },
          verifiedAt: { not: null },
          student: { user: { enrollments: { some: { status: 'ACTIVE', course: { teacherId: teacherUserId } } } } },
        },
        select: { id: true },
      })
      if (!linked) throw forbidden('Наставник не ведёт занятия у вашего ребёнка')
    }

    // Личные диалоги — только между учеником/родителем и преподавателем/администрацией.
    const allowed =
      auth.role === 'ADMIN' ||
      auth.role === 'MANAGER' ||
      auth.role === 'TEACHER' ||
      target.role === 'TEACHER' ||
      target.role === 'ADMIN'
    if (!allowed) throw forbidden('Личные диалоги доступны только с преподавателями и администрацией')

    const existing = await prisma.conversation.findFirst({
      where: {
        type,
        participants: { some: { userId: auth.userId } },
        AND: [{ participants: { some: { userId } } }, { participants: { every: { userId: { in: [auth.userId, userId] } } } }],
      },
      select: { id: true },
    })
    if (existing) {
      res.json({ id: existing.id, created: false })
      return
    }

    const conversation = await prisma.conversation.create({
      data: { type, createdById: auth.userId, participants: { create: [{ userId: auth.userId }, { userId }] } },
    })
    res.status(201).json({ id: conversation.id, created: true })
    return
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, teacherId: true, enrollments: { select: { studentId: true } } },
  })
  if (!course) throw notFound('Курс не найден')

  const isMember =
    auth.role === 'ADMIN' ||
    course.teacherId === auth.userId ||
    course.enrollments.some((item) => item.studentId === auth.userId)
  if (!isMember) throw forbidden('Чат доступен только участникам курса')

  const existing = await prisma.conversation.findFirst({ where: { type: 'COURSE', courseId: course.id } })
  if (existing) {
    res.json({ id: existing.id, created: false })
    return
  }

  const memberIds = [...new Set([course.teacherId, ...course.enrollments.map((item) => item.studentId)])]
  if (!memberIds.includes(auth.userId)) memberIds.push(auth.userId)

  const conversation = await prisma.conversation.create({
    data: {
      type: 'COURSE',
      courseId: course.id,
      title: `Чат курса «${course.title}»`,
      participants: { create: memberIds.map((id) => ({ userId: id })) },
    },
  })

  res.status(201).json({ id: conversation.id, created: true })
})

messagesRouter.get('/conversations/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  const participant = await assertParticipant(id, req.auth!.userId)
  const conversation = participant.conversation

  res.json({
    id: conversation.id,
    type: conversation.type,
    title:
      conversation.type === 'COURSE' || conversation.type === 'TOPIC' || conversation.type === 'GROUP'
        ? conversation.title ?? conversation.course?.title ?? 'Чат'
        : participantNames(conversation.participants)
            .filter((item) => item.userId !== req.auth!.userId)
            .map((item) => item.name)
            .join(', ') || 'Диалог',
    description: conversation.description,
    courseId: conversation.course?.id ?? null,
    participants: participantNames(conversation.participants),
    updatedAt: conversation.updatedAt,
    isPinned: conversation.isPinned,
  })
})

messagesRouter.get('/conversations/:id/messages', requireAuth, validate(messagesQuerySchema, 'query'), async (req, res) => {
  const id = String(req.params.id)
  await assertParticipant(id, req.auth!.userId)

  const query = req.query as unknown as z.infer<typeof messagesQuerySchema>
  const participant = await assertParticipant(id, req.auth!.userId)
  const conversation = participant.conversation
  const others = conversation.participants.filter((item) => item.userId !== req.auth!.userId)

  const items = await prisma.message.findMany({
    where: {
      conversationId: id,
      ...(query.q ? { body: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.before ? { createdAt: { lt: new Date(query.before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
  })

  res.json({
    conversation: {
      id: conversation.id,
      type: conversation.type,
      title:
        conversation.type === 'COURSE' || conversation.type === 'TOPIC' || conversation.type === 'GROUP'
          ? conversation.title ?? conversation.course?.title ?? 'Чат'
          : others.map((item) => `${item.user.firstName} ${item.user.lastName}`.trim()).join(', ') || 'Диалог',
      description: conversation.description,
      courseId: conversation.course?.id ?? null,
      participants: participantNames(conversation.participants),
      updatedAt: conversation.updatedAt,
      isPinned: conversation.isPinned,
    },
    items: items
      .reverse()
      .map((message) => {
        const readCount = others.filter(
          (item) => item.lastReadAt && item.lastReadAt >= message.createdAt,
        ).length
        const recipientCount = others.length
        return {
          id: message.id,
          body: message.body,
          attachments: message.attachments,
          createdAt: message.createdAt,
          editedAt: message.editedAt,
          sender: message.sender,
          isMine: message.senderId === req.auth!.userId,
          readByOthers: readCount > 0,
          readCount,
          recipientCount,
          status: deliveryStatus(readCount, recipientCount),
        }
      }),
    hasMore: items.length === query.limit,
  })
})

messagesRouter.post('/conversations/:id/messages', requireAuth, validate(messageSchema), async (req, res) => {
  const auth = req.auth!
  const id = String(req.params.id)
  const participant = await assertParticipant(id, auth.userId)
  const { body, attachments } = req.body

  const message = await prisma.message.create({
    data: {
      conversationId: id,
      senderId: auth.userId,
      body: body || (attachments?.length ? 'Файл' : ''),
      attachments: attachments ? (attachments as never) : undefined,
    },
    include: { sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
  })

  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: id, userId: auth.userId } },
    data: { lastReadAt: new Date() },
  })

  const recipientIds = participant.conversation.participants
    .map((item) => item.userId)
    .filter((userId) => userId !== auth.userId)

  const conversationTitle =
    participant.conversation.type === 'COURSE' || participant.conversation.type === 'TOPIC' || participant.conversation.type === 'GROUP'
      ? (participant.conversation.title ?? participant.conversation.course?.title ?? 'Чат')
      : `${message.sender.firstName} ${message.sender.lastName}`

  if (recipientIds.length > 0) {
    await notifyUsers(recipientIds, {
      type: 'MESSAGE_RECEIVED',
      title: conversationTitle,
      body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      data: { conversationId: id },
      email: { subject: `Новое сообщение: ${conversationTitle}`, text: body },
      sms: `ITadis: новое сообщение от ${message.sender.firstName}.`,
    })
  }

  const payload = {
    id: message.id,
    body: message.body,
    attachments: message.attachments,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    sender: message.sender,
    conversationId: id,
    isMine: false,
    readByOthers: false,
    readCount: 0,
    recipientCount: recipientIds.length,
    status: 'SENT' as const,
  }
  emitNewMessage(id, payload, recipientIds)

  res.status(201).json({ ...payload, isMine: true })
})

messagesRouter.post('/conversations/:id/read', requireAuth, async (req, res) => {
  const id = String(req.params.id)
  await assertParticipant(id, req.auth!.userId)

  const readAt = new Date()
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: id, userId: req.auth!.userId } },
    data: { lastReadAt: readAt },
  })

  // Собеседники получают отметку о прочтении в реальном времени.
  emitConversationRead(id, req.auth!.userId, readAt)

  res.json({ ok: true, readAt })
})

/** Жалоба на сообщение: фиксируется в аудите, повторная жалоба не дублируется. */
messagesRouter.post('/messages/:id/report', requireAuth, async (req, res) => {
  const message = await prisma.message.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, conversationId: true, senderId: true },
  })
  if (!message) throw notFound('Сообщение не найдено')

  await assertParticipant(message.conversationId, req.auth!.userId)

  const existing = await prisma.auditLog.findFirst({
    where: {
      action: 'message.report',
      entityId: message.id,
      actorId: req.auth!.userId,
    },
  })
  if (existing) {
    res.json({ ok: true, duplicate: true })
    return
  }

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, select: { id: true } })

  await writeAudit({
    actorId: req.auth!.userId,
    action: 'message.report',
    entity: 'Message',
    entityId: message.id,
    metadata: { conversationId: message.conversationId, senderId: message.senderId },
    ip: req.ip,
  })

  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: 'SYSTEM' as const,
        title: 'Жалоба на сообщение',
        body: 'Проверьте сообщение в модерации',
        data: { messageId: message.id, conversationId: message.conversationId },
      })),
    })
  }

  res.status(201).json({ ok: true })
})
