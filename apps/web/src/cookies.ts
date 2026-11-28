/**
 * Настройки cookie хранятся локально. Необязательные категории выключены
 * по умолчанию и не активируются до явного согласия.
 */
export type CookieCategory = 'analytics' | 'functional' | 'marketing'

export interface CookiePreferences {
  version: 1
  necessary: true
  analytics: boolean
  functional: boolean
  marketing: boolean
  updatedAt: string
}

const KEY = 'itadis.cookie.preferences'

const defaultCookiePreferences: CookiePreferences = {
  version: 1,
  necessary: true,
  analytics: false,
  functional: false,
  marketing: false,
  updatedAt: '',
}

export function loadCookiePreferences(): CookiePreferences | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CookiePreferences>
    return {
      ...defaultCookiePreferences,
      ...parsed,
      necessary: true,
    }
  } catch {
    return null
  }
}

export function saveCookiePreferences(preferences: Omit<CookiePreferences, 'version' | 'necessary' | 'updatedAt'>): CookiePreferences {
  const value: CookiePreferences = {
    version: 1,
    necessary: true,
    analytics: Boolean(preferences.analytics),
    functional: Boolean(preferences.functional),
    marketing: Boolean(preferences.marketing),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(KEY, JSON.stringify(value))
  return value
}

export function consentTypesForCookies(preferences: CookiePreferences): Array<{
  type: 'COOKIES' | 'COOKIE_ANALYTICS' | 'COOKIE_FUNCTIONAL' | 'COOKIE_MARKETING'
  granted: boolean
}> {
  return [
    { type: 'COOKIES', granted: true },
    { type: 'COOKIE_ANALYTICS', granted: preferences.analytics },
    { type: 'COOKIE_FUNCTIONAL', granted: preferences.functional },
    { type: 'COOKIE_MARKETING', granted: preferences.marketing },
  ]
}
