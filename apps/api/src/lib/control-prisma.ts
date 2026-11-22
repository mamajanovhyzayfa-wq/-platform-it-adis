import { PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'
import { pooledDatabaseUrl } from './database-url.js'

/**
 * Управляющая БД (реестр филиалов) отделена от клиентского прокси: запросы
 * реестра не должны случайно уйти в БД филиала. Пароль берётся из окружения,
 * в реестре он не хранится.
 */
export const controlPrisma = new PrismaClient({
  datasourceUrl: pooledDatabaseUrl(env.CONTROL_DATABASE_URL ?? env.DATABASE_URL),
  log: ['error'],
})
