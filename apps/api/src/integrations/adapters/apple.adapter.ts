import { env } from '../../config/env.js'
import { safeErrorMessage } from '../core/errors.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

const DISCOVERY_URL = 'https://appleid.apple.com/.well-known/openid-configuration'

/**
 * Вход через Apple. Ключ подписи (APPLE_PRIVATE_KEY) нужен только серверу,
 * если платформа обменивает код авторизации; клиенту он не передаётся.
 */
export const appleAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'apple',
    name: 'Apple Sign-In',
    category: 'identity',
    description: 'Вход через Apple ID и проверка identity-токена на сервере.',
    docsUrl: 'https://developer.apple.com/documentation/sign_in_with_apple',
    envVars: ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'],
  },
  missingEnv: () => (env.APPLE_CLIENT_ID ? [] : ['APPLE_CLIENT_ID']),
  isConfigured: () => Boolean(env.APPLE_CLIENT_ID),
  async probe(): Promise<IntegrationProbe> {
    try {
      const response = await fetch(DISCOVERY_URL, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return { ok: false, message: `Apple OIDC: HTTP ${response.status}` }
      const document = (await response.json()) as { issuer?: string }
      return document.issuer === 'https://appleid.apple.com'
        ? { ok: true }
        : { ok: false, message: 'Apple OIDC вернул неожиданный документ конфигурации' }
    } catch (error) {
      return { ok: false, message: `Apple OIDC недоступен (${safeErrorMessage(error, 120)})` }
    }
  },
}
