/**
 * Адрес веб-кабинета. В production лендинг и кабинет собираются вместе,
 * поэтому по умолчанию используется /app. При отдельном домене задайте
 * VITE_CABINET_URL (например, https://cabinet.itadis.kg).
 */
export function cabinetUrl(path = '/') {
  const configured = import.meta.env.VITE_CABINET_URL
  const base = (configured || (import.meta.env.DEV ? 'http://localhost:5174' : '/app')).replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}
