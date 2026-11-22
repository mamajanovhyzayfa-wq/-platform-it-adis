import { describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '../src/integrations/core/errors.js'
import { retryDelay, withRetry } from '../src/integrations/core/retry.js'

describe('повторные попытки внешних вызовов', () => {
  it('повторяет временную сетевую ошибку и возвращает результат', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('ok')
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(withRetry(operation, { attempts: 3, sleep, random: () => 0 })).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('не повторяет отказ из-за неверного ключа', async () => {
    const unauthorized = new IntegrationError('demo', 'HTTP_ERROR', 'demo: HTTP 401', { retryable: false })
    const operation = vi.fn().mockRejectedValue(unauthorized)
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(withRetry(operation, { attempts: 3, sleep })).rejects.toBe(unauthorized)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('повторяет 5xx и 429', async () => {
    const retryable = new IntegrationError('demo', 'HTTP_ERROR', 'demo: HTTP 503', { retryable: true })
    const operation = vi.fn().mockRejectedValueOnce(retryable).mockResolvedValueOnce('done')
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(withRetry(operation, { attempts: 2, sleep })).resolves.toBe('done')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('прекращает попытки после исчерпания и возвращает последнюю ошибку', async () => {
    const operation = vi.fn().mockRejectedValue(new TypeError('network'))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(withRetry(operation, { attempts: 3, sleep })).rejects.toThrow('network')
    expect(operation).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('увеличивает паузу экспоненциально и ограничивает максимумом', () => {
    expect(retryDelay(1, { baseDelayMs: 100, maxDelayMs: 1_000, random: () => 1 })).toBe(100)
    expect(retryDelay(2, { baseDelayMs: 100, maxDelayMs: 1_000, random: () => 1 })).toBe(200)
    expect(retryDelay(3, { baseDelayMs: 100, maxDelayMs: 1_000, random: () => 1 })).toBe(400)
    expect(retryDelay(10, { baseDelayMs: 100, maxDelayMs: 1_000, random: () => 1 })).toBe(1_000)
  })

  it('добавляет джиттер 50–100 %', () => {
    expect(retryDelay(1, { baseDelayMs: 100, random: () => 0 })).toBe(50)
  })
})
