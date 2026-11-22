import { http, type SessionRole } from './client'

export interface RoleRequestItem {
  id?: string
  role: SessionRole
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  requestedAt?: string
}

export interface MyRoles {
  primary: SessionRole
  roles: SessionRole[]
  requests: RoleRequestItem[]
}

export interface PendingRoleRequest {
  id: string
  role: SessionRole
  reason: string | null
  requestedAt: string
  user: { id: string; firstName: string; lastName: string; email: string; role: SessionRole }
}

export interface PendingParentLink {
  id: string
  createdAt: string
  parent: { id: string; user: { id: string; firstName: string; lastName: string; email: string } }
  student: { id: string; user: { id: string; firstName: string; lastName: string; email: string } }
}

/** Роли текущего пользователя: основная и подтверждённые администратором филиала. */
export const rolesApi = {
  me: () => http.get<MyRoles>('/roles/me').then((response) => response.data),
  pendingRequests: () =>
    http.get<PendingRoleRequest[]>('/roles/requests/pending').then((response) => response.data),
  decideRequest: (id: string, approve: boolean) =>
    http.post(`/roles/requests/${id}/${approve ? 'approve' : 'reject'}`).then((response) => response.data),
  issueParentCode: (studentId: string) =>
    http.post<{ code: string; expiresAt: string }>('/roles/parent-links/codes', { studentId }).then((response) => response.data),
  pendingParentLinks: () =>
    http.get<PendingParentLink[]>('/roles/parent-links/pending').then((response) => response.data),
  verifyParentLink: (id: string) =>
    http.post(`/roles/parent-links/${id}/verify`).then((response) => response.data),
}
