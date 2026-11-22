import type { Branch } from '@prisma/client'
import { controlPrisma } from './control-prisma.js'
import { cacheDelete, cacheGet, cacheSet } from './redis.js'

interface CacheEntry {
  branch: Branch | null
  expiresAt: number
}

const TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

/** Домен → филиал (включая ещё не активированные, чтобы не отдавать их основной БД). */
export async function resolveBranchByDomain(domain: string): Promise<Branch | null> {
  const host = normalizeHost(domain)
  const cached = cache.get(host)
  if (cached && cached.expiresAt > Date.now()) return cached.branch

  // Общий Redis-кеш снижает нагрузку на управляющую БД при нескольких репликах.
  const redisCached = await cacheGet<Branch>(`branch:${host}`)
  if (redisCached) {
    cache.set(host, { branch: redisCached, expiresAt: Date.now() + TTL_MS })
    return redisCached
  }

  const branch = await controlPrisma.branch.findFirst({ where: { domain: host } })
  cache.set(host, { branch, expiresAt: Date.now() + TTL_MS })
  if (branch) await cacheSet(`branch:${host}`, branch, 30)
  return branch
}

export async function getPrimaryBranch(): Promise<Branch | null> {
  return controlPrisma.branch.findFirst({ where: { isPrimary: true } })
}

export function invalidateBranchCache(domain?: string): void {
  if (domain) {
    const host = normalizeHost(domain)
    cache.delete(host)
    void cacheDelete(`branch:${host}`)
  } else {
    cache.clear()
  }
}
