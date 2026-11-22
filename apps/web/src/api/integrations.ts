import { http } from './client'

export type IntegrationCategory =
  | 'video'
  | 'identity'
  | 'email'
  | 'sms'
  | 'push'
  | 'calendar'
  | 'payments'
  | 'accounting'
  | 'ai'
  | 'storage'

export type IntegrationHealthStatus = 'ok' | 'degraded' | 'not_configured' | 'unreachable'

export interface IntegrationAdapterView {
  id: string
  name: string
  category: IntegrationCategory
  description: string
  docsUrl: string
  envVars: string[]
  configured: boolean
  missingEnv: string[]
  enabled: boolean
  lastCheckedAt: string | null
  lastStatus: string | null
  lastMessage: string | null
}

export interface IntegrationList {
  checkedAt: string
  total: number
  configured: number
  categories: IntegrationCategory[]
  adapters: IntegrationAdapterView[]
}

export interface IntegrationHealth {
  id: string
  name: string
  category: IntegrationCategory
  configured: boolean
  status: IntegrationHealthStatus
  missingEnv: string[]
  latencyMs: number | null
  message: string | null
  checkedAt: string
}

export interface IntegrationCheckAll {
  checkedAt: string
  results: IntegrationHealth[]
  summary: { ok: number; degraded: number; notConfigured: number; unreachable: number }
}

export interface IntegrationEvent {
  id: string
  provider: string
  action: 'health_check' | 'connect' | 'request' | 'webhook' | 'config' | string
  status: 'OK' | 'FAILED' | 'SKIPPED'
  attempts: number
  durationMs: number | null
  message: string | null
  metadata: Record<string, unknown> | null
  actorId: string | null
  createdAt: string
}

export interface IntegrationEventsPage {
  items: IntegrationEvent[]
  page: number
  limit: number
  total: number
  pages: number
}

export const integrationsApi = {
  list: () => http.get<IntegrationList>('/integrations').then((response) => response.data),

  check: (id: string) =>
    http.post<IntegrationHealth>(`/integrations/${encodeURIComponent(id)}/check`).then((response) => response.data),

  checkAll: () => http.post<IntegrationCheckAll>('/integrations/check-all').then((response) => response.data),

  events: (params: { page: number; limit: number; provider?: string; status?: 'OK' | 'FAILED' | 'SKIPPED' | '' }) =>
    http
      .get<IntegrationEventsPage>('/integrations/events', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.provider ? { provider: params.provider } : {}),
          ...(params.status ? { status: params.status } : {}),
        },
      })
      .then((response) => response.data),

  update: (id: string, payload: { enabled?: boolean; settings?: Record<string, unknown>; secretEnvVars?: string[] }) =>
    http
      .patch<{ provider: string; enabled: boolean; settings: unknown; secretEnvVars: unknown; updatedAt: string }>(
        `/integrations/${encodeURIComponent(id)}`,
        payload,
      )
      .then((response) => response.data),
}
