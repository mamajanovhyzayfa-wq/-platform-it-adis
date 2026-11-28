import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { PrismaClient, type Branch, type Prisma, type RoleName } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { env } from '../../config/env.js'
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { invalidateBranchCache } from '../../lib/branch-registry.js'
import { branchDirectDatabaseUrl, tenantUploadsDir } from '../../lib/tenant.js'
import { databaseNameFromUrl } from '../../lib/primary-branch.js'
import { deleteObject, saveObject, storageDriver } from '../../lib/file-storage.js'
import { redisHealth } from '../../lib/redis.js'
import {
  databaseNameFor,
  generateAdminPassword,
  isValidDomain,
  isValidSlug,
  normalizeDomain,
  slugFromDomain,
  splitSqlStatements,
} from '../../lib/branches.util.js'

interface ProvisionInput {
  name: string
  domain: string
  slug?: string
  adminEmail: string
  adminName: string
  locale?: string
  timezone?: string
  /** Публичная страница филиала: логотип, описание, контакты и направления. */
  logoUrl?: string
  description?: string
  contactPhone?: string
  contactEmail?: string
  contactAddress?: string
  directions?: string
}

interface ProvisionStep {
  key: string
  label: string
  status: 'ok' | 'failed'
  detail: string
}

interface ProvisionResult {
  branch: ReturnType<typeof toPublicBranch>
  credentials: { email: string; temporaryPassword: string }
  steps: ProvisionStep[]
  urls: { site: string; api: string }
}

const PERMISSIONS = [
  { code: 'courses.manage', description: 'Создание и редактирование курсов' },
  { code: 'homework.review', description: 'Проверка домашних заданий' },
  { code: 'coins.award', description: 'Начисление изикоинов' },
  { code: 'users.manage', description: 'Управление пользователями' },
  { code: 'analytics.view', description: 'Просмотр аналитики' },
  { code: 'audit.view', description: 'Просмотр журнала аудита' },
  { code: 'leads.manage', description: 'Обработка заявок и CRM' },
  { code: 'students.view', description: 'Просмотр списка учеников' },
  { code: 'attendance.manage', description: 'Учёт посещаемости' },
  { code: 'payments.cash', description: 'Регистрация наличных платежей' },
  { code: 'schedule.manage', description: 'Управление расписанием' },
  { code: 'finance.view', description: 'Просмотр финансовой аналитики филиала' },
  { code: 'finance.manage', description: 'Счета, платежи, расходы и тарифы' },
  { code: 'finance.refunds', description: 'Рассмотрение заявок на возврат' },
]

const ROLES: Array<{ code: RoleName; name: string; description: string }> = [
  { code: 'ADMIN', name: 'Администратор', description: 'Полный доступ ко всем разделам филиала' },
  { code: 'MANAGER', name: 'Менеджер', description: 'Заявки, ученики, расписание и поддержка клиентов' },
  { code: 'TEACHER', name: 'Преподаватель', description: 'Ведёт курсы, проверяет задания, начисляет изикоины' },
  { code: 'STUDENT', name: 'Ученик', description: 'Учится на курсах и выполняет задания' },
  { code: 'PARENT', name: 'Родитель', description: 'Следит за успеваемостью и оплатой обучения ребёнка' },
]

const GRANTS: Record<RoleName, string[]> = {
  ADMIN: PERMISSIONS.map((permission) => permission.code),
  MANAGER: [
    'leads.manage',
    'students.view',
    'attendance.manage',
    'payments.cash',
    'schedule.manage',
    'analytics.view',
  ],
  TEACHER: ['courses.manage', 'homework.review', 'coins.award', 'analytics.view'],
  STUDENT: [],
  PARENT: [],
}

@Injectable()
export class BranchProvisioningService {
  private readonly logger = new Logger(BranchProvisioningService.name)

