import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { freedomPayAdapter } from '../src/integrations/payments/adapters/freedompay.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('адаптер FreedomPay', () => {
  it('дописывает paid/failed к returnUrl с уже существующим invoice', async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<response>
  <pg_status>ok</pg_status>
  <pg_payment_id>123456</pg_payment_id>
  <pg_redirect_url>https://api.freedompay.kg/pay.html?customer=test</pg_redirect_url>
</response>`
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockResolvedValue(new Response(xml, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await freedomPayAdapter.createCheckout(
      {
        provider: 'freedompay',
        label: 'Филиал',
        merchantId: 'merchant-1',
        secret: 'secret-key',
      },
      {
        invoiceId: '00000000-0000-4000-8000-000000000001',
        invoiceNumber: 'INV-2026-000001',
        amount: 4500,
        description: 'Оплата обучения',
        callbackUrl: 'https://app.example/api/finance/webhooks',
        returnUrl: 'https://app.example/payments?invoice=00000000-0000-4000-8000-000000000001',
      },
    )

    expect(result.externalId).toBe('123456')
    expect(result.redirectUrl).toContain('pay.html')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const body = new URLSearchParams(String(init?.body ?? ''))
    expect(body.get('pg_success_url')).toBe(
      'https://app.example/payments?invoice=00000000-0000-4000-8000-000000000001&paid=1',
    )
    expect(body.get('pg_failure_url')).toBe(
      'https://app.example/payments?invoice=00000000-0000-4000-8000-000000000001&failed=1',
    )

    const unsigned = Object.fromEntries(body.entries())
    delete unsigned.pg_sig
    const expectedSignature = createHash('md5')
      .update(
        [
          'init_payment.php',
          ...Object.keys(unsigned)
            .sort()
            .map((key) => unsigned[key]),
          'secret-key',
        ].join(';'),
      )
      .digest('hex')
    expect(body.get('pg_sig')).toBe(expectedSignature)
  })
})
