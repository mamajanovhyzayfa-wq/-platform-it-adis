import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyEmailDeliverability } from '../src/integrations/adapters/apyhub.adapter.js'

const ENDPOINT = 'https://api.eu.apyhub.com/apyhub/verify-email-validity-and-deliverability'
const TOKEN = 'test-apy-token'

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  process.env.APY_TOKEN = TOKEN
})

afterEach(() => {
  delete process.env.APY_TOKEN
  vi.unstubAllGlobals()
})

describe('ApyHub: проверка email', () => {
  it('возвращает true и отправляет документированные поля', async () => {
    const fetchMock = mockFetch(() => Response.json({ data: true }))

    await expect(verifyEmailDeliverability('User@Example.com')).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['apy-token']).toBe(TOKEN)
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'User@Example.com',
      // Политика проекта: одноразовые адреса не принимаем.
      disposable_checks: true,
    })
    expect(JSON.stringify(init.headers)).not.toContain('Authorization')
  })

  it('возвращает false для отклонённого адреса', async () => {
    mockFetch(() => Response.json({ data: false }))

    await expect(verifyEmailDeliverability('user@mailinator.com')).resolves.toBe(false)
  })

  it('не считает ответ без boolean data успешной проверкой', async () => {
    mockFetch(() => Response.json({ data: 'true' }))

    await expect(verifyEmailDeliverability('user@example.com')).rejects.toMatchObject({
      name: 'IntegrationError',
      code: 'INVALID_RESPONSE',
    })
  })

  it('отличает 429 от неверного адреса', async () => {
    mockFetch(() => new Response('rate limit', { status: 429 }))

    await expect(verifyEmailDeliverability('user@example.com')).rejects.toMatchObject({
      name: 'IntegrationError',
      code: 'HTTP_ERROR',
      retryable: true,
    })
  })

  it('отличает 5xx от неверного адреса', async () => {
    mockFetch(() => new Response('upstream down', { status: 503 }))

    await expect(verifyEmailDeliverability('user@example.com')).rejects.toMatchObject({
      name: 'IntegrationError',
      code: 'HTTP_ERROR',
      retryable: true,
    })
  })

  it('отличает таймаут от неверного адреса', async () => {
    mockFetch(() => Promise.reject(new DOMException('timed out', 'TimeoutError')))

    await expect(verifyEmailDeliverability('user@example.com')).rejects.toMatchObject({
      name: 'IntegrationError',
      code: 'NETWORK_ERROR',
      retryable: true,
    })
  })

  it('не повторяет запрос при неверном токене', async () => {
    const fetchMock = mockFetch(() => new Response('unauthorized', { status: 401 }))

    await expect(verifyEmailDeliverability('user@example.com')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      retryable: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('без APY_TOKEN не ходит в сеть и не выдаёт адрес за проверенный', async () => {
    delete process.env.APY_TOKEN
    const fetchMock = mockFetch(() => Response.json({ data: true }))

    await expect(verifyEmailDeliverability('user@example.com')).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
      status: 503,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
