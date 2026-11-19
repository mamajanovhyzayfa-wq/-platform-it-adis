import { http } from './client'

export interface AuthUser {
  id: string
  email: string
  phone: string | null
  firstName: string
  lastName: string
  role: 'STUDENT' | 'TEACHER' | 'MANAGER' | 'ADMIN' | 'PARENT'
  avatarUrl: string | null
  locale: string
  createdAt: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: string
}

export interface AuthResponse {
  user: AuthUser
  tokens: TokenPair
}

export type CourseLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'

export interface CourseCategory {
  id: string
  slug: string
  title: string
  icon: string | null
  coursesCount: number
}

export interface CourseCategoryRef {
  id: string
  slug: string
  title: string
  icon: string | null
}

/** Карточка курса в каталоге: прогресс уже посчитан сервером. */
export interface CatalogCourse {
  id: string
  title: string
  slug: string
  description: string
  coverUrl: string | null
  level: CourseLevel
  teacher: { id: string; name: string }
  category: CourseCategoryRef | null
  modulesCount: number
  lessonsCount: number
  durationMinutes: number
  studentsCount: number
  enrolled: boolean
  progress: number
}

export interface CatalogResponse {
  items: CatalogCourse[]
  total: number
  hasMore: boolean
  filters: {
    search: string | null
    category: string | null
    level: CourseLevel | null
    sort: 'new' | 'popular' | 'title'
    mine: boolean
  }
}

export interface EnrolledCourse {
  enrollmentId: string
  enrollmentStatus: string
  progress: number
  lessonsCount: number
  completedLessons: number
  course: {
    id: string
    title: string
    slug: string
    description: string
    coverUrl: string | null
    level: CourseLevel
    category: CourseCategoryRef | null
    teacher: { id: string; name: string }
    modulesCount: number
    durationMinutes: number
  }
  nextLesson: { id: string; title: string; moduleTitle: string; durationMinutes: number } | null
}

export interface LearningOverview {
  coinBalance: number
  activeCoursesCount: number
  completedCoursesCount: number
  overallProgress: number
  totalLessons: number
  completedLessons: number
  activeCourses: EnrolledCourse[]
  continueLearning: {
    courseId: string
    courseTitle: string
    lessonId: string | null
    lessonTitle: string | null
    moduleTitle: string | null
    progress: number
  } | null
  nextClass: {
    id: string
    title: string
    startsAt: string
    endsAt: string
    status: ScheduleItem['status']
    timezone: string
    course: { id: string; title: string }
    teacher: string | null
    hasRoom: boolean
  } | null
}

export interface CourseLessonSummary {
  id: string
  title: string
  description: string | null
  durationMinutes: number
  publishedAt: string | null
  materialsCount: number
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'
  lastPositionSeconds: number
  locked: boolean
}

export interface CourseModule {
  id: string
  title: string
  description: string | null
  position: number
  lessonsCount: number
  completedLessons: number
  lessons: CourseLessonSummary[]
}

export interface CoursePage {
  id: string
  title: string
  slug: string
  description: string
  coverUrl: string | null
  level: CourseLevel
  status: string
  createdAt: string
  category: CourseCategoryRef | null
  teacher: { id: string; name: string }
  enrollment: { id: string; status: string; progress: number; enrolledAt: string } | null
  isEnrolled: boolean
  progress: number
  completedLessons: number
  lessonsCount: number
  durationMinutes: number
  modules: CourseModule[]
}

export interface Profile extends AuthUser {
  profile: { bio: string | null; timezone: string } | null
  coinBalance: number
  courses: Array<{ enrollmentId: string; progress: number; status: string; course: { id: string; title: string; coverUrl: string | null; level: string; teacher: string } }>
}

export interface ScheduleItem {
  id: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  timezone: string
  status: 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED'
  course: { id: string; title: string }
  teacher: string
  hasRoom: boolean
}

export interface ScheduleCreateInput {
  courseId: string
  title: string
  description?: string
  startsAt: string
  durationMinutes: number
}

export interface HomeworkFile {
  name: string
  url: string
}

export interface HomeworkSubmission {
  id: string
  attempt: number
  text: string | null
  projectUrl: string | null
  files: HomeworkFile[] | null
  status: 'SUBMITTED' | 'REVIEWED' | 'RETURNED'
  submittedAt: string
  score: number | null
  reviewedAt: string | null
  review: {
    score: number
    comment: string | null
    returnForRevision: boolean
    createdAt: string
    reviewer?: string
  } | null
}

