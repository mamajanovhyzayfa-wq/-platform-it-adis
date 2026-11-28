import { http } from './client'

export type DeliveryMode = 'ONLINE' | 'OFFLINE' | 'HYBRID'
export type ScheduleStatus = 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED'
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ABSENT'

export interface ScheduleCard {
  id: string
  title: string
  startsAt: string
  endsAt: string
  status: ScheduleStatus
  kind: 'REGULAR' | 'EXTRA'
  deliveryMode: DeliveryMode
  capacity: number | null
  enrolled: number
  extraEnrolled: number
  seatsLeft: number | null
  allowSelfEnrollment: boolean
  publishedAt: string | null
  cancellationReason: string | null
  cancelledAt: string | null
  cancelledBy: { id: string; name: string } | null
  teacher: { id: string; name: string }
  course: { id: string; title: string }
  classroom: { id: string; name: string; capacity: number; equipment: string[]; location: string | null } | null
  video: { id: string; provider: string; status: string; ready: boolean } | null
  myExtraEnrollment: string | null
  canJoin: boolean
  myEnrollment?: string | null
  isCourseStudent?: boolean
  canEnroll?: boolean
  registrations?: Array<{ id: string; userId: string; name: string; email: string; createdAt: string }>
}

export interface ScheduleDetail extends ScheduleCard {
  description: string | null
  timezone: string
  recordingEnabled: boolean | null
  autoRecord: boolean | null
  teacherInfo: { id: string; firstName: string; lastName: string; email: string } | null
  students?: Array<{
    id: string
    name: string
    email: string
    attendance: {
      id: string
      status: AttendanceStatus
      source: string
      joinedAt: string
      leftAt: string | null
      durationSeconds: number
      reconnectCount: number
      lateMinutes: number
      earlyLeaveMinutes: number
      note: string | null
    } | null
  }>
  changes?: Array<{
    id: string
    type: 'RESCHEDULE' | 'CANCEL'
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    reason: string
    proposedStartsAt: string | null
    proposedTeacher: { id: string; firstName: string; lastName: string } | null
    proposedClassroom: { id: string; name: string } | null
    requestedBy: { id: string; firstName: string; lastName: string; role: string }
    decidedBy: { id: string; firstName: string; lastName: string } | null
    createdAt: string
    decidedAt: string | null
    decisionComment: string | null
  }>
  events?: Array<{
    id: string
    action: string
    message: string | null
    createdAt: string
    actor: { id: string; firstName: string; lastName: string } | null
  }>
  substitutions?: Array<{
    id: string
    reason: string | null
    createdAt: string
    fromTeacher: { id: string; firstName: string; lastName: string }
    toTeacher: { id: string; firstName: string; lastName: string }
    assignedBy: { id: string; firstName: string; lastName: string }
  }>
  attendance?: Array<{
    id: string
    userId: string
    name: string
    status: AttendanceStatus
    source: string
    joinedAt: string
    leftAt: string | null
    durationSeconds: number
    reconnectCount: number
    lateMinutes: number
    earlyLeaveMinutes: number
    note: string | null
  }>
  extraEnrollments: Array<{ id: string; userId: string; name: string; createdAt: string }>
  canManage: boolean
}

interface Classroom {
  id: string
  name: string
  capacity: number
  equipment: string[]
  location: string | null
  isActive: boolean
  upcoming: number
}

export interface ScheduleTemplate {
  id: string
  courseId: string
  teacherId: string
  title: string
  description: string | null
  weekdays: number[]
  startTime: string
  durationMinutes: number
  deliveryMode: DeliveryMode
  capacity: number | null
  allowSelfEnrollment: boolean
  classroomId: string | null
  course: { id: string; title: string }
  teacher: { id: string; firstName: string; lastName: string }
  classroom: { id: string; name: string; capacity: number } | null
}

interface CourseOption {
  id: string
  title: string
  teacherId: string
  teacher: string
  students: number
  recordingEnabled: boolean | null
  recordingAuto: boolean | null
  endDate: string | null
}

interface ScheduleChange {
  id: string
  type: 'RESCHEDULE' | 'CANCEL'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reason: string
  proposedStartsAt: string | null
  createdAt: string
  schedule: { id: string; title: string; startsAt: string; endsAt: string; teacherId: string; course: { id: string; title: string } }
  requestedBy: { id: string; firstName: string; lastName: string; role: string }
  decidedBy: { id: string; firstName: string; lastName: string } | null
  proposedTeacher: { id: string; firstName: string; lastName: string } | null
  proposedClassroom: { id: string; name: string } | null
}

