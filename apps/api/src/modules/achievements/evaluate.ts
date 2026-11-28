import { prisma } from '../../lib/prisma.js'
import { awardCoins } from '../../lib/coins.js'
import { notifyUsers } from '../../lib/notify.js'
import { notificationBody } from './copy.js'

type Condition = { type?: string; value?: number; rewardCoins?: number }

/** Счётчики прогресса: каждый тип условия считается только на сервере. */
const achievementCounters: Record<string, (userId: string) => Promise<number>> = {
  lessons_completed: (userId) =>
    prisma.lessonProgress.count({ where: { studentId: userId, completedAt: { not: null } } }),
  homework_reviewed: (userId) =>
    prisma.homeworkSubmission.count({ where: { studentId: userId, status: 'REVIEWED' } }),
  tests_completed: (userId) =>
    prisma.testAttempt.count({ where: { studentId: userId, status: 'SUBMITTED' } }),
  perfect_tests: (userId) =>
    prisma.testAttempt.count({ where: { studentId: userId, status: 'SUBMITTED', percent: { gte: 90 } } }),
  quests_completed: (userId) =>
    prisma.userQuestProgress.count({ where: { userId, claimedAt: { not: null } } }),
  active_days: async (userId) => {
    const [transactions, attendance] = await Promise.all([
      prisma.coinTransaction.findMany({ where: { userId, status: 'POSTED', amount: { gt: 0 } }, select: { createdAt: true } }),
      prisma.attendance.findMany({ where: { userId, status: { not: 'ABSENT' } }, select: { joinedAt: true } }),
    ])
    const days = new Set<string>()
    for (const item of [...transactions, ...attendance]) {
      const date = 'createdAt' in item ? item.createdAt : item.joinedAt
      days.add(new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10))
    }
    return days.size
  },
  courses_completed: (userId) =>
    prisma.courseEnrollment.count({ where: { studentId: userId, status: 'COMPLETED' } }),
  attendance: (userId) => prisma.attendance.count({ where: { userId, status: { not: 'ABSENT' } } }),
  teacher_lessons: (userId) =>
    prisma.schedule.count({ where: { teacherId: userId, status: 'COMPLETED' } }),
  teacher_reviews: (userId) =>
    prisma.homeworkReview.count({ where: { reviewerId: userId } }),
  event_participations: (userId) =>
    prisma.eventRegistration.count({ where: { userId, status: 'REGISTERED' } }),
  contest_podiums: (userId) =>
    prisma.eventResult.count({ where: { userId, place: { lte: 3 }, publishedAt: { not: null } } }),
  coins_earned: async (userId) => {
    const result = await prisma.coinTransaction.aggregate({
      where: { userId, status: 'POSTED', amount: { gt: 0 } },
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
 *
 * Награда и достижение пишутся в одной транзакции, а `CoinTransaction` дополнительно
 * защищён уникальным ключом источника — баланс не разойдётся при параллельных запросах.
 */
export async function evaluateAchievements(userId: string): Promise<string[]> {
  const [achievements, earned] = await Promise.all([
    prisma.achievement.findMany({ where: { isActive: true } }),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
  ])

  const earnedIds = new Set(earned.map((item) => item.achievementId))
  const awarded: string[] = []

  for (const achievement of achievements) {
    if (earnedIds.has(achievement.id)) continue
    const { current, target } = await achievementProgress(userId, achievement.condition)
    if (current < target) continue

    const reward = achievement.rewardCoins || Number((achievement.condition as Condition | null)?.rewardCoins ?? 0)
    const created = await prisma
      .$transaction(async (tx) => {
        await tx.userAchievement.create({
          data: { userId, achievementId: achievement.id, progress: current, target },
        })
        if (reward > 0) {
          await awardCoins(tx, {
            userId,
            amount: reward,
            reason: `Достижение: ${achievement.title}`,
            sourceType: 'ACHIEVEMENT',
            sourceId: achievement.id,
          })
        }
        return true
      })
      .catch(() => null)
    if (!created) continue

    awarded.push(achievement.title)
    await notifyUsers([userId], {
      type: 'ACHIEVEMENT_UNLOCKED',
      title: 'Новое достижение',
      body: notificationBody(achievement.title, reward),
      data: { kind: 'achievement', achievementId: achievement.id },
    }).catch(() => undefined)
  }

  return awarded
}