export interface HomeworkDetail {
  id: string
  title: string
  description: string
  dueAt: string
  maxScore: number
  allowResubmit: boolean
  course: { id: string; title: string }
  mySubmission: HomeworkSubmission | null
}

export interface HomeworkSubmitInput {
  text?: string
  projectUrl?: string
  files?: HomeworkFile[]
  idempotencyKey: string
}

export type CoinSource = 'MANUAL' | 'HOMEWORK' | 'TEST' | 'ATTENDANCE' | 'ACHIEVEMENT' | 'SHOP'

export interface CoinTransactionItem {
  id: string
  amount: number
  reason: string
  sourceType: CoinSource | null
  createdAt: string
}

export interface CoinHistory {
  items: CoinTransactionItem[]
  total: number
  balance: number
  totals: { earned: number; spent: number }
}

export interface HomeworkItem {
  id: string
  title: string
  description: string
  dueAt: string
  maxScore: number
  allowResubmit: boolean
  course: { id: string; title: string }
  submission: { id: string; status: string; score: number | null; submittedAt: string } | null
}

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

export interface StudentOfTeacher {
  id: string
  firstName: string
  lastName: string
  email: string
  avatarUrl: string | null
  courseTitle: string
  progress: number
  lastActivity: string | null
}

/** Курс в кабинете преподавателя: счётчики уже посчитаны сервером. */
export interface TeacherCourse {
  id: string
  title: string
  description: string
  coverUrl: string | null
  level: CourseLevel
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  category: CourseCategoryRef | null
  modulesCount: number
  lessonsCount: number
  publishedLessonsCount: number
  durationMinutes: number
  studentsCount: number
  avgProgress: number
  pendingReviews: number
}

export interface TeacherLesson {
  id: string
  title: string
  description: string | null
  durationMinutes: number
  position: number
  publishedAt: string | null
  videoUrl: string | null
  materialsCount: number
}

export interface TeacherModule {
  id: string
  title: string
  description: string | null
  position: number
  lessonsCount: number
  lessons: TeacherLesson[]
}

export interface TeacherHomework {
  id: string
  title: string
  description: string
  dueAt: string
  maxScore: number
  allowResubmit: boolean
  lessonId: string | null
  lesson: { id: string; title: string } | null
  createdAt: string
  pendingSubmissions: number
}

export interface TeacherHomeworkDetail extends TeacherHomework {
  course: { id: string; title: string }
}

export interface TeacherHomeworkInput {
  title: string
  description: string
  dueAt: string
  maxScore: number
  allowResubmit: boolean
  lessonId?: string
}

export interface TeacherCourseDetail {
  id: string
  title: string
  description: string
  coverUrl: string | null
  level: CourseLevel
  status: TeacherCourse['status']
  createdAt: string
  category: CourseCategoryRef | null
  teacher: { id: string; name: string }
  studentsCount: number
  avgProgress: number
  lessonsCount: number
  publishedLessonsCount: number
  durationMinutes: number
  pendingReviews: number
  modules: TeacherModule[]
  homework: TeacherHomework[]
}

export interface TeacherSubmission {
  id: string
  status: 'SUBMITTED' | 'REVIEWED' | 'RETURNED'
  attempt: number
  submittedAt: string
  reviewedAt: string | null
  score: number | null
  text: string | null
  projectUrl: string | null
  files: Array<{ name: string; url: string }> | null
  student: { id: string; firstName: string; lastName: string; name: string; avatarUrl: string | null; email: string }
  homework: { id: string; title: string; maxScore: number; dueAt: string; course: { id: string; title: string } }
  review: { score: number; comment: string | null; returnForRevision: boolean; createdAt: string } | null
}

export interface TeacherSubmissionDetail extends TeacherSubmission {
  homework: TeacherSubmission['homework'] & { description: string; allowResubmit: boolean }
  review: (TeacherSubmission['review'] & { reviewer: string }) | null
}

export interface TeacherOverview {
  stats: { courses: number; students: number; pendingReviews: number; avgProgress: number }
  nextClass: {
    id: string
    title: string
    startsAt: string
    endsAt: string
    status: ScheduleItem['status']
    timezone: string
    course: { id: string; title: string }
  } | null
  courses: TeacherCourse[]
  recentSubmissions: TeacherSubmission[]
}

