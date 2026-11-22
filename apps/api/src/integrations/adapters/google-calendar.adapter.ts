import { env } from '../../config/env.js'
import { IntegrationError, safeErrorMessage } from '../core/errors.js'
import { probeHttp } from '../core/http.js'
import { missingVariables } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

/**
 * Google Calendar: расписание занятий попадает в календарь филиала.
 * OAuth refresh-токен живёт только на сервере; access-токен кешируется в памяти.
 */
let cachedToken: { value: string; expiresAt: number } | null = null

function missing(): string[] {
  return missingVariables([
    ['GOOGLE_CALENDAR_CLIENT_ID', env.GOOGLE_CALENDAR_CLIENT_ID],
    ['GOOGLE_CALENDAR_CLIENT_SECRET', env.GOOGLE_CALENDAR_CLIENT_SECRET],
    ['GOOGLE_CALENDAR_REFRESH_TOKEN', env.GOOGLE_CALENDAR_REFRESH_TOKEN],
  ])
}

async function accessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? '',
      refresh_token: env.GOOGLE_CALENDAR_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new IntegrationError(
      'google-calendar',
      'OAUTH_FAILED',
      `Google Calendar: не удалось обновить токен (HTTP ${response.status})`,
      { retryable: response.status === 429 || response.status >= 500 },
    )
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) {
    throw new IntegrationError('google-calendar', 'OAUTH_FAILED', 'Google Calendar: сервер не вернул access-токен')
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3_600) * 1_000,
  }
  return cachedToken.value
}

export const googleCalendarAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'calendar',
    description: 'Двусторонняя синхронизация расписания с календарём Google.',
    docsUrl: 'https://developers.google.com/calendar/api/v3/reference',
    envVars: [
      'GOOGLE_CALENDAR_CLIENT_ID',
      'GOOGLE_CALENDAR_CLIENT_SECRET',
      'GOOGLE_CALENDAR_REFRESH_TOKEN',
      'GOOGLE_CALENDAR_ID',
    ],
  },
  missingEnv: missing,
  isConfigured: () => missing().length === 0,
  async connect(): Promise<void> {
    await accessToken(true)
  },
  async probe(): Promise<IntegrationProbe> {
    const token = await accessToken()
    const calendarId = encodeURIComponent(env.GOOGLE_CALENDAR_ID)
    const result = await probeHttp(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (result.ok) return { ok: true }
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: `Google Calendar: нет доступа к календарю (HTTP ${result.status})` }
    }
    if (result.status === 404) return { ok: false, message: 'Google Calendar: календарь не найден' }
    return { ok: false, message: `Google Calendar: ${safeErrorMessage(result.message ?? 'нет ответа', 120)}` }
  },
}
