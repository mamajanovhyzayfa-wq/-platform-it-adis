/** Публичные данные филиала для страницы входа. */
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

export async function getBranding() {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetch(`${API_BASE}/branding`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
