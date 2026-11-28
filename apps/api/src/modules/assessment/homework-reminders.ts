import { defaultPrisma, prisma } from '../../lib/prisma.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { getBranchPrisma, runWithTenant, tenantUploadsDir } from '../../lib/tenant.js'
import { notifyUsers } from '../../lib/notify.js'
import { withDistributedLock } from '../../lib/redis.js'

/**
 * Напоминания о сроке сдачи домашнего задания.
 *
 * Цикл ищет задания, до дедлайна которых осталось меньше суток, и напоминает
 * только тем, кто ещё не отправил работу. Повтор исключается записью
 * HOMEWORK_DUE_SOON за последние 20 часов, а для пользователей с отключёнными
 * внутренними уведомлениями — дополнительной памятью процесса.
 */

const LOOKAHEAD_MS = 24 * 60 * 60 * 1000
const DEDUPE_MS = 20 * 60 * 60 * 1000
const reminded = new Map<string, number>()

function pruneMemory(now: Date): void {
  for (const [key, at] of reminded) {
    if (now.getTime() - at > DEDUPE_MS) reminded.delete(key)
  }
}

async function sendHomeworkDueReminders(now = new Date()): Promise<number> {
  pruneMemory(now)
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS)
  const homework = await prisma.homework.findMany({
    where: { dueAt: { gt: now, lte: horizon } },
    orderBy: { dueAt: 'asc' },
    take: 200,
    select: {
      id: true,
      title: true,
      dueAt: true,
      courseId: true,
      assignAll: true,
      course: {
        select: {
          title: true,
          enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
        },
      },
      targets: { select: { studentId: true } },
      submissions: { select: { studentId: true, status: true } },
    },
  })

  let sent = 0
  for (const item of homework) {
    const assigned = item.assignAll
      ? item.course.enrollments.map((row) => row.studentId)
      : item.targets.map((row) => row.studentId)
    // Отправленная или принятая работа не требует напоминания; RETURNED требует.
    const completed = new Set(
      item.submissions
        .filter((submission) => submission.status === 'SUBMITTED' || submission.status === 'REVIEWED')
        .map((submission) => submission.studentId),
    )
    const candidates = [...new Set(assigned)].filter(
      (userId) => !completed.has(userId) && !reminded.has(`${item.id}:${userId}`),
    )
    if (candidates.length === 0) continue

    const alreadyNotified = await prisma.notification.findMany({
      where: {
        userId: { in: candidates },
        type: 'HOMEWORK_DUE_SOON',
        createdAt: { gte: new Date(now.getTime() - DEDUPE_MS) },
        data: { path: ['homeworkId'], equals: item.id },
      },
      select: { userId: true },
    })
    const notified = new Set(alreadyNotified.map((row) => row.userId))
    const recipients = candidates.filter((userId) => !notified.has(userId))
    if (recipients.length === 0) continue

    const dueLabel = item.dueAt.toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })
    const title = 'Срок сдачи домашнего задания'
    const body = `«${item.title}» по курсу «${item.course.title}» нужно сдать до ${dueLabel}.`
    await notifyUsers(recipients, {
      type: 'HOMEWORK_DUE_SOON',
      title,
      body,
      data: { kind: 'homework_due', homeworkId: item.id, courseId: item.courseId },
      email: { subject: `ITadis: ${title}`, text: body },
      sms: `ITadis: ${body}`.slice(0, 160),
    })
    for (const userId of recipients) reminded.set(`${item.id}:${userId}`, now.getTime())
    sent += recipients.length
  }
  return sent
}

/** Останавливает цикл напоминаний о дедлайнах при shutdown приложения. */
export function startHomeworkReminderLoop(intervalMs = 30 * 60 * 1000): () => void {
  let running = false

  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
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
          sent += await runWithTenant(tenant, () => sendHomeworkDueReminders())
        } catch (error) {
          console.warn(
            `[homework-reminders] филиал ${branch.slug} не обработан`,
            error instanceof Error ? error.message : error,
          )
        }
      }
      if (sent > 0) console.log(`[homework-reminders] отправлено напоминаний: ${sent}`)
    } catch (error) {
      console.warn('[homework-reminders] цикл упал', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }

  // В нескольких репликах цикл выполняет только владелец Redis-блокировки.
  const guardedTick = async (): Promise<void> => {
    await withDistributedLock('cron:homework-reminders', 30 * 60_000, tick)
  }
  const timer = setInterval(() => void guardedTick(), intervalMs)
  timer.unref()
  void guardedTick()
  return () => clearInterval(timer)
}
