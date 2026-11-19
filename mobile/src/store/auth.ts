import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { api, type AuthResponse, type Profile } from '@/api/api'
import { describeApiError } from '@/api/client'
import { clearSessionTokens, notifySessionExpired, onSessionExpired, setSessionTokens } from '@/api/session'
import { unregisterPush } from '@/services/push'
import type { Locale } from '@/i18n'

const ACCESS_KEY = 'itadis.access'
const REFRESH_KEY = 'itadis.refresh'
const LOCALE_KEY = 'itadis.locale'

/** SecureStore недоступен в web, поэтому там используем localStorage (токены всё равно короткоживущие). */
const storage = {
  async get(key: string) {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null
    return SecureStore.getItemAsync(key)
  },
  async set(key: string, value: string | null) {
    if (Platform.OS === 'web') {
      if (value === null) globalThis.localStorage?.removeItem(key)
      else globalThis.localStorage?.setItem(key, value)
      return
    }
    if (value === null) await SecureStore.deleteItemAsync(key)
    else await SecureStore.setItemAsync(key, value)
  },
}

export type AuthStatus = 'idle' | 'loading' | 'guest' | 'authenticated'

interface AuthState {
  status: AuthStatus
  user: Profile | null
  locale: Locale
  error: string | null
  bootstrap: () => Promise<void>
  login: (identifier: string, password: string) => Promise<void>
  register: (payload: Record<string, unknown>) => Promise<void>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
  setLocale: (locale: Locale) => Promise<void>
}

async function persistSession(response: AuthResponse) {
  setSessionTokens(response.tokens)
  await storage.set(ACCESS_KEY, response.tokens.accessToken)
  await storage.set(REFRESH_KEY, response.tokens.refreshToken)
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  locale: 'ru',
  error: null,

  bootstrap: async () => {
    set({ status: 'loading', error: null })
    const locale = ((await storage.get(LOCALE_KEY)) as Locale | null) ?? 'ru'
    const accessToken = await storage.get(ACCESS_KEY)
    const refreshToken = await storage.get(REFRESH_KEY)

    onSessionExpired(async () => {
      await storage.set(ACCESS_KEY, null)
      await storage.set(REFRESH_KEY, null)
      clearSessionTokens()
      set({ status: 'guest', user: null })
    })

    if (!accessToken || !refreshToken) {
      set({ status: 'guest', locale, user: null })
      return
    }

    setSessionTokens({ accessToken, refreshToken })
    try {
      const user = await api.me()
      set({ status: 'authenticated', user, locale: (user.locale as Locale) ?? locale })
    } catch {
      clearSessionTokens()
      await storage.set(ACCESS_KEY, null)
      await storage.set(REFRESH_KEY, null)
      set({ status: 'guest', user: null, locale })
    }
  },

  login: async (identifier, password) => {
    set({ error: null })
    try {
      const deviceId = Platform.OS === 'web' ? 'web-device' : `${Platform.OS}-${Platform.Version}`
      const response = await api.login({ identifier, password, deviceId, platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web' })
      await persistSession(response)
      const user = await api.me()
      set({ status: 'authenticated', user, locale: (user.locale as Locale) ?? get().locale })
    } catch (error) {
      set({ error: describeApiError(error) })
      throw error
    }
  },

  register: async (payload) => {
    set({ error: null })
    try {
      const response = await api.register(payload)
      await persistSession(response)
      const user = await api.me()
      set({ status: 'authenticated', user, locale: (user.locale as Locale) ?? get().locale })
    } catch (error) {
      set({ error: describeApiError(error) })
      throw error
    }
  },

  logout: async () => {
    const refreshToken = await storage.get(REFRESH_KEY)
    if (refreshToken) {
      try {
        await api.logout(refreshToken)
      } catch {
        // даже если сервер недоступен, локальную сессию закрываем
      }
    }
    // Снимаем токен устройства до очистки сессии, чтобы следующий пользователь
    // на этом телефоне не получал чужие уведомления.
    await unregisterPush()
    await storage.set(ACCESS_KEY, null)
    await storage.set(REFRESH_KEY, null)
    clearSessionTokens()
    set({ status: 'guest', user: null })
  },

  refreshProfile: async () => {
    if (get().status !== 'authenticated') return
    try {
      const user = await api.me()
      set({ user })
    } catch (error) {
      if (describeApiError(error).includes('401')) notifySessionExpired()
    }
  },

  setLocale: async (locale) => {
    await storage.set(LOCALE_KEY, locale)
    set({ locale })
  },
}))
