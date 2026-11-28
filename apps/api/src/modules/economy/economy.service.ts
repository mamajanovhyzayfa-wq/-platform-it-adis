import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type CoinSource, type CoinTransactionStatus, type RoleName, type ShopOrderStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { notifyUsers } from '../../lib/notify.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'

type Tx = Prisma.TransactionClient
type Condition = { type?: string; value?: number; rewardCoins?: number; xp?: number; rarity?: string }
type Period = 'DAILY' | 'WEEKLY' | 'SEASON'
type CounterSet = Record<string, number>

const DAY = 24 * 60 * 60 * 1000
const ACHIEVEMENT_RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const
const SHOP_CATEGORIES = ['DIGITAL', 'DISCOUNT', 'MATERIAL', 'PRIVILEGE', 'PHYSICAL'] as const
const SHOP_KINDS = ['DIGITAL', 'PHYSICAL'] as const
const FULFILLMENT = ['AUTOMATIC', 'MANUAL'] as const

function startOfDay(date = new Date()) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}
function endOfDay(date = new Date()) {
  const copy = startOfDay(date)
  copy.setDate(copy.getDate() + 1)
  return copy
}
function startOfWeek(date = new Date()) {
  const copy = startOfDay(date)
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7))
  return copy
}
function isoWeekKey(date: Date) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((copy.getTime() - yearStart.getTime()) / DAY + 1) / 7)
  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
