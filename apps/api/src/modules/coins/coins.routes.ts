import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { EconomyService } from '../economy/economy.service.js'

export const coinsRouter = Router()
const economy = new EconomyService(new PrismaService())

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
  const transaction = await economy.award(
    { userId: req.auth!.userId, role: req.auth!.role },
    { userId: studentId, amount, reason },
  )
  const balance = transaction.balanceAfter ?? (await prisma.coinBalance.findUnique({ where: { userId: studentId } }))?.balance ?? 0
  res.status(201).json({ transaction, balance, requiresApproval: transaction.requiresApproval })
})
