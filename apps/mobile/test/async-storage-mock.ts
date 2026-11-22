/**
 * In-memory замена AsyncStorage для unit-тестов.
 * Поведение совпадает с API библиотеки в объёме, который используют
 * офлайн-модули: getItem/setItem/removeItem/multiRemove.
 */
const store = new Map<string, string>()

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return store.get(key) ?? null
  },
  async setItem(key: string, value: string): Promise<void> {
    store.set(key, value)
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key)
  },
  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) store.delete(key)
  },
  async clear(): Promise<void> {
    store.clear()
  },
}

/** Прямой доступ к хранилищу нужен тестам для проверки вытеснения и порчи данных. */
export const __store = store

export default AsyncStorage