export interface LessonMaterialItem {
  id: string
  type: 'DOCUMENT' | 'VIDEO' | 'PRESENTATION' | 'IMAGE' | 'LINK'
  title: string
  url: string
  mimeType: string | null
  sizeBytes: number | null
}

export interface LessonPage {
  id: string
  title: string
  description: string | null
  content: string | null
  videoUrl: string | null
  durationMinutes: number
  publishedAt: string | null
  materials: LessonMaterialItem[]
  course: { id: string; title: string; progress: number; lessonsCount: number; completedLessons: number }
  module: { id: string; title: string }
  progress: { status: string; lastPositionSeconds: number; watchedSeconds: number; completedAt: string | null } | null
  prevLesson: { id: string; title: string } | null
  nextLesson: { id: string; title: string } | null
}

export interface TestListItem {
  id: string
  title: string
  description: string | null
  course: { id: string; title: string }
  timeLimitMinutes: number
  passingScore: number
  attemptsAllowed: number
  questionsCount: number
  myAttempts: number
  bestScore: number
  hasActiveAttempt: boolean
}

export type QuestionType = 'SINGLE' | 'MULTIPLE' | 'TEXT' | 'MATCHING' | 'NUMBER' | 'BOOLEAN'

export interface TestQuestion {
  id: string
  type: QuestionType
  prompt: string
  points: number
  matchPairsLeft: string[] | null
  matchPairsRight: string[] | null
  options: Array<{ id: string; text: string }>
}

export interface TestDetail {
  id: string
  title: string
  description: string | null
  course: { id: string; title: string }
  timeLimitMinutes: number
  passingScore: number
  attemptsAllowed: number
  questions: TestQuestion[]
  attemptsLeft: number | null
}

export interface TestAttemptStart {
  attemptId: string
  expiresAt: string
  resumed: boolean
  questions: TestQuestion[]
  savedAnswers: Array<{ questionId: string; value: unknown }>
}

export interface TestSubmitResult {
  attemptId: string
  score: number
  maxScore: number
  percent: number
  passed: boolean
  correctCount: number
  incorrectCount: number
  totalQuestions: number
  review: Array<{ questionId: string; isCorrect: boolean; pointsAwarded: number }>
}

export interface VideoJoinInfo {
  roomId: string
  roomName: string
  url: string
  token: string
  expiresAt: string
  canPublish: boolean
  isModerator: boolean
  schedule: { id: string; title: string; startsAt: string; endsAt: string }
  course: { id: string; title: string }
  teacher: string
}

export interface VideoRecordingItem {
  id: string
  status: string
  url: string | null
  startedAt: string
  endedAt: string | null
  schedule: { id: string; title: string; startsAt: string; course: { id: string; title: string } }
}

export interface ShopProduct {
  id: string
  title: string
  description: string
  imageUrl: string | null
  category: string
  priceCoins: number
  stock: number
  terms: string | null
}

export interface ShopOrder {
  id: string
  status: 'NEW' | 'APPROVED' | 'ISSUED' | 'REJECTED'
  comment: string | null
  createdAt: string
  updatedAt: string
  product: { id: string; title: string; priceCoins: number; category: string }
}

export interface AchievementItem {
  id: string
  code: string
  title: string
  description: string
  iconUrl: string | null
  current: number
  target: number
  earnedAt: string | null
}

export interface KnowledgeCategory {
  id: string
  slug: string
  title: string
  icon: string | null
  materials: number
}

export interface KnowledgeItem {
  id: string
  title: string
  description: string
  coverUrl?: string | null
  type: 'VIDEO' | 'DOCUMENT' | 'PRESENTATION' | 'IMAGE' | 'LINK'
  durationMinutes: number
  createdAt?: string
  category: { slug: string; title: string }
  author?: string
  views?: number
  isFavorite: boolean
}

export interface KnowledgeDetail extends KnowledgeItem {
  videoUrl: string | null
  content: string | null
  fileUrl: string | null
}

export interface ConversationItem {
  id: string
  type: 'DIRECT' | 'COURSE'
  title: string
  courseId: string | null
  participants: Array<{ userId: string; name: string }>
  lastMessage: { id: string; body: string; senderName: string; createdAt: string } | null
  unread: number
}

export interface ChatAttachment {
  name: string
  url: string
  mimeType?: string
  size?: number
  isImage?: boolean
}