  async list() {
    const branches = await controlPrisma.branch.findMany({ orderBy: { createdAt: 'desc' } })
    return branches.map(toPublicBranch)
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    const domain = normalizeDomain(input.domain)
    if (!isValidDomain(domain)) {
      throw badRequest('Некорректный домен. Пример: filial.example.com', { field: 'domain' })
    }

    const slug = (input.slug?.trim() || slugFromDomain(domain)).toLowerCase()
    if (!isValidSlug(slug)) {
      throw badRequest('Некорректный идентификатор филиала: только a-z, 0-9 и дефис', { field: 'slug' })
    }

    const databaseName = databaseNameFor(slug, env.BRANCH_DATABASE_PREFIX)
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
      throw badRequest('Не удалось сформировать имя базы данных филиала')
    }
    if (isReservedDatabaseName(databaseName)) {
      throw badRequest('Имя базы данных филиала совпадает с основной или управляющей БД')
    }

    const existing = await controlPrisma.branch.findFirst({
      where: { OR: [{ domain }, { slug }, { databaseName }] },
    })
    if (existing && existing.status !== 'FAILED') {
      throw conflict(
        existing.domain === domain
          ? 'Домен уже занят другим филиалом'
          : 'Идентификатор филиала уже используется',
      )
    }
    if (
      existing &&
      (existing.domain !== domain || existing.slug !== slug || existing.databaseName !== databaseName)
    ) {
      throw conflict('Домен или идентификатор уже связан с другим филиалом')
    }

    const adminEmail = input.adminEmail.trim().toLowerCase()
    const branchName = input.name.trim()
    const logoUrl = input.logoUrl?.trim()
    const phone = input.contactPhone?.trim()
    const contactAddress = input.contactAddress?.trim()
    const contacts = {
      ...(phone ? { phone } : {}),
      email: input.contactEmail?.trim() || adminEmail,
      ...(contactAddress ? { address: contactAddress } : {}),
    }
    const directions = parseDirections(input.directions)
    const temporaryPassword = generateAdminPassword()
    const config: Prisma.InputJsonValue = {
      locale: input.locale ?? 'ru',
      currency: 'KGS',
      timezone: input.timezone ?? 'Asia/Bishkek',
      allowPublicSignup: true,
      description:
        input.description?.trim() ||
        `Образовательный центр «${branchName}»: курсы, наставники и поддержка на каждом этапе обучения.`,
      ...(logoUrl ? { logoUrl } : {}),
      contacts,
      ...(directions.length ? { directions } : {}),
      security: { passwordMinLength: 10, sessionDays: env.REFRESH_TOKEN_TTL_DAYS },
    }

