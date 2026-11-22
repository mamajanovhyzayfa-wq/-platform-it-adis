import { Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { env } from '../config/env.js'
import { controlPrisma } from './control-prisma.js'
import { invalidateBranchCache } from './branch-registry.js'
import { isValidDomain, normalizeDomain } from './branches.util.js'

/**
 * Основной филиал по умолчанию создан миграцией с доменом `primary.local`.
 * В production fallback неизвестных доменов выключен, поэтому основной домен
 * нужно явно привязать к записи isPrimary. Иначе главный сайт отвечал бы 404.
 *
 * Функция идемпотентна: при рестарте обновляет домен, не создаёт дубликаты и
 * не позволяет занять домен, уже принадлежащий другому филиалу.
 */
export async function ensurePrimaryBranch(): Promise<void> {
  const requested = env.PRIMARY_DOMAIN?.trim()
  if (!requested) {
    if (env.NODE_ENV === 'production' && !env.ALLOW_PRIMARY_FALLBACK) {
      throw new Error(
        'PRIMARY_DOMAIN обязателен в production при выключенном ALLOW_PRIMARY_FALLBACK: иначе основной сайт не найдёт филиал',
      )
    }
    return
  }

  const domain = normalizeDomain(requested)
  if (!isValidDomain(domain)) {
    throw new Error(`PRIMARY_DOMAIN имеет неверный формат: ${requested}`)
  }

  const logger = new Logger('PrimaryBranch')
  const databaseName = databaseNameFromUrl(env.DATABASE_URL)
  const existing = await controlPrisma.branch.findFirst({ where: { isPrimary: true } })
  const clash = await controlPrisma.branch.findFirst({
    where: existing ? { domain, NOT: { id: existing.id } } : { domain },
  })
  if (clash) {
    throw new Error(`PRIMARY_DOMAIN ${domain} уже принадлежит филиалу ${clash.slug}`)
  }

  const config: Prisma.InputJsonValue = (existing?.config as Prisma.InputJsonValue | null) ?? {
    locale: 'ru',
    currency: 'KGS',
    timezone: 'Asia/Bishkek',
    allowPublicSignup: true,
    security: { passwordMinLength: 10, sessionDays: env.REFRESH_TOKEN_TTL_DAYS },
  }

  const data = {
    name: existing?.name ?? 'Основной филиал',
    slug: existing?.slug ?? 'primary',
    domain,
    databaseName,
    storagePrefix: existing?.storagePrefix ?? 'primary',
    status: 'ACTIVE' as const,
    isPrimary: true,
    adminEmail: existing?.adminEmail ?? env.PLATFORM_ADMIN_EMAIL,
    adminName: existing?.adminName ?? 'Администратор',
    config,
    provisionedAt: existing?.provisionedAt ?? new Date(),
    activatedAt: existing?.activatedAt ?? new Date(),
    lastError: null,
  }

  if (existing) {
    await controlPrisma.branch.update({ where: { id: existing.id }, data })
    invalidateBranchCache(existing.domain)
  } else {
    await controlPrisma.branch.create({ data: { ...data, steps: [] } })
  }
  invalidateBranchCache(domain)
  logger.log(`Основной филиал привязан к домену ${domain}`)
}

/** Имя основной БД из DATABASE_URL; хранится в реестре только для диагностики. */
export function databaseNameFromUrl(raw: string): string {
  try {
    const name = decodeURIComponent(new URL(raw).pathname.replace(/^\/+/, '')).trim()
    return name || 'primary'
  } catch {
    return 'primary'
  }
}

