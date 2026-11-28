import { http } from './client'

export type BackupKind = 'DATABASE' | 'FILES'
export type BackupStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED'
export type RestoreStatus =
  | 'DETECTED'
  | 'CHECKED'
  | 'PLANNED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'RUNNING'
  | 'VERIFIED'
  | 'FAILED'
  | 'CANCELLED'

export interface BackupRun {
  id: string
  branchId: string
  kind: BackupKind
  status: BackupStatus
  sizeBytes: number | null
  sha256: string | null
  startedAt: string
  finishedAt: string | null
  verifiedAt: string | null
  error: string | null
  metadata: unknown
  storageKey?: string
  branch?: { name: string; slug: string }
}

export interface RestorePlan {
  branch?: { id: string; slug: string; name: string }
  approvalPhrase?: string
  steps?: string[]
  checks?: {
    database?: { sha256: string | null; sizeBytes: number | null; verifiedAt: string | null }
    files?: { sha256: string | null; sizeBytes: number | null; verifiedAt: string | null } | null
  }
  warning?: string
}

export interface RestoreReport {
  steps?: Array<{ key: string; status: string; detail?: string }>
  checks?: {
    database?: string
    users?: number
    courses?: number
    files?: string
    restoredFiles?: number
    expectedFiles?: number | null
  }
  requestedBy?: string
  approvedBy?: string | null
  finishedAt?: string
}

export interface RestoreRequest {
  id: string
  branchId: string
  backupId: string
  status: RestoreStatus
  reason: string | null
  requestedBy: string
  approvedBy: string | null
  confirmationPhrase: string | null
  plan: RestorePlan | null
  report: RestoreReport | null
  error: string | null
  detectedAt: string
  checkedAt: string | null
  plannedAt: string | null
  approvedAt: string | null
  executedAt: string | null
  verifiedAt: string | null
  backup?: { kind: BackupKind; startedAt: string }
  branch?: { name: string; slug: string }
}

export interface BranchBackupSettings {
  id: string
  name: string
  slug: string
  status: string
  isPrimary: boolean
  backupEnabled: boolean
  backupFrequencyHours: number
  backupRetentionDays: number
  backupIncludeFiles: boolean
  lastBackupAt: string | null
  lastBackupStatus: BackupStatus | null
  fileMaxSizeMb: number
  fileQuotaMb: number
  recentRuns: BackupRun[]
  recentRestores: RestoreRequest[]
}

interface BackupsOverview {
  storageDriver: string
  backup: { directory: string; driver: string; command: string }
  branches: BranchBackupSettings[]
}

export interface BackupSettingsInput {
  backupEnabled?: boolean
  backupFrequencyHours?: number
  backupRetentionDays?: number
  backupIncludeFiles?: boolean
  fileMaxSizeMb?: number
  fileQuotaMb?: number
}

export const backupsApi = {
  overview: () => http.get<BackupsOverview>('/backups/overview').then((response) => response.data),

  runs: () =>
    http.get<{ items: BackupRun[] }>('/backups/runs').then((response) => response.data.items),

  run: (kind: BackupKind) =>
    http
      .post<BackupRun | { status: 'ALREADY_RUNNING' }>('/backups/runs', { kind })
      .then((response) => response.data),

  verify: (id: string) =>
    http.post<BackupRun>(`/backups/runs/${id}/verify`).then((response) => response.data),

  updateSettings: (branchId: string, payload: BackupSettingsInput) =>
    http
      .patch<BackupSettingsInput & { id: string }>(`/backups/branches/${branchId}/settings`, payload)
      .then((response) => response.data),

  restores: () =>
    http.get<{ items: RestoreRequest[] }>('/backups/restores').then((response) => response.data.items),

  createRestore: (payload: { backupId: string; filesBackupId?: string; reason?: string }) =>
    http.post<RestoreRequest>('/backups/restores', payload).then((response) => response.data),

  approveRestore: (id: string, phrase: string) =>
    http
      .post<RestoreRequest>(`/backups/restores/${id}/approve`, { phrase })
      .then((response) => response.data),

  executeRestore: (id: string) =>
    http
      .post<RestoreRequest>(`/backups/restores/${id}/execute`, { confirm: true })
      .then((response) => response.data),

  cancelRestore: (id: string) =>
    http.post<RestoreRequest>(`/backups/restores/${id}/cancel`).then((response) => response.data),
}
