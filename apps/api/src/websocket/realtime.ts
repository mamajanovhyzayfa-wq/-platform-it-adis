import type { Server as HttpServer } from 'node:http'
import { Logger } from '@nestjs/common'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'
import { Server } from 'socket.io'
import { env } from '../config/env.js'
import { getTenant, runWithTenant, type TenantContext } from '../lib/tenant.js'
import { authorizeSocket } from './realtime-auth.js'

/**
 * Socket.IO для сообщений: клиент подключается с access-токеном,
 * вступает в комнату переписки только после проверки участия.
 *
 * Филиал определяется по Host рукопожатия. Комнаты включают branchId, поэтому
 * одноимённые идентификаторы разных филиалов не пересекаются.
 */
let io: Server | null = null
let adapterClients: { pub: Redis; sub: Redis } | null = null

const logger = new Logger('Realtime')

/**
 * Redis adapter нужен, когда API запущен в нескольких репликах: без него
 * сообщение, отправленное через одну реплику, не увидят сокеты другой.
 * Клиенты pub/sub отдельные от кеша: ioredis требует dedicate-соединения.
 */
function attachRedisAdapter(server: Server): void {
  if (!env.REDIS_URL) {
    logger.warn('REDIS_URL не задан: Socket.IO работает только в одном процессе')
    return
  }

  try {
    const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
    const sub = pub.duplicate()
    for (const [name, client] of [
      ['pub', pub],
      ['sub', sub],
    ] as const) {
      client.on('error', (error: Error) => logger.warn(`Redis ${name}: ${error.message}`))
    }
    server.adapter(createAdapter(pub, sub))
    adapterClients = { pub, sub }
    logger.log('Socket.IO использует Redis adapter для нескольких реплик')
  } catch (error) {
    logger.error(
      `Не удалось включить Redis adapter: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function room(branchId: string, kind: 'user' | 'conversation', id: string): string {
  return `branch:${branchId}:${kind}:${id}`
}

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: env.APP_ORIGIN, credentials: true },
  })
  attachRedisAdapter(io)

  io.use((socket, next) => {
    void authorizeSocket({
      host: socket.handshake.headers.host,
      token: socket.handshake.auth?.token,
    })
      .then((identity) => {
        socket.data.tenant = identity.tenant
        socket.data.userId = identity.userId
        socket.data.role = identity.role
        next()
      })
      .catch((error: unknown) => {
        next(new Error(error instanceof Error ? error.message : 'Не удалось авторизовать соединение'))
      })
  })

  io.on('connection', (socket) => {
    const tenant = socket.data.tenant as TenantContext
    const userId = socket.data.userId as string
    void socket.join(room(tenant.branchId, 'user', userId))
    console.log(`[socket] подключён пользователь ${userId} (${tenant.branchSlug})`)

    socket.on('conversation:join', (conversationId: unknown) => {
      if (typeof conversationId !== 'string') return
      void runWithTenant(tenant, async () => {
        // Участие проверяется в БД филиала подключения, а не в общей БД.
        const participant = await tenant.prisma.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId, userId } },
          select: { conversationId: true },
        })
        if (participant) {
          await socket.join(room(tenant.branchId, 'conversation', conversationId))
        }
      }).catch(() => undefined)
    })

    socket.on('conversation:leave', (conversationId: unknown) => {
      if (typeof conversationId === 'string') {
        void socket.leave(room(tenant.branchId, 'conversation', conversationId))
      }
    })

    socket.on('typing', (payload: { conversationId?: unknown; name?: unknown }) => {
      const conversationId = payload?.conversationId
      if (typeof conversationId !== 'string') return
      const roomName = room(tenant.branchId, 'conversation', conversationId)
      if (!socket.rooms.has(roomName)) return
      socket.to(roomName).emit('typing', {
        conversationId,
        userId,
        name: typeof payload?.name === 'string' ? payload.name : null,
      })
    })
  })

  return io
}

export function emitNewMessage(conversationId: string, message: unknown, recipientIds: string[]): void {
  const branchId = getTenant()?.branchId
  if (!io || !branchId) return
  io.to(room(branchId, 'conversation', conversationId)).emit('message:new', { conversationId, message })
  for (const recipientId of recipientIds) {
    io.to(room(branchId, 'user', recipientId)).emit('message:notification', { conversationId, message })
  }
}

/** Отметка о прочтении: приходит всем, кто открыл ту же переписку. */
export function emitConversationRead(conversationId: string, userId: string, readAt: Date): void {
  const branchId = getTenant()?.branchId
  if (!io || !branchId) return
  io.to(room(branchId, 'conversation', conversationId)).emit('conversation:read', {
    conversationId,
    userId,
    readAt: readAt.toISOString(),
  })
}

export function closeRealtime(): void {
  io?.close()
  adapterClients?.pub.disconnect()
  adapterClients?.sub.disconnect()
  adapterClients = null
  io = null
}
