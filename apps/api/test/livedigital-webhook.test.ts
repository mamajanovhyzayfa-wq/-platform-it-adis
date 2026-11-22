import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppError } from '../src/lib/errors.js'
import type { LiveDigitalWebhookPayload } from '../src/modules/scheduling/livedigital.js'

const SECRET = 'livedigital-test-webhook-secret'

const body: LiveDigitalWebhookPayload = {
  eventName: 'room.started',
  roomId: 'room-1',
  spaceId: 'test-space',
  recordId: 'record-1',
}

const rawBody = Buffer.from(JSON.stringify({ signature: 'placeholder', body }))

function sign(value: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex')
}

async function loadModule() {
  vi.resetModules()
  return import('../src/modules/scheduling/livedigital.js')
}

beforeAll(() => {
  process.env.LIVEDIGITAL_API_TOKEN = 'test-token'
  process.env.LIVEDIGITAL_SPACE_ID = 'test-space'
  process.env.LIVEDIGITAL_WEBHOOK_SECRET = SECRET
})

describe('вебхук LiveDigital: подпись', () => {
  it('принимает подпись тела в формате sha256=hex', async () => {
    const { verifyWebhook } = await loadModule()
    const payload = { signature: `sha256=${sign(JSON.stringify(body))}`, body }
    expect(verifyWebhook(rawBody, payload)).toEqual(body)
  })

  it('принимает подпись без префикса и в верхнем регистре', async () => {
    const { verifyWebhook } = await loadModule()
    const payload = { signature: sign(JSON.stringify(body)).toUpperCase(), body }
    expect(verifyWebhook(rawBody, payload)).toEqual(body)
  })

  it('принимает подпись, посчитанную по сырому HTTP-телу', async () => {
    const { verifyWebhook } = await loadModule()
    const payload = { signature: sign(rawBody.toString()), body }
    expect(verifyWebhook(rawBody, payload)).toEqual(body)
  })

  it('отклоняет тело, не совпадающее с подписью', async () => {
    const { verifyWebhook } = await loadModule()
    const tamperedBody: LiveDigitalWebhookPayload = { ...body, eventName: 'room.ended' }
    const tamperedRaw = Buffer.from(JSON.stringify({ signature: 'x', body: tamperedBody }))
    const payload = { signature: sign(JSON.stringify(body)), body: tamperedBody }

    try {
      verifyWebhook(tamperedRaw, payload)
      throw new Error('ожидалась ошибка подписи')
    } catch (error) {
      // Модуль загружен динамически после resetModules, поэтому проверяем
      // контракт ошибки (status/code), а не идентичность класса.
      expect((error as AppError).status).toBe(401)
      expect((error as AppError).code).toBe('INVALID_WEBHOOK')
    }
  })

  it('отклоняет чужую подпись', async () => {
    const { verifyWebhook } = await loadModule()
    const payload = { signature: sign(JSON.stringify(body), 'another-secret'), body }

    expect(() => verifyWebhook(rawBody, payload)).toThrow(/не совпадает/)
  })

  it('требует подпись и тело', async () => {
    const { verifyWebhook } = await loadModule()

    expect(() => verifyWebhook(rawBody, { body })).toThrow(/без подписи или тела/)
    expect(() => verifyWebhook(rawBody, { signature: sign(JSON.stringify(body)) })).toThrow(
      /без подписи или тела/,
    )
  })

  it('отклоняет не-JSON тело', async () => {
    const { verifyWebhook } = await loadModule()
    const payload = { signature: sign(JSON.stringify(body)), body }

    expect(() => verifyWebhook(Buffer.from('не json'), payload)).toThrow(/не является JSON/)
  })

  it('без настроенного провайдера отвечает 503, а не имитирует успех', async () => {
    delete process.env.LIVEDIGITAL_API_TOKEN
    try {
      const { verifyWebhook } = await loadModule()
      const payload = { signature: sign(JSON.stringify(body)), body }
      expect(() => verifyWebhook(rawBody, payload)).toThrow(/не настроены/)
    } finally {
      process.env.LIVEDIGITAL_API_TOKEN = 'test-token'
      vi.resetModules()
    }
  })
})
