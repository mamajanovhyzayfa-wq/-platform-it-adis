import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { writeAudit } from '../../lib/audit.js'

export const coinsRouter = Router()

const awardSchema = z.object({
  studentId: z.string().uuid(),
  amount: z.number().int().min(1).max(1000),
  reason: z.string().trim().min(3).max(200),
})

coinsRouter.get('/balance', requireAuth, async (req, res) => {
  const balance = await prisma.coinBalance.findUnique({ where: { userId: req.auth!.userId } })
  res.json({ balance: balance?.balance ?? 0 })
})

coinsRouter.get('/history', requireAuth, async (req, res) => {
  const userId = req.auth!.userId
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200)
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

  const [items, total, balance, earned, spent] = await Promise.all([
    prisma.coinTransaction.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
    }),
    prisma.coinTransaction.count({ where: { userId } }),
    prisma.coinBalance.findUnique({ where: { userId } }),
    prisma.coinTransaction.aggregate({ where: { userId, amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.coinTransaction.aggregate({ where: { userId, amount: { lt: 0 } }, _sum: { amount: true } }),
  ])

  res.json({
    items,
    total,
    balance: balance?.balance ?? 0,
    totals: { earned: earned._sum.amount ?? 0, spent: Math.abs(spent._sum.amount ?? 0) },
  })
})

/** Начисление возможно только серверной операцией с указанием причины и автора. */
coinsRouter.post('/award', requireAuth, requireRole('TEACHER', 'ADMIN'), validate(awardSchema), async (req, res) => {
  const { studentId, amount, reason } = req.body
  const student = await prisma.user.findFirst({ where: { id: studentId, role: 'STUDENT', deletedAt: null } })
  if (!student) throw notFound('Ученик не найден')

  if (req.auth!.role === 'TEACHER') {
    const taught = await prisma.courseEnrollment.findFirst({
      where: { studentId, course: { teacherId: req.auth!.userId } },
    })
    if (!taught) throw badRequest('Ученик не закреплён за вашими курсами')
  }

  const [transaction, balance] = await prisma.$transaction([
    prisma.coinTransaction.create({
      data: { userId: studentId, amount, reason, awardedById: req.auth!.userId, sourceType: 'MANUAL' },
    }),
    prisma.coinBalance.upsert({
      where: { userId: studentId },
      update: { balance: { increment: amount } },
      create: { userId: studentId, balance: amount },
    }),
  ])

  await prisma.notification.create({
    data: {
      userId: studentId,
      type: 'COINS_AWARDED',
      title: `+${amount} изикоинов`,
      body: reason,
    },
  })

  await writeAudit({
    actorId: req.auth!.userId,
    action: 'coins.awarded',
    entity: 'user',
    entityId: studentId,
    metadata: { amount, reason },
  })

  res.status(201).json({ transaction, balance: balance.balance })
})
