/**
 * Публичный клиент заявок с лендинга.
 *
 * В production запрос идёт на тот же origin (`/api`) и проксируется nginx/Worker
 * на backend. При отдельном домене задайте VITE_API_URL, например
 * https://api.itadis.kg/api.
 */
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

export async function submitLead(payload) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20_000)

  try {
    const response = await fetch(`${API_BASE}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Слишком много заявок с этого адреса. Попробуйте через 10 минут.')
      }
      const message =
        data && typeof data === 'object'
          ? data?.error?.message ?? data?.message
          : null
      throw new Error(message || 'Не удалось отправить заявку. Попробуйте ещё раз.')
    }

    return data
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Сервер не ответил вовремя. Проверьте подключение и попробуйте снова.')
    }
    if (error instanceof TypeError) {
      throw new Error('Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}
