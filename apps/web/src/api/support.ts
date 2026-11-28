import { http } from './client'

export type SupportStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type SupportPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export interface SupportTicket {
  id: string
  userId: string
  subject: string
  message: string
  category: string
  status: SupportStatus
  priority: SupportPriority
  assignedToId: string | null
  resolution: string | null
  createdAt: string
  updatedAt: string
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null
}

interface SupportTicketsPage {
  data: SupportTicket[]
  page: number
  limit: number
  total: number
  pages: number
}

export const supportApi = {
  create: (payload: { subject: string; message: string; category?: string; priority?: SupportPriority }) =>
    http.post<SupportTicket>('/support/tickets', payload).then((response) => response.data),

  list: (params: { page: number; limit: number; status?: SupportStatus | ''; search?: string }) =>
    http
      .get<SupportTicketsPage>('/support/tickets', {
        params: {
          page: params.page,
          limit: params.limit,
          ...(params.status ? { status: params.status } : {}),
          ...(params.search ? { search: params.search } : {}),
        },
      })
      .then((response) => response.data),

  update: (
    id: string,
    payload: { status?: SupportStatus; priority?: SupportPriority; resolution?: string | null; assignedToId?: string | null },
  ) => http.patch<SupportTicket>(`/support/tickets/${id}`, payload).then((response) => response.data),
}
