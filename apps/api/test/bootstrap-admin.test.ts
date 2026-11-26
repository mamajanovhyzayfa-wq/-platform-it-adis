import bcrypt from 'bcryptjs'
import type { PrismaClient, RoleName } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { permissionCatalog, roleGrants } from '../prisma/bootstrap-rbac.js'
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  bootstrapAdmin,
  isBcryptHash,
} from '../src/lib/bootstrap-admin.js'

/**
 * Bootstrap первого администратора основной БД.
 *
 * Проверяется поведение, из-за которого чаще всего ломается первый вход в
 * production: роль ADMIN должна существовать до создания пользователя,
 * повторный запуск не должен перезаписывать пароль, смена пароля в .env
 * должна обновлять хеш, готовый bcrypt-хеш нельзя хешировать второй раз,
 * а сам пароль не должен попадать в лог.
 *
 * Prisma заменена in-memory двойником: тест не требует PostgreSQL и идёт
 * в общем прогоне `npm test`. Реальный Postgres проверяется шагом CI
 * «Bootstrap администратора на чистой БД» (.github/workflows/ci.yml).
 */

interface FakeUser {
  id: string
  email: string
  passwordHash: string
  role: RoleName
  firstName: string
  lastName: string
  isActive: boolean
  deletedAt: Date | null
  emailVerifiedAt: Date | null
}

interface FakeRole {
  id: string
  code: RoleName
  name: string
  description: string | null
  isSystem: boolean
}

interface FakePermission {
  id: string
  code: string
  description: string
}

function createFakePrisma() {
  const users = new Map<string, FakeUser>()
  const roles = new Map<RoleName, FakeRole>()
  const permissions = new Map<string, FakePermission>()
  const rolePermissions = new Set<string>()
  let sequence = 0

  const nextId = (prefix: string) => `${prefix}-${++sequence}`

  const client = {
    permission: {
      upsert: async (args: { where: { code: string }; create: { code: string; description: string } }) => {
        const existing = permissions.get(args.where.code)
        if (existing) return existing
        const row: FakePermission = { id: nextId('perm'), ...args.create }
        permissions.set(row.code, row)
        return row
      },
      findUniqueOrThrow: async (args: { where: { code: string } }) => {
        const row = permissions.get(args.where.code)
        if (!row) throw new Error(`Permission ${args.where.code} не найден`)
        return row
      },
    },
    role: {
      upsert: async (args: {
        where: { code: RoleName }
        update: { name: string; description: string | null }
        create: { name: string; description: string | null; isSystem: boolean }
      }) => {
        const existing = roles.get(args.where.code)
        if (existing) {
          Object.assign(existing, args.update)
          return existing
        }
        const row: FakeRole = { id: nextId('role'), code: args.where.code, ...args.create }
        roles.set(row.code, row)
        return row
      },
    },
    rolePermission: {
      upsert: async (args: {
        where: { role_permissionId: { role: RoleName; permissionId: string } }
        create: { role: RoleName; permissionId: string }
      }) => {
        const { role, permissionId } = args.where.role_permissionId
        rolePermissions.add(`${role}:${permissionId}`)
        return args.create
      },
    },
    user: {
      findUnique: async (args: { where: { email: string } }) => users.get(args.where.email) ?? null,
      upsert: async (args: {
        where: { email: string }
        update: Partial<FakeUser>
        create: Partial<FakeUser> & { coinBalance?: unknown }
      }) => {
        const existing = users.get(args.where.email)
        if (existing) {
          Object.assign(existing, args.update)
          return { id: existing.id, email: existing.email, role: existing.role }
        }
        // Значения по умолчанию модели User в Prisma: isActive=true, deletedAt=null.
        const row: FakeUser = {
          id: nextId('user'),
          email: args.create.email ?? '',
          passwordHash: args.create.passwordHash ?? '',
          role: args.create.role ?? 'STUDENT',
          firstName: args.create.firstName ?? '',
          lastName: args.create.lastName ?? '',
          isActive: args.create.isActive ?? true,
          deletedAt: args.create.deletedAt ?? null,
          emailVerifiedAt: args.create.emailVerifiedAt ?? null,
        }
        users.set(row.email, row)
        return { id: row.id, email: row.email, role: row.role }
      },
    },
  }

  return {
    prisma: client as unknown as PrismaClient,
    users,
    roles,
    permissions,
    rolePermissions,
  }
}

const EMAIL = 'director@itadis.kg'
const PASSWORD = 'Itadis-Admin-2026'

