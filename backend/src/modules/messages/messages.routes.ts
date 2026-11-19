import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'
import { sendPushToUsers } from '../../lib/push.js'
import { emitConversationRead, emitNewMessage } from '../../realtime.js'

export const messagesRouter = Router()

const createConversationSchema = z
  .object({
    type: z.enum(['DIRECT', 'COURSE']).default('DIRECT'),
    userId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
  })
  .refine((value) => (value.type === 'DIRECT' ? Boolean(value.userId) : Boolean(value.courseId)), {
    message: 'Для личного чата нужен userId, для чата курса — courseId',
  })

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
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
              user: { select: { firstName: true, lastName: true } },
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

function participantNames(participants: Array<{ userId: string; user: { firstName: string; lastName: string } }>) {
  return participants.map((item) => ({
    userId: item.userId,
    name: `${item.user.firstName} ${item.user.lastName}`,
  }))
}

messagesRouter.get('/conversations', requireAuth, async (req, res) => {
  const userId = req.auth!.userId

  const links = await prisma.conversationParticipant.findMany({
    where: { userId },
    include: {
      conversation: {
        include: {
          participants: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
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
        title:
          conversation.type === 'COURSE'
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
      }
    }),
  )

  items.sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0
    return bTime - aTime
  })

  res.json({ items, unreadTotal: items.reduce((sum, item) => sum + item.unread, 0) })
})

/** Личный чат создаётся один раз; чат курса доступен только участникам курса. */
messagesRouter.post('/conversations', requireAuth, validate(createConversationSchema), async (req, res) => {
  const auth = req.auth!
  const { type, userId, courseId } = req.body

  if (type === 'DIRECT') {
    if (userId === auth.userId) throw badRequest('Нельзя начать диалог с собой')
    const target = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, role: true } })
    if (!target) throw notFound('Пользователь не найден')

    // Личные диалоги — только между учеником и преподавателем/администратором.
    const allowed =
      auth.role === 'ADMIN' ||
      auth.role === 'TEACHER' ||
      target.role === 'TEACHER' ||
      target.role === 'ADMIN'
    if (!allowed) throw forbidden('Личные диалоги доступны только с преподавателями и администрацией')

    const existing = await prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        AND: [{ participants: { some: { userId: auth.userId } } }, { participants: { some: { userId } } }],
      },
      select: { id: true },
    })
    if (existing) {
      res.json({ id: existing.id, created: false })
      return
    }

    const conversation = await prisma.conversation.create({
      data: { type: 'DIRECT', participants: { create: [{ userId: auth.userId }, { userId }] } },
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
      conversation.type === 'COURSE'
        ? conversation.title ?? conversation.course?.title ?? 'Чат курса'
        : participantNames(conversation.participants)
            .filter((item) => item.userId !== req.auth!.userId)
            .map((item) => item.name)
            .join(', '),
    courseId: conversation.course?.id ?? null,
    participants: participantNames(conversation.participants),
  })
})

messagesRouter.get('/conversations/:id/messages', requireAuth, validate(messagesQuerySchema, 'query'), async (req, res) => {
  const id = String(req.params.id)
  await assertParticipant(id, req.auth!.userId)

  const query = req.query as unknown as z.infer<typeof messagesQuerySchema>
  const participant = await assertParticipant(id, req.auth!.userId)
  // Момент, до которого переписку прочитали остальные участники.
  const othersReadAt = participant.conversation.participants
    .filter((item) => item.userId !== req.auth!.userId)
    .reduce<Date | null>(
      (latest, item) => (item.lastReadAt && (!latest || item.lastReadAt > latest) ? item.lastReadAt : latest),
      null,
    )

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
    items: items
      .reverse()
      .map((message) => ({
        id: message.id,
        body: message.body,
        attachments: message.attachments,
        createdAt: message.createdAt,
        sender: message.sender,
        isMine: message.senderId === req.auth!.userId,
        readByOthers: Boolean(
          message.senderId === req.auth!.userId && othersReadAt && othersReadAt >= message.createdAt,
        ),
      })),
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
      body,
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

  if (recipientIds.length > 0) {
    await prisma.notification.createMany({
      data: recipientIds.map((userId) => ({
        userId,
        type: 'MESSAGE_RECEIVED' as const,
        title: 'Новое сообщение',
        body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
        data: { conversationId: id },
      })),
    })
  }

  const payload = {
    id: message.id,
    body: message.body,
    attachments: message.attachments,
    createdAt: message.createdAt,
    sender: message.sender,
    conversationId: id,
    isMine: false,
    readByOthers: false,
  }
  emitNewMessage(id, payload, recipientIds)

  // Push получают только участники переписки; отсутствие токенов не влияет на ответ API.
  const conversationTitle =
    participant.conversation.type === 'COURSE'
      ? (participant.conversation.title ?? participant.conversation.course?.title ?? 'Чат курса')
      : `${message.sender.firstName} ${message.sender.lastName}`
  await sendPushToUsers(recipientIds, {
    title: conversationTitle,
    body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
    channelId: 'messages',
    data: { type: 'MESSAGE_RECEIVED', conversationId: id },
  })

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
