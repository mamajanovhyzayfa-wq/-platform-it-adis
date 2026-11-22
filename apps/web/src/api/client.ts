import axios from 'axios'

const TOKEN_KEY = 'itadis.admin.token'
const USER_KEY = 'itadis.admin.user'

export type SessionRole = 'ADMIN' | 'MANAGER' | 'TEACHER' | 'STUDENT' | 'PARENT'

export interface AdminSession {
  id: string
  email: string
  firstName: string
  lastName: string
  /// Активный интерфейс роли. Для дополнительной роли подтверждён администратором.
  role: SessionRole
  /// Роль из access-токена; нужна, чтобы вернуться в неё после смены интерфейса.
  primaryRole?: SessionRole
  /// Язык пользователя из профиля; применяется после входа на новом устройстве.
  locale?: string
}

export const STANDARD_ROLES: SessionRole[] = ['STUDENT', 'TEACHER', 'MANAGER', 'ADMIN', 'PARENT']

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getSession(): AdminSession | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AdminSession
  } catch {
    return null
  }
}

export function saveSession(token: string, user: AdminSession) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify({ ...user, primaryRole: user.primaryRole ?? user.role }))
  // Cookie-панель слушает это событие и переносит локальный выбор в историю согласий.
  // I18nProvider использует его же, чтобы применить язык профиля на новом устройстве.
  window.dispatchEvent(new Event('itadis:login'))
}

/** Переключает интерфейс на другую подтверждённую роль. */
export function switchSessionRole(role: SessionRole) {
  if (!STANDARD_ROLES.includes(role)) return
  const session = getSession()
  if (!session) return
  localStorage.setItem(USER_KEY, JSON.stringify({ ...session, role, primaryRole: session.primaryRole ?? session.role }))
  window.dispatchEvent(new Event('itadis:session'))
}

/** Обновляет язык в сохранённой сессии без повторного события входа. */
export function updateSessionLocale(locale: string) {
  const session = getSession()
  if (!session) return
  localStorage.setItem(USER_KEY, JSON.stringify({ ...session, locale }))
  window.dispatchEvent(new Event('itadis:session'))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(STEP_UP_KEY)
  sessionStorage.removeItem('itadis.cookie.synced')
  window.dispatchEvent(new Event('itadis:logout'))
  window.dispatchEvent(new Event('itadis:session'))
}

const STEP_UP_KEY = 'itadis.stepUp'

/** Токен повторного подтверждения пароля для важных операций (10 минут). */
export function setStepUpToken(token: string) {
  sessionStorage.setItem(STEP_UP_KEY, token)
}

export function getStepUpToken(): string | null {
  return sessionStorage.getItem(STEP_UP_KEY)
}

export function clearStepUpToken() {
  sessionStorage.removeItem(STEP_UP_KEY)
}

/** Базовый путь приложения: пустой для корня или /app для совместного деплоя. */
export const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '')

export function appUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${appBasePath}${suffix}`
}

/** Единая точка HTTP: токен подставляется автоматически, 401 выводит на вход. */
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 20_000,
})

http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  // Дополнительная роль подтверждается на сервере; заголовок лишь выбирает интерфейс.
  const session = getSession()
  if (session?.role) config.headers['X-Active-Role'] = session.role
  const stepUp = getStepUpToken()
  if (stepUp) config.headers['X-Step-Up-Token'] = stepUp
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && window.location.pathname !== appUrl('/login')) {
      clearSession()
      window.location.assign(appUrl('/login'))
    }
    return Promise.reject(error)
  },
)

export function errorCode(error: unknown): string | undefined {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code
  }
  return undefined
}

export function errorMessage(error: unknown, fallback = 'Не удалось выполнить запрос'): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message
    if (message) return message
  }
  return fallback
}
