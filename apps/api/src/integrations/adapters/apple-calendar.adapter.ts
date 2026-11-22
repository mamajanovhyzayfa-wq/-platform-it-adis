import { env } from '../../config/env.js'
import { probeHttp } from '../core/http.js'
import { missingVariables } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>'

function missing(): string[] {
  return missingVariables([
    ['APPLE_CALDAV_URL', env.APPLE_CALDAV_URL],
    ['APPLE_CALDAV_USERNAME', env.APPLE_CALDAV_USERNAME],
    ['APPLE_CALDAV_PASSWORD', env.APPLE_CALDAV_PASSWORD],
  ])
}

/** Apple Calendar (iCloud CalDAV): проверка — PROPFIND на корень календаря. */
export const appleCalendarAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'apple-calendar',
    name: 'Apple Calendar (CalDAV)',
    category: 'calendar',
    description: 'Синхронизация занятий с iCloud Calendar по протоколу CalDAV.',
    docsUrl: 'https://developer.apple.com/documentation/calendars',
    envVars: ['APPLE_CALDAV_URL', 'APPLE_CALDAV_USERNAME', 'APPLE_CALDAV_PASSWORD'],
  },
  missingEnv: missing,
  isConfigured: () => missing().length === 0,
  async probe(): Promise<IntegrationProbe> {
    const auth = Buffer.from(`${env.APPLE_CALDAV_USERNAME ?? ''}:${env.APPLE_CALDAV_PASSWORD ?? ''}`).toString('base64')
    const result = await probeHttp(env.APPLE_CALDAV_URL ?? '', {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${auth}`,
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: PROPFIND_BODY,
    })
    if (result.ok) return { ok: true }
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: 'Apple Calendar: логин или пароль приложения отклонён' }
    }
    return { ok: false, message: `Apple Calendar: ${result.message ?? 'нет ответа'}` }
  },
}
