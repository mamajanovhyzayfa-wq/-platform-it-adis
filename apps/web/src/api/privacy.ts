import { http } from './client'

export type ConsentType =
  | 'TERMS'
  | 'PRIVACY'
  | 'DATA_PROCESSING'
  | 'MARKETING'
  | 'COOKIES'
  | 'COOKIE_ANALYTICS'
  | 'COOKIE_FUNCTIONAL'
  | 'COOKIE_MARKETING'
  | 'GUARDIAN'

interface ConsentDocument {
  type: ConsentType
  title: string
  version: string
  effectiveDate: string
  url: string
  required: boolean
  description: string
}

export interface ConsentRecord {
  id: string
  type: ConsentType
  documentVersion: string
  granted: boolean
  ip: string | null
  createdAt: string
}

interface ConsentState {
  documents: ConsentDocument[]
  latest: ConsentRecord[]
  history: ConsentRecord[]
  age: number | null
  guardianRequired: boolean
  guardian: { name: string | null; phone: string | null; confirmedAt: string | null } | null
}

export interface DeletionEvent {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  comment: string | null
  createdAt: string
}

export interface DeletionRequest {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reason: string | null
  adminComment: string | null
  legalHold: boolean
  requestedAt: string
  reviewedAt: string | null
  events: DeletionEvent[]
  user?: {
    id: string
    email: string
    phone: string | null
    firstName: string
    lastName: string
    role: string
    createdAt: string
    deletedAt: string | null
  }
  reviewedBy?: { id: string; firstName: string; lastName: string } | null
}

export const privacyApi = {
  documents: () =>
    http.get<{ documents: ConsentDocument[] }>('/privacy/documents').then((response) => response.data.documents),
  state: () => http.get<ConsentState>('/privacy/consents').then((response) => response.data),
  record: (type: ConsentType, granted: boolean, guardian?: { guardianName: string; guardianPhone: string; confirmedByGuardian: true }) =>
    http.post('/privacy/consents', { type, granted, ...guardian }).then((response) => response.data),
  recordBatch: (consents: Array<{ type: ConsentType; granted: boolean }>) =>
    http.post('/privacy/consents/batch', { consents }).then((response) => response.data),
  deletionRequests: () =>
    http.get<{ requests: DeletionRequest[] }>('/privacy/account-deletion').then((response) => response.data.requests),
  requestDeletion: (reason?: string) =>
    http
      .post<{ request: DeletionRequest }>('/privacy/account-deletion', { reason })
      .then((response) => response.data.request),
  cancelDeletion: (id: string) =>
    http.delete(`/privacy/account-deletion/${id}`).then((response) => response.data),
  adminDeletionRequests: (status?: string) =>
    http
      .get<{ requests: DeletionRequest[] }>('/privacy/admin/account-deletion', { params: { status } })
      .then((response) => response.data.requests),
  reviewDeletion: (id: string, approve: boolean, comment?: string, legalHold?: boolean) =>
    http
      .patch<{ request: DeletionRequest }>(`/privacy/admin/account-deletion/${id}`, {
        approve,
        comment,
        legalHold,
      })
      .then((response) => response.data.request),
  fileAudit: (action?: 'UPLOAD' | 'DOWNLOAD') =>
    http
      .get<{
        logs: Array<{
          id: string
          action: 'UPLOAD' | 'DOWNLOAD'
          fileName: string
          url: string | null
          mimeType: string | null
          sizeBytes: number | null
          sha256: string | null
          scanStatus: string
          createdAt: string
          user: { id: string; email: string; firstName: string; lastName: string } | null
        }>
      }>('/privacy/admin/file-audit', { params: { action } })
      .then((response) => response.data.logs),
}
