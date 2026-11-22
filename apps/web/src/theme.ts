/**
 * Пользовательские настройки интерфейса: тема, размер текста, контрастность.
 * Хранятся в localStorage и применяются атрибутами на <html>.
 */
export type Theme = 'light' | 'dark'
export type FontScale = 'sm' | 'md' | 'lg'

export interface Preferences {
  theme: Theme
  font: FontScale
  contrast: boolean
}

const KEY = 'itadis.prefs'

const defaults = (): Preferences => ({
  theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  font: 'md',
  contrast: false,
})

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      font: parsed.font === 'sm' || parsed.font === 'lg' ? parsed.font : 'md',
      contrast: Boolean(parsed.contrast),
    }
  } catch {
    return defaults()
  }
}

export function applyPreferences(preferences: Preferences) {
  const root = document.documentElement
  root.dataset.theme = preferences.theme
  root.dataset.font = preferences.font
  root.dataset.contrast = preferences.contrast ? 'high' : 'normal'
  root.style.colorScheme = preferences.theme
  localStorage.setItem(KEY, JSON.stringify(preferences))
}
