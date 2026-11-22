import { beforeEach, describe, expect, it, vi } from 'vitest'

const apyhub = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  verify: vi.fn<(email: string) => Promise<boolean>>(),
}))

vi.mock('../src/integrations/adapters/apyhub.adapter.js', () => ({
  isApyHubConfigured: apyhub.configured,
  verifyEmailDeliverability: apyhub.verify,
  apyHubAdapter: { descriptor: { id: 'apyhub' } },
}))

import { IntegrationError } from '../src/integrations/core/errors.js'
import { assertDeliverableLeadEmail } from '../src/modules/leads/leads.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  apyhub.configured.mockReturnValue(true)
})

describe('проверка email в форме заявки', () => {
  it('пропускает заявку, когда ApyHub подтвердил адрес', async () => {
    apyhub.verify.mockResolvedValue(true)

    await expect(assertDeliverableLeadEmail(' User@Example.com ')).resolves.toBeUndefined()
    expect(apyhub.verify).toHaveBeenCalledWith('user@example.com')
  })

  it('отклоняет заявку с неверным или одноразовым адресом как 400', async () => {
    apyhub.verify.mockResolvedValue(false)

    await expect(assertDeliverableLeadEmail('user@mailinator.com')).rejects.toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    })
  })

  it('возвращает 503, а не «неверный email», при сбое ApyHub', async () => {
    apyhub.verify.mockRejectedValue(
      new IntegrationError('ApyHub', 'HTTP_ERROR', 'ApyHub: HTTP 503', { retryable: true }),
    )

    await expect(assertDeliverableLeadEmail('user@example.com')).rejects.toMatchObject({
      status: 503,
      code: 'EMAIL_CHECK_UNAVAILABLE',
    })
  })

  it('пропускает проверку без токена и для пустого email', async () => {
    apyhub.configured.mockReturnValue(false)

    await expect(assertDeliverableLeadEmail('user@example.com')).resolves.toBeUndefined()
    apyhub.configured.mockReturnValue(true)
    await expect(assertDeliverableLeadEmail('')).resolves.toBeUndefined()
    await expect(assertDeliverableLeadEmail(undefined)).resolves.toBeUndefined()
    expect(apyhub.verify).not.toHaveBeenCalled()
  })
})
