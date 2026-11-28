import { defaultPrisma, prisma } from '../../lib/prisma.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { getBranchPrisma, runWithTenant, tenantUploadsDir } from '../../lib/tenant.js'
import { notifyInvoiceParties } from './finance.notify.js'
import { withDistributedLock } from '../../lib/redis.js'

/**
 * Напоминания о просроченной оплате.
 *
 * Ученик и подтверждённые родители получают PAYMENT_DUE через общий
 * notifyUsers. Повтор по одному счёту исключается уведомлением за последние
 * 20 часов, а при отключённом внутреннем канале — памятью процесса.
 */

const DEDUPE_MS = 20 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const reminded = new Map<string, number>()

function pruneMemory(now: Date): void {
  for (const [key, at] of reminded) {
    if (now.getTime() - at > DEDUPE_MS) reminded.delete(key)
  }
}

async function sendPaymentDueReminders(now = new Date()): Promise<number> {
  pruneMemory(now)
  const invoices = await prisma.invoice.findMany({
    where: {
      dueAt: { lt: now },
      status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
    },
    orderBy: { dueAt: 'asc' },
    take: 200,
    select: { id: true, number: true, amount: true, dueAt: true },
  })

  let sent = 0
  for (const invoice of invoices) {
    if (reminded.has(invoice.id)) continue
    const existing = await prisma.notification.findFirst({
      where: {
        type: 'PAYMENT_DUE',
        createdAt: { gte: new Date(now.getTime() - DEDUPE_MS) },
        data: { path: ['invoiceId'], equals: invoice.id },
      },
      select: { id: true },
    })
    if (existing) {
      reminded.set(invoice.id, now.getTime())
      continue
    }

    const overdueDays = Math.max(1, Math.floor((now.getTime() - invoice.dueAt.getTime()) / DAY_MS))
    await notifyInvoiceParties({
      invoiceId: invoice.id,
      type: 'PAYMENT_DUE',
      title: 'Просрочена оплата обучения',
      body: `Счёт ${invoice.number} на ${invoice.amount} KGS просрочен на ${overdueDays} дн.`,
      data: { kind: 'invoice_overdue', dueAt: invoice.dueAt.toISOString() },
    })
    reminded.set(invoice.id, now.getTime())
    sent += 1
  }
  return sent
}

/** Останавливает цикл напоминаний об оплате при shutdown приложения. */
export function startPaymentDueReminderLoop(intervalMs = 6 * 60 * 60 * 1000): () => void {
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
          sent += await runWithTenant(tenant, () => sendPaymentDueReminders())
        } catch (error) {
          console.warn(
            `[finance-reminders] филиал ${branch.slug} не обработан`,
            error instanceof Error ? error.message : error,
          )
        }
      }
      if (sent > 0) console.log(`[finance-reminders] отправлено напоминаний: ${sent}`)
    } catch (error) {
      console.warn('[finance-reminders] цикл упал', error instanceof Error ? error.message : error)
    } finally {
      running = false
    }
  }

  // В нескольких репликах цикл выполняет только владелец Redis-блокировки.
  const guardedTick = async (): Promise<void> => {
    await withDistributedLock('cron:finance-reminders', 60 * 60_000, tick)
  }
  const timer = setInterval(() => void guardedTick(), intervalMs)
  timer.unref()
  void guardedTick()
  return () => clearInterval(timer)
}
