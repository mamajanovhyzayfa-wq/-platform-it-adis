import { env } from '../../config/env.js'
import { probeHttp } from '../core/http.js'
import { missingVariables, readSecret } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

function missing(): string[] {
  return missingVariables([
    ['LIVEDIGITAL_API_TOKEN', env.LIVEDIGITAL_API_TOKEN],
    ['LIVEDIGITAL_SPACE_ID', env.LIVEDIGITAL_SPACE_ID],
  ])
}

/**
 * LiveDigital (Moodhood API): видеокомнаты, запись и аналитика занятий.
 * Проверка читает список комнат пространства — это документированный метод,
 * поэтому заодно проверяется и токен, и spaceId.
 */
export const liveDigitalAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'livedigital',
    name: 'LiveDigital',
    category: 'video',
    description: 'Видеоконференции, облачная запись и аналитика занятий.',
    docsUrl: 'https://docs.livedigital.space/docs/moodhood-api/v1/livedigital-api',
    envVars: ['LIVEDIGITAL_API_URL', 'LIVEDIGITAL_API_TOKEN', 'LIVEDIGITAL_SPACE_ID', 'LIVEDIGITAL_WEBHOOK_SECRET'],
  },
  missingEnv: missing,
  isConfigured: () => missing().length === 0,
  async probe(): Promise<IntegrationProbe> {
    const base = env.LIVEDIGITAL_API_URL.replace(/\/$/, '')
    const token = readSecret('LIVEDIGITAL_API_TOKEN') ?? ''
    const spaceId = env.LIVEDIGITAL_SPACE_ID ?? ''
    const result = await probeHttp(`${base}/spaces/${encodeURIComponent(spaceId)}/rooms?limit=1`, {
      headers: { Authorization: `Bearer ${token}`, 'x-public': 'true' },
    })

    if (result.ok) return { ok: true }
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: `LiveDigital: ключ отклонён (HTTP ${result.status})` }
    }
    if (result.status === 404) {
      return { ok: false, message: 'LiveDigital: пространство не найдено, проверьте LIVEDIGITAL_SPACE_ID' }
    }
    return { ok: false, message: `LiveDigital недоступен (${result.message ?? 'нет ответа'})` }
  },
}
