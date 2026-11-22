import { env } from '../../config/env.js'
import { safeErrorMessage } from '../core/errors.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

const DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration'

/** Вход через Google: ID-токен проверяется на сервере, секрет не попадает в приложения. */
export const googleAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'google',
    name: 'Google Sign-In',
    category: 'identity',
    description: 'Вход через Google: проверка ID-токена на сервере и привязка аккаунта.',
    docsUrl: 'https://developers.google.com/identity/gsi/web/guides/verify-google-id-token',
    envVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
  missingEnv: () => (env.GOOGLE_CLIENT_ID ? [] : ['GOOGLE_CLIENT_ID']),
  isConfigured: () => Boolean(env.GOOGLE_CLIENT_ID),
  async probe(): Promise<IntegrationProbe> {
    try {
      const response = await fetch(DISCOVERY_URL, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return { ok: false, message: `Google OIDC: HTTP ${response.status}` }
      const document = (await response.json()) as { issuer?: string }
      return document.issuer === 'https://accounts.google.com'
        ? { ok: true }
        : { ok: false, message: 'Google OIDC вернул неожиданный документ конфигурации' }
    } catch (error) {
      return { ok: false, message: `Google OIDC недоступен (${safeErrorMessage(error, 120)})` }
    }
  },
}