describe('bootstrapAdmin', () => {
  beforeEach(() => {
    // Каждый тест начинается с «чистой БД».
  })

  it('создаёт администратора, роль ADMIN и полную матрицу прав администратора', async () => {
    const fake = createFakePrisma()

    const result = await bootstrapAdmin(fake.prisma, { email: EMAIL, password: PASSWORD, log: () => {} })

    expect(result.action).toBe('created')
    expect(result.role).toBe('ADMIN')
    expect(fake.users.size).toBe(1)

    const user = fake.users.get(EMAIL)
    expect(user?.role).toBe('ADMIN')
    expect(user?.isActive).toBe(true)
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date)
    // В БД лежит bcrypt-хеш, а не пароль.
    expect(isBcryptHash(user?.passwordHash ?? '')).toBe(true)
    expect(user?.passwordHash).not.toContain(PASSWORD)
    expect(await bcrypt.compare(PASSWORD, user?.passwordHash ?? '')).toBe(true)

    expect(fake.roles.get('ADMIN')?.isSystem).toBe(true)
    expect(fake.permissions.size).toBe(permissionCatalog.length)
    // Каталог создаёт права всех ролей, а ADMIN получает их полностью.
    expect(fake.rolePermissions.size).toBe(
      Object.values(roleGrants).reduce((sum, codes) => sum + codes.length, 0),
    )
    const adminGrants = [...fake.rolePermissions].filter((key) => key.startsWith('ADMIN:'))
    expect(adminGrants).toHaveLength(permissionCatalog.length)
    for (const permission of permissionCatalog) {
      expect(fake.rolePermissions.has(`ADMIN:${fake.permissions.get(permission.code)?.id}`)).toBe(true)
    }
  })

  it('повторный запуск с тем же паролем ничего не меняет', async () => {
    const fake = createFakePrisma()
    await bootstrapAdmin(fake.prisma, { email: EMAIL, password: PASSWORD, log: () => {} })
    const firstHash = fake.users.get(EMAIL)?.passwordHash

    const second = await bootstrapAdmin(fake.prisma, { email: EMAIL, password: PASSWORD, log: () => {} })

    // bcrypt солит каждый хеш: без сравнения пароля строка перезаписывалась бы.
    expect(second.action).toBe('unchanged')
    expect(fake.users.size).toBe(1)
    expect(fake.users.get(EMAIL)?.passwordHash).toBe(firstHash)
  })

  it('смена PLATFORM_ADMIN_PASSWORD обновляет хеш и не создаёт второго пользователя', async () => {
    const fake = createFakePrisma()
    await bootstrapAdmin(fake.prisma, { email: EMAIL, password: PASSWORD, log: () => {} })

    const rotated = 'Itadis-Admin-2027'
    const result = await bootstrapAdmin(fake.prisma, { email: EMAIL, password: rotated, log: () => {} })

    expect(result.action).toBe('password-updated')
    expect(fake.users.size).toBe(1)
    const hash = fake.users.get(EMAIL)?.passwordHash ?? ''
    expect(await bcrypt.compare(rotated, hash)).toBe(true)
    expect(await bcrypt.compare(PASSWORD, hash)).toBe(false)
  })

  it('готовый bcrypt-хеш из PLATFORM_ADMIN_PASSWORD_HASH не хешируется повторно', async () => {
    const fake = createFakePrisma()
    const hash = await bcrypt.hash(PASSWORD, 10)

    const result = await bootstrapAdmin(fake.prisma, {
      email: EMAIL,
      passwordHash: hash,
      log: () => {},
    })

    expect(result.action).toBe('created')
    expect(fake.users.get(EMAIL)?.passwordHash).toBe(hash)
    expect(await bcrypt.compare(PASSWORD, fake.users.get(EMAIL)?.passwordHash ?? '')).toBe(true)
  })

  it('bcrypt-хеш, переданный в PLATFORM_ADMIN_PASSWORD, тоже принимается как хеш', async () => {
    const fake = createFakePrisma()
    const hash = await bcrypt.hash(PASSWORD, 10)

    await bootstrapAdmin(fake.prisma, { email: EMAIL, password: hash, log: () => {} })

    expect(fake.users.get(EMAIL)?.passwordHash).toBe(hash)
    // Повторный запуск с тем же значением идемпотентен.
    const second = await bootstrapAdmin(fake.prisma, { email: EMAIL, password: hash, log: () => {} })
    expect(second.action).toBe('unchanged')
  })

  it('без пароля и хеша падает с указанием переменных и не создаёт пользователя', async () => {
    const fake = createFakePrisma()

    await expect(bootstrapAdmin(fake.prisma, { email: EMAIL, log: () => {} })).rejects.toThrow(
      /PLATFORM_ADMIN_PASSWORD/,
    )
    expect(fake.users.size).toBe(0)
  })

  it('отклоняет короткий пароль и хеш неверного формата', async () => {
    const fake = createFakePrisma()

    await expect(
      bootstrapAdmin(fake.prisma, { email: EMAIL, password: 'short', log: () => {} }),
    ).rejects.toThrow(String(MIN_ADMIN_PASSWORD_LENGTH))

    await expect(
      bootstrapAdmin(fake.prisma, { email: EMAIL, passwordHash: 'Itadis-Admin-2026', log: () => {} }),
    ).rejects.toThrow(/bcrypt/)
    expect(fake.users.size).toBe(0)
  })

  it('не печатает пароль или хеш в лог', async () => {
    const fake = createFakePrisma()
    const logs: string[] = []
    const log = (message: string) => logs.push(message)

    await bootstrapAdmin(fake.prisma, { email: EMAIL, password: PASSWORD, log })
    await bootstrapAdmin(fake.prisma, { email: EMAIL, password: PASSWORD, log })
    await bootstrapAdmin(fake.prisma, { email: EMAIL, password: 'Itadis-Admin-2027', log })

    const text = logs.join('\n')
    expect(text).toContain(EMAIL)
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain('Itadis-Admin-2027')
    expect(text).not.toContain(fake.users.get(EMAIL)?.passwordHash ?? '$2b$never-matches')
    expect(text).not.toMatch(/\$2[aby]\$/)
  })
})
