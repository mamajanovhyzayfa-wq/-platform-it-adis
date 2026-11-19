import axios from 'axios'

const TOKEN_KEY = 'itadis.admin.token'
const USER_KEY = 'itadis.admin.user'

export interface AdminSession {
  id: string
  email: string
  firstName: string
  lastName: string
}

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
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/** Единая точка HTTP: токен подставляется автоматически, 401 выводит на вход. */
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 20_000,
})

http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && window.location.pathname !== '/login') {
      clearSession()
      window.location.assign('/login')
    }
    return Promise.reject(error)
  },
)

export function errorMessage(error: unknown, fallback = 'Не удалось выполнить запрос'): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message
    if (message) return message
  }
  return fallback
}
