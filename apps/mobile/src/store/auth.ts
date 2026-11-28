import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { api, type AuthResponse, type Profile } from '@/api/api'
import { describeApiError } from '@/api/client'
import { clearSessionTokens, notifySessionExpired, onSessionExpired, setSessionTokens } from '@/api/session'
import { unregisterPush } from '@/services/push'
import { clearOfflineCache } from '@/offline/cache'
import { clearQueue } from '@/offline/queue'
import { clearDownloadedMaterials } from '@/offline/materials'
import type { Locale } from '@/i18n'

const ACCESS_KEY = 'itadis.access'
const REFRESH_KEY = 'itadis.refresh'
const LOCALE_KEY = 'itadis.locale'

/**
 * Автоматический выбор языка при первом запуске: язык системы, затем русский.
 * На web используем navigator.language, на устройствах — Intl (Hermes).
 */
function detectDeviceLocale(): Locale {
  const candidates: string[] = []
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    const webNavigator = navigator as Navigator & { languages?: readonly string[] }
    candidates.push(...(webNavigator.languages ?? []), webNavigator.language)
  }
  try {
    candidates.push(Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {
    /* Intl может быть недоступен в старых сборках Hermes */
  }
  for (const candidate of candidates) {
    const tag = candidate?.toLowerCase()
    if (tag?.startsWith('ky')) return 'ky'
    if (tag?.startsWith('en')) return 'en'
    if (tag?.startsWith('ru')) return 'ru'
  }
  return 'ru'
}

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

type AuthStatus = 'idle' | 'loading' | 'guest' | 'authenticated'

interface AuthState {
  status: AuthStatus
  user: Profile | null
  locale: Locale
  error: string | null
  twoFactorChallenge: string | null
  bootstrap: () => Promise<void>
  login: (
    identifier: string,
    password: string,
    captcha?: { captchaId: string; captchaAnswer: string },
  ) => Promise<'authenticated' | 'two-factor'>
  verifyTwoFactor: (code: string) => Promise<void>
  cancelTwoFactor: () => void
  register: (payload: Record<string, unknown>) => Promise<void>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
  setLocale: (locale: Locale) => Promise<void>
  /** Токены, обновлённые внутри WebView видеокомнаты. */
  updateTokens: (tokens: { accessToken: string; refreshToken: string }) => Promise<void>
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
  twoFactorChallenge: null,

  bootstrap: async () => {
    set({ status: 'loading', error: null })
    const locale = ((await storage.get(LOCALE_KEY)) as Locale | null) ?? detectDeviceLocale()
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

  login: async (identifier, password, captcha) => {
    set({ error: null })
    try {
      const deviceId = Platform.OS === 'web' ? 'web-device' : `${Platform.OS}-${Platform.Version}`
      const response = await api.login({
        identifier,
        password,
        deviceId,
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
        ...(captcha ?? {}),
      })
      if ('twoFactorRequired' in response) {
        set({ twoFactorChallenge: response.challengeToken })
        return 'two-factor'
      }
      await persistSession(response)
      const user = await api.me()
      set({
        status: 'authenticated',
        user,
        locale: (user.locale as Locale) ?? get().locale,
        twoFactorChallenge: null,
      })
      return 'authenticated'
    } catch (error) {
      set({ error: describeApiError(error) })
      throw error
    }
  },

  cancelTwoFactor: () => set({ twoFactorChallenge: null, error: null }),

  verifyTwoFactor: async (code) => {
    const challengeToken = get().twoFactorChallenge
    if (!challengeToken) throw new Error('Нет активного запроса двухфакторной проверки')
    set({ error: null })
    try {
      const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web'
      const response = await api.verifyTwoFactor(challengeToken, code, {
        deviceId: Platform.OS === 'web' ? 'web-device' : `${Platform.OS}-${Platform.Version}`,
        platform,
      })
      await persistSession(response)
      const user = await api.me()
      set({
        status: 'authenticated',
        user,
        locale: (user.locale as Locale) ?? get().locale,
        twoFactorChallenge: null,
      })
    } catch (error) {
      set({ error: describeApiError(error) })
      throw error
    }
  },

  register: async (payload) => {
    set({ error: null })
    try {
      // Заявка не создаёт сессию: администратор филиала должен её подтвердить.
      await api.register(payload)
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
    // Локальные материалы и очередь не должны достаться следующему пользователю.
    await Promise.allSettled([clearQueue(), clearDownloadedMaterials(), clearOfflineCache()])
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

  updateTokens: async (tokens) => {
    setSessionTokens(tokens)
    await storage.set(ACCESS_KEY, tokens.accessToken)
    await storage.set(REFRESH_KEY, tokens.refreshToken)
  },

  setLocale: async (locale) => {
    await storage.set(LOCALE_KEY, locale)
    set({ locale })
    // Явный выбор синхронизируется с профилем, чтобы язык сохранился на других устройствах.
    if (get().status !== 'authenticated') return
    try {
      const user = await api.updateMe({ locale })
      set({ user, locale: (user.locale as Locale) ?? locale })
    } catch {
      // Локальный выбор уже применён; при следующем входе профиль можно обновить повторно.
    }
  },
}))
