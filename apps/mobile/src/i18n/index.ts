import { useMemo } from 'react'
import { useAuthStore } from '@/store/auth'
import ruJson from './locales/ru.json'
import kyJson from './locales/ky.json'
import enJson from './locales/en.json'

/**
 * Локализация: все строки интерфейса живут в JSON-файлах (`locales/ru.json`, `ky.json`, `en.json`).
 *
 * Русский файл — источник истины для набора ключей. Кыргызский и английский объявлены как
 * `Record<MessageKey, string>`, поэтому пропущенный перевод ломает сборку TypeScript, а не
 * превращается в пустой экран.
 */

export type Locale = 'ru' | 'ky' | 'en'

export const ru = ruJson
export type MessageKey = keyof typeof ru

const ky: Record<MessageKey, string> = kyJson
const en: Record<MessageKey, string> = enJson

const dictionaries: Record<Locale, Record<MessageKey, string>> = { ru, ky, en }

export function translate(locale: Locale, key: MessageKey): string {
  return dictionaries[locale]?.[key] ?? dictionaries.ru[key]
}

export function useI18n() {
  const locale = useAuthStore((state) => state.locale)
  return useMemo(
    () => ({ locale, t: (key: MessageKey) => translate(locale, key) }),
    [locale],
  )
}

export const localeLabels: Record<Locale, string> = { ru: 'Русский', ky: 'Кыргызча', en: 'English' }

/** Код языка для Intl: даты и числа форматируются по выбранной локали. */
export const localeTags: Record<Locale, string> = { ru: 'ru-RU', ky: 'ky-KG', en: 'en-GB' }
