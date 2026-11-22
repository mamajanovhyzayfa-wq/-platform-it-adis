import { env } from '../config/env.js'

/**
 * Параметры, которые нужны только Prisma-клиенту или пулеру. Их нельзя
 * передавать в pg_dump/pg_restore и в psql: это не настройки PostgreSQL.
 */
const PRISMA_ONLY_PARAMS = [
  'schema',
  'connection_limit',
  'pool_timeout',
  'pgbouncer',
  'statement_cache_size',
] as const

/**
 * URL для приложения. connection_limit — это размер пула одного PrismaClient,
 * а не число пользователей: при нескольких репликах и филиалах суммарное
 * количество клиентских соединений считается по формуле
 * replicas × (2 + branches) × connection_limit и мультиплексируется PgBouncer.
 */
export function pooledDatabaseUrl(raw: string): string {
  const url = new URL(raw)
  url.searchParams.set('connection_limit', String(env.DATABASE_CONNECTION_LIMIT))
  url.searchParams.set('pool_timeout', String(env.DATABASE_POOL_TIMEOUT))
  return url.toString()
}

/**
 * Прямое подключение к PostgreSQL для миграций, провижининга филиалов и
 * pg_dump/pg_restore. PgBouncer в transaction mode не подходит для этих
 * операций, поэтому в production задаётся DIRECT_DATABASE_URL.
 */
export function directDatabaseUrl(raw = env.DIRECT_DATABASE_URL ?? env.DATABASE_URL): string {
  const url = new URL(raw)
  for (const param of PRISMA_ONLY_PARAMS) url.searchParams.delete(param)
  return url.toString()
}

export function branchDatabaseUrl(databaseName: string): string {
  const url = new URL(env.DATABASE_URL)
  url.pathname = `/${databaseName}`
  // У филиала схема public; Prisma-параметр schema здесь не нужен.
  url.searchParams.delete('schema')
  return pooledDatabaseUrl(url.toString())
}

export function branchDirectDatabaseUrl(databaseName: string): string {
  const url = new URL(directDatabaseUrl())
  url.pathname = `/${databaseName}`
  return url.toString()
}
