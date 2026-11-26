/**
 * Создание первого администратора основной БД без демонстрационных данных.
 *
 * Это локальный/отладочный путь для машины разработчика (запуск через `tsx`).
 * В production тот же код выполняется собранным JS: `node dist/src/bootstrap.js`
 * в сервисе `bootstrap` из docker-compose.prod.yml — прод-образ не содержит
 * `tsx` и каталога `scripts/`.
 *
 * Запуск из apps/api:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx scripts/create-admin.ts
 *
 * Пароль обязателен: bootstrap не генерирует и не печатает пароли.
 * Скрипт идемпотентен: повторный запуск обновляет пароль существующего
 * пользователя, но не создаёт дубликат.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { MIN_ADMIN_PASSWORD_LENGTH, bootstrapAdmin } from '../src/lib/bootstrap-admin.js'

async function main(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD ?? ''
  const firstName = (process.env.ADMIN_FIRST_NAME ?? 'Администратор').trim() || 'Администратор'
  const lastName = (process.env.ADMIN_LAST_NAME ?? '').trim()

  if (!password) {
    throw new Error(
      `ADMIN_PASSWORD обязателен (не короче ${MIN_ADMIN_PASSWORD_LENGTH} символов): пароль не генерируется, чтобы не попасть в лог`,
    )
  }

  const prisma = new PrismaClient()
  try {
    const result = await bootstrapAdmin(prisma, {
      email,
      password,
      firstName,
      lastName,
    })
    console.log(`Готово: ${result.email} (${result.role}), действие: ${result.action}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
