import type { HttpProbe } from '../core/http.js'
import type { IntegrationProbe } from '../core/types.js'

/** Единая трактовка HTTP-ответа провайдера при проверке доступности. */
export function interpretProbe(provider: string, probe: HttpProbe): IntegrationProbe {
  if (probe.ok) return { ok: true }
  if (probe.status === 401 || probe.status === 403) {
    return { ok: false, message: `${provider}: ключ отклонён (HTTP ${probe.status})` }
  }
  if (probe.status > 0 && probe.status < 500) {
    return { ok: false, message: `${provider}: ${probe.message ?? `HTTP ${probe.status}`}` }
  }
  return { ok: false, message: `${provider}: сервис недоступен (${probe.message ?? 'нет ответа'})` }
}
