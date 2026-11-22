import type { ApiErrorBody } from '@itadis/shared-types'

export interface ApiClientOptions {
  baseUrl: string
  getToken?: () => string | null | Promise<string | null>
  fetchImpl?: typeof fetch
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

/**
 * Минимальный типизированный fetch-клиент без привязки к React/Expo.
 * Токен запрашивается перед каждым вызовом, поэтому rotation обрабатывается
 * вызывающим приложением, а не копируется в этот пакет.
 */
export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl.replace(/\/$/, '')

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await options.getToken?.()
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const response = await doFetch(`${baseUrl}${path}`, { ...init, headers })
    const text = await response.text()
    const body = text ? (JSON.parse(text) as unknown) : undefined
    if (!response.ok) {
      const error = body as ApiErrorBody | undefined
      throw new ApiClientError(
        response.status,
        error?.error.code ?? 'HTTP_ERROR',
        error?.error.message ?? `HTTP ${response.status}`,
        error?.error.details,
      )
    }
    return body as T
  }

  return {
    request,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
