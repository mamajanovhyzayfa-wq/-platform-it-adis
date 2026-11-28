import { defaultPrisma, prisma } from '../../lib/prisma.js'
import { notifyUsers } from '../../lib/notify.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { getBranchPrisma, runWithTenant, tenantUploadsDir } from '../../lib/tenant.js'
import { withDistributedLock } from '../../lib/redis.js'

/**
 * Напоминания о начале занятия.
 *
 * Отдельный лёгкий цикл вместо очереди: каждую минуту ищет занятия, до которых осталось
 * меньше 15 минут, и создаёт уведомление ученикам и преподавателю. Повторная отправка
 * исключается проверкой уже сохранённого уведомления с тем же scheduleId.
 */

const LOOKAHEAD_MS = 15 * 60 * 1000
const DEDUPE_WINDOW_MS = 3 * 60 * 60 * 1000
// Пользователи с отключённым внутренним каналом не оставляют строку в БД.
const reminded = new Map<string, number>()

function minutesLeft(startsAt: Date, now: Date): number {
  return Math.max(1, Math.round((startsAt.getTime() - now.getTime()) / 60_000))
}

async function sendLessonReminders(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS)

  const lessons = await prisma.schedule.findMany({
    where: {
      status: 'SCHEDULED',
      startsAt: { gt: now, lte: horizon },
      // Черновики дополнительных занятий не анонсируем до публикации.
      OR: [{ kind: 'REGULAR' }, { publishedAt: { not: null } }],
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      teacherId: true,
      course: {
        select: {
          id: true,
          title: true,
          enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
        },
      },
      extraEnrollments: { where: { status: 'REGISTERED' }, select: { userId: true } },
    },
    take: 200,
  })

  let sent = 0

  for (const lesson of lessons) {
    const userIds = [
      ...new Set([
        lesson.teacherId,
        ...lesson.course.enrollments.map((item) => item.studentId),
        ...lesson.extraEnrollments.map((item) => item.userId),
      ]),
    ]
    if (userIds.length === 0) continue

    const alreadySent = await prisma.notification.findMany({
      where: {
        userId: { in: userIds },
        type: 'LESSON_STARTING',
        createdAt: { gte: new Date(now.getTime() - DEDUPE_WINDOW_MS) },
        data: { path: ['scheduleId'], equals: lesson.id },
      },
      select: { userId: true },
    })

    const notified = new Set(alreadySent.map((item) => item.userId))
    const recipients = userIds.filter(
      (userId) =>
        !notified.has(userId) &&
        !(reminded.get(`${lesson.id}:${userId}`) && Date.now() - reminded.get(`${lesson.id}:${userId}`)! < DEDUPE_WINDOW_MS),
    )
    if (recipients.length === 0) continue

    const left = minutesLeft(lesson.startsAt, now)
    const title = 'Занятие начнётся скоро'
    const body = `${lesson.course.title}: «${lesson.title}» через ${left} мин`

    await notifyUsers(recipients, {
      type: 'LESSON_STARTING',
      title,
      body,
      data: { kind: 'lesson_starting', scheduleId: lesson.id, courseId: lesson.course.id },
      email: { subject: `ITadis: ${title}`, text: body },
      sms: `ITadis: ${body}`.slice(0, 160),
    })
    for (const userId of recipients) reminded.set(`${lesson.id}:${userId}`, Date.now())
    sent += recipients.length
  }

  return sent
}

/** Возвращает функцию остановки цикла — её вызывает shutdown приложения. */
export function startLessonReminderLoop(intervalMs = 60_000): () => void {
  let running = false

  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      // Напоминания каждого активного филиала считаются в его собственной БД.
      const branches = await controlPrisma.branch.findMany({ where: { status: 'ACTIVE' } })
      let sent = 0
      for (const branch of branches) {
        const tenant = {
          branchId: branch.id,
          branchSlug: branch.slug,
          domain: branch.domain,
          isPrimary: branch.isPrimary,
          prisma: branch.isPrimary ? defaultPrisma : getBranchPrisma(branch.id, branch.databaseName),
          uploadsDir: tenantUploadsDir(branch.slug, branch.isPrimary),
        }
        try {
          sent += await runWithTenant(tenant, () => sendLessonReminders())
        } catch (error) {
          console.warn(
            `[reminders] филиал ${branch.slug} не обработан`,
            error instanceof Error ? error.message : error,
          )
        }
      }
      if (sent > 0) console.log(`[reminders] отправлено напоминаний: ${sent}`)
    } catch (error) {
      console.warn('[reminders] цикл напоминаний упал', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }

  // В нескольких репликах цикл выполняет только владелец Redis-блокировки.
  const guardedTick = async (): Promise<void> => {
    await withDistributedLock('cron:lesson-reminders', 5 * 60_000, tick)
  }
  const timer = setInterval(() => void guardedTick(), intervalMs)
  timer.unref()
  void guardedTick()

  return () => clearInterval(timer)
}