    let branch: Branch
    try {
      branch = existing
        ? await controlPrisma.branch.update({
            where: { id: existing.id },
            data: {
              name: branchName,
              domain,
              databaseName,
              storagePrefix: slug,
              adminEmail,
              adminName: input.adminName.trim(),
              config,
              status: 'PROVISIONING',
              steps: [],
              lastError: null,
              provisionedAt: null,
            },
          })
        : await controlPrisma.branch.create({
            data: {
              name: branchName,
              slug,
              domain,
              databaseName,
              storagePrefix: slug,
              adminEmail,
              adminName: input.adminName.trim(),
              config,
            },
          })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw conflict('Домен или идентификатор филиала уже используется')
      }
      throw error
    }

    const steps: ProvisionStep[] = []
    const step = async <T>(key: string, label: string, action: () => Promise<T> | T): Promise<T> => {
      try {
        const result = await action()
        steps.push({ key, label, status: 'ok', detail: describe(result) })
        return result
      } catch (error) {
        steps.push({ key, label, status: 'failed', detail: errorMessage(error) })
        throw error
      }
    }

    try {
      await controlPrisma.branch.update({
        where: { id: branch.id },
        data: { status: 'PROVISIONING', steps: steps as unknown as Prisma.InputJsonValue },
      })

      await step('domain', 'Проверка уникальности домена', async () => {
        const clash = await controlPrisma.branch.findFirst({ where: { domain, NOT: { id: branch.id } } })
        if (clash) throw conflict('Домен уже занят другим филиалом')
        return domain
      })

      await step('database', 'Создание отдельной базы данных', async () => {
        // Повтор после сбоя начинает БД заново: частично применённая миграция
        // не должна блокировать восстановление провижининга.
        if (existing) await dropDatabase(databaseName)
        return createDatabase(databaseName)
      })

      const client = new PrismaClient({ datasourceUrl: branchDirectDatabaseUrl(databaseName), log: ['error'] })
      try {
        await step('migrations', 'Применение миграций', () => applyMigrations(client))
        await step('seed', 'Начальная конфигурация и администратор филиала', () =>
          seedBranch(client, {
            email: adminEmail,
            name: input.adminName.trim(),
            passwordHash: bcrypt.hashSync(temporaryPassword, 12),
            locale: input.locale ?? 'ru',
          }),
        )
        await step('health', 'Проверка подключения и схемы', () => checkDatabaseHealth(client))
      } finally {
        await client.$disconnect()
      }

      await step('storage', 'Проверка файлового хранилища', () => checkStorage(slug))

      await step('services', 'Проверка подключения сервисов', async () => {
        const redis = await redisHealth()
        if (env.REDIS_URL && redis !== 'up') {
          throw new Error('Redis настроен, но недоступен')
        }
        return { database: 'up', storage: storageDriver(), redis }
      })

      await step('security', 'Параметры безопасности', () => ({
        domain,
        isolatedDatabase: databaseName,
        storage: `branches/${slug}`,
        tokenScope: 'branch',
        passwordPolicy: 'мин. 10 символов',
      }))

      const updated = await controlPrisma.branch.update({
        where: { id: branch.id },
        data: {
          status: 'PROVISIONED',
          provisionedAt: new Date(),
          steps: steps as unknown as Prisma.InputJsonValue,
        },
      })
      invalidateBranchCache(domain)

      return {
        branch: toPublicBranch(updated),
        credentials: { email: adminEmail, temporaryPassword },
        steps,
        urls: { site: `https://${domain}`, api: `https://${domain}/api` },
      }
    } catch (error) {
      this.logger.error(`Не удалось создать филиал ${domain}: ${errorMessage(error)}`)
      await controlPrisma.branch.update({
        where: { id: branch.id },
        data: {
          status: 'FAILED',
          lastError: errorMessage(error),
          steps: steps as unknown as Prisma.InputJsonValue,
        },
      })
      throw new AppError(500, 'BRANCH_PROVISIONING_FAILED', `Создание филиала не завершено: ${errorMessage(error)}`, {
        branchId: branch.id,
        steps,
      })
    }
  }

  /** Повтор провижининга после ошибки: домен и запись филиала сохраняются. */
  async retry(branchId: string): Promise<ProvisionResult> {
    const branch = await controlPrisma.branch.findUnique({ where: { id: branchId } })
    if (!branch) throw notFound('Филиал не найден')
    if (branch.status !== 'FAILED') {
      throw conflict('Повтор разрешён только для филиала со статусом FAILED')
    }
    const config = (branch.config ?? {}) as Record<string, unknown>
    const contacts = (config.contacts ?? {}) as Record<string, unknown>
    const directions = Array.isArray(config.directions)
      ? config.directions
          .map((item) =>
            typeof item === 'string'
              ? item
              : typeof item === 'object' && item && 'title' in item
                ? String((item as { title?: unknown }).title ?? '')
                : '',
          )
          .filter(Boolean)
          .join(', ')
      : undefined
    return this.provision({
      name: branch.name,
      domain: branch.domain,
      slug: branch.slug,
      adminEmail: branch.adminEmail,
      adminName: branch.adminName ?? 'Администратор',
      locale: typeof config.locale === 'string' ? config.locale : 'ru',
      timezone: typeof config.timezone === 'string' ? config.timezone : 'Asia/Bishkek',
      ...(typeof config.logoUrl === 'string' ? { logoUrl: config.logoUrl } : {}),
      ...(typeof config.description === 'string' ? { description: config.description } : {}),
      ...(typeof contacts.phone === 'string' ? { contactPhone: contacts.phone } : {}),
      ...(typeof contacts.email === 'string' ? { contactEmail: contacts.email } : {}),
      ...(typeof contacts.address === 'string' ? { contactAddress: contacts.address } : {}),
      ...(directions ? { directions } : {}),
    })
  }

  async activate(branchId: string, confirm: boolean) {
    if (!confirm) throw badRequest('Активация требует подтверждения')
    const branch = await controlPrisma.branch.findUnique({ where: { id: branchId } })
    if (!branch) throw notFound('Филиал не найден')
    if (branch.status === 'ACTIVE') return toPublicBranch(branch)
    if (branch.status !== 'PROVISIONED') {
      throw conflict('Филиал не готов к активации: сначала завершите создание без ошибок')
    }

    const client = new PrismaClient({ datasourceUrl: branchDirectDatabaseUrl(branch.databaseName), log: ['error'] })
    try {
      await checkDatabaseHealth(client)
    } finally {
      await client.$disconnect()
    }

    await checkStorage(branch.slug)

    const activated = await controlPrisma.branch.update({
      where: { id: branch.id },
      data: { status: 'ACTIVE', activatedAt: new Date(), lastError: null },
    })
    invalidateBranchCache(branch.domain)
    return toPublicBranch(activated)
  }

  /** Реестр филиалов для консоли: без списков студентов, платежей и учебных данных. */
  async get(branchId: string) {
    const branch = await controlPrisma.branch.findUnique({ where: { id: branchId } })
    if (!branch) throw notFound('Филиал не найден')
    return toPublicBranch(branch)
  }
}

