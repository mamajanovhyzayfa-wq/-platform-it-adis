import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { getSession, getToken, http, updateSessionLocale } from '../api/client'
import ruJson from '../locales/ru.json'
import kyJson from '../locales/ky.json'
import enJson from '../locales/en.json'

/**
 * Локализация веб-кабинета.
 *
 * `ru.json` — источник истины для набора ключей. Кыргызский и английский
 * намеренно описаны как Partial: непереведённая строка показывает русский
 * оригинал, а не пустой экран или ключ. Новые языки добавляются одним объектом
 * в `dictionaries` и одной опцией в `localeLabels`.
 *
 * Язык выбирается в таком порядке: сохранённый на устройстве → язык профиля →
 * язык браузера → русский. Отдельный раздел может иметь собственный язык;
 * переопределение хранится на устройстве и не меняет язык профиля.
 */
export type Locale = 'ru' | 'ky' | 'en'

export const ru = ruJson as Record<string, string>
export type MessageKey = keyof typeof ru

const ky: Partial<Record<MessageKey, string>> = kyJson
const en: Partial<Record<MessageKey, string>> = enJson

const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = { ru, ky, en }

export const localeLabels: Record<Locale, string> = {
  ru: 'Русский',
  ky: 'Кыргызча',
  en: 'English',
}

/** Коды Intl: даты, числа и денежные суммы форматируются по выбранной локали. */
export const localeTags: Record<Locale, string> = {
  ru: 'ru-RU',
  ky: 'ky-KG',
  en: 'en-GB',
}

export const locales: Locale[] = ['ru', 'ky', 'en']

const STORAGE_KEY = 'itadis.locale'
const SECTIONS_KEY = 'itadis.locale.sections'

/** Текущий язык для чистых функций форматирования (даты, статусы). */
let activeLocale: Locale = 'ru'

export function normalizeLocale(value: string | null | undefined): Locale | null {
  const tag = value?.trim().toLowerCase()
  if (!tag) return null
  if (tag === 'ky' || tag.startsWith('ky-') || tag.startsWith('ky_')) return 'ky'
  if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) return 'en'
  if (tag === 'ru' || tag.startsWith('ru-') || tag.startsWith('ru_')) return 'ru'
  return null
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'ru'
  const candidates = [...(navigator.languages ?? []), navigator.language]
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate)
    if (locale) return locale
  }
  return 'ru'
}

function readStoredLocale(): Locale | null {
  try {
    return normalizeLocale(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function readSectionOverrides(): Record<string, Locale> {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: Record<string, Locale> = {}
    for (const [section, value] of Object.entries(parsed)) {
      const locale = typeof value === 'string' ? normalizeLocale(value) : null
      if (locale) result[section] = locale
    }
    return result
  } catch {
    return {}
  }
}

export function translate(
  locale: Locale,
  key: MessageKey | string,
  params?: Record<string, string | number>,
): string {
  const template = dictionaries[locale]?.[key as MessageKey] ?? ru[key as MessageKey]
  if (!template) return key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}

/** Код языка для Intl; вызывается из форматтеров вне React-контекста. */
export function currentLocale(): Locale {
  return activeLocale
}

export function currentLocaleTag(): string {
  return localeTags[activeLocale]
}

export function statusLabel(status: string): string {
  return translate(activeLocale, `status.${status}`)
}

export type TFunction = (key: MessageKey, params?: Record<string, string | number>) => string

export type LocaleSyncState = 'idle' | 'saving' | 'saved' | 'local' | 'error'

interface I18nValue {
  locale: Locale
  activeLocale: Locale
  section: string
  sectionLocale: Locale | null
  tag: string
  syncState: LocaleSyncState
  t: TFunction
  setLocale: (locale: Locale) => void
  setSectionLocale: (locale: Locale | null) => void
}

const I18nContext = createContext<I18nValue | null>(null)

function initialLocale(): Locale {
  return readStoredLocale() ?? normalizeLocale(getSession()?.locale) ?? detectBrowserLocale()
}

function routeSection(pathname: string): string {
  const first = pathname.replace(/^\/+/, '').split('/')[0]
  return first || 'root'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, Locale>>(readSectionOverrides)
  const [syncState, setSyncState] = useState<LocaleSyncState>('idle')

  const section = routeSection(pathname)
  const sectionLocale = sectionOverrides[section] ?? null
  const resolved = sectionLocale ?? locale

  // Форматтеры — чистые функции вне React; синхронизируем их до отрисовки детей.
  activeLocale = resolved

  useEffect(() => {
    document.documentElement.lang = localeTags[resolved]
    document.documentElement.dir = 'ltr'
    document.title = translate(resolved, 'app.title')
  }, [resolved])

  // После входа язык профиля применяется, если пользователь ещё не выбирал язык вручную.
  // Если язык выбран вручную до входа, сохраняем его и в профиле — явный выбор важнее
  // значения по умолчанию, которое могло быть задано при создании аккаунта.
  useEffect(() => {
    const applyProfileLocale = () => {
      const stored = readStoredLocale()
      if (stored) {
        setLocaleState(stored)
        if (getToken()) {
          http
            .patch('/users/me', { locale: stored })
            .then(() => updateSessionLocale(stored))
            .catch(() => setSyncState('error'))
        }
        return
      }
      const profileLocale = normalizeLocale(getSession()?.locale)
      if (profileLocale) setLocaleState(profileLocale)
    }
    const resetAfterLogout = () => {
      if (!readStoredLocale()) setLocaleState(detectBrowserLocale())
    }
    applyProfileLocale()
    window.addEventListener('itadis:login', applyProfileLocale)
    window.addEventListener('itadis:logout', resetAfterLogout)
    return () => {
      window.removeEventListener('itadis:login', applyProfileLocale)
      window.removeEventListener('itadis:logout', resetAfterLogout)
    }
  }, [])

  const t = useCallback<TFunction>(
    (key, params) => translate(resolved, key, params),
    [resolved],
  )

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    // Глобальный выбор должен быть виден сразу: локальный язык текущего раздела
    // сбрасывается на «как интерфейс», его можно задать заново отдельно.
    setSectionOverrides((current) => {
      if (!(section in current)) return current
      const updated = { ...current }
      delete updated[section]
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(updated))
      } catch {
        /* выбор всё равно применится в текущей сессии */
      }
      return updated
    })
    setSyncState('idle')
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* выбор всё равно применится в текущей сессии */
    }

    if (!getToken()) {
      setSyncState('local')
      return
    }

    setSyncState('saving')
    http
      .patch('/users/me', { locale: next })
      .then(() => {
        updateSessionLocale(next)
        setSyncState('saved')
      })
      .catch(() => setSyncState('error'))
  }, [section])

  const setSectionLocale = useCallback(
    (next: Locale | null) => {
      setSectionOverrides((current) => {
        const updated = { ...current }
        if (next) updated[section] = next
        else delete updated[section]
        try {
          localStorage.setItem(SECTIONS_KEY, JSON.stringify(updated))
        } catch {
          /* приватный режим: переопределение живёт до закрытия вкладки */
        }
        return updated
      })
    },
    [section],
  )

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      activeLocale: resolved,
      section,
      sectionLocale,
      tag: localeTags[resolved],
      syncState,
      t,
      setLocale,
      setSectionLocale,
    }),
    [locale, resolved, section, sectionLocale, syncState, t, setLocale, setSectionLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}

/** Язык раздела с возможностью временно переопределить его. */
export function useSectionI18n(): I18nValue {
  return useI18n()
}