export interface CalendarEvent {
  id: string
  entityId: string
  type: 'lesson' | 'task' | 'homework' | 'exam'
  title: string
  startsAt: string
  endsAt: string
  allDay: boolean
  status?: string
  kind?: string
  deliveryMode?: DeliveryMode
  course?: { id: string; title: string } | null
  teacher?: string | null
  classroom?: { id: string; name: string; location: string | null } | null
  location?: string | null
  canJoin?: boolean
  extraSeats?: number | null
  extraEnrolled?: number
  isCourseStudent?: boolean
  myExtraEnrollment?: string | null
  canEnrollExtra?: boolean
  completed?: boolean
  description?: string | null
  link?: string
  cancellationReason?: string | null
  cancelledAt?: string | null
  cancelledBy?: { name: string } | null
}

interface CalendarTask {
  id: string
  title: string
  description: string | null
  dueAt: string
  completedAt: string | null
  course: { id: string; title: string } | null
}

export interface CalendarConnection {
  id: string
  provider: 'GOOGLE' | 'APPLE' | 'OUTLOOK'
  isActive: boolean
  feedUrl: string
  webcalUrl: string
  lastSyncedAt: string | null
  createdAt: string
}

export interface Recording {
  id: string
  status: string
  transferStatus: string
  url: string | null
  durationSeconds: number | null
  attempts: number
  error: string | null
  startedAt: string
  endedAt: string | null
  expiresAt?: string | null
  available: boolean
  schedule: { id: string; title: string; startsAt: string; course: { id: string; title: string } }
}

interface VideoJoin {
  provider: string
  roomName: string
  providerRoomId: string
  signalingToken: string
  participantId: string
  isModerator: boolean
  appData: { displayName: string }
  autoRecording?: { started: boolean; warning?: string } | null
  schedule: { id: string; title: string; startsAt: string; endsAt: string; deliveryMode: DeliveryMode }
  course: { id: string; title: string }
}

interface ScheduleChatMessage {
  id: string
  body: string
  createdAt: string
  user: { id: string; name: string; role: string }
}

interface ScheduleStats {
  period: { from: string; to: string }
  lessons: { total: number; conducted: number; cancelled: number; cancelRate: number; extra: number }
  attendance: { marked: number; present: number; absent: number; late: number; earlyLeave: number; totalHours: number }
  teacherLoad: Array<{ teacherId: string; teacher: string; lessons: number; cancelled: number; hours: number }>
  classroomUsage: Array<{ id: string; name: string; capacity: number; lessons: number; hours: number; utilization: number }>
}

