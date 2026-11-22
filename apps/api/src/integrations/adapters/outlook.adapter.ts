import { env } from '../../config/env.js'
import { IntegrationError } from '../core/errors.js'
import { probeHttp } from '../core/http.js'
import { missingVariables } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

/** Outlook / Microsoft 365 через Microsoft Graph (client credentials). */
let cachedToken: { value: string; expiresAt: number } | null = null

function missing(): string[] {
  return missingVariables([
    ['OUTLOOK_TENANT_ID', env.OUTLOOK_TENANT_ID],
    ['OUTLOOK_CLIENT_ID', env.OUTLOOK_CLIENT_ID],
    ['OUTLOOK_CLIENT_SECRET', env.OUTLOOK_CLIENT_SECRET],
  ])
}

async function accessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value

  const tenant = encodeURIComponent(env.OUTLOOK_TENANT_ID ?? '')
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.OUTLOOK_CLIENT_ID ?? '',
      client_secret: env.OUTLOOK_CLIENT_SECRET ?? '',
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new IntegrationError(
      'outlook',
      'OAUTH_FAILED',
      `Outlook: не удалось получить токен (HTTP ${response.status})`,
      { retryable: response.status === 429 || response.status >= 500 },
    )
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) {
    throw new IntegrationError('outlook', 'OAUTH_FAILED', 'Outlook: сервер не вернул access-токен')
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3_600) * 1_000 }
  return cachedToken.value
}

export const outlookAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    category: 'calendar',
    description: 'Синхронизация расписания и приглашений через Microsoft Graph.',
    docsUrl: 'https://learn.microsoft.com/graph/api/resources/calendar',
    envVars: ['OUTLOOK_TENANT_ID', 'OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET'],
  },
  missingEnv: missing,
  isConfigured: () => missing().length === 0,
  async connect(): Promise<void> {
    await accessToken(true)
  },
  async probe(): Promise<IntegrationProbe> {
    const token = await accessToken()
    const result = await probeHttp('https://graph.microsoft.com/v1.0/organization?$select=id', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (result.ok) return { ok: true }
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: `Outlook: токен получен, но Graph отклонил запрос (HTTP ${result.status})` }
    }
    return { ok: false, message: `Outlook Graph: ${result.message ?? 'нет ответа'}` }
  },
}
