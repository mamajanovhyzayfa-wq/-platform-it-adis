import { prisma } from '../../lib/prisma.js'
import { sendPushToUsers } from '../../lib/push.js'

/**
 * Напоминания о начале занятия.
 *
 * Отдельный лёгкий цикл вместо очереди: каждую минуту ищет занятия, до которых осталось
 * меньше 15 минут, и создаёт уведомление ученикам и преподавателю. Повторная отправка
 * исключается проверкой уже сохранённого уведомления с тем же scheduleId.
 */

const LOOKAHEAD_MS = 15 * 60 * 1000
const DEDUPE_WINDOW_MS = 3 * 60 * 60 * 1000

function minutesLeft(startsAt: Date, now: Date): number {
  return Math.max(1, Math.round((startsAt.getTime() - now.getTime()) / 60_000))
}

export async function sendLessonReminders(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS)

  const lessons = await prisma.schedule.findMany({
    where: {
      status: 'SCHEDULED',
      startsAt: { gt: now, lte: horizon },
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
    },
    take: 200,
  })

  let sent = 0

  for (const lesson of lessons) {
    const userIds = [...new Set([lesson.teacherId, ...lesson.course.enrollments.map((item) => item.studentId)])]
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
    const recipients = userIds.filter((userId) => !notified.has(userId))
    if (recipients.length === 0) continue

    const left = minutesLeft(lesson.startsAt, now)
    const title = 'Занятие начнётся скоро'
    const body = `${lesson.course.title}: «${lesson.title}» через ${left} мин`

    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        type: 'LESSON_STARTING' as const,
        title,
        body,
        data: { scheduleId: lesson.id, courseId: lesson.course.id },
      })),
    })

    sent += await sendPushToUsers(recipients, {
      title,
      body,
      data: { type: 'LESSON_STARTING', scheduleId: lesson.id, courseId: lesson.course.id },
    })
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
      const sent = await sendLessonReminders()
      if (sent > 0) console.log(`[reminders] отправлено напоминаний: ${sent}`)
    } catch (error) {
      console.warn('[reminders] цикл напоминаний упал', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref()
  void tick()

  return () => clearInterval(timer)
}
