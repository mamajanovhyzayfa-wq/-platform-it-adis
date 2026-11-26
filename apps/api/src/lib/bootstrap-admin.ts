import bcrypt from 'bcryptjs'
import type { PrismaClient } from '@prisma/client'
import { bootstrapRbac } from '../../prisma/bootstrap-rbac.js'

/**
 * Первый администратор основной БД для production.
 *
 * Логика вынесена из `scripts/create-admin.ts`, потому что прод-образ содержит
 * только `dist` и `node_modules` без devDependencies (`tsx`), а значит скрипт
 * на TypeScript в проде запустить нечем. Здесь код компилируется обычным
 * `npm run build` в `dist/src/lib/bootstrap-admin.js` и вызывается из
 * `dist/src/bootstrap.js` (сервис `bootstrap` в docker-compose.prod.yml).
 *
 * Пароль берётся из окружения и никогда не пишется в лог: логируется только
 * email, роль и факт изменения.
 */

/** bcrypt-хеши начинаются с $2a$, $2b$ или $2y$ — по префиксу отличаем хеш от пароля. */
export const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

/** Минимальная длина пароля администратора основной БД. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type AdminBootstrapAction = 'created' | 'password-updated' | 'unchanged'

export interface AdminBootstrapResult {
  id: string
  email: string
  role: 'ADMIN'
  action: AdminBootstrapAction
}

export interface AdminBootstrapOptions {
  email: string
  password?: string
  passwordHash?: string
  firstName?: string
  lastName?: string
  /** Куда писать строки прогресса. По умолчанию console.log. */
  log?: (message: string) => void
}

/** true для строки вида $2b$12$...; пробелы по краям игнорируются. */
export function isBcryptHash(value: string): boolean {
  return BCRYPT_HASH.test(value.trim())
}

/**
 * Идемпотентно создаёт или обновляет администратора основной БД.
 *
 * - повторный запуск с тем же паролем ничего не пишет в БД (`unchanged`);
 * - смена PLATFORM_ADMIN_PASSWORD в .env обновляет хеш (`password-updated`);
 * - готовый bcrypt-хеш (PLATFORM_ADMIN_PASSWORD_HASH или значение с префиксом
 *   $2a$/$2b$/$2y$ в PLATFORM_ADMIN_PASSWORD) не хешируется повторно, иначе
 *   вход по исходному паролю перестал бы работать.
 */
export async function bootstrapAdmin(
  prisma: PrismaClient,
  options: AdminBootstrapOptions,
): Promise<AdminBootstrapResult> {
  const email = (options.email ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) {
    throw new Error('PLATFORM_ADMIN_EMAIL обязателен и должен быть корректным email')
  }

  const rawPassword = options.password ?? ''
  const rawHash = (options.passwordHash ?? '').trim()
  // Пароль в .env может быть уже хешем: тогда повторное хеширование сломало бы вход.
  const inlineHash = isBcryptHash(rawPassword) ? rawPassword.trim() : ''
  const providedHash = rawHash || inlineHash
  const plainPassword = inlineHash ? '' : rawPassword

  if (rawHash && !isBcryptHash(rawHash)) {
    throw new Error(
      'PLATFORM_ADMIN_PASSWORD_HASH не похож на bcrypt-хеш: ожидается префикс $2a$/$2b$/$2y$. ' +
        'В .env.production символы $ нужно удваивать ($$2b$$...), иначе compose их подставит как переменные.',
    )
  }
  if (!providedHash && !plainPassword) {
    throw new Error(
      'Bootstrap администратора: задайте PLATFORM_ADMIN_PASSWORD или PLATFORM_ADMIN_PASSWORD_HASH. ' +
        'Случайный пароль не генерируется, чтобы он не попал в логи контейнера.',
    )
  }
  if (!providedHash && plainPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`PLATFORM_ADMIN_PASSWORD должен быть не короче ${MIN_ADMIN_PASSWORD_LENGTH} символов`)
  }

  const log = options.log ?? ((message: string) => console.log(message))
  const firstName = (options.firstName ?? 'Администратор').trim() || 'Администратор'
  const lastName = (options.lastName ?? '').trim()

  // Роли и права — часть схемы: без Role.code = ADMIN вход невозможен.
  await bootstrapRbac(prisma)

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  })

  // Хеш bcrypt недетерминирован (соль), поэтому «пароль не изменился»
  // проверяется сравнением, а не равенством строк — иначе каждый прогон
  // перезаписывал бы строку пользователя.
  const passwordMatches = existing
    ? providedHash
      ? existing.passwordHash === providedHash
      : await bcrypt.compare(plainPassword, existing.passwordHash)
    : false

  if (existing && passwordMatches) {
    log(`Администратор ${email} уже настроен (роль ADMIN), пароль не изменён`)
    return { id: existing.id, email, role: 'ADMIN', action: 'unchanged' }
  }

  const passwordHash = providedHash || (await bcrypt.hash(plainPassword, 12))
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'ADMIN',
      isActive: true,
      deletedAt: null,
      emailVerifiedAt: new Date(),
    },
    create: {
      email,
      passwordHash,
      firstName,
      lastName,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      coinBalance: { create: { balance: 0 } },
    },
    select: { id: true, email: true, role: true },
  })

  const action: AdminBootstrapAction = existing ? 'password-updated' : 'created'
  log(
    action === 'created'
      ? `Администратор ${user.email} создан (роль ${user.role})`
      : `Пароль администратора ${user.email} обновлён из переменной окружения (роль ${user.role})`,
  )
  return { id: user.id, email: user.email, role: 'ADMIN', action }
}
