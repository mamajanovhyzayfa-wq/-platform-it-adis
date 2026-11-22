import { probeHttp } from '../core/http.js'
import { readSecret } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

/**
 * Push через Expo Push API.
 *
 * Токен Expo не обязателен: без него рассылка работает с общими лимитами,
 * с ним — с повышенными. Поэтому адаптер считается настроенным всегда, а
 * EXPO_ACCESS_TOKEN показывается как необязательная переменная.
 */
export const pushAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'expo-push',
    name: 'Push (Expo)',
    category: 'push',
    description: 'Push-уведомления мобильным приложениям Android и iOS.',
    docsUrl: 'https://docs.expo.dev/push-notifications/overview/',
    envVars: ['EXPO_ACCESS_TOKEN'],
  },
  missingEnv: () => [],
  isConfigured: () => true,
  async probe(): Promise<IntegrationProbe> {
    const token = readSecret('EXPO_ACCESS_TOKEN')
    const result = await probeHttp('https://exp.host', {
      method: 'HEAD',
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    })
    if (result.status > 0 && result.status < 500) {
      return result.ok
        ? { ok: true }
        : { ok: true, degraded: true, message: `Expo ответил HTTP ${result.status}; отправка повторится позже` }
    }
    return { ok: false, message: `Expo недоступен (${result.message ?? 'нет ответа'})` }
  },
}
