import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

/**
 * Небольшая обёртка над хранилищем ключ-значение.
 * На нативных платформах — expo-secure-store, в web — localStorage.
 */
const isWeb = Platform.OS === 'web'

export const storage = {
  async get(key: string): Promise<string | null> {
    if (isWeb) return globalThis.localStorage?.getItem(key) ?? null
    return SecureStore.getItemAsync(key)
  },
  async set(key: string, value: string | null): Promise<void> {
    if (isWeb) {
      if (value === null) globalThis.localStorage?.removeItem(key)
      else globalThis.localStorage?.setItem(key, value)
      return
    }
    if (value === null) await SecureStore.deleteItemAsync(key)
    else await SecureStore.setItemAsync(key, value)
  },
}
