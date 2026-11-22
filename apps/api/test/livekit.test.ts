import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import { buildJoinToken, verifyWebhook, type LivekitConfig } from '../src/modules/video/livekit.js'

const config: LivekitConfig = {
  url: 'wss://livekit.test',
  apiKey: 'test-key',
  apiSecret: 'test-secret-value-with-enough-length',
}

describe('токены LiveKit', () => {
  it('выдаёт токен только на указанную комнату и с ограниченным сроком', () => {
    const { token, expiresAt } = buildJoinToken(
      { identity: 'user-1', name: 'Иван', roomName: 'room-1', ttlSeconds: 600 },
      config,
    )

    const payload = jwt.verify(token, config.apiSecret, { issuer: config.apiKey }) as {
      sub: string
      name: string
      video: { room: string; roomJoin: boolean; canPublish: boolean; roomAdmin: boolean }
      exp: number
    }

    expect(payload.sub).toBe('user-1')
    expect(payload.name).toBe('Иван')
    expect(payload.video.room).toBe('room-1')
    expect(payload.video.roomJoin).toBe(true)
    expect(payload.video.canPublish).toBe(true)
    expect(payload.video.roomAdmin).toBe(false)
    expect(payload.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('ограничивает срок жизни токена шестью часами', () => {
    const { token } = buildJoinToken({ identity: 'u', name: 'U', roomName: 'r', ttlSeconds: 60 * 60 * 24 }, config)
    const payload = jwt.decode(token) as { exp: number; nbf: number }
    expect(payload.exp - payload.nbf).toBe(6 * 60 * 60)
  })

  it('выдаёт преподавателю права модератора комнаты', () => {
    const { token } = buildJoinToken({ identity: 't', name: 'T', roomName: 'r', roomAdmin: true }, config)
    const payload = jwt.decode(token) as { video: { roomAdmin: boolean } }
    expect(payload.video.roomAdmin).toBe(true)
  })
})

function signedWebhook(body: string, secret = config.apiSecret, key = config.apiKey) {
  const sha256 = crypto.createHash('sha256').update(Buffer.from(body)).digest('base64')
  const token = jwt.sign({ iss: key, sha256 }, secret, { algorithm: 'HS256', expiresIn: 60 })
  return { token, rawBody: Buffer.from(body) }
}

describe('вебхуки LiveKit', () => {
  it('принимает событие с корректной подписью', () => {
    const body = JSON.stringify({ event: 'participant_joined', room: { name: 'room-1' }, participant: { identity: 'user-1' } })
    const { token, rawBody } = signedWebhook(body)

    const event = verifyWebhook(rawBody, `Bearer ${token}`, config)
    expect(event.event).toBe('participant_joined')
    expect(event.participant?.identity).toBe('user-1')
  })

  it('отклоняет подделанное тело', () => {
    const { token } = signedWebhook(JSON.stringify({ event: 'room_finished', room: { name: 'room-1' } }))
    const tampered = Buffer.from(JSON.stringify({ event: 'room_finished', room: { name: 'room-2' } }))

    expect(() => verifyWebhook(tampered, `Bearer ${token}`, config)).toThrow(/Хеш/)
  })

  it('отклоняет чужую подпись и отсутствие заголовка', () => {
    const body = JSON.stringify({ event: 'room_started', room: { name: 'room-1' } })
    const { token, rawBody } = signedWebhook(body, 'another-secret-value-with-enough-length')

    expect(() => verifyWebhook(rawBody, `Bearer ${token}`, config)).toThrow(/Подпись/)
    expect(() => verifyWebhook(rawBody, undefined, config)).toThrow(/Authorization/)
  })
})
