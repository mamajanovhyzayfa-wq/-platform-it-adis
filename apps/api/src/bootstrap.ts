/**
 * Одноразовый шаг деплоя: администратор основной БД.
 *
 * Запуск в контейнере backend-образа (сервис `bootstrap` из
 * docker-compose.prod.yml):
 *
 *   node dist/src/bootstrap.js
 *
 * Нужны PLATFORM_ADMIN_EMAIL и PLATFORM_ADMIN_PASSWORD либо
 * PLATFORM_ADMIN_PASSWORD_HASH. Значения читаются только из окружения, в лог
 * попадают email и роль — сам пароль и хеш не логируются.
 *
 * Код возврата: 0 — администратор создан/обновлён либо bootstrap намеренно
 * пропущен (email не задан); 1 — конфигурация неполная или БД недоступна.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { bootstrapAdmin } from './lib/bootstrap-admin.js'

async function main(): Promise<void> {
  const email = (process.env.PLATFORM_ADMIN_EMAIL ?? '').trim()

  if (!email) {
    console.warn(
      'Bootstrap администратора пропущен: PLATFORM_ADMIN_EMAIL не задан. ' +
        'Войти в кабинет будет некому, пока переменная не заполнена.',
    )
    return
  }

  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? ''
  const passwordHash = process.env.PLATFORM_ADMIN_PASSWORD_HASH ?? ''

  const prisma = new PrismaClient()
  try {
    const result = await bootstrapAdmin(prisma, { email, password, passwordHash })
    console.log(`Bootstrap администратора завершён: ${result.email} → ${result.action}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