export interface ChatMessage {
  id: string
  body: string
  attachments: ChatAttachment[] | null
  createdAt: string
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  isMine: boolean
  conversationId?: string
  /** Собеседники прочитали сообщение (для исходящих — галочка «прочитано»). */
  readByOthers?: boolean
}

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export type AnswerValue = string | number | boolean | string[] | null

export type LeadStatus = 'NEW' | 'CONTACTED' | 'CONVERTED' | 'REJECTED'
export type LeadAudience = 'STUDENT' | 'PARENT' | 'PARTNER'

/** Заявка в CRM менеджера. */
export interface LeadItem {
  id: string
  name: string
  phone: string
  email: string | null
  audience: LeadAudience
  message: string | null
  status: LeadStatus
  source: string
  note: string | null
  assignedTo: { id: string; firstName: string; lastName: string } | null
  contactedAt: string | null
  closedAt: string | null
  createdAt: string
}

export interface LeadsPage {
  items: LeadItem[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface ManagerOverview {
  stats: {
    students: number
    teachers: number
    activeCourses: number
    newLeads: number
    lessonsToday: number
    pendingHomework: number
    attendanceToday: number
  }
  recentLeads: Array<{
    id: string
    name: string
    phone: string
    audience: LeadAudience
    status: LeadStatus
    createdAt: string
  }>
  upcoming: Array<{
    id: string
    title: string
    startsAt: string
    endsAt: string
    course: { id: string; title: string }
  }>
  generatedAt: string
}

export interface ManagerStudent {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  avatarUrl: string | null
  isActive: boolean
  gradeLevel: number | null
  coinBalance: number
  courses: Array<{ id: string; title: string; progress: number }>
  lastLoginAt: string | null
  createdAt: string
}

export interface ManagerStudentsPage {
  items: ManagerStudent[]
  total: number
  page: number
  limit: number
  pages: number
}

export const api = {
  register: (payload: Record<string, unknown>) => http.post<AuthResponse>('/auth/register', payload).then((r) => r.data),
  login: (payload: { identifier: string; password: string; deviceId?: string; platform?: string }) =>
    http.post<AuthResponse>('/auth/login', payload).then((r) => r.data),
  logout: (refreshToken: string) => http.post('/auth/logout', { refreshToken }),
  forgotPassword: (email: string) => http.post('/auth/forgot-password', { email }),
  resetPassword: (payload: { token: string; password: string; passwordRepeat: string }) =>
    http.post('/auth/reset-password', payload),

  me: () => http.get<Profile>('/users/me').then((r) => r.data),
  updateMe: (payload: Record<string, unknown>) => http.patch<Profile>('/users/me', payload).then((r) => r.data),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    http.post('/users/me/password', payload),
  deleteAccount: () => http.delete('/users/me'),
  myCourses: () => http.get<{ items: EnrolledCourse[] }>('/courses/my').then((r) => r.data.items),
  courseOverview: () => http.get<LearningOverview>('/courses/overview').then((r) => r.data),
  courseCategories: () => http.get<{ items: CourseCategory[] }>('/courses/categories').then((r) => r.data.items),
  catalogCourses: (params: {
    search?: string
    category?: string
    level?: CourseLevel
    sort?: 'new' | 'popular' | 'title'
    mine?: boolean
    limit?: number
    offset?: number
  }) =>
    http
      .get<CatalogResponse>('/courses', {
        params: {
          ...(params.search ? { search: params.search } : {}),
          ...(params.category ? { category: params.category } : {}),
          ...(params.level ? { level: params.level } : {}),
          ...(params.mine ? { mine: 'true' } : {}),
          sort: params.sort ?? 'new',
          limit: params.limit ?? 20,
          offset: params.offset ?? 0,
        },
      })
      .then((r) => r.data),
  enrollCourse: (id: string) => http.post(`/courses/${id}/enroll`).then((r) => r.data),
  myStudents: () => http.get<{ items: StudentOfTeacher[] }>('/users/me/students').then((r) => r.data.items),

  teacherOverview: () => http.get<TeacherOverview>('/teacher/overview').then((r) => r.data),
  teacherCourses: () => http.get<{ items: TeacherCourse[] }>('/teacher/courses').then((r) => r.data.items),
  teacherCourse: (id: string) => http.get<TeacherCourseDetail>(`/teacher/courses/${id}`).then((r) => r.data),
  teacherSubmissions: (params?: {
    status?: 'PENDING' | 'REVIEWED' | 'RETURNED' | 'ALL'
    courseId?: string
    limit?: number
    offset?: number
  }) =>
    http
      .get<{ items: TeacherSubmission[]; total: number }>('/teacher/submissions', {
        params: {
          status: params?.status ?? 'PENDING',
          ...(params?.courseId ? { courseId: params.courseId } : {}),
          limit: params?.limit ?? 20,
          offset: params?.offset ?? 0,
        },
      })
      .then((r) => r.data),
  teacherSubmission: (id: string) => http.get<TeacherSubmissionDetail>(`/teacher/submissions/${id}`).then((r) => r.data),
  reviewSubmission: (id: string, payload: { score: number; comment?: string; returnForRevision?: boolean }) =>
    http
      .post<{ id: string; status: string; score: number }>(`/teacher/submissions/${id}/review`, payload)
      .then((r) => r.data),

  teacherHomework: (id: string) => http.get<TeacherHomeworkDetail>(`/teacher/homework/${id}`).then((r) => r.data),
  createHomework: (courseId: string, payload: TeacherHomeworkInput) =>
    http.post<TeacherHomework>(`/teacher/courses/${courseId}/homework`, payload).then((r) => r.data),
  updateHomework: (id: string, payload: Partial<TeacherHomeworkInput>) =>
    http.patch<TeacherHomework>(`/teacher/homework/${id}`, payload).then((r) => r.data),

  createModule: (courseId: string, payload: { title: string; description?: string; position?: number }) =>
    http.post<TeacherModule>(`/courses/${courseId}/modules`, payload).then((r) => r.data),
  updateModule: (id: string, payload: { title?: string; description?: string; position?: number }) =>
    http.patch(`/modules/${id}`, payload).then((r) => r.data),
  deleteModule: (id: string) => http.delete(`/modules/${id}`).then((r) => r.data),

  createLesson: (payload: {
    moduleId: string
    title: string
    description?: string
    content?: string
    videoUrl?: string
    durationMinutes?: number
    published?: boolean
  }) => http.post<TeacherLesson>('/lessons', payload).then((r) => r.data),
  updateLesson: (
    id: string,
    payload: {
      title?: string
      description?: string
      content?: string
      videoUrl?: string
      durationMinutes?: number
      position?: number
      published?: boolean
    },
  ) => http.patch<TeacherLesson>(`/lessons/${id}`, payload).then((r) => r.data),
  deleteLesson: (id: string) => http.delete(`/lessons/${id}`).then((r) => r.data),

  course: (id: string) => http.get<CoursePage>(`/courses/${id}`).then((r) => r.data),

  lesson: (id: string) => http.get<LessonPage>(`/lessons/${id}`).then((r) => r.data),
  saveLessonProgress: (id: string, positionSeconds: number) =>
    http.patch<{ lastPositionSeconds: number; status: string }>(`/lessons/${id}/progress`, { positionSeconds }).then((r) => r.data),
  completeLesson: (id: string) =>
    http
      .post<{ progress: number; totalLessons: number; completedLessons: number; lessonCompleted: boolean; awarded: string[] }>(
        `/lessons/${id}/complete`,
      )
      .then((r) => r.data),

  tests: () => http.get<{ items: TestListItem[] }>('/tests').then((r) => r.data.items),
  test: (id: string) => http.get<TestDetail>(`/tests/${id}`).then((r) => r.data),
  startTest: (id: string) => http.post<TestAttemptStart>(`/tests/${id}/start`).then((r) => r.data),
  submitTest: (id: string, payload: { attemptId: string; answers: Array<{ questionId: string; value: AnswerValue }> }) =>
    http.post<TestSubmitResult>(`/tests/${id}/submit`, payload).then((r) => r.data),

  schedule: (params?: { from?: string; to?: string; courseId?: string }) =>
    http
      .get<{ items: ScheduleItem[]; range: { from: string; to: string } }>('/schedule', { params: params ?? {} })
      .then((r) => r.data.items),
  createSchedule: (payload: ScheduleCreateInput) =>
    http.post<ScheduleItem>('/schedule', payload).then((r) => r.data),

  managerOverview: () => http.get<ManagerOverview>('/manager/overview').then((r) => r.data),
  managerStudents: (params: { search?: string; page?: number; limit?: number } = {}) =>
    http
      .get<ManagerStudentsPage>('/manager/students', {
        params: { ...params, limit: params.limit ?? 20 },
      })
      .then((r) => r.data),
  leads: (params: { status?: LeadStatus; search?: string; page?: number; limit?: number } = {}) =>
    http
      .get<LeadsPage>('/leads', { params: { ...params, limit: params.limit ?? 20 } })
      .then((r) => r.data),
  leadStats: () =>
    http
      .get<{ total: number; newToday: number; byStatus: Record<LeadStatus, number> }>('/leads/stats')
      .then((r) => r.data),
  updateLead: (
    id: string,
    payload: { status?: LeadStatus; note?: string | null; assignedToId?: string | null },
  ) => http.patch<LeadItem>(`/leads/${id}`, payload).then((r) => r.data),

  homework: () => http.get<{ items: HomeworkItem[] }>('/homework').then((r) => r.data.items),
  homeworkById: (id: string) => http.get<HomeworkDetail>(`/homework/${id}`).then((r) => r.data),
  submitHomework: (id: string, payload: HomeworkSubmitInput) =>
    http.post<{ id: string; status: string; attempt: number; repeated?: boolean }>(`/homework/${id}/submit`, payload).then((r) => r.data),

  notifications: (params?: { limit?: number; offset?: number }) =>
    http
      .get<{ items: NotificationItem[]; unread: number; total: number }>('/notifications', {
        params: { limit: params?.limit ?? 30, offset: params?.offset ?? 0 },
      })
      .then((r) => r.data),
  markNotificationRead: (id: string) => http.patch(`/notifications/${id}/read`),
  markAllRead: () => http.post('/notifications/read-all'),

  coinBalance: () => http.get<{ balance: number }>('/coins/balance').then((r) => r.data.balance),
  coinHistory: (params: { limit?: number; offset?: number } = {}) =>
    http
      .get<CoinHistory>('/coins/history', { params: { limit: params.limit ?? 50, offset: params.offset ?? 0 } })
      .then((r) => r.data),
  awardCoins: (payload: { studentId: string; amount: number; reason: string }) =>
    http.post('/coins/award', payload).then((r) => r.data),

  videoStatus: () => http.get<{ enabled: boolean; recording: boolean }>('/video/status').then((r) => r.data),
  videoJoin: (scheduleId: string) =>
    http.post<VideoJoinInfo>('/video/rooms/join', { scheduleId }).then((r) => r.data),
  videoLeave: (roomId: string) => http.post(`/video/rooms/${roomId}/leave`).then((r) => r.data),
  videoEnd: (roomId: string) => http.post(`/video/rooms/${roomId}/end`).then((r) => r.data),
  videoStartRecording: (roomId: string) =>
    http.post<{ id: string; status: string }>(`/video/rooms/${roomId}/recording/start`).then((r) => r.data),
  videoStopRecording: (roomId: string, recordingId: string) =>
    http.post(`/video/rooms/${roomId}/recording/stop`, { recordingId }).then((r) => r.data),
  videoRecordings: () => http.get<{ items: VideoRecordingItem[] }>('/video/recordings').then((r) => r.data.items),
  conversations: () =>
    http
      .get<{ items: ConversationItem[]; unreadTotal: number }>('/messages/conversations')
      .then((r) => r.data),
  conversation: (id: string) =>
    http
      .get<{
        id: string
        type: 'DIRECT' | 'COURSE'
        title: string
        courseId: string | null
        participants: Array<{ userId: string; name: string }>
      }>(`/messages/conversations/${id}`)
      .then((r) => r.data),
  startConversation: (payload: { type?: 'DIRECT' | 'COURSE'; userId?: string; courseId?: string }) =>
    http.post<{ id: string; created: boolean }>('/messages/conversations', payload).then((r) => r.data),
  messages: (conversationId: string, options?: { before?: string; q?: string }) =>
    http
      .get<{ items: ChatMessage[]; hasMore: boolean }>(`/messages/conversations/${conversationId}/messages`, {
        params: options ?? {},
      })
      .then((r) => r.data),
  sendMessage: (conversationId: string, body: string, attachments?: ChatAttachment[]) =>
    http
      .post<ChatMessage>(`/messages/conversations/${conversationId}/messages`, {
        body,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      })
      .then((r) => r.data),
  createDirectConversation: (userId: string) =>
    http
      .post<{ id: string; created: boolean }>('/messages/conversations', { type: 'DIRECT', userId })
      .then((r) => r.data),
  createCourseConversation: (courseId: string) =>
    http
      .post<{ id: string; created: boolean }>('/messages/conversations', { type: 'COURSE', courseId })
      .then((r) => r.data),

  /** Загрузка вложения: фото из галереи или файл из файлового менеджера. */
  uploadAttachment: (file: { uri: string; name: string; mimeType: string }) => {
    const form = new FormData()
    // React Native FormData принимает объект с uri/name/type вместо Blob.
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob)
    return http
      .post<ChatAttachment & { isImage: boolean }>('/uploads', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      })
      .then((r) => r.data)
  },

