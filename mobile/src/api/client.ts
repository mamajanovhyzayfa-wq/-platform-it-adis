import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, getRefreshToken, setSessionTokens, notifySessionExpired } from './session'

/**
 * Базовый URL API. Для запуска на устройстве задайте EXPO_PUBLIC_API_URL
 * (например, http://192.168.0.10:4000/api). Эмулятор Android: http://10.0.2.2:4000/api
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api'

export const http = axios.create({ baseURL: API_URL, timeout: 15000 })

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

let refreshPromise: Promise<boolean> | null = null

async function refreshSession(): Promise<boolean> {
  const token = getRefreshToken()
  if (!token) return false

  try {
    const { data } = await axios.post<{ tokens: { accessToken: string; refreshToken: string } }>(
      `${API_URL}/auth/refresh`,
      { refreshToken: token },
      { timeout: 15000 },
    )
    setSessionTokens(data.tokens)
    return true
  } catch {
    notifySessionExpired()
    return false
  }
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined
    const status = error.response?.status

    if (!config || status !== 401 || config._retried) {
      return Promise.reject(error)
    }

    config._retried = true
    refreshPromise ??= refreshSession().finally(() => {
      refreshPromise = null
    })

    const refreshed = await refreshPromise
    if (!refreshed) return Promise.reject(error)

    const token = getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return http(config)
  },
)

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: Array<{ path: string; message: string }> }
}

/** Человекочитаемое сообщение об ошибке API для форм и toast-подобных подсказок. */
export function describeApiError(error: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const body = error.response?.data
    if (body?.error?.details?.length) return body.error.details.map((item) => item.message).join(', ')
    if (body?.error?.message) return body.error.message
    if (error.code === 'ECONNABORTED') return 'Сервер не ответил вовремя. Проверьте соединение.'
    if (!error.response) return 'Нет соединения с сервером. Проверьте интернет и адрес API.'
    return `Ошибка запроса (${error.response.status})`
  }
  return 'Неизвестная ошибка'
}
