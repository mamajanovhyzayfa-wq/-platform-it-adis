import { PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'
import { getTenant } from './tenant.js'
import { pooledDatabaseUrl } from './database-url.js'

/**
 * Основной клиент: БД из DATABASE_URL. Используется без контекста филиала
 * (управляющая БД, миграции, фон-задачи) и как fallback для основного филиала.
 */
export const defaultPrisma = new PrismaClient({
  datasourceUrl: pooledDatabaseUrl(env.DATABASE_URL),
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})

/**
 * Клиент для кода домена. Внутри HTTP-запроса проксирует обращения к БД филиала,
 * вне запроса — к основной БД. Все существующие модули работают без изменений,
 * а данные филиалов физически остаются в разных базах.
 */
export const prisma: PrismaClient = new Proxy(defaultPrisma, {
  get(target, property, _receiver) {
    const client = getTenant()?.prisma ?? target
    const value = Reflect.get(client, property, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