export const schedulingApi = {
  courses: () => http.get<{ items: CourseOption[] }>('/scheduling/courses').then((response) => response.data.items),
  teachers: () =>
    http
      .get<{ items: Array<{ id: string; firstName: string; lastName: string; email: string }> }>('/scheduling/teachers')
      .then((response) => response.data.items),
  videoStatus: () => http.get('/scheduling/video/status').then((response) => response.data),

  classrooms: () =>
    http.get<{ items: Classroom[] }>('/scheduling/classrooms').then((response) => response.data.items),
  classroomAvailability: (params: { from: string; to: string }) =>
    http
      .get<{
        items: Array<
          Classroom & {
            bookedMinutes: number
            utilization: number
            bookings: Array<{ id: string; title: string; course: string; startsAt: string; endsAt: string }>
          }
        >
        workingHours: { start: string; end: string }
      }>('/scheduling/classrooms/availability', { params })
      .then((response) => response.data),
  createClassroom: (payload: {
    name: string
    capacity: number
    equipment: string[]
    location?: string
    isActive: boolean
  }) => http.post('/scheduling/classrooms', payload).then((response) => response.data),
  updateClassroom: (id: string, payload: Partial<Classroom>) =>
    http.patch(`/scheduling/classrooms/${id}`, payload).then((response) => response.data),
  deleteClassroom: (id: string) => http.delete(`/scheduling/classrooms/${id}`).then((response) => response.data),

  templates: () =>
    http.get<{ items: ScheduleTemplate[] }>('/scheduling/templates').then((response) => response.data.items),
  createTemplate: (payload: Record<string, unknown>) =>
    http.post('/scheduling/templates', payload).then((response) => response.data),
  updateTemplate: (id: string, payload: Record<string, unknown>) =>
    http.patch(`/scheduling/templates/${id}`, payload).then((response) => response.data),
  deleteTemplate: (id: string) => http.delete(`/scheduling/templates/${id}`).then((response) => response.data),
  applyTemplate: (id: string, payload: { from: string; to: string }) =>
    http.post(`/scheduling/templates/${id}/apply`, payload).then((response) => response.data),

  schedules: (params: Record<string, string | undefined>) =>
    http
      .get<{ items: ScheduleCard[]; range: { from: string; to: string } }>('/scheduling/schedules', { params })
      .then((response) => response.data),
  schedule: (id: string) => http.get<ScheduleDetail>(`/scheduling/schedules/${id}`).then((response) => response.data),
  createSchedule: (payload: Record<string, unknown>) =>
    http.post<ScheduleCard>('/scheduling/schedules', payload).then((response) => response.data),
  createRecurring: (payload: Record<string, unknown>) =>
    http
      .post<{ seriesId: string; created: number; skipped: Array<{ startsAt: string; reason: string }> }>(
        '/scheduling/schedules/recurring',
        payload,
      )
      .then((response) => response.data),
  updateSchedule: (id: string, payload: Record<string, unknown>) =>
    http.patch<ScheduleCard>(`/scheduling/schedules/${id}`, payload).then((response) => response.data),
  cancelSchedule: (id: string, reason: string) =>
    http.post(`/scheduling/schedules/${id}/cancel`, { reason }).then((response) => response.data),
  conflicts: (payload: Record<string, unknown>) =>
    http
      .post<{
        conflicts: Array<{ type: string; message: string; scheduleId?: string }>
        capacity: number
        enrolled: number
      }>('/scheduling/schedules/conflicts', payload)
      .then((response) => response.data),
  alternatives: (id: string) =>
    http
      .get<{
        slots: Array<{ startsAt: string; endsAt: string }>
        availableTeachers: Array<{ id: string; name: string }>
        freeClassrooms: Array<{ id: string; name: string; capacity: number }>
      }>(`/scheduling/schedules/${id}/alternatives`)
      .then((response) => response.data),
  requestChange: (id: string, payload: Record<string, unknown>) =>
    http.post(`/scheduling/schedules/${id}/change-request`, payload).then((response) => response.data),
  substitute: (id: string, teacherId: string, reason?: string) =>
    http.post(`/scheduling/schedules/${id}/substitute`, { teacherId, reason }).then((response) => response.data),

  changes: (status?: string) =>
    http
      .get<{ items: ScheduleChange[] }>('/scheduling/changes', { params: { ...(status ? { status } : {}) } })
      .then((response) => response.data.items),
  approveChange: (id: string, comment?: string) =>
    http.post(`/scheduling/changes/${id}/approve`, { comment }).then((response) => response.data),
  rejectChange: (id: string, comment?: string) =>
    http.post(`/scheduling/changes/${id}/reject`, { comment }).then((response) => response.data),

  extra: () => http.get<{ items: ScheduleCard[] }>('/scheduling/extra').then((response) => response.data.items),
  enroll: (id: string) => http.post(`/scheduling/schedules/${id}/enroll`).then((response) => response.data),
  cancelEnrollment: (id: string) =>
    http.delete(`/scheduling/schedules/${id}/enroll`).then((response) => response.data),

  attendance: (id: string) =>
    http
      .get<{
        schedule: { id: string; title: string; startsAt: string; endsAt: string; deliveryMode: DeliveryMode; course: { id: string; title: string } }
        items: Array<{
          id: string
          name: string
          email: string
          extra: boolean
          attendance: ScheduleDetail['attendance'] extends Array<infer T> | undefined ? T | null : never
        }>
      }>(`/scheduling/schedules/${id}/attendance`)
      .then((response) => response.data),
  markAttendance: (
    id: string,
    items: Array<{
      userId: string
      status: AttendanceStatus
      note?: string
      lateMinutes?: number
      earlyLeaveMinutes?: number
    }>,
  ) => http.post(`/scheduling/schedules/${id}/attendance`, { items }).then((response) => response.data),

  stats: (from: string, to: string) =>
    http.get<ScheduleStats>('/scheduling/stats', { params: { from, to } }).then((response) => response.data),
  aiAnalyze: () =>
    http
      .post<{
        summary?: string
        suggestions?: Array<{ title: string; reason: string; impact?: string; scheduleIds?: string[] }>
        risks?: string[]
        disclaimer: string
      }>('/scheduling/ai/analyze')
      .then((response) => response.data),
  recordingSettings: () =>
    http
      .get<{
        recordingEnabled: boolean
        recordingAuto: boolean
        workingHoursStart: string
        workingHoursEnd: string
        slotStepMinutes: number
        notifyAbsenceStudent: boolean
        notifyAbsenceParent: boolean
        notifyAbsenceTeacher: boolean
        notifyAbsenceManager: boolean
        levels: string
        provider: string
      }>('/scheduling/settings/recording')
      .then((response) => response.data),
  updateRecordingSettings: (payload: Record<string, unknown>) =>
    http.patch('/scheduling/settings/recording', payload).then((response) => response.data),
  updateCourseRecording: (courseId: string, payload: { recordingEnabled?: boolean | null; recordingAuto?: boolean | null }) =>
    http.patch(`/scheduling/courses/${courseId}/recording`, payload).then((response) => response.data),

  calendar: (params: Record<string, string | undefined>) =>
    http.get<{ items: CalendarEvent[]; range: { from: string; to: string } }>('/scheduling/calendar', { params }).then((response) => response.data),
  freeSlots: (params: Record<string, string | number | undefined>) =>
    http
      .get<{ items: Array<{ startsAt: string; endsAt: string; freeRooms: Array<{ id: string; name: string; capacity: number }> }> }>(
        '/scheduling/calendar/free-slots',
        { params },
      )
      .then((response) => response.data),
  tasks: () => http.get<{ items: CalendarTask[] }>('/scheduling/calendar/tasks').then((response) => response.data.items),
  createTask: (payload: { title: string; dueAt: string; description?: string; courseId?: string }) =>
    http.post('/scheduling/calendar/tasks', payload).then((response) => response.data),
  updateTask: (id: string, payload: Record<string, unknown>) =>
    http.patch(`/scheduling/calendar/tasks/${id}`, payload).then((response) => response.data),
  deleteTask: (id: string) => http.delete(`/scheduling/calendar/tasks/${id}`).then((response) => response.data),
  connections: () =>
    http
      .get<{ items: CalendarConnection[]; instructions: Record<string, string> }>('/scheduling/calendar/connections')
      .then((response) => response.data),
  createConnection: (provider: 'GOOGLE' | 'APPLE' | 'OUTLOOK') =>
    http.post<CalendarConnection>('/scheduling/calendar/connections', { provider }).then((response) => response.data),
  deleteConnection: (id: string) =>
    http.delete(`/scheduling/calendar/connections/${id}`).then((response) => response.data),

  createVideoRoom: (id: string) => http.post(`/scheduling/schedules/${id}/video/room`).then((response) => response.data),
  joinVideo: (id: string) => http.post<VideoJoin>(`/scheduling/schedules/${id}/video/join`).then((response) => response.data),
  leaveVideo: (id: string) => http.post(`/scheduling/schedules/${id}/video/leave`).then((response) => response.data),
  endVideo: (id: string) => http.post(`/scheduling/schedules/${id}/video/end`).then((response) => response.data),
  startRecording: (id: string) => http.post(`/scheduling/schedules/${id}/recording/start`).then((response) => response.data),
  stopRecording: (id: string) => http.post(`/scheduling/schedules/${id}/recording/stop`).then((response) => response.data),
  videoAnalytics: (id: string) => http.get(`/scheduling/schedules/${id}/video/analytics`).then((response) => response.data),

  chat: (id: string, after?: string) =>
    http
      .get<{ items: ScheduleChatMessage[] }>(`/scheduling/schedules/${id}/chat`, { params: { ...(after ? { after } : {}) } })
      .then((response) => response.data.items),
  sendChat: (id: string, body: string) =>
    http.post(`/scheduling/schedules/${id}/chat`, { body }).then((response) => response.data),

  recordings: () =>
    http.get<{ items: Recording[] }>('/scheduling/recordings').then((response) => response.data.items),
  recordingFile: (id: string) =>
    http.get<Blob>(`/scheduling/recordings/${id}/file`, { responseType: 'blob' }).then((response) => response.data),
  retryTransfer: (id: string) =>
    http.post(`/scheduling/recordings/${id}/transfer/retry`).then((response) => response.data),
}
