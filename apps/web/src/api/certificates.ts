import { http } from './client'

export type CertificateStatus = 'ISSUED' | 'REVOKED'
export type CertificateMimeType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'

export interface Certificate {
  id: string
  number: string
  verificationCode: string
  status: CertificateStatus
  grade: number | null
  issuedAt: string
  expiresAt: string | null
  revokedAt: string | null
  revokeReason: string | null
  student: { id: string; firstName: string; lastName: string; email: string; name: string }
  course: { id: string; title: string }
  issuedBy: string
  hasFile: boolean
  fileUrl: string | null
  fileName: string | null
  mimeType: string | null
  fileSize: number | null
}

export interface CertificateList {
  items: Certificate[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface CertificateCandidate {
  id: string
  name: string
  email: string
  courses: Array<{ id: string; title: string }>
}

export interface CertificateUpload {
  url: string
  name: string
  mimeType: CertificateMimeType
  size: number
}

export interface CertificateVerification {
  valid: boolean
  expired: boolean
  status: CertificateStatus
  number: string
  student: { firstName: string; lastName: string }
  course: { title: string }
  issuedAt: string
  expiresAt: string | null
  revokedAt: string | null
  revokeReason: string | null
  issuedBy: string
}

export const certificateApi = {
  list: (params: { page: number; limit: number; search?: string; status?: CertificateStatus | '' }) =>
    http
      .get<CertificateList>('/certificates', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.search ? { search: params.search } : {}),
          ...(params.status ? { status: params.status } : {}),
        },
      })
      .then((response) => response.data),

  candidates: (search: string) =>
    http
      .get<{ items: CertificateCandidate[] }>('/certificates/candidates', {
        params: { search, limit: 20 },
      })
      .then((response) => response.data.items),

  /** Загрузка готового сертификата: сервер принимает только PDF/JPEG/PNG/WebP от администратора. */
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http
      .post<CertificateUpload>('/uploads?purpose=certificate', form)
      .then((response) => response.data)
  },

  issue: (payload: {
    studentId: string
    courseId: string
    grade?: number
    issuedAt?: string
    fileUrl: string
    fileName: string
    mimeType: CertificateMimeType
    fileSize: number
  }) => http.post<Certificate>('/certificates', payload).then((response) => response.data),

  my: () => http.get<{ items: Certificate[] }>('/certificates/my').then((response) => response.data.items),

  file: (id: string, download = false) =>
    http
      .get<Blob>(`/certificates/${id}/file`, {
        params: download ? { download: 1 } : {},
        responseType: 'blob',
      })
      .then((response) => response.data),

  revoke: (id: string, reason: string) =>
    http.post<Certificate>(`/certificates/${id}/revoke`, { reason }).then((response) => response.data),

  html: (id: string) =>
    http
      .get<string>(`/certificates/${id}/html`, {
        responseType: 'text',
        transformResponse: [(data) => data],
      })
      .then((response) => response.data),

  verify: (code: string) =>
    http
      .get<CertificateVerification>(`/certificates/verify/${encodeURIComponent(code)}`)
      .then((response) => response.data),
}
