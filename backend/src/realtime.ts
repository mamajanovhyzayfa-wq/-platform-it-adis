import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { verifyAccessToken } from './lib/security.js'

/**
 * Socket.IO для сообщений: клиент подключается с access-токеном,
 * вступает в комнату переписки только после проверки участия.
 */
let io: Server | null = null

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: env.APP_ORIGIN, credentials: true },
  })

  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token ?? '') as string
    if (!token) {
      next(new Error('Требуется access-токен'))
      return
    }
    try {
      const payload = verifyAccessToken(token)
      socket.data.userId = payload.sub
      socket.data.role = payload.role
      next()
    } catch {
      next(new Error('Access-токен недействителен'))
    }
  })

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string
    void socket.join(`user:${userId}`)
    console.log(`[socket] подключён пользователь ${userId}`)

    socket.on('conversation:join', async (conversationId: unknown) => {
      if (typeof conversationId !== 'string') return
      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
        select: { conversationId: true },
      })
      if (participant) void socket.join(`conversation:${conversationId}`)
    })

    socket.on('conversation:leave', (conversationId: unknown) => {
      if (typeof conversationId === 'string') void socket.leave(`conversation:${conversationId}`)
    })

    socket.on('typing', (payload: { conversationId?: unknown; name?: unknown }) => {
      const conversationId = payload?.conversationId
      if (typeof conversationId !== 'string') return
      if (!socket.rooms.has(`conversation:${conversationId}`)) return
      socket.to(`conversation:${conversationId}`).emit('typing', {
        conversationId,
        userId,
        name: typeof payload?.name === 'string' ? payload.name : null,
      })
    })
  })

  return io
}

export function emitNewMessage(conversationId: string, message: unknown, recipientIds: string[]): void {
  if (!io) return
  io.to(`conversation:${conversationId}`).emit('message:new', { conversationId, message })
  for (const recipientId of recipientIds) {
    io.to(`user:${recipientId}`).emit('message:notification', { conversationId, message })
  }
}

/** Отметка о прочтении: приходит всем, кто открыл ту же переписку. */
export function emitConversationRead(conversationId: string, userId: string, readAt: Date): void {
  if (!io) return
  io.to(`conversation:${conversationId}`).emit('conversation:read', {
    conversationId,
    userId,
    readAt: readAt.toISOString(),
  })
}

export function closeRealtime(): void {
  io?.close()
  io = null
}