function dateKey(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
function periodKey(period: Period, date = new Date(), seasonId?: string) {
  if (period === 'DAILY') return dateKey(date)
  if (period === 'WEEKLY') return isoWeekKey(date)
  return seasonId ?? dateKey(date)
}
function conditionOf(value: unknown): Condition {
  return value && typeof value === 'object' ? (value as Condition) : {}
}

/** Экономика IT Coins: баланс, уровни, задания, достижения и магазин филиала. */
@Injectable()
export class EconomyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Upsert не защищён от гонки: два параллельных запроса на первом входе
   * видят отсутствующую строку и оба пытаются её создать. Второй получает
   * P2002, хотя нужная запись уже существует. Такой конфликт считаем успехом.
   */
  private async upsertSafe<T>(operation: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return fallback()
      }
      throw error
    }
  }

  /** Создание справочной записи, где конфликт означает, что её уже создали. */
  private async createIfMissing(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation()
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
      throw error
    }
  }

  // ---------- настройки и профиль ----------

  async rules() {
    return this.upsertSafe(
      () =>
        this.prisma.client.coinRule.upsert({
          where: { id: 'branch' },
          update: {},
          create: { id: 'branch' },
        }),
      () => this.prisma.client.coinRule.findUniqueOrThrow({ where: { id: 'branch' } }),
    )
  }

  async updateRules(input: Partial<{
    dailyAwardLimit: number
    weeklyAwardLimit: number
    teacherDailyLimit: number
    maxManualAward: number
    suspiciousAmount: number
    penaltyApprovalThreshold: number
    streakMinDailyActions: number
    streakBonusEvery: number
    streakBonusCoins: number
  }>, actorId: string) {
    const updated = await this.prisma.client.coinRule.upsert({
      where: { id: 'branch' },
      update: input,
      create: { id: 'branch', ...input },
    })
    await writeAudit({ actorId, action: 'coins.rules.update', entity: 'CoinRule', entityId: 'branch', metadata: input })
    return updated
  }

  private async balanceOf(userId: string) {
    return (await this.prisma.client.coinBalance.findUnique({ where: { userId } }))?.balance ?? 0
  }

  /** Базовый каталог создаётся при первом обращении, чтобы филиал работал без ручной настройки. */
  private async ensureDefaults() {
    await this.rules()
    const levels = [
      ['NOVICE', 'Новичок', 'Только начинаете путь в ITadis', 0, 1],
      ['LEARNER', 'Ученик', 'Первые учебные результаты', 100, 2],
      ['PRACTITIONER', 'Практик', 'Стабильная работа и активность', 300, 3],
      ['EXPERT', 'Эксперт', 'Сильные результаты и достижения', 700, 4],
      ['MASTER', 'Мастер', 'Максимальный уровень филиала', 1500, 5],
    ] as const
    for (const [code, title, description, thresholdXp, position] of levels) {
      await this.createIfMissing(() =>
        this.prisma.client.coinLevel.upsert({
          where: { code },
          update: { title, description, thresholdXp, position },
          create: { code, title, description, thresholdXp, position, perks: { badge: code.toLowerCase() } },
        }),
      )
    }

    const quests = [
      ['DAILY_LESSON', 'Посетите занятие', 'Одно занятие в расписании', 'DAILY', 'attendance', 1, 10, 10],
      ['DAILY_HOMEWORK', 'Сдайте домашнюю работу', 'Одна проверенная работа', 'DAILY', 'homework_reviewed', 1, 15, 10],
      ['DAILY_TEST', 'Пройдите тест', 'Одна завершённая попытка', 'DAILY', 'tests_completed', 1, 10, 10],
      ['WEEKLY_ACTIVE', 'Активная неделя', 'Три учебных действия за неделю', 'WEEKLY', 'active_days', 3, 50, 30],
      ['WEEKLY_COINS', 'Заработайте монеты', 'Получите 100 IT Coins за неделю', 'WEEKLY', 'coins_earned', 100, 30, 20],
      ['WEEKLY_LESSONS', 'Пять занятий', 'Посетите пять занятий за неделю', 'WEEKLY', 'attendance', 5, 40, 25],
    ] as const
    for (const [code, title, description, period, targetType, targetValue, rewardCoins, rewardXp] of quests) {
      await this.createIfMissing(() =>
        this.prisma.client.coinQuest.upsert({
          where: { code },
          update: { title, description, targetType, targetValue, rewardCoins, rewardXp },
          create: { code, title, description, period, targetType, targetValue, rewardCoins, rewardXp },
        }),
      )
    }

    // Базовая коллекция достижений создаётся и в новом филиале без seed.
    const builtInAchievements = [
      ['FIRST_LESSON', 'Первый урок', 'Завершён первый урок курса', 'COMMON', 'Учёба', 'Первые шаги', 10, 'lessons_completed', 1],
      ['FIRST_HOMEWORK', 'Первое домашнее задание', 'Проверено первое домашнее задание', 'COMMON', 'Учёба', 'Первые шаги', 20, 'homework_reviewed', 1],
      ['TEST_ACE', 'Пять тестов', 'Пройдено пять тестов', 'RARE', 'Учёба', 'Проверка знаний', 50, 'tests_completed', 5],
      ['PERFECT_TEST', 'Безупречный тест', 'Тест сдан на 90% и выше', 'EPIC', 'Учёба', 'Проверка знаний', 60, 'perfect_tests', 1],
      ['COIN_COLLECTOR', 'Копилка IT Coins', 'Заработано 100 IT Coins', 'COMMON', 'Активность', 'Экономика', 25, 'coins_earned', 100],
      ['ATTENDANCE_5', 'Активный ученик', 'Посещено пять занятий', 'RARE', 'Посещаемость', 'Активность', 30, 'attendance', 5],
      ['COURSE_FINISHER', 'Завершённый курс', 'Пройден первый курс полностью', 'EPIC', 'Прогресс', 'Учебный путь', 100, 'courses_completed', 1],
      ['STREAK_7', 'Семь дней подряд', 'Семь учебных дней без пропусков', 'LEGENDARY', 'Активность', 'Серии', 150, 'active_days', 7],
      ['EVENT_DEBUT', 'Первый выход в свет', 'Участие в первом мероприятии филиала', 'COMMON', 'События', 'Сезоны и конкурсы', 20, 'event_participations', 1],
      ['CONTEST_PODIUM', 'Пьедестал', 'Призовое место в конкурсе или соревновании', 'EPIC', 'События', 'Сезоны и конкурсы', 70, 'contest_podiums', 1],
      ['MENTOR_FIRST_LESSON', 'Первый проведённый урок', 'Завершён первый урок под руководством наставника', 'COMMON', 'Наставничество', 'Наставник', 20, 'teacher_lessons', 1],
      ['MENTOR_TEN_LESSONS', 'Десять уроков', 'Проведено десять занятий', 'RARE', 'Наставничество', 'Наставник', 70, 'teacher_lessons', 10],
      ['MENTOR_REVIEWER', 'Наставник-эксперт', 'Проверено 25 работ учеников', 'EPIC', 'Наставничество', 'Наставник', 80, 'teacher_reviews', 25],
    ] as const
    const existingAchievements = await this.prisma.client.achievement.findMany({
      where: { code: { in: builtInAchievements.map((item) => item[0]) } },
      select: { code: true },
    })
    const existingCodes = new Set(existingAchievements.map((item) => item.code))
    const missingAchievements = builtInAchievements.filter((item) => !existingCodes.has(item[0]))
    if (missingAchievements.length) {
      await this.prisma.client.achievement.createMany({
        data: missingAchievements.map(([code, title, description, rarity, category, collection, rewardCoins, conditionType, targetValue]) => ({
          code,
          title,
          description,
          rarity,
          category,
          collection,
          rewardCoins,
          condition: { type: conditionType, value: targetValue, rewardCoins },
        })),
        skipDuplicates: true,
      })
    }

    const activeSeason = await this.prisma.client.coinSeason.findFirst({
      where: { isActive: true, endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'desc' },
    })
    if (!activeSeason) {
      const startsAt = new Date()
      const endsAt = new Date(startsAt.getTime() + 90 * DAY)
      const season = await this.prisma.client.coinSeason.create({
        data: {
          title: 'Сезон учебного года',
          description: 'Участвуйте в учебных активностях и собирайте сезонные награды.',
          theme: 'Учебный год',
          startsAt,
          endsAt,
        },
      })
      const seasonQuests = [
        ['SEASON_COINS', 'Сезонный охотник за монетами', 'Заработайте 500 IT Coins за сезон', 'coins_earned', 500, 80, 50],
        ['SEASON_ACHIEVEMENTS', 'Коллекционер сезона', 'Получите три достижения за сезон', 'achievements', 3, 60, 40],
        ['SEASON_ACTIVE', 'Активный участник', '20 учебных действий за сезон', 'active_days', 20, 100, 75],
      ] as const
      for (const [code, title, description, targetType, targetValue, rewardCoins, rewardXp] of seasonQuests) {
        await this.createIfMissing(() =>
          this.prisma.client.coinQuest.upsert({
            where: { code },
            update: {},
            create: {
              code, title, description, period: 'SEASON', targetType, targetValue, rewardCoins, rewardXp, seasonId: season.id,
            },
          }),
        )
      }
    }
  }

  /** Считает XP, уровень и серию активности из учебных действий, а не из одной суммы монет. */
  private async refreshProfile(userId: string, role: RoleName) {
    const [profile, lessons, homework, tests, attendance, courses, achievements, claimedQuests, teacherLessons, teacherReviews, positive] =
      await Promise.all([
        this.upsertSafe(
          () => this.prisma.client.userCoinProfile.upsert({ where: { userId }, update: {}, create: { userId } }),
          () => this.prisma.client.userCoinProfile.findUniqueOrThrow({ where: { userId } }),
        ),
        this.prisma.client.lessonProgress.count({ where: { studentId: userId, completedAt: { not: null } } }),
        this.prisma.client.homeworkSubmission.count({ where: { studentId: userId, status: 'REVIEWED' } }),
        this.prisma.client.testAttempt.count({ where: { studentId: userId, status: 'SUBMITTED' } }),
        this.prisma.client.attendance.count({ where: { userId, status: { not: 'ABSENT' } } }),
        this.prisma.client.courseEnrollment.count({ where: { studentId: userId, status: 'COMPLETED' } }),
        this.prisma.client.userAchievement.count({ where: { userId } }),
        this.prisma.client.userQuestProgress.count({ where: { userId, claimedAt: { not: null } } }),
        this.prisma.client.schedule.count({ where: { teacherId: userId, status: 'COMPLETED' } }),
        this.prisma.client.homeworkReview.count({ where: { reviewerId: userId } }),
        this.prisma.client.coinTransaction.aggregate({ where: { userId, amount: { gt: 0 }, status: 'POSTED' }, _sum: { amount: true } }),
      ])

    const baseXp = role === 'TEACHER'
      ? teacherLessons * 20 + teacherReviews * 15 + achievements * 25
      : lessons * 10 + homework * 15 + tests * 15 + attendance * 5 + courses * 100 + achievements * 25
    const xp = baseXp + Math.floor((positive._sum.amount ?? 0) / 10) + profile.bonusXp
    const levels = await this.prisma.client.coinLevel.findMany({ orderBy: { thresholdXp: 'asc' } })
    const level = levels.filter((item) => item.thresholdXp <= xp).at(-1)
    const next = levels.find((item) => item.thresholdXp > xp)

    const [attendanceDates, transactionDates] = await Promise.all([
      this.prisma.client.attendance.findMany({
        where: { userId, status: { not: 'ABSENT' }, joinedAt: { gte: new Date(Date.now() - 120 * DAY) } },
        select: { joinedAt: true },
      }),
      this.prisma.client.coinTransaction.findMany({
        // Серию поддерживает только положительная активность: покупка или штраф не считаются.
        where: { userId, status: 'POSTED', amount: { gt: 0 }, createdAt: { gte: new Date(Date.now() - 120 * DAY) } },
        select: { createdAt: true },
      }),
    ])
    const actionCounts = new Map<string, number>()
    for (const item of [...attendanceDates, ...transactionDates]) {
      const key = dateKey('joinedAt' in item ? item.joinedAt : item.createdAt)
      actionCounts.set(key, (actionCounts.get(key) ?? 0) + 1)
    }
    const rules = await this.rules()
    const activeDays = new Set([...actionCounts.entries()].filter(([, count]) => count >= rules.streakMinDailyActions).map(([key]) => key))
    let streak = 0
    const cursor = startOfDay()
    if (!activeDays.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1)
    while (activeDays.has(dateKey(cursor))) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    const best = Math.max(profile.streakBest, streak)
    const updated = await this.prisma.client.userCoinProfile.update({
      where: { userId },
      data: {
        xp,
        level: level?.position ?? 1,
        streakCurrent: streak,
        streakBest: best,
        lastActivityDate: activeDays.size ? new Date(`${[...activeDays].sort().at(-1)}T00:00:00.000Z`) : null,
      },
    })

    // Серия награждается один раз за день достижения рубежа; уникальный источник защищает от повторов.
    if (streak > 0 && rules.streakBonusCoins > 0 && streak % rules.streakBonusEvery === 0) {
      const sourceId = `streak:${dateKey(new Date())}`
      const exists = await this.prisma.client.coinTransaction.findFirst({ where: { userId, sourceType: 'STREAK', sourceId } })
      if (!exists) {
        try {
          await this.prisma.client.$transaction((tx) => this.postTransaction(tx, {
            userId,
            amount: rules.streakBonusCoins,
            reason: `Серия активности: ${streak} дней`,
            sourceType: 'STREAK',
            sourceId,
          }))
          await this.notify(userId, 'Серия активности', `${streak} дней подряд: +${rules.streakBonusCoins} IT Coins`, 'COINS_AWARDED')
        } catch {
          // параллельный пересчёт мог уже выдать награду — баланс не должен ломаться
        }
      }
    }

    return {
      profile: updated,
      level: level ?? levels[0] ?? null,
      next: next ?? null,
      xp,
      progress: next ? Math.round(((xp - (level?.thresholdXp ?? 0)) / Math.max(1, next.thresholdXp - (level?.thresholdXp ?? 0))) * 100) : 100,
      counters: { lessons, homework, tests, attendance, courses, achievements, claimedQuests, teacherLessons, teacherReviews },
    }
  }

  /** Счётчики за период: один источник правды для заданий, сезонов и достижений. */
  private async counters(userId: string, role: RoleName, from: Date, to: Date): Promise<CounterSet> {
    const range = { gte: from, lte: to }
    const [lessons, homework, tests, attendance, positive, negative, perfect, achievements, claimed, courses, teacherLessons, teacherReviews, eventParticipations, contestPodiums, txDates, attendanceDates] =
      await Promise.all([
        this.prisma.client.lessonProgress.count({ where: { studentId: userId, completedAt: range } }),
        this.prisma.client.homeworkSubmission.count({ where: { studentId: userId, status: 'REVIEWED', reviewedAt: range } }),
        this.prisma.client.testAttempt.count({ where: { studentId: userId, status: 'SUBMITTED', submittedAt: range } }),
        this.prisma.client.attendance.count({ where: { userId, status: { not: 'ABSENT' }, joinedAt: range } }),
        this.prisma.client.coinTransaction.aggregate({ where: { userId, status: 'POSTED', amount: { gt: 0 }, createdAt: range }, _sum: { amount: true } }),
        this.prisma.client.coinTransaction.aggregate({ where: { userId, status: 'POSTED', amount: { lt: 0 }, createdAt: range }, _sum: { amount: true } }),
        this.prisma.client.testAttempt.count({ where: { studentId: userId, status: 'SUBMITTED', percent: { gte: 90 }, submittedAt: range } }),
        this.prisma.client.userAchievement.count({ where: { userId, awardedAt: range } }),
        this.prisma.client.userQuestProgress.count({ where: { userId, claimedAt: range } }),
        this.prisma.client.courseEnrollment.count({ where: { studentId: userId, status: 'COMPLETED' } }),
        this.prisma.client.schedule.count({ where: { teacherId: userId, status: 'COMPLETED', startsAt: range } }),
        this.prisma.client.homeworkReview.count({ where: { reviewerId: userId, createdAt: range } }),
        this.prisma.client.eventRegistration.count({ where: { userId, status: 'REGISTERED', registeredAt: range } }),
        this.prisma.client.eventResult.count({ where: { userId, place: { lte: 3 }, publishedAt: range } }),
        this.prisma.client.coinTransaction.findMany({ where: { userId, status: 'POSTED', amount: { gt: 0 }, createdAt: range }, select: { createdAt: true } }),
        this.prisma.client.attendance.findMany({ where: { userId, status: { not: 'ABSENT' }, joinedAt: range }, select: { joinedAt: true } }),
      ])
    const activeDays = new Set([...txDates.map((item) => dateKey(item.createdAt)), ...attendanceDates.map((item) => dateKey(item.joinedAt))])
    return {
      lessons_completed: lessons,
      homework_reviewed: homework,
      tests_completed: tests,
      perfect_tests: perfect,
      attendance,
      coins_earned: positive._sum.amount ?? 0,
      coins_spent: Math.abs(negative._sum.amount ?? 0),
      active_days: activeDays.size,
      achievements,
      quests_completed: claimed,
      courses_completed: courses,
      teacher_lessons: teacherLessons,
      teacher_reviews: teacherReviews,
      event_participations: eventParticipations,
      contest_podiums: contestPodiums,
    }
  }

  private async targetUser(userId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    })
    if (!user) throw notFound('Пользователь не найден')
    return user
  }

  private async assertParentAccess(parentUserId: string, studentUserId: string) {
    const parent = await this.prisma.client.parent.findUnique({ where: { userId: parentUserId }, select: { id: true } })
    if (!parent) throw forbidden('Профиль родителя не найден')
    const link = await this.prisma.client.parentStudentLink.findFirst({
      where: { parentId: parent.id, studentId: studentUserId, verifiedAt: { not: null } },
      select: { id: true },
    })
    if (!link) throw forbidden('Нет подтверждённой связи с этим учеником')
  }

  // ---------- обзор и история ----------

  async overview(userId: string, role: RoleName) {
    await this.ensureDefaults()
    const [profile, balance, recent, achievements, activeSeason, unread] = await Promise.all([
      this.refreshProfile(userId, role),
      this.balanceOf(userId),
      this.prisma.client.coinTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          awardedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.client.userAchievement.findMany({
        where: { userId },
        orderBy: { awardedAt: 'desc' },
        take: 5,
        include: { achievement: { select: { title: true, description: true, rarity: true } } },
      }),
      this.prisma.client.coinSeason.findFirst({ where: { isActive: true, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'desc' } }),
      this.prisma.client.notification.count({ where: { userId, readAt: null } }),
    ])
    const quests = await this.quests(userId)
    const season = activeSeason ? await this.seasonProgress(userId, activeSeason.id) : null
    return {
      balance,
      xp: profile.xp,
      level: profile.profile.level,
      levelTitle: profile.level?.title ?? 'Новичок',
      nextLevel: profile.next ? { title: profile.next.title, thresholdXp: profile.next.thresholdXp } : null,
      levelProgress: profile.progress,
      streak: { current: profile.profile.streakCurrent, best: profile.profile.streakBest },
      profile: { lastActivityDate: profile.profile.lastActivityDate },
      recent,
      achievements: achievements.map((item) => ({
        title: item.achievement.title,
        description: item.achievement.description,
        rarity: item.achievement.rarity,
        awardedAt: item.awardedAt,
      })),
      quests: quests.quests,
      season,
      unreadNotifications: unread,
    }
  }

  async transactions(
    userId: string,
    role: RoleName,
    query: { page?: number; limit?: number; sourceType?: CoinSource; status?: CoinTransactionStatus; from?: string; to?: string; search?: string },
  ) {
    const page = Math.max(1, query.page ?? 1)
    const limit = Math.min(100, Math.max(1, query.limit ?? 20))
    const target = userId
    if (role === 'ADMIN' || role === 'MANAGER') {
      const where = {
        ...(query.sourceType ? { sourceType: query.sourceType } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
        ...(query.search
          ? {
              OR: [
                { reason: { contains: query.search, mode: 'insensitive' as const } },
                { user: { firstName: { contains: query.search, mode: 'insensitive' as const } } },
                { user: { lastName: { contains: query.search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      }
      const [items, total] = await Promise.all([
        this.prisma.client.coinTransaction.findMany({
          where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
            awardedBy: { select: { id: true, firstName: true, lastName: true } },
            appeal: true,
          },
        }),
        this.prisma.client.coinTransaction.count({ where }),
      ])
      return { items, total, page, limit, balance: null }
    }
    const where = {
      userId: target,
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    }
    const [items, total, balance, earned, spent] = await Promise.all([
      this.prisma.client.coinTransaction.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { appeal: true, awardedBy: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.client.coinTransaction.count({ where }),
      this.balanceOf(target),
      this.prisma.client.coinTransaction.aggregate({ where: { userId: target, status: 'POSTED', amount: { gt: 0 } }, _sum: { amount: true } }),
      this.prisma.client.coinTransaction.aggregate({ where: { userId: target, status: 'POSTED', amount: { lt: 0 } }, _sum: { amount: true } }),
    ])
    return {
      items, total, page, limit, balance,
      totals: { earned: earned._sum.amount ?? 0, spent: Math.abs(spent._sum.amount ?? 0) },
    }
  }

  async pending(role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER') throw forbidden('Подтверждения доступны администратору или менеджеру')
    return this.prisma.client.coinTransaction.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })
  }

  // ---------- транзакции ----------

  private async postTransaction(
    tx: Tx,
    input: {
      userId: string
      amount: number
      reason: string
      sourceType?: CoinSource
      sourceId?: string | null
      awardedById?: string | null
      metadata?: Prisma.InputJsonValue
      status?: CoinTransactionStatus
    },
  ) {
    const amount = Math.trunc(input.amount)
    if (!Number.isInteger(amount) || amount === 0) throw badRequest('Сумма операции должна быть целым числом, отличным от нуля')
    const status = input.status ?? 'POSTED'
    const current = await tx.coinBalance.findUnique({ where: { userId: input.userId } })
    const balance = current?.balance ?? 0
    if (status === 'POSTED' && balance + amount < 0) throw conflict('Недостаточно IT Coins для списания')
    const created = await tx.coinTransaction.create({
      data: {
        userId: input.userId,
        amount,
        reason: input.reason,
        sourceType: input.sourceType ?? 'MANUAL',
        sourceId: input.sourceId ?? null,
        awardedById: input.awardedById ?? null,
        status,
        metadata: input.metadata,
      },
    })
    if (status !== 'POSTED') return created
    const updated = await tx.coinBalance.upsert({
      where: { userId: input.userId },
      update: { balance: { increment: amount } },
      create: { userId: input.userId, balance: amount },
    })
    return tx.coinTransaction.update({ where: { id: created.id }, data: { balanceAfter: updated.balance } })
  }

  async award(
    actor: { userId: string; role: RoleName },
    input: { userId: string; amount: number; reason: string; sourceType?: CoinSource; sourceId?: string },
  ) {
    if (!['ADMIN', 'MANAGER', 'TEACHER'].includes(actor.role)) throw forbidden('Начислять IT Coins может наставник, менеджер или администратор')
    const target = await this.targetUser(input.userId)
    if (target.role === 'PARENT') throw badRequest('Нельзя начислять IT Coins родителю')
    const rules = await this.rules()
    const amount = Math.trunc(input.amount)
    if (amount <= 0) throw badRequest('Сумма начисления должна быть положительной')

    if (actor.role === 'TEACHER') {
      if (amount > rules.maxManualAward) throw forbidden(`Одно начисление не может превышать ${rules.maxManualAward} IT Coins`)
      const taught = await this.prisma.client.courseEnrollment.count({
        where: { studentId: target.id, course: { teacherId: actor.userId } },
      })
      if (target.role !== 'STUDENT' || taught === 0) throw forbidden('Начислять можно только ученикам ваших групп')
      const today = new Date()
      const sum = await this.prisma.client.coinTransaction.aggregate({
        where: { awardedById: actor.userId, status: 'POSTED', amount: { gt: 0 }, createdAt: { gte: startOfDay(today), lt: endOfDay(today) } },
        _sum: { amount: true },
      })
      if ((sum._sum.amount ?? 0) + amount > rules.teacherDailyLimit) {
        throw conflict(`Дневной лимит наставника — ${rules.teacherDailyLimit} IT Coins`)
      }
    }

    const from = startOfDay(new Date())
    const weekFrom = startOfWeek(new Date())
    const [daySum, weekSum, sameRecent] = await Promise.all([
      this.prisma.client.coinTransaction.aggregate({
        where: { userId: target.id, status: 'POSTED', amount: { gt: 0 }, createdAt: { gte: from } }, _sum: { amount: true },
      }),
      this.prisma.client.coinTransaction.aggregate({
        where: { userId: target.id, status: 'POSTED', amount: { gt: 0 }, createdAt: { gte: weekFrom } }, _sum: { amount: true },
      }),
      this.prisma.client.coinTransaction.count({
        where: {
          userId: target.id, awardedById: actor.userId, amount, reason: input.reason.trim(),
          createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
        },
      }),
    ])
    const suspicious =
      amount >= rules.suspiciousAmount ||
      sameRecent > 0 ||
      (daySum._sum.amount ?? 0) + amount > rules.dailyAwardLimit ||
      (weekSum._sum.amount ?? 0) + amount > rules.weeklyAwardLimit

    if (actor.role === 'TEACHER' && suspicious) {
      throw conflict('Начисление требует подтверждения администратора: превышен лимит или операция выглядит подозрительной')
    }

    const status: CoinTransactionStatus = suspicious && actor.role !== 'TEACHER' ? 'PENDING' : 'POSTED'
    const created = await this.prisma.client.$transaction((tx) =>
      this.postTransaction(tx, {
        userId: target.id,
        amount,
        reason: input.reason.trim(),
        sourceType: input.sourceType ?? 'MANUAL',
        sourceId: input.sourceId,
        awardedById: actor.userId,
        status,
        metadata: suspicious ? { suspicious: true, rules: { daily: rules.dailyAwardLimit, weekly: rules.weeklyAwardLimit } } : undefined,
      }),
    )
    await this.notify(
      target.id,
      status === 'PENDING' ? 'Начисление ожидает подтверждения' : `+${amount} IT Coins`,
      status === 'PENDING' ? `${input.reason}: операция проверяется администратором` : input.reason,
      status === 'PENDING' ? 'SYSTEM' : 'COINS_AWARDED',
    )
    await writeAudit({
      actorId: actor.userId,
      action: status === 'PENDING' ? 'coins.award.pending' : 'coins.awarded',
      entity: 'CoinTransaction',
      entityId: created.id,
      metadata: { targetId: target.id, amount, reason: input.reason, suspicious },
    })
    return { ...created, requiresApproval: status === 'PENDING' }
  }

  async approve(transactionId: string, actor: { userId: string; role: RoleName }) {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') throw forbidden('Подтверждает администратор или менеджер')
    const result = await this.prisma.client.$transaction(async (tx) => {
      const item = await tx.coinTransaction.findUnique({ where: { id: transactionId } })
      if (!item) throw notFound('Операция не найдена')
      if (item.status !== 'PENDING') throw conflict('Операция не ожидает подтверждения')
      if (item.amount < 0) {
        const current = await tx.coinBalance.findUnique({ where: { userId: item.userId } })
        if ((current?.balance ?? 0) + item.amount < 0) throw conflict('Недостаточно IT Coins для списания')
      }
      const balance = await tx.coinBalance.upsert({
        where: { userId: item.userId },
        update: { balance: { increment: item.amount } },
        create: { userId: item.userId, balance: item.amount },
      })
      return tx.coinTransaction.update({
        where: { id: item.id },
        data: { status: 'POSTED', balanceAfter: balance.balance, metadata: { ...(item.metadata as object ?? {}), approvedById: actor.userId } },
      })
    })
    await this.notify(result.userId, `Начисление подтверждено: +${result.amount}`, result.reason, 'COINS_AWARDED')
    await writeAudit({ actorId: actor.userId, action: 'coins.award.approve', entity: 'CoinTransaction', entityId: result.id })
    return result
  }

  async reject(transactionId: string, actor: { userId: string; role: RoleName }) {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') throw forbidden('Отклоняет администратор или менеджер')
    const item = await this.prisma.client.coinTransaction.findUnique({ where: { id: transactionId } })
    if (!item) throw notFound('Операция не найдена')
    if (item.status !== 'PENDING') throw conflict('Операция не ожидает подтверждения')
    const updated = await this.prisma.client.coinTransaction.update({ where: { id: item.id }, data: { status: 'REJECTED' } })
    await this.notify(item.userId, 'Начисление отклонено', item.reason, 'SYSTEM')
    await writeAudit({ actorId: actor.userId, action: 'coins.award.reject', entity: 'CoinTransaction', entityId: item.id })
    return updated
  }

  async penalty(actor: { userId: string; role: RoleName }, input: { userId: string; amount: number; reason: string }) {
    if (actor.role !== 'ADMIN') throw forbidden('Списание настраивает и выполняет администратор филиала')
    const target = await this.targetUser(input.userId)
    const rules = await this.rules()
    const amount = Math.trunc(input.amount)
    if (amount <= 0) throw badRequest('Сумма списания должна быть положительной')
    const status: CoinTransactionStatus = amount > rules.penaltyApprovalThreshold ? 'PENDING' : 'POSTED'
    const created = await this.prisma.client.$transaction((tx) =>
      this.postTransaction(tx, {
        userId: target.id,
        amount: -amount,
        reason: input.reason.trim(),
        sourceType: 'PENALTY',
        sourceId: `penalty:${randomUUID()}`,
        awardedById: actor.userId,
        status,
        metadata: { penalty: true, requiresApproval: status === 'PENDING' },
      }),
    )
    await this.notify(
      target.id,
      status === 'PENDING' ? 'Списание ожидает подтверждения' : `Списание −${amount} IT Coins`,
      input.reason,
      'SYSTEM',
    )
    await writeAudit({ actorId: actor.userId, action: 'coins.penalty', entity: 'CoinTransaction', entityId: created.id, metadata: { targetId: target.id, amount } })
    return created
  }

  async appeal(transactionId: string, userId: string, reason: string) {
    const item = await this.prisma.client.coinTransaction.findFirst({ where: { id: transactionId, userId }, include: { appeal: true } })
    if (!item) throw notFound('Операция не найдена')
    if (item.amount >= 0) throw badRequest('Обжаловать можно только списание')
    if (item.status !== 'POSTED') throw conflict('Обжаловать можно только проведённое списание')
    if (item.appeal) throw conflict('По этой операции уже есть обращение')
    const appeal = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.coinAppeal.create({ data: { transactionId, reason: reason.trim() } })
      await tx.coinTransaction.update({ where: { id: transactionId }, data: { status: 'APPEALED' } })
      return created
    })
    const admins = await this.prisma.client.user.findMany({ where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true, deletedAt: null }, select: { id: true } })
    if (admins.length) {
      await this.prisma.client.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id, type: 'SYSTEM' as const, title: 'Обжалование списания',
          body: reason.trim(), data: { kind: 'coin_appeal', appealId: appeal.id, transactionId },
        })),
      }).catch(() => undefined)
    }
    await writeAudit({ actorId: userId, action: 'coins.appeal', entity: 'CoinAppeal', entityId: appeal.id })
    return appeal
  }

  async appeals(role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER') throw forbidden('Обращения доступны администратору или менеджеру')
    return this.prisma.client.coinAppeal.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        transaction: {
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
      },
    })
  }

  async reviewAppeal(appealId: string, actor: { userId: string; role: RoleName }, input: { approve: boolean; resolution?: string }) {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') throw forbidden('Решение принимает администратор или менеджер')
    const appeal = await this.prisma.client.coinAppeal.findUnique({ where: { id: appealId }, include: { transaction: true } })
    if (!appeal) throw notFound('Обращение не найдено')
    if (appeal.status !== 'PENDING') throw conflict('Обращение уже рассмотрено')
    if (!input.approve) {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const result = await tx.coinAppeal.update({
          where: { id: appealId },
          data: { status: 'REJECTED', resolution: input.resolution ?? null, reviewedById: actor.userId, reviewedAt: new Date() },
        })
        await tx.coinTransaction.update({ where: { id: appeal.transactionId }, data: { status: 'POSTED' } })
        return result
      })
      await this.notify(appeal.transaction.userId, 'Списание оставлено в силе', input.resolution ?? 'Обращение рассмотрено', 'SYSTEM')
      await writeAudit({ actorId: actor.userId, action: 'coins.appeal.reject', entity: 'CoinAppeal', entityId: appealId })
      return updated
    }

    const refund = Math.abs(appeal.transaction.amount)
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await this.postTransaction(tx, {
        userId: appeal.transaction.userId,
        amount: refund,
        reason: `Возврат по обжалованию: ${appeal.transaction.reason}`,
        sourceType: 'REFUND',
        sourceId: `appeal:${appeal.id}`,
        awardedById: actor.userId,
        metadata: { appealId: appeal.id, originalTransactionId: appeal.transactionId },
      })
      await tx.coinAppeal.update({
        where: { id: appealId },
        data: { status: 'APPROVED', resolution: input.resolution ?? null, reviewedById: actor.userId, reviewedAt: new Date() },
      })
      return tx.coinTransaction.update({ where: { id: appeal.transactionId }, data: { status: 'REVERSED', reversedById: actor.userId, reversedAt: new Date() } })
    })
    await this.notify(appeal.transaction.userId, 'Списание отменено', `Возвращено ${refund} IT Coins`, 'COINS_AWARDED')
    await writeAudit({ actorId: actor.userId, action: 'coins.appeal.approve', entity: 'CoinAppeal', entityId: appealId })
    return updated
  }

  async reverse(transactionId: string, actor: { userId: string; role: RoleName }) {
    if (actor.role !== 'ADMIN') throw forbidden('Отменяет ошибочные начисления администратор')
    const item = await this.prisma.client.coinTransaction.findUnique({ where: { id: transactionId } })
    if (!item) throw notFound('Операция не найдена')
    if (item.status !== 'POSTED') throw conflict('Отменить можно только проведённую операцию')
    const reversal = await this.prisma.client.$transaction(async (tx) => {
      const created = await this.postTransaction(tx, {
        userId: item.userId,
        amount: -item.amount,
        reason: `Отмена операции: ${item.reason}`,
        sourceType: 'REVERSAL',
        sourceId: `reverse:${item.id}`,
        awardedById: actor.userId,
        metadata: { originalTransactionId: item.id },
      })
      await tx.coinTransaction.update({ where: { id: item.id }, data: { status: 'REVERSED', reversedById: actor.userId, reversedAt: new Date() } })
      return created
    })
    await this.notify(item.userId, 'Операция отменена', `Баланс изменён на ${reversal.amount} IT Coins`, 'SYSTEM')
    await writeAudit({ actorId: actor.userId, action: 'coins.reverse', entity: 'CoinTransaction', entityId: item.id })
    return reversal
  }

  // ---------- достижения, задания, сезоны ----------

  async levels() {
    await this.ensureDefaults()
    return this.prisma.client.coinLevel.findMany({ orderBy: { thresholdXp: 'asc' } })
  }

  async achievements(userId: string) {
    await this.ensureDefaults()
    const profile = await this.refreshProfile(userId, (await this.targetUser(userId)).role)
    const [items, earned] = await Promise.all([
      this.prisma.client.achievement.findMany({ where: { isActive: true }, orderBy: [{ rarity: 'desc' }, { title: 'asc' }] }),
      this.prisma.client.userAchievement.findMany({ where: { userId } }),
    ])
    const now = new Date()
    const counters = await this.counters(userId, (await this.targetUser(userId)).role, new Date(0), now)
    const earnedMap = new Map(earned.map((item) => [item.achievementId, item]))
    return items.map((achievement) => {
      const condition = conditionOf(achievement.condition)
      const target = Math.max(1, condition.value ?? 1)
      const current = Math.min(counters[condition.type ?? ''] ?? 0, target)
      const mine = earnedMap.get(achievement.id)
      return {
        id: achievement.id,
        code: achievement.code,
        title: achievement.title,
        description: achievement.description,
        iconUrl: achievement.iconUrl,
        rarity: achievement.rarity,
        category: achievement.category,
        collection: achievement.collection,
        conditionType: condition.type ?? null,
        current: mine ? Math.max(mine.progress, mine.target) : current,
        target: mine?.target ?? target,
        earnedAt: mine?.awardedAt ?? null,
        rewardCoins: achievement.rewardCoins || condition.rewardCoins || 0,
        level: profile.level?.title ?? 'Новичок',
      }
    })
  }

  async checkAchievements(userId: string) {
    await this.ensureDefaults()
    const user = await this.targetUser(userId)
    const [items, earned, now] = await Promise.all([
      this.prisma.client.achievement.findMany({ where: { isActive: true } }),
      this.prisma.client.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
      new Date(),
    ])
    const counters = await this.counters(userId, user.role, new Date(0), now)
    const earnedIds = new Set(earned.map((item) => item.achievementId))
    const newly: string[] = []
    for (const achievement of items) {
      if (earnedIds.has(achievement.id)) continue
      const condition = conditionOf(achievement.condition)
      const target = Math.max(1, condition.value ?? 1)
      const current = counters[condition.type ?? ''] ?? 0
      if (current < target) continue
      try {
        await this.prisma.client.$transaction(async (tx) => {
          await tx.userAchievement.create({ data: { userId, achievementId: achievement.id, progress: current, target } })
          const reward = achievement.rewardCoins || condition.rewardCoins || 0
          if (reward > 0) {
            await this.postTransaction(tx, {
              userId,
              amount: reward,
              reason: `Достижение: ${achievement.title}`,
              sourceType: 'ACHIEVEMENT',
              sourceId: achievement.id,
            })
          }
          if (condition.xp) await tx.userCoinProfile.update({ where: { userId }, data: { bonusXp: { increment: condition.xp } } })
        })
        newly.push(achievement.title)
        await this.notify(userId, 'Новое достижение', achievement.title, 'ACHIEVEMENT_UNLOCKED')
      } catch {
        // уникальный ключ защищает от повторной выдачи при параллельном запросе
      }
    }
    await this.refreshProfile(userId, user.role)
    return { awarded: newly }
  }

  async createAchievement(actor: { userId: string; role: RoleName }, input: {
    title: string; description: string; rarity: string; category: string; collection?: string;
    conditionType: string; targetValue: number; rewardCoins: number; iconUrl?: string
  }) {
    if (actor.role !== 'ADMIN') throw forbidden('Коллекцию достижений настраивает администратор филиала')
    if (!ACHIEVEMENT_RARITIES.includes(input.rarity as (typeof ACHIEVEMENT_RARITIES)[number])) throw badRequest('Неизвестная редкость')
    const code = `CUSTOM_${randomUUID().slice(0, 8).toUpperCase()}`
    const achievement = await this.prisma.client.achievement.create({
      data: {
        code,
        title: input.title,
        description: input.description,
        iconUrl: input.iconUrl,
        rarity: input.rarity,
        category: input.category,
        collection: input.collection,
        rewardCoins: input.rewardCoins,
        condition: { type: input.conditionType, value: input.targetValue, rewardCoins: input.rewardCoins },
      },
    })
    await writeAudit({ actorId: actor.userId, action: 'coins.achievement.create', entity: 'Achievement', entityId: achievement.id })
    return achievement
  }

  async quests(userId: string) {
    await this.ensureDefaults()
    const [quests, profile] = await Promise.all([
      this.prisma.client.coinQuest.findMany({ where: { isActive: true }, orderBy: [{ period: 'asc' }, { rewardCoins: 'desc' }] }),
      this.refreshProfile(userId, (await this.targetUser(userId)).role),
    ])
    const now = new Date()
    const ranges: Record<string, { from: Date; to: Date; key: string }> = {
      DAILY: { from: startOfDay(now), to: endOfDay(now), key: periodKey('DAILY', now) },
      WEEKLY: { from: startOfWeek(now), to: new Date(startOfWeek(now).getTime() + 7 * DAY), key: periodKey('WEEKLY', now) },
      SEASON: { from: new Date(0), to: now, key: 'season' },
    }
    const items = []
    for (const quest of quests) {
      const range = ranges[quest.period] ?? ranges.DAILY!
      if (quest.period === 'SEASON' && quest.seasonId) {
        const season = await this.prisma.client.coinSeason.findUnique({ where: { id: quest.seasonId } })
        // Задания завершённого или ещё не начавшегося сезона не показываем и не выдаём.
        if (!season || !season.isActive || season.endsAt <= now || season.startsAt > now) continue
        range.from = season.startsAt
        range.to = season.endsAt
        range.key = season.id
      }
      const counters = await this.counters(userId, (await this.targetUser(userId)).role, range.from, range.to)
      const progress = Math.min(counters[quest.targetType] ?? 0, quest.targetValue)
      const stored = await this.prisma.client.userQuestProgress.upsert({
        where: { userId_questId_periodKey: { userId, questId: quest.id, periodKey: range.key } },
        update: { progress, ...(progress >= quest.targetValue ? { completedAt: new Date() } : {}) },
        create: { userId, questId: quest.id, periodKey: range.key, progress, ...(progress >= quest.targetValue ? { completedAt: new Date() } : {}) },
      })
      items.push({
        id: quest.id,
        code: quest.code,
        title: quest.title,
        description: quest.description,
        period: quest.period,
        progress,
        target: quest.targetValue,
        rewardCoins: quest.rewardCoins,
        rewardXp: quest.rewardXp,
        completed: progress >= quest.targetValue,
        claimedAt: stored.claimedAt,
        periodKey: range.key,
      })
    }
    return { quests: items, level: profile.level }
  }

  async claimQuest(questId: string, userId: string) {
    const quest = await this.prisma.client.coinQuest.findUnique({ where: { id: questId } })
    if (!quest || !quest.isActive) throw notFound('Задание не найдено')
    const list = await this.quests(userId)
    const item = list.quests.find((entry) => entry.id === questId)
    if (!item) throw notFound('Задание не найдено')
    if (item.claimedAt) throw conflict('Награда уже получена')
    if (!item.completed) throw conflict('Задание ещё не выполнено')
    const result = await this.prisma.client.$transaction(async (tx) => {
      const transaction = quest.rewardCoins > 0
        ? await this.postTransaction(tx, {
            userId, amount: quest.rewardCoins, reason: `Задание: ${quest.title}`,
            sourceType: 'QUEST', sourceId: `${quest.id}:${item.periodKey}`,
          })
        : null
      if (quest.rewardXp > 0) await tx.userCoinProfile.update({ where: { userId }, data: { bonusXp: { increment: quest.rewardXp } } })
      await tx.userQuestProgress.updateMany({
        where: { userId, questId, periodKey: item.periodKey },
        data: { claimedAt: new Date(), progress: item.progress },
      })
      return transaction
    })
    await this.notify(userId, 'Награда за задание', `${quest.title}: +${quest.rewardCoins} IT Coins`, 'COINS_AWARDED')
    return { transaction: result, rewardCoins: quest.rewardCoins, rewardXp: quest.rewardXp }
  }

  private async seasonProgress(userId: string, seasonId: string) {
    const season = await this.prisma.client.coinSeason.findUnique({ where: { id: seasonId } })
    if (!season) return null
    const counters = await this.counters(userId, (await this.targetUser(userId)).role, season.startsAt, season.endsAt)
    const points = (counters.coins_earned ?? 0) + (counters.achievements ?? 0) * 20 + (counters.active_days ?? 0) * 5
    const participant = await this.prisma.client.coinSeasonParticipant.upsert({
      where: { seasonId_userId: { seasonId, userId } },
      update: { points },
      create: { seasonId, userId, points },
    })
    const quests = (await this.quests(userId)).quests.filter((item) => item.period === 'SEASON')
    return {
      id: season.id,
      title: season.title,
      description: season.description,
      theme: season.theme,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      points: participant.points,
      daysLeft: Math.max(0, Math.ceil((season.endsAt.getTime() - Date.now()) / DAY)),
      quests,
    }
  }

  async season(userId: string) {
    await this.ensureDefaults()
    const season = await this.prisma.client.coinSeason.findFirst({ where: { isActive: true, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'desc' } })
    if (!season) return null
    return this.seasonProgress(userId, season.id)
  }

  // ---------- рейтинг ----------

  async leaderboard(userId: string, role: RoleName, courseId?: string) {
    let courses: Array<{ id: string; title: string }> = []
    if (role === 'STUDENT') {
      const enrolled = await this.prisma.client.courseEnrollment.findMany({
        where: { studentId: userId, status: 'ACTIVE', ...(courseId ? { courseId } : {}) },
        select: { course: { select: { id: true, title: true } } },
      })
      courses = enrolled.map((item) => item.course)
    } else if (role === 'TEACHER') {
      courses = await this.prisma.client.course.findMany({
        where: { teacherId: userId, ...(courseId ? { id: courseId } : {}) },
        select: { id: true, title: true },
      })
    } else if (role === 'ADMIN' || role === 'MANAGER') {
      courses = await this.prisma.client.course.findMany({
        where: { ...(courseId ? { id: courseId } : {}) },
        select: { id: true, title: true },
        take: 10,
      })
    } else {
      throw forbidden('Рейтинг доступен ученику, наставнику, менеджеру и администратору')
    }
    const groups = []
    for (const course of courses) {
      const enrollments = await this.prisma.client.courseEnrollment.findMany({
        where: { courseId: course.id, status: 'ACTIVE' },
        include: { student: { select: { id: true, firstName: true, lastName: true, coinProfile: true } } },
      })
      const members = await Promise.all(enrollments.map(async (entry) => {
        const sum = await this.prisma.client.coinTransaction.aggregate({
          where: { userId: entry.student.id, status: 'POSTED', amount: { gt: 0 }, createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
          _sum: { amount: true },
        })
        return {
          userId: entry.student.id,
          name: `${entry.student.firstName} ${entry.student.lastName}`.trim(),
          earned: sum._sum.amount ?? 0,
          level: entry.student.coinProfile?.level ?? 1,
          balance: (await this.prisma.client.coinBalance.findUnique({ where: { userId: entry.student.id } }))?.balance ?? 0,
        }
      }))
      members.sort((a, b) => b.earned - a.earned || b.level - a.level)
      groups.push({ courseId: course.id, title: course.title, members: members.map((member, index) => ({ ...member, rank: index + 1 })) })
    }
    return { groups }
  }

  // ---------- магазин ----------

  private async notify(userId: string, title: string, body: string, type: 'COINS_AWARDED' | 'ACHIEVEMENT_UNLOCKED' | 'SHOP_ORDER' | 'SYSTEM' = 'SYSTEM') {
    await notifyUsers([userId], { type, title, body, data: { kind: 'economy' } }).catch(() => undefined)
  }

  async shopProducts(userId: string, query: { search?: string; category?: string; favorite?: boolean }, role: RoleName = 'STUDENT') {
    const [items, favorites] = await Promise.all([
      this.prisma.client.shopProduct.findMany({
        where: {
          ...(role === 'ADMIN' ? {} : { isActive: true }),
          ...(query.category ? { category: query.category } : {}),
          ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }] } : {}),
        },
        orderBy: [{ priceCoins: 'asc' }, { title: 'asc' }],
      }),
      this.prisma.client.shopFavorite.findMany({ where: { userId }, select: { productId: true } }),
    ])
    const favoriteIds = new Set(favorites.map((item) => item.productId))
    const filtered = query.favorite ? items.filter((item) => favoriteIds.has(item.id)) : items
    return filtered.map((item) => ({
      id: item.id, title: item.title, description: item.description, imageUrl: item.imageUrl,
      category: item.category, priceCoins: item.priceCoins, kind: item.kind, fulfillment: item.fulfillment,
      unlimitedStock: item.unlimitedStock, stock: item.unlimitedStock ? null : item.stock,
      deliveryUrl: item.deliveryUrl, terms: item.terms, isActive: item.isActive,
      favorite: favoriteIds.has(item.id), available: item.unlimitedStock || item.stock > 0,
    }))
  }

  async toggleFavorite(userId: string, productId: string) {
    const product = await this.prisma.client.shopProduct.findFirst({ where: { id: productId, isActive: true } })
    if (!product) throw notFound('Награда не найдена')
    const existing = await this.prisma.client.shopFavorite.findUnique({ where: { userId_productId: { userId, productId } } })
    if (existing) {
      await this.prisma.client.shopFavorite.delete({ where: { userId_productId: { userId, productId } } })
      return { favorite: false }
    }
    await this.prisma.client.shopFavorite.create({ data: { userId, productId } })
    return { favorite: true }
  }

  async createProduct(actor: { userId: string; role: RoleName }, input: Record<string, unknown>) {
    if (actor.role !== 'ADMIN') throw forbidden('Магазином управляет администратор филиала')
    const category = String(input.category ?? 'DIGITAL')
    if (!SHOP_CATEGORIES.includes(category as (typeof SHOP_CATEGORIES)[number])) throw badRequest('Неизвестная категория награды')
    // Категория определяет тип: физический подарок всегда согласуется вручную,
    // цифровая награда, скидка, материал и привилегия выдаются автоматически.
    const kind = category === 'PHYSICAL' ? 'PHYSICAL' : 'DIGITAL'
    if (!SHOP_KINDS.includes(kind)) throw badRequest('Неизвестный тип награды')
    const fulfillment = kind === 'PHYSICAL' ? 'MANUAL' : 'AUTOMATIC'
    if (!FULFILLMENT.includes(fulfillment)) throw badRequest('Неизвестный способ выдачи')
    const product = await this.prisma.client.shopProduct.create({
      data: {
        title: String(input.title), description: String(input.description), category,
        priceCoins: Number(input.priceCoins), kind, fulfillment,
        imageUrl: input.imageUrl ? String(input.imageUrl) : null,
        terms: input.terms ? String(input.terms) : null,
        deliveryUrl: input.deliveryUrl ? String(input.deliveryUrl) : null,
        unlimitedStock: input.unlimitedStock !== false,
        stock: input.unlimitedStock === false ? Number(input.stock ?? 0) : 0,
        isActive: input.isActive !== false,
        createdById: actor.userId,
      },
    })
    await writeAudit({ actorId: actor.userId, action: 'coins.shop.product.create', entity: 'ShopProduct', entityId: product.id })
    return product
  }

  async updateProduct(actor: { userId: string; role: RoleName }, id: string, input: Record<string, unknown>) {
    if (actor.role !== 'ADMIN') throw forbidden('Магазином управляет администратор филиала')
    const product = await this.prisma.client.shopProduct.findUnique({ where: { id } })
    if (!product) throw notFound('Награда не найдена')
    const data: Prisma.ShopProductUpdateInput = {}
    if (input.title !== undefined) data.title = String(input.title)
    if (input.description !== undefined) data.description = String(input.description)
    if (input.priceCoins !== undefined) data.priceCoins = Number(input.priceCoins)
    if (input.category !== undefined) {
      const category = String(input.category)
      if (!SHOP_CATEGORIES.includes(category as (typeof SHOP_CATEGORIES)[number])) throw badRequest('Неизвестная категория награды')
      data.category = category
    }
    // Тип и способ выдачи всегда выводятся из категории, клиент не может
    // сделать цифровую награду ручной или физический подарок автоматическим.
    const nextCategory = String(input.category ?? product.category)
    const physical = nextCategory === 'PHYSICAL'
    data.kind = physical ? 'PHYSICAL' : 'DIGITAL'
    data.fulfillment = physical ? 'MANUAL' : 'AUTOMATIC'
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl ? String(input.imageUrl) : null
    if (input.terms !== undefined) data.terms = input.terms ? String(input.terms) : null
    if (input.deliveryUrl !== undefined) data.deliveryUrl = input.deliveryUrl ? String(input.deliveryUrl) : null
    if (input.unlimitedStock !== undefined) {
      data.unlimitedStock = Boolean(input.unlimitedStock)
      if (!input.unlimitedStock) data.stock = Number(input.stock ?? 0)
    }
    if (input.isActive !== undefined) data.isActive = Boolean(input.isActive)
    const updated = await this.prisma.client.shopProduct.update({ where: { id }, data })
    await writeAudit({ actorId: actor.userId, action: 'coins.shop.product.update', entity: 'ShopProduct', entityId: id })
    return updated
  }

  async orders(userId: string, role: RoleName, query: { status?: ShopOrderStatus; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1)
    const limit = Math.min(100, Math.max(1, query.limit ?? 20))
    const where = { ...(role === 'ADMIN' || role === 'MANAGER' ? {} : { userId }), ...(query.status ? { status: query.status } : {}) }
    const [items, total] = await Promise.all([
      this.prisma.client.shopOrder.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { product: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.client.shopOrder.count({ where }),
    ])
    return { items, total, page, limit }
  }

  async createOrder(userId: string, role: RoleName, input: { productId: string; comment?: string; deliveryDetails?: string }) {
    if (role !== 'STUDENT' && role !== 'TEACHER') throw forbidden('Покупки в магазине доступны ученикам и наставникам')
    const product = await this.prisma.client.shopProduct.findFirst({ where: { id: input.productId, isActive: true } })
    if (!product) throw notFound('Награда не найдена')
    if (!product.unlimitedStock && product.stock <= 0) throw conflict('Награда закончилась')
    const balance = await this.balanceOf(userId)
    if (balance < product.priceCoins) throw conflict(`Недостаточно IT Coins: нужно ${product.priceCoins}, на балансе ${balance}`)
    const automatic = product.fulfillment === 'AUTOMATIC'
    const orderId = randomUUID()
    const order = await this.prisma.client.$transaction(async (tx) => {
      if (!product.unlimitedStock) {
        const changed = await tx.shopProduct.updateMany({ where: { id: product.id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } })
        if (changed.count === 0) throw conflict('Награда закончилась')
      }
      const created = await tx.shopOrder.create({
        data: {
          id: orderId, productId: product.id, userId, comment: input.comment,
          priceCoins: product.priceCoins,
          deliveryDetails: automatic ? (product.deliveryUrl ?? product.description) : (input.deliveryDetails ?? null),
          status: automatic ? 'ISSUED' : 'NEW',
          ...(automatic ? { issuedAt: new Date() } : {}),
        },
        include: { product: true },
      })
      await this.postTransaction(tx, {
        userId, amount: -product.priceCoins, reason: `Покупка в магазине: ${product.title}`,
        sourceType: 'SHOP', sourceId: orderId,
        metadata: { orderId, productId: product.id },
      })
      return created
    })
    await this.notify(
      userId,
      automatic ? 'Награда получена' : 'Заявка отправлена',
      automatic ? `${product.title}: награда доступна в личном кабинете` : `${product.title}: ожидает подтверждения администратора`,
      'SHOP_ORDER',
    )
    if (!automatic) {
      const admins = await this.prisma.client.user.findMany({ where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true, deletedAt: null }, select: { id: true } })
      if (admins.length) {
        await this.prisma.client.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id, type: 'SHOP_ORDER' as const, title: 'Новая заявка в магазине',
            body: `${product.title}: ${product.priceCoins} IT Coins`, data: { kind: 'shop_order', orderId },
          })),
        }).catch(() => undefined)
      }
    }
    await writeAudit({ actorId: userId, action: 'coins.shop.order', entity: 'ShopOrder', entityId: order.id, metadata: { productId: product.id, price: product.priceCoins } })
    return order
  }

  async updateOrder(actor: { userId: string; role: RoleName }, id: string, input: { status: ShopOrderStatus; deliveryDetails?: string; reason?: string }) {
    if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') throw forbidden('Заявки магазина обрабатывает администратор или менеджер')
    const order = await this.prisma.client.shopOrder.findUnique({ where: { id }, include: { product: true } })
    if (!order) throw notFound('Заявка не найдена')
    if (['REJECTED', 'CANCELLED'].includes(order.status)) throw conflict('Заявка уже закрыта')
    if (order.status === 'ISSUED' && input.status !== 'ISSUED') throw conflict('Выданную награду нельзя отменить через заявку')
    if (input.status === order.status) return order

    const refundNeeded = ['REJECTED', 'CANCELLED'].includes(input.status) && order.priceCoins !== null
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (refundNeeded && order.priceCoins) {
        await this.postTransaction(tx, {
          userId: order.userId, amount: order.priceCoins,
          reason: `Возврат за заявку: ${order.product.title}`,
          sourceType: 'REFUND', sourceId: `order-refund:${order.id}`,
          awardedById: actor.userId,
        })
        if (!order.product.unlimitedStock) {
          await tx.shopProduct.update({ where: { id: order.productId }, data: { stock: { increment: 1 } } })
        }
      }
      return tx.shopOrder.update({
        where: { id },
        data: {
          status: input.status,
          processedById: actor.userId,
          ...(input.deliveryDetails !== undefined ? { deliveryDetails: input.deliveryDetails } : {}),
          ...(input.reason !== undefined ? { rejectionReason: input.reason } : {}),
          ...(input.status === 'ISSUED' ? { issuedAt: new Date() } : {}),
        },
      })
    })
    await this.notify(
      order.userId,
      input.status === 'ISSUED' ? 'Награда выдана' : input.status === 'REJECTED' || input.status === 'CANCELLED' ? 'Заявка закрыта' : 'Заявка обновлена',
      `${order.product.title}${refundNeeded ? `: возвращено ${order.priceCoins ?? 0} IT Coins` : ''}`,
      'SHOP_ORDER',
    )
    await writeAudit({ actorId: actor.userId, action: 'coins.shop.order.status', entity: 'ShopOrder', entityId: id, metadata: { status: input.status } })
    return updated
  }

  // ---------- родитель ----------

  async parentView(parentUserId: string, studentUserId: string, query: { page?: number; limit?: number } = {}) {
    // Кабинет родителя передаёт User.id, а связь ParentStudentLink хранит Student.id — принимаем оба.
    const studentProfile = await this.prisma.client.student.findFirst({
      where: { OR: [{ id: studentUserId }, { userId: studentUserId }] },
      select: { id: true, userId: true },
    })
    if (!studentProfile) throw notFound('Ученик не найден')
    await this.assertParentAccess(parentUserId, studentProfile.id)
    const student = await this.targetUser(studentProfile.userId)
    const actualId = student.id
    const page = Math.max(1, query.page ?? 1)
    const limit = Math.min(100, Math.max(1, query.limit ?? 25))
    const [balance, profile, transactions, total, achievements] = await Promise.all([
      this.balanceOf(actualId),
      this.prisma.client.userCoinProfile.findUnique({ where: { userId: actualId } }),
      this.prisma.client.coinTransaction.findMany({
        where: { userId: actualId },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { awardedBy: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.client.coinTransaction.count({ where: { userId: actualId } }),
      this.prisma.client.userAchievement.count({ where: { userId: actualId } }),
    ])
    return {
      student: { id: student.id, name: `${student.firstName} ${student.lastName}`.trim() },
      balance,
      level: profile?.level ?? 1,
      xp: profile?.xp ?? 0,
      streak: profile?.streakCurrent ?? 0,
      achievements,
      transactions,
      total,
      page,
      limit,
    }
  }
}
