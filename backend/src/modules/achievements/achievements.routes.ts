import { Router } from 'express'
import { prisma } from '../../lib/prisma.js'
import { requireAuth } from '../../middleware/auth.js'
import { achievementProgress, evaluateAchievements } from './evaluate.js'

export const achievementsRouter = Router()

/** Список достижений с прогрессом и датой получения. */
achievementsRouter.get('/', requireAuth, async (req, res) => {
  const userId = req.auth!.userId

  const [achievements, earned] = await Promise.all([
    prisma.achievement.findMany({ orderBy: { title: 'asc' } }),
    prisma.userAchievement.findMany({ where: { userId } }),
  ])

  const earnedMap = new Map(earned.map((item) => [item.achievementId, item.awardedAt]))

  const items = await Promise.all(
    achievements.map(async (achievement) => {
      const { current, target } = await achievementProgress(userId, achievement.condition)
      return {
        id: achievement.id,
        code: achievement.code,
        title: achievement.title,
        description: achievement.description,
        iconUrl: achievement.iconUrl,
        current,
        target,
        earnedAt: earnedMap.get(achievement.id) ?? null,
      }
    }),
  )

  res.json({ items, earned: earned.length, total: achievements.length })
})

/** Пересчёт достижений: выдаёт всё, что уже выполнено, и возвращает новые. */
achievementsRouter.post('/check', requireAuth, async (req, res) => {
  const awarded = await evaluateAchievements(req.auth!.userId)
  res.json({ awarded })
})
