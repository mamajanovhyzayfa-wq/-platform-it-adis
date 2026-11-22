import { create } from 'zustand'
import { storage } from '@/utils/storage'

export type ThemeMode = 'system' | 'light' | 'dark'

const THEME_KEY = 'itadis.theme'

interface ThemeState {
  /** Выбор пользователя: системная тема, всегда светлая или всегда тёмная. */
  mode: ThemeMode
  hydrated: boolean
  hydrate: () => Promise<void>
  setMode: (mode: ThemeMode) => Promise<void>
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'system',
  hydrated: false,

  hydrate: async () => {
    try {
      const saved = await storage.get(THEME_KEY)
      set({ mode: isThemeMode(saved) ? saved : 'system', hydrated: true })
    } catch {
      set({ hydrated: true })
    }
  },

  setMode: async (mode) => {
    set({ mode })
    await storage.set(THEME_KEY, mode)
  },
}))
