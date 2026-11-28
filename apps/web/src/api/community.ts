import { http } from './client'

export interface Attachment {
  name: string
  url: string
  mimeType?: string
}

interface ConversationItem {
  id: string
  type: 'DIRECT' | 'COURSE' | 'GROUP' | 'TOPIC' | 'PARENT_TEACHER'
  title: string
  description: string | null
  lastMessage: { id: string; body: string; createdAt: string; sender: { firstName: string; lastName: string } } | null
  unread: number
  updatedAt: string
  isPinned: boolean
  participants: Array<{ userId: string; name: string; role: string }>
}

export interface ChatMessage {
  id: string
  body: string
  createdAt: string
  editedAt: string | null
  attachments: Attachment[] | null
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null; role: string }
  readByOthers: boolean
  readCount: number
  recipientCount: number
  status: 'SENT' | 'DELIVERED' | 'READ'
}

interface MeetingRequest {
  id: string
  subject: string
  message: string | null
  preferredAt: string
  durationMinutes: number
  status: string
  response: string | null
  requester: { id: string; firstName: string; lastName: string; role: string; email: string }
  teacher: { id: string; firstName: string; lastName: string; email: string }
  student: { id: string; firstName: string; lastName: string } | null
  course: { id: string; title: string } | null
}

interface Announcement {
  id: string
  title: string
  body: string
  audience: string
  isPinned: boolean
  publishedAt: string
  expiresAt: string | null
  attachments: Attachment[] | null
  createdBy: { firstName: string; lastName: string }
  course: { id: string; title: string } | null
}

export interface CommunityEvent {
  id: string
  type: 'EVENT' | 'CONTEST' | 'OLYMPIAD' | 'COMPETITION'
  title: string
  description: string
  rules: string | null
  status: string
  startsAt: string
  endsAt: string
  registrationDeadline: string | null
  location: string | null
  onlineUrl: string | null
  capacity: number | null
  visibility: string
  registered: boolean
  course: { id: string; title: string } | null
  createdBy: { firstName: string; lastName: string }
  _count?: { registrations: number; tasks: number }
  participants?: Array<{ id: string; status: string; user: { id: string; firstName: string; lastName: string; email: string } }>
  tasks?: Array<{ id: string; title: string; description: string | null; dueAt: string | null; maxScore: number | null; position: number }>
  awards?: Array<{ id: string; title: string; description: string | null; place: number | null; user: { id: string; firstName: string; lastName: string } | null }>
  ranking?: Array<{ userId: string; name: string; score: number; place: number | null }>
  results?: Array<{
    id: string
    score: number | null
    place: number | null
    comment: string | null
    publishedAt: string | null
    createdAt: string
    user: { id: string; firstName: string; lastName: string }
    task: { id: string; title: string } | null
  }>
}

interface Directory {
  courses: Array<{ id: string; title: string }>
  teachers: Array<{ id: string; firstName: string; lastName: string; email: string }>
  students: Array<{ id: string; firstName: string; lastName: string; email: string }>
}