  registerPushToken: (payload: { deviceId: string; platform: 'ios' | 'android' | 'web'; pushToken: string }) =>
    http.post('/users/me/push-token', payload).then((r) => r.data),
  removePushToken: (deviceId: string) =>
    http.delete('/users/me/push-token', { params: { deviceId } }).then((r) => r.data),

  aiStatus: () =>
    http
      .get<{ configured: boolean; model: string; used: number; limit: number }>('/ai/status')
      .then((r) => r.data),
  aiChat: (payload: { messages: AiMessage[]; topic?: string }) =>
    http
      .post<{ reply: string; usage: { used: number; limit: number }; model: string }>('/ai/chat', payload, {
        timeout: 60_000,
      })
      .then((r) => r.data),
  markConversationRead: (conversationId: string) =>
    http.post(`/messages/conversations/${conversationId}/read`).then((r) => r.data),
  reportMessage: (messageId: string) =>
    http.post<{ ok: boolean; duplicate?: boolean }>(`/messages/messages/${messageId}/report`).then((r) => r.data),

  knowledgeCategories: () =>
    http.get<{ items: KnowledgeCategory[] }>('/knowledge/categories').then((r) => r.data.items),
  knowledgeMaterials: (params: { search?: string; category?: string; type?: string; sort?: 'new' | 'popular' }) =>
    http
      .get<{ items: KnowledgeItem[]; total: number }>('/knowledge/materials', {
        params: {
          ...(params.search ? { search: params.search } : {}),
          ...(params.category ? { category: params.category } : {}),
          ...(params.type ? { type: params.type } : {}),
          sort: params.sort ?? 'new',
          limit: 30,
        },
      })
      .then((r) => r.data),
  knowledgeMaterial: (id: string) => http.get<KnowledgeDetail>(`/knowledge/materials/${id}`).then((r) => r.data),
  setKnowledgeFavorite: (id: string, favorite: boolean) =>
    favorite
      ? http.post(`/knowledge/materials/${id}/favorite`).then((r) => r.data)
      : http.delete(`/knowledge/materials/${id}/favorite`).then((r) => r.data),
  knowledgeFavorites: () =>
    http.get<{ items: KnowledgeItem[] }>('/knowledge/favorites').then((r) => r.data.items),
  knowledgeHistory: () =>
    http
      .get<{ items: Array<{ id: string; title: string; type: string; category: { slug: string; title: string }; viewedAt: string }> }>(
        '/knowledge/history',
      )
      .then((r) => r.data.items),
  knowledgeRecommendations: () =>
    http.get<{ items: KnowledgeItem[] }>('/knowledge/recommendations').then((r) => r.data.items),

  shopProducts: () => http.get<{ items: ShopProduct[] }>('/shop/products').then((r) => r.data.items),
  buyProduct: (payload: { productId: string; comment?: string }) =>
    http.post<ShopOrder>('/shop/orders', payload).then((r) => r.data),
  shopOrders: () => http.get<{ items: ShopOrder[] }>('/shop/orders').then((r) => r.data.items),
  achievements: () =>
    http.get<{ items: AchievementItem[]; earned: number; total: number }>('/achievements').then((r) => r.data),
  checkAchievements: () => http.post<{ awarded: string[] }>('/achievements/check').then((r) => r.data),

  videoAttendance: (roomId: string) =>
    http
      .get<{ items: Array<{ userId: string; name: string; role: string; joinedAt: string; leftAt: string | null; durationSeconds: number }> }>(
        `/video/rooms/${roomId}/attendance`,
      )
      .then((r) => r.data.items),
}
