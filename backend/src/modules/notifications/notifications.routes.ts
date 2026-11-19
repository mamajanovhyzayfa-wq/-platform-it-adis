import { Router } from 'express'
import { prisma } from '../../lib/prisma.js'
import { notFound } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'

export const notificationsRouter = Router()

notificationsRouter.get('/', requireAuth, async (req, res) => {
  const userId = req.auth!.userId
  const limit = Math.min(Number(req.query.limit ?? 30) || 30, 100)
  // offset нужен мобильному списку для бесконечной прокрутки.
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ])

  res.json({ items, total, unread })
})

notificationsRouter.patch('/:id/read', requireAuth, async (req, res) => {
  const notification = await prisma.notification.findFirst({
    where: { id: String(req.params.id), userId: req.auth!.userId },
  })
  if (!notification) throw notFound('Уведомление не найдено')

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { readAt: new Date() },
  })
  res.json(updated)
})

notificationsRouter.post('/read-all', requireAuth, async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.auth!.userId, readAt: null },
    data: { readAt: new Date() },
  })
  res.json({ updated: result.count })
})
