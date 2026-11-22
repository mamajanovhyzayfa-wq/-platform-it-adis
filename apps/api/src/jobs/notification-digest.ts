import { defaultPrisma, prisma } from '../lib/prisma.js'
import { controlPrisma } from '../lib/control-prisma.js'
import { getBranchPrisma, runWithTenant, tenantUploadsDir } from '../lib/tenant.js'
import { notifyUser } from '../lib/notify.js'
import { withDistributedLock } from '../lib/redis.js'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Ежедневная/недельная сводка непрочитанных уведомлений с учётом настроек канала. */
export async function sendNotificationDigests(now = new Date()): Promise<number> {
  const dayStart = startOfUtcDay(now)
  const weekly = now.getUTCDay() === 1
  const preferences = await prisma.notificationPreference.findMany({
    where: { digest: { in: weekly ? ['DAILY', 'WEEKLY'] : ['DAILY'] } },
    select: { userId: true, digest: true, digestHour: true },
  })
  let sent = 0

  for (const preference of preferences) {
    if (preference.digestHour !== now.getUTCHours()) continue
    const windowStart = preference.digest === 'WEEKLY' ? new Date(dayStart.getTime() - 7 * DAY_MS) : new Date(dayStart.getTime() - DAY_MS)
    const existing = await prisma.notification.findFirst({
      where: {
        userId: preference.userId,
        type: 'DIGEST',
        createdAt: { gte: dayStart },
      },
      select: { id: true },
    })
    if (existing) continue

    const where = { userId: preference.userId, readAt: null, createdAt: { gte: windowStart }, type: { not: 'DIGEST' as const } }
    const [unread, totalUnread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { title: true, body: true, createdAt: true },
      }),
      prisma.notification.count({ where }),
    ])
    if (totalUnread === 0) continue

    const lines = unread.map((item) => `• ${item.title}: ${item.body}`).join('\n')
    await notifyUser(preference.userId, {
      type: 'DIGEST',
      title: preference.digest === 'WEEKLY' ? 'Недельная сводка ITadis' : 'Сводка ITadis за день',
      body: `Непрочитанных уведомлений: ${totalUnread}. ${lines.slice(0, 1200)}`,
      data: { kind: 'notification_digest', digest: preference.digest, totalUnread },
      email: {
        subject: preference.digest === 'WEEKLY' ? 'ITadis: недельная сводка' : 'ITadis: сводка за день',
        text: `Здравствуйте!\n\nНепрочитанных уведомлений: ${totalUnread}.\n\n${lines}`,
      },
      sms: `ITadis: ${totalUnread} непрочитанных уведомлений. Откройте кабинет.`,
    })
    sent += 1
  }
  return sent
}

export function startNotificationDigestLoop(intervalMs = 60 * 60 * 1000): () => void {
  let running = false
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const branches = await controlPrisma.branch.findMany({ where: { status: 'ACTIVE' } })
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
          const sent = await runWithTenant(tenant, () => sendNotificationDigests())
          if (sent > 0) console.log(`[digest] ${branch.slug}: отправлено сводок ${sent}`)
        } catch (error) {
          console.warn(`[digest] филиал ${branch.slug} не обработан`, error instanceof Error ? error.message : error)
        }
      }
    } catch (error) {
      console.warn('[digest] цикл упал', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }
  // В нескольких репликах цикл выполняет только владелец Redis-блокировки.
  const guardedTick = async (): Promise<void> => {
    await withDistributedLock('cron:notification-digest', 30 * 60_000, tick)
  }
  const timer = setInterval(() => void guardedTick(), intervalMs)
  timer.unref()
  void guardedTick()
  return () => clearInterval(timer)
}
