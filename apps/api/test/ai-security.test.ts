import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../src/config/env.js'
import { aiJson } from '../src/modules/assessment/ai.service.js'

/**
 * AI-провайдер: ключ читается только сервером, ошибки не раскрывают его
 * значение, а некорректный ответ модели не попадает в бизнес-логику.
 */
const originalKey = env.OPENAI_API_KEY
const originalBaseUrl = env.OPENAI_BASE_URL

function response(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

beforeEach(() => {
  env.OPENAI_API_KEY = undefined
  env.OPENAI_BASE_URL = 'https://ai.example.test/v1'
  vi.restoreAllMocks()
})

afterEach(() => {
  env.OPENAI_API_KEY = originalKey
  env.OPENAI_BASE_URL = originalBaseUrl
  vi.unstubAllGlobals()
})

describe('AI-вызов без ключа', () => {
  it('возвращает 503 и не делает сетевой запрос', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const error = await aiJson('system', 'user').catch((value) => value)
    expect(error).toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(error)).not.toContain('sk-')
  })
})

describe('AI-вызов с ключом', () => {
  beforeEach(() => {
    env.OPENAI_API_KEY = 'sk-test-secret-value'
  })

  it('отправляет ключ только в заголовке и возвращает JSON из fenced-блока', async () => {
    const fetchMock = vi.fn(async () =>
      response(200, {
        choices: [{ message: { content: '```json\n{"answer":"ok","confidence":0.9}\n```' } }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(aiJson('system', 'user')).resolves.toEqual({ answer: 'ok', confidence: 0.9 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ai.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-secret-value' }),
      }),
    )
  })

  it('отказ авторизации превращается в безопасную ошибку без тела провайдера', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => response(401, { error: 'sk-test-secret-value rejected' })))

    await expect(aiJson('system', 'user')).rejects.toMatchObject({
      status: 502,
      code: 'AI_AUTH',
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sk-test-secret-value')
  })

  it('ограничение частоты возвращает 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(429)))
    await expect(aiJson('system', 'user')).rejects.toMatchObject({ status: 429, code: 'AI_RATE_LIMIT' })
  })

  it('невалидный JSON модели не проходит в бизнес-логику', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(200, { choices: [{ message: { content: 'не json' } }] })),
    )
    await expect(aiJson('system', 'user')).rejects.toMatchObject({ status: 502, code: 'AI_INVALID' })
  })

  it('сетевая ошибка не раскрывает ключ в ошибке и логе', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed for sk-test-secret-value')
      }),
    )

    const error = await aiJson('system', 'user').catch((value) => value)
    expect(error).toMatchObject({ status: 502, code: 'AI_UNAVAILABLE' })
    expect(JSON.stringify(error)).not.toContain('sk-test-secret-value')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sk-test-secret-value')
  })
})
