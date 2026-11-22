import { io, type Socket } from 'socket.io-client'
import { API_URL } from '@/api/client'
import { getAccessToken } from '@/api/session'

let socket: Socket | null = null
let currentToken: string | null = null

/** Сокет подключается к тому же хосту, что и API, с access-токеном в handshake. */
export function connectSocket(): Socket | null {
  const token = getAccessToken()
  if (!token) return null

  if (socket && currentToken === token) {
    if (!socket.connected) socket.connect()
    return socket
  }

  socket?.disconnect()
  socket = io(API_URL.replace(/\/api\/?$/, ''), {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
  })
  currentToken = token
  return socket
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
  currentToken = null
}
