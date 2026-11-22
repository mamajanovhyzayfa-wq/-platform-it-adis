/**
 * Создание первого администратора production-филиала без демонстрационных данных.
 *
 * Запуск из apps/api:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/create-admin.ts
 *
 * Без ADMIN_PASSWORD пароль генерируется и печатается один раз. Скрипт
 * идемпотентен: повторный запуск обновляет пароль существующего пользователя,
 * но не трогает остальные данные.
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { bootstrapRbac } from '../prisma/bootstrap-rbac'
import { generateAdminPassword } from '../src/lib/branches.util'

const MIN_PASSWORD_LENGTH = 12

async function main(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  const providedPassword = process.env.ADMIN_PASSWORD ?? ''
  const firstName = (process.env.ADMIN_FIRST_NAME ?? 'Администратор').trim() || 'Администратор'
  const lastName = (process.env.ADMIN_LAST_NAME ?? '').trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL обязателен и должен быть корректным email')
  }
  if (providedPassword && providedPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD должен быть не короче ${MIN_PASSWORD_LENGTH} символов`)
  }

  const password = providedPassword || generateAdminPassword()
  const passwordHash = await bcrypt.hash(password, 12)
  const prisma = new PrismaClient()

  try {
    // Каталог ролей и прав — часть схемы, без него Role не существует и вход невозможен.
    await bootstrapRbac(prisma)

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

    console.log(`Администратор готов: ${user.email} (${user.role})`)
    if (!providedPassword) {
      console.log(`Одноразовый пароль: ${password}`)
      console.log('Смените его после первого входа.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
