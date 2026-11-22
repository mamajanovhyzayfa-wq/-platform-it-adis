import { env } from '../../config/env.js'
import { probeHttp } from '../core/http.js'
import { readSecret } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

/** AI-провайдер, совместимый с OpenAI API (ключ только на сервере). */
export const aiAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'openai',
    name: 'AI-провайдер (OpenAI-совместимый)',
    category: 'ai',
    description: 'AI-помощник, проверка заданий и автоматизация: запросы идут с сервера.',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    envVars: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'],
  },
  missingEnv: () => (env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY']),
  isConfigured: () => Boolean(env.OPENAI_API_KEY),
  async probe(): Promise<IntegrationProbe> {
    const base = env.OPENAI_BASE_URL.replace(/\/$/, '')
    const result = await probeHttp(`${base}/models`, {
      headers: { Authorization: `Bearer ${readSecret('OPENAI_API_KEY') ?? ''}` },
    })
    if (result.ok) return { ok: true }
    if (result.status === 401 || result.status === 403) {
      return { ok: false, message: 'AI: ключ провайдера отклонён' }
    }
    return { ok: false, message: `AI-провайдер: ${result.message ?? 'нет ответа'}` }
  },
}