function toPublicBranch(branch: Branch) {
  return {
    id: branch.id,
    name: branch.name,
    slug: branch.slug,
    domain: branch.domain,
    status: branch.status,
    isPrimary: branch.isPrimary,
    adminEmail: branch.adminEmail,
    adminName: branch.adminName,
    steps: branch.steps,
    lastError: branch.lastError,
    provisionedAt: branch.provisionedAt,
    activatedAt: branch.activatedAt,
    createdAt: branch.createdAt,
  }
}

async function dropDatabase(databaseName: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) throw new Error('Недопустимое имя базы данных')
  if (isReservedDatabaseName(databaseName)) throw new Error('Нельзя удалить основную или управляющую БД')
  const admin = new PrismaClient({ datasourceUrl: branchDirectDatabaseUrl('postgres'), log: ['error'] })
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  } finally {
    await admin.$disconnect()
  }
}

async function createDatabase(databaseName: string): Promise<string> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) throw new Error('Недопустимое имя базы данных')
  if (isReservedDatabaseName(databaseName)) throw new Error('Нельзя использовать основную или управляющую БД')
  const admin = new PrismaClient({ datasourceUrl: branchDirectDatabaseUrl('postgres'), log: ['error'] })
  try {
    // Повтор после сбоя не должен падать на уже созданной БД.
    const exists = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      'SELECT datname FROM pg_database WHERE datname = $1',
      databaseName,
    )
    if (exists.length > 0) return `${databaseName} (уже существует)`
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    return databaseName
  } finally {
    await admin.$disconnect()
  }
}

function isReservedDatabaseName(databaseName: string): boolean {
  const reserved = [env.DATABASE_URL, env.CONTROL_DATABASE_URL ?? env.DATABASE_URL]
  return reserved.some((url) => databaseNameFromUrl(url) === databaseName)
}

async function checkStorage(slug: string): Promise<string> {
  const dir = tenantUploadsDir(slug, false)
  const uploadProbe = join(dir, `.health-${randomUUID()}`)
  writeFileSync(uploadProbe, 'ok')
  const content = readFileSync(uploadProbe, 'utf8')
  rmSync(uploadProbe, { force: true })
  if (content !== 'ok') throw new Error('Не удалось записать файл в uploads филиала')

  const temp = join(tmpdir(), `itadis-storage-${randomUUID()}.txt`)
  const key = `branches/${slug}/library/.health-${randomUUID()}`
  writeFileSync(temp, 'ok')
  try {
    await saveObject(key, temp, 'text/plain')
  } finally {
    rmSync(temp, { force: true })
    await deleteObject(key).catch(() => undefined)
  }
  return `${storageDriver()}: branches/${slug}`
}

