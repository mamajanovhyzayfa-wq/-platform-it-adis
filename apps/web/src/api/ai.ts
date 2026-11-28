import { http } from './client'

export interface AiTool {
  id: string
  title: string
  description: string
  group: string
  icon: string
  requiresProvider?: boolean
}

export interface AiSource {
  title: string
  url?: string | null
  kind: 'COURSE' | 'LESSON' | 'MATERIAL' | 'DOCUMENT' | 'PLATFORM' | 'EXTERNAL' | 'MODEL'
  note?: string
}

interface AiStatus {
  configured: boolean
  provider: string
  model: string
  enabled: boolean
  mode: 'model' | 'local'
  tools: AiTool[]
  limits: { dailyRequests: number; monthlyTokens: number; allowedFeatures: string[] }
  allowExternalSources: boolean
  usage: { today: number; tokensThisMonth: number }
  disclaimer: string
}

interface AiRunResult {
  id: string
  answer: string
  sources: AiSource[]
  assumptions: string[]
  confidence: number
  provider: string
  model: string
  generatedByAi: boolean
  disclaimer: string
  durationMs: number
  usage: { today: number; limit: number }
}

export interface AiHistoryItem {
  id: string
  feature: string
  prompt: string
  response: string | null
  provider: string | null
  model: string | null
  status: string
  sources: AiSource[] | null
  assumptions: string[] | null
  confidence: number | null
  feedback: string | null
  isFlagged: boolean
  createdAt: string
  disclaimer: string
  generatedByAi: boolean
  user?: { id: string; firstName: string; lastName: string; role: string } | null
}

interface AiErrorReport {
  id: string
  requestId: string | null
  userId: string
  feature: string
  message: string
  status: string
  resolution: string | null
  createdAt: string
  user?: { id: string; firstName: string; lastName: string; email: string; role: string } | null
}

interface AiSettings {
  setting: {
    enabled: boolean
    provider: string
    model: string
    dailyDefault: number
    maxTokens: number
    allowExternalSources: boolean
    featurePermissions: Record<string, string[]> | null
  }
  roleLimits: Array<{ id: string; role: string; dailyRequests: number; monthlyTokens: number; allowedFeatures: string[] | null; model: string | null }>
  userLimits: Array<{ id: string; userId: string; dailyRequests: number | null; monthlyTokens: number | null; model: string | null; allowedFeatures: string[] | null; user: { id: string; firstName: string; lastName: string; email: string; role: string } }>
  catalog: Record<string, AiTool[]>
  providerConfigured: boolean
}

export interface AiAutomation {
  id: string
  name: string
  description: string | null
  enabled: boolean
  triggerType: string
  triggerConfig: Record<string, unknown> | null
  conditions: Array<Record<string, unknown>> | null
  actions: Array<{ type?: string; config?: Record<string, unknown> }> | null
  schedule: string | null
  requiresApproval: boolean
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
}

interface AiAutomationRun {
  id: string
  automationId: string
  status: string
  result: Array<{ action: string; status: string; detail?: string }> | null
  error: string | null
  startedAt: string
  finishedAt: string | null
  automation?: { name: string }
}

export const aiApi = {
  status: () => http.get<AiStatus>('/ai-center/status').then((r) => r.data),
  run: (payload: Record<string, unknown>) => http.post<AiRunResult>('/ai-center/run', payload).then((r) => r.data),
  history: (params: { page?: number; limit?: number } = {}) =>
    http.get<{ items: AiHistoryItem[]; total: number; page: number; limit: number }>('/ai-center/history', { params }).then((r) => r.data),
  deleteHistory: (id: string) => http.delete(`/ai-center/history/${id}`).then((r) => r.data),
  clearHistory: () => http.delete('/ai-center/history').then((r) => r.data),
  flagHistory: (id: string, feedback: string) => http.post(`/ai-center/history/${id}/flag`, { feedback }).then((r) => r.data),
  errors: () => http.get<AiErrorReport[]>('/ai-center/errors').then((r) => r.data),
  resolveError: (id: string, resolution: string) => http.post(`/ai-center/errors/${id}/resolve`, { resolution }).then((r) => r.data),
  settings: () => http.get<AiSettings>('/ai-center/settings').then((r) => r.data),
  updateSettings: (payload: Record<string, unknown>) => http.patch('/ai-center/settings', payload).then((r) => r.data),
  updateRoleLimit: (role: string, payload: Record<string, unknown>) => http.patch(`/ai-center/limits/role/${role}`, payload).then((r) => r.data),
  updateUserLimit: (userId: string, payload: Record<string, unknown>) => http.patch(`/ai-center/limits/user/${userId}`, payload).then((r) => r.data),
  automations: () => http.get<{
    triggers: Array<{ value: string; label: string }>
    conditions: Array<{ value: string; label: string }>
    actions: Array<{ value: string; label: string }>
    automations: AiAutomation[]
    runs: AiAutomationRun[]
  }>('/ai-center/automations').then((r) => r.data),
  createAutomation: (payload: Record<string, unknown>) => http.post<AiAutomation>('/ai-center/automations', payload).then((r) => r.data),
  updateAutomation: (id: string, payload: Record<string, unknown>) => http.patch(`/ai-center/automations/${id}`, payload).then((r) => r.data),
  runAutomation: (id: string, approved = false) => http.post(`/ai-center/automations/${id}/run`, { approved }).then((r) => r.data),
  approveRun: (runId: string) => http.post(`/ai-center/automations/runs/${runId}/approve`).then((r) => r.data),
}
