import { prisma } from '../../lib/prisma.js'
import { notificationBody } from './copy.js'

type Condition = { type?: string; value?: number; rewardCoins?: number }

/** Счётчики прогресса: каждый тип условия считается только на сервере. */
export const achievementCounters: Record<string, (userId: string) => Promise<number>> = {
  lessons_completed: (userId) =>
    prisma.lessonProgress.count({ where: { studentId: userId, completedAt: { not: null } } }),
  homework_reviewed: (userId) =>
    prisma.homeworkSubmission.count({ where: { studentId: userId, status: 'REVIEWED' } }),
  tests_completed: (userId) =>
    prisma.testAttempt.count({ where: { studentId: userId, status: 'SUBMITTED' } }),
  courses_completed: (userId) =>
    prisma.courseEnrollment.count({ where: { studentId: userId, status: 'COMPLETED' } }),
  attendance: (userId) => prisma.attendance.count({ where: { userId } }),
  coins_earned: async (userId) => {
    const result = await prisma.coinTransaction.aggregate({
      where: { userId, amount: { gt: 0 } },
      _sum: { amount: true },
    })
    return result._sum.amount ?? 0
  },
}

export async function achievementProgress(userId: string, condition: unknown): Promise<{ current: number; target: number }> {
  const parsed = (condition ?? {}) as Condition
  const target = Math.max(1, Number(parsed.value ?? 1))
  const counter = parsed.type ? achievementCounters[parsed.type] : undefined
  if (!counter) return { current: 0, target }
  return { current: Math.min(await counter(userId), target), target }
}

/**
 * Проверяет условия достижений и выдаёт новые. Вызывается после учебных действий
 * и из экрана достижений; повторная выдача исключена уникальным ключом.
 */
export async function evaluateAchievements(userId: string): Promise<string[]> {
  const [achievements, earned, balance] = await Promise.all([
    prisma.achievement.findMany(),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
    prisma.coinBalance.findUnique({ where: { userId } }),
  ])

  const earnedIds = new Set(earned.map((item) => item.achievementId))
  const awarded: string[] = []
  let balanceDelta = 0

  for (const achievement of achievements) {
    if (earnedIds.has(achievement.id)) continue
    const { current, target } = await achievementProgress(userId, achievement.condition)
    if (current < target) continue

    const created = await prisma.userAchievement
      .create({ data: { userId, achievementId: achievement.id } })
      .catch(() => null)
    if (!created) continue

    awarded.push(achievement.title)

    const reward = Number((achievement.condition as Condition | null)?.rewardCoins ?? 0)
    if (reward > 0) {
      balanceDelta += reward
      await prisma.coinTransaction.create({
        data: {
          userId,
          amount: reward,
          reason: `Достижение: ${achievement.title}`,
          sourceType: 'ACHIEVEMENT',
          sourceId: achievement.id,
        },
      })
    }

    await prisma.notification.create({
      data: {
        userId,
        type: 'ACHIEVEMENT_UNLOCKED',
        title: 'Новое достижение',
        body: notificationBody(achievement.title, reward),
      },
    })
  }

  if (balanceDelta > 0) {
    if (balance) {
      await prisma.coinBalance.update({ where: { userId }, data: { balance: { increment: balanceDelta } } })
    } else {
      await prisma.coinBalance.create({ data: { userId, balance: balanceDelta } })
    }
  }

  return awarded
}