async function applyMigrations(client: PrismaClient): Promise<string> {
  const dir = resolve(process.cwd(), 'prisma', 'migrations')
  await client.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "_branch_migrations" ("name" TEXT PRIMARY KEY, "appliedAt" TIMESTAMP NOT NULL DEFAULT now())',
  )

  const migrations = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{10,}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  let applied = 0
  for (const name of migrations) {
    const done = await client.$queryRawUnsafe<Array<{ name: string }>>(
      'SELECT "name" FROM "_branch_migrations" WHERE "name" = $1',
      name,
    )
    if (done.length > 0) continue

    const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8')
    for (const statement of splitSqlStatements(sql)) {
      await client.$executeRawUnsafe(statement)
    }
    await client.$executeRawUnsafe('INSERT INTO "_branch_migrations" ("name") VALUES ($1)', name)
    applied += 1
  }
  return `${applied} из ${migrations.length} миграций применено`
}

async function seedBranch(
  client: PrismaClient,
  admin: { email: string; name: string; passwordHash: string; locale: string },
): Promise<string> {
  await client.permission.createMany({ data: PERMISSIONS, skipDuplicates: true })
  await client.role.createMany({
    data: ROLES.map((role) => ({ ...role, isSystem: true })),
    skipDuplicates: true,
  })

  const permissions = await client.permission.findMany({ select: { id: true, code: true } })
  const byCode = new Map(permissions.map((permission) => [permission.code, permission.id]))
  const rolePermissions = (Object.entries(GRANTS) as Array<[RoleName, string[]]>).flatMap(([role, codes]) =>
    codes
      .map((code) => byCode.get(code))
      .filter((permissionId): permissionId is string => Boolean(permissionId))
      .map((permissionId) => ({ role, permissionId })),
  )
  await client.rolePermission.createMany({ data: rolePermissions, skipDuplicates: true })

  const [firstName, ...rest] = admin.name.split(/\s+/)
  const adminUser = await client.user.upsert({
    where: { email: admin.email },
    update: {
      passwordHash: admin.passwordHash,
      firstName: firstName || 'Администратор',
      lastName: rest.join(' ') || 'Филиала',
      role: 'ADMIN',
      locale: admin.locale,
      isActive: true,
      deletedAt: null,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: admin.email,
      passwordHash: admin.passwordHash,
      firstName: firstName || 'Администратор',
      lastName: rest.join(' ') || 'Филиала',
      role: 'ADMIN',
      locale: admin.locale,
      emailVerifiedAt: new Date(),
    },
  })
  await client.coinBalance.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: { userId: adminUser.id, balance: 0 },
  })

  // Начальная конфигурация филиала: настройки, лимиты и академическая шкала.
  await client.branchSettings.upsert({ where: { id: 'branch' }, update: {}, create: { id: 'branch' } })
  await client.coinRule.upsert({ where: { id: 'branch' }, update: {}, create: { id: 'branch' } })
  await client.aiSetting.upsert({ where: { id: 'branch' }, update: {}, create: { id: 'branch' } })
  await client.gradingScale.upsert({
    where: { name: '5-балльная' },
    update: { isDefault: true },
    create: {
      name: '5-балльная',
      description: 'Базовая шкала филиала: 2–5',
      isDefault: true,
      bands: {
        create: [
          { minPercent: 0, maxPercent: 59, label: '2', position: 1 },
          { minPercent: 60, maxPercent: 74, label: '3', position: 2 },
          { minPercent: 75, maxPercent: 89, label: '4', position: 3 },
          { minPercent: 90, maxPercent: 100, label: '5', position: 4 },
        ],
      },
    },
  })

  return `ролей: ${ROLES.length}, прав: ${permissions.length}, администратор: ${admin.email}, настройки филиала созданы`
}

async function checkDatabaseHealth(client: PrismaClient): Promise<string> {
  await client.$queryRawUnsafe('SELECT 1')
  const rows = await client.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
  )
  const count = Number(rows[0]?.count ?? 0)
  if (count < 20) throw new Error(`Схема неполная: найдено таблиц ${count}`)
  return `подключение установлено, таблиц: ${count}`
}

function parseDirections(value?: string): Array<{ title: string }> {
  return (value ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((title) => ({ title }))
}

function describe(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === undefined || result === null) return 'готово'
  return JSON.stringify(result)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
