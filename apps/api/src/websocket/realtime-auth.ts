import { env } from '../config/env.js'
import { getPrimaryBranch, normalizeHost, resolveBranchByDomain } from '../lib/branch-registry.js'
import { defaultPrisma } from '../lib/prisma.js'
import { verifyAccessToken } from '../lib/security.js'
import { getBranchPrisma, tenantUploadsDir, type TenantContext } from '../lib/tenant.js'

/**
 * Авторизация WebSocket-рукопожатия.
 *
 * Филиал определяется только по Host рукопожатия, как и для HTTP: клиент не
 * может выбрать чужую БД параметром или полем сообщения. Комнаты затем
 * строятся с branchId, поэтому одинаковые идентификаторы филиалов не
 * пересекаются. Вынесено из realtime.ts, чтобы правила можно было покрыть
 * тестами без поднятия Socket.IO.
 */
interface SocketIdentity {
  tenant: TenantContext
  userId: string
  role: string
}

interface SocketHandshakeData {
  host?: unknown
  token?: unknown
}

export async function authorizeSocket(handshake: SocketHandshakeData): Promise<SocketIdentity> {
  const host = normalizeHost(String(handshake.host ?? ''))
  let branch = await resolveBranchByDomain(host)
  if (!branch && env.ALLOW_PRIMARY_FALLBACK) {
    branch = await getPrimaryBranch()
  }
  if (!branch || branch.status !== 'ACTIVE') {
    throw new Error('Филиал для этого домена не найден или не активирован')
  }

  const token = typeof handshake.token === 'string' ? handshake.token : ''
  if (!token) throw new Error('Требуется access-токен')

  let payload: ReturnType<typeof verifyAccessToken>
  try {
    payload = verifyAccessToken(token)
  } catch {
    throw new Error('Access-токен недействителен')
  }

  if (!payload.role || typeof payload.sub !== 'string') {
    throw new Error('Требуется токен пользователя филиала')
  }
  if (payload.branchId && payload.branchId !== branch.id) {
    throw new Error('Токен выдан для другого филиала')
  }
  if (!payload.branchId && !branch.isPrimary) {
    throw new Error('Токен не привязан к филиалу, войдите заново')
  }

  return {
    tenant: {
      branchId: branch.id,
      branchSlug: branch.slug,
      domain: branch.domain,
      isPrimary: branch.isPrimary,
      prisma: branch.isPrimary ? defaultPrisma : getBranchPrisma(branch.id, branch.databaseName),
      uploadsDir: tenantUploadsDir(branch.slug, branch.isPrimary),
    },
    userId: payload.sub,
    role: payload.role,
  }
}
