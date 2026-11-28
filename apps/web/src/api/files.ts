import { http } from './client'

export type FileCategory = 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'PDF' | 'PRESENTATION' | 'ARCHIVE' | 'OTHER'
export type FileAccess = 'PRIVATE' | 'STAFF' | 'BRANCH'

export interface StorageFileItem {
  id: string
  title: string
  originalName: string
  category: FileCategory
  mimeType: string
  sizeBytes: number
  scanStatus: string
  access: FileAccess
  description: string | null
  tags: string[]
  downloadCount: number
  createdAt: string
  updatedAt: string
  owner: { id: string; name: string } | null
}

interface FileHistoryItem {
  id: string
  action: 'UPLOAD' | 'DOWNLOAD' | 'UPDATE' | 'DELETE'
  fileName: string
  sizeBytes: number | null
  scanStatus: string
  ip: string | null
  createdAt: string
  user: { id: string; firstName: string; lastName: string } | null
}

interface StorageInfo {
  driver: 'local' | 's3'
  prefix: string
  maxFileSizeMb: number
  quotaMb: number
  usedBytes: number
  files: number
}

interface FileListResponse {
  items: StorageFileItem[]
  page: number
  limit: number
  total: number
  pages: number
}

export interface BackupRun {
  id: string
  branchId: string
  kind: 'DATABASE' | 'FILES'
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  sizeBytes: number | null
  sha256: string | null
  startedAt: string
  finishedAt: string | null
  verifiedAt: string | null
  error: string | null
  metadata: Record<string, unknown> | null
  branch?: { name: string; slug: string }
}

export interface RestoreRequest {
  id: string
  branchId: string
  backupId: string
  status: 'DETECTED' | 'CHECKED' | 'PLANNED' | 'AWAITING_APPROVAL' | 'APPROVED' | 'RUNNING' | 'VERIFIED' | 'FAILED' | 'CANCELLED'
  reason: string | null
  requestedBy: string
  approvedBy: string | null
  confirmationPhrase: string | null
  plan: {
    warning?: string
    steps?: string[]
    databaseBackup?: { id: string; startedAt: string; sizeBytes: number | null }
    filesBackup?: { id: string; startedAt: string; sizeBytes: number | null } | null
  } | null
  report: { steps?: Array<{ key: string; status: string; detail?: string }>; checks?: unknown } | null
  error: string | null
  detectedAt: string
  checkedAt: string | null
  plannedAt: string | null
  approvedAt: string | null
  executedAt: string | null
  verifiedAt: string | null
  branch?: { name: string; slug: string }
}

interface BranchStorageSettings {
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
  lastBackupStatus: string | null
  fileMaxSizeMb: number
  fileQuotaMb: number
  recentRuns: BackupRun[]
  recentRestores: RestoreRequest[]
}

interface BackupOverview {
  storageDriver: 'local' | 's3'
  backup: { directory: string; driver: string; command: string }
  branches: BranchStorageSettings[]
}

export const filesApi = {
  list: (params: { search?: string; category?: FileCategory; access?: FileAccess; tag?: string; sort?: string; page?: number; limit?: number }) =>
    http.get<FileListResponse>('/files', { params }).then((response) => response.data),
  categories: () =>
    http
      .get<{ categories: Array<{ category: FileCategory; count: number; sizeBytes: number }> }>('/files/categories')
      .then((response) => response.data.categories),
  storage: () => http.get<StorageInfo>('/files/storage').then((response) => response.data),
  upload: (file: File, meta: { title?: string; description?: string; access: FileAccess; tags?: string }) => {
    const form = new FormData()
    form.append('file', file)
    if (meta.title) form.append('title', meta.title)
    if (meta.description) form.append('description', meta.description)
    form.append('access', meta.access)
    if (meta.tags) form.append('tags', meta.tags)
    return http.post<StorageFileItem>('/files', form).then((response) => response.data)
  },
  update: (id: string, patch: Partial<Pick<StorageFileItem, 'title' | 'description' | 'category' | 'access' | 'tags'>>) =>
    http.patch<StorageFileItem>(`/files/${id}`, patch).then((response) => response.data),
  remove: (id: string) => http.delete(`/files/${id}`).then(() => undefined),
  history: (id: string) =>
    http.get<{ items: FileHistoryItem[] }>(`/files/${id}/history`).then((response) => response.data.items),
  download: async (file: StorageFileItem) => {
    const response = await http.get<Blob>(`/files/${file.id}/download`, { responseType: 'blob' })
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = file.originalName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },
}

export const backupsApi = {
  overview: () => http.get<BackupOverview>('/backups/overview').then((response) => response.data),
  runs: () => http.get<{ items: BackupRun[] }>('/backups/runs').then((response) => response.data.items),
  run: (kind: 'DATABASE' | 'FILES') =>
    http.post<BackupRun>('/backups/runs', { kind }).then((response) => response.data),
  verify: (id: string) => http.post<BackupRun>(`/backups/runs/${id}/verify`).then((response) => response.data),
  updateSettings: (
    id: string,
    patch: Partial<Pick<BranchStorageSettings, 'backupEnabled' | 'backupFrequencyHours' | 'backupRetentionDays' | 'backupIncludeFiles' | 'fileMaxSizeMb' | 'fileQuotaMb'>>,
  ) => http.patch(`/backups/branches/${id}/settings`, patch).then((response) => response.data),
  restores: () => http.get<{ items: RestoreRequest[] }>('/backups/restores').then((response) => response.data.items),
  createRestore: (input: { backupId: string; filesBackupId?: string; reason?: string }) =>
    http.post<RestoreRequest>('/backups/restores', input).then((response) => response.data),
  approve: (id: string, phrase: string) =>
    http.post<RestoreRequest>(`/backups/restores/${id}/approve`, { phrase }).then((response) => response.data),
  execute: (id: string) =>
    http.post<RestoreRequest>(`/backups/restores/${id}/execute`, { confirm: true }).then((response) => response.data),
  cancel: (id: string) => http.post<RestoreRequest>(`/backups/restores/${id}/cancel`).then((response) => response.data),
}
