import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'
import { branchDatabaseUrl } from './database-url.js'

export { branchDatabaseUrl, branchDirectDatabaseUrl } from './database-url.js'

/**
 * Контекст филиала на время HTTP-запроса.
 *
 * Филиал определяется только по домену (Host) в middleware. Клиентские параметры
 * не участвуют в выборе БД, поэтому подменить филиал через query/body нельзя.
 */
export interface TenantContext {
  branchId: string
  branchSlug: string
  domain: string
  isPrimary: boolean
  prisma: PrismaClient
  uploadsDir: string
}

const storage = new AsyncLocalStorage<TenantContext>()

export function runWithTenant<T>(context: TenantContext, callback: () => T): T {
  return storage.run(context, callback)
}

export function getTenant(): TenantContext | undefined {
  return storage.getStore()
}

export function tenantUploadsDir(slug: string, isPrimary: boolean): string {
  const base = resolve(env.UPLOADS_DIR)
  if (isPrimary) return base
  const dir = resolve(base, 'branches', slug)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Отдельный PrismaClient на каждую БД филиала; создаётся лениво и кешируется. */
const branchClients = new Map<string, PrismaClient>()

export function getBranchPrisma(branchId: string, databaseName: string): PrismaClient {
  const existing = branchClients.get(branchId)
  if (existing) return existing
  const client = new PrismaClient({
    datasourceUrl: branchDatabaseUrl(databaseName),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
  branchClients.set(branchId, client)
  return client
}

export async function disconnectBranchClients(): Promise<void> {
  const clients = [...branchClients.values()]
  branchClients.clear()
  await Promise.allSettled(clients.map((client) => client.$disconnect()))
}