export const communityApi = {
  directory: () => http.get<Directory>('/community/directory').then((response) => response.data),
  conversations: (params: { type?: string; q?: string }) =>
    http.get<{ items: ConversationItem[]; unreadTotal: number }>('/messages/conversations', { params }).then((response) => response.data),
  startConversation: (payload: {
    type: string
    userId?: string
    courseId?: string
    title?: string
    description?: string
    participantIds?: string[]
  }) => http.post<{ id: string }>('/messages/conversations', payload).then((response) => response.data),
  messages: (conversationId: string, params: { q?: string; before?: string; limit?: number } = {}) =>
    http
      .get<{ conversation: ConversationItem; items: ChatMessage[]; hasMore: boolean }>(`/messages/conversations/${conversationId}/messages`, { params })
      .then((response) => response.data),
  sendMessage: (conversationId: string, payload: { body: string; attachments?: Attachment[] }) =>
    http.post<ChatMessage>(`/messages/conversations/${conversationId}/messages`, payload).then((response) => response.data),
  markRead: (conversationId: string) => http.post(`/messages/conversations/${conversationId}/read`).then((response) => response.data),
  users: (q: string) =>
    http
      .get<{ items: Array<{ id: string; firstName: string; lastName: string; email: string; role: string; name: string }> }>('/messages/users', { params: { q } })
      .then((response) => response.data.items),

  meetings: () => http.get<{ items: MeetingRequest[] }>('/community/meeting-requests').then((response) => response.data.items),
  createMeeting: (payload: {
    teacherId: string
    studentId?: string
    courseId?: string
    subject: string
    message?: string
    preferredAt: string
    durationMinutes: number
  }) => http.post<MeetingRequest>('/community/meeting-requests', payload).then((response) => response.data),
  respondMeeting: (id: string, status: string, response?: string) =>
    http.patch<MeetingRequest>(`/community/meeting-requests/${id}`, { status, ...(response ? { response } : {}) }).then((response) => response.data),

  announcements: (params: { q?: string; audience?: string; courseId?: string } = {}) =>
    http.get<{ items: Announcement[] }>('/community/announcements', { params }).then((response) => response.data.items),
  createAnnouncement: (payload: {
    title: string
    body: string
    audience: string
    courseId?: string
    isPinned: boolean
    attachments?: Attachment[]
  }) => http.post<Announcement>('/community/announcements', payload).then((response) => response.data),

  events: (params: { type?: string; q?: string; status?: string; page?: number; limit?: number } = {}) =>
    http
      .get<{ items: CommunityEvent[]; total: number; page: number; limit: number; pages: number }>('/community/events', { params })
      .then((response) => response.data),
  event: (id: string) => http.get<CommunityEvent>(`/community/events/${id}`).then((response) => response.data),
  createEvent: (payload: {
    type: string
    title: string
    description: string
    rules?: string
    startsAt: string
    endsAt: string
    registrationDeadline?: string
    location?: string
    onlineUrl?: string
    capacity?: number
    visibility: string
    courseId?: string
  }) => http.post<CommunityEvent>('/community/events', payload).then((response) => response.data),
  updateEvent: (id: string, payload: Record<string, unknown>) =>
    http.patch<CommunityEvent>(`/community/events/${id}`, payload).then((response) => response.data),
  registerEvent: (id: string) => http.post(`/community/events/${id}/register`).then((response) => response.data),
  cancelEvent: (id: string) => http.delete(`/community/events/${id}/register`).then((response) => response.data),
  addTask: (id: string, payload: { title: string; description?: string; dueAt?: string; maxScore?: number; position: number }) =>
    http.post(`/community/events/${id}/tasks`, payload).then((response) => response.data),
  addResult: (id: string, payload: { userId: string; taskId?: string; score?: number; place?: number; comment?: string; publish: boolean }) =>
    http.post(`/community/events/${id}/results`, payload).then((response) => response.data),
  addAward: (id: string, payload: { userId?: string; title: string; description?: string; place?: number }) =>
    http.post(`/community/events/${id}/awards`, payload).then((response) => response.data),

  lessonComments: (lessonId: string) =>
    http
      .get<{ items: Array<{ id: string; body: string; createdAt: string; attachments: Attachment[] | null; user: { id: string; firstName: string; lastName: string; role: string }; replies: Array<{ id: string; body: string; createdAt: string; user: { id: string; firstName: string; lastName: string } }> }> }>(`/community/lessons/${lessonId}/comments`)
      .then((response) => response.data.items),
  addComment: (lessonId: string, body: string, parentId?: string) =>
    http.post(`/community/lessons/${lessonId}/comments`, { body, ...(parentId ? { parentId } : {}) }).then((response) => response.data),
  lessonQuestions: (lessonId: string) =>
    http
      .get<{ items: Array<{ id: string; title: string; body: string; answer: string | null; status: string; createdAt: string; student: { firstName: string; lastName: string }; answeredBy: { firstName: string; lastName: string } | null }> }>(`/community/lessons/${lessonId}/questions`)
      .then((response) => response.data.items),
  askQuestion: (lessonId: string, title: string, body: string) =>
    http.post(`/community/lessons/${lessonId}/questions`, { title, body }).then((response) => response.data),
  answerQuestion: (id: string, answer: string) =>
    http.patch(`/community/lesson-questions/${id}/answer`, { answer, status: 'ANSWERED' }).then((response) => response.data),

  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http
      .post<{ url: string; name: string; mimeType: string; size: number }>('/uploads', form)
      .then((response) => response.data)
  },
}
