import { http } from './client'

export type BlockType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'file'
  | 'pdf'
  | 'presentation'
  | 'link'
  | 'assignment'
  | 'test'
  | 'interactive'

export interface LmsBlock {
  id: string
  type: BlockType
  title?: string
  text?: string
  url?: string
  caption?: string
  description?: string
  dueAt?: string
  testId?: string
  homeworkId?: string
  prompt?: string
  options?: string[]
  correctOption?: number
  allowDownload?: boolean
}

export interface LmsMaterial {
  id: string
  type: string
  title: string
  url: string
  mimeType: string | null
  sizeBytes: number | null
  allowDownload: boolean
}

export interface LmsLesson {
  id: string
  title: string
  description: string | null
  durationMinutes: number
  position: number
  publishedAt: string | null
  version: number
  blocks: LmsBlock[]
  materials: LmsMaterial[]
  homework: Array<{ id: string; title: string; dueAt?: string }>
  studentsStarted: number
}

export interface LmsCoursePreview {
  id: string
  title: string
  description: string
  coverUrl: string | null
  level: string
  status: string
  approvalStatus: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  submittedAt: string | null
  approvedAt: string | null
  version: number
  category: { id: string; title: string } | null
  teacher: { id: string; name: string }
  author: { id: string; name: string } | null
  students: number
  tests: Array<{ id: string; title: string; isPublished: boolean }>
  modules: Array<{
    id: string
    title: string
    description: string | null
    position: number
    lessons: LmsLesson[]
  }>
}

export interface LmsCourseListItem {
  id: string
  title: string
  slug: string
  status: string
  approvalStatus: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  coverUrl: string | null
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  rejectionReason: string | null
  teacher: string
  author: string | null
  modules: number
  lessons: number
  students: number
}

export interface LmsVersion {
  id: string
  version: number
  note: string | null
  createdAt: string
  createdById?: string
}

export interface LmsBuilderLesson {
  id: string
  title: string
  description: string | null
  durationMinutes: number
  blocks: LmsBlock[]
  version: number
  publishedAt: string | null
  materials: LmsMaterial[]
  course: { id: string; title: string }
  module: { id: string; title: string }
  tests: Array<{ id: string; title: string }>
  homework: Array<{ id: string; title: string }>
}

export interface LearnCourse {
  id: string
  title: string
  description: string
  coverUrl: string | null
  level: string
  teacher: string
  author: string | null
  lessonsCount: number
  completedLessons: number
  progress: number
  modules: Array<{
    id: string
    title: string
    lessons: Array<{
      id: string
      title: string
      description: string | null
      durationMinutes: number
      materials: Array<{ id: string; title: string; type: string }>
      completed: boolean
    }>
  }>
}

export interface LearnLesson {
  id: string
  title: string
  description: string | null
  durationMinutes: number
  blocks: LmsBlock[]
  content: string | null
  videoUrl: string | null
  materials: Array<
    LmsMaterial & {
      bookmarked: boolean
      highlights: Array<{ id: string; quote: string; note: string | null; color: string; createdAt: string }>
    }
  >
  homework: { id: string; title: string; dueAt: string; description: string } | null
  tests: Array<{ id: string; title: string }>
  note: string
  course: { id: string; title: string }
  module: { id: string; title: string }
  prevLesson: { id: string; title: string } | null
  nextLesson: { id: string; title: string } | null
  progress: { status: string; completedAt: string | null } | null
}

export interface LibraryData {
  saved: Array<{
    id: string
    title: string
    type: string
    url: string
    allowDownload: boolean
    course: string
    courseId: string
    lessonId: string
    highlights: number
  }>
  courses: Array<{
    course: { id: string; title: string; coverUrl: string | null }
    groups: Array<{
      id: string
      title: string
      lessons: Array<{
        id: string
        title: string
        note: string | null
        noteUpdatedAt: string | null
        materials: Array<
          LmsMaterial & {
            bookmarked: boolean
            highlights: Array<{ id: string; quote: string; note: string | null; color: string }>
          }
        >
      }>
    }>
  }>
}

export const lmsApi = {
  courses: () => http.get<{ items: LmsCourseListItem[] }>('/lms/courses').then((response) => response.data.items),
  teachers: () =>
    http.get<{ items: Array<{ id: string; name: string; role: string }> }>('/lms/teachers').then((response) => response.data.items),

  createCourse: (payload: {
    title: string
    description: string
    coverUrl?: string
    level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
    teacherId?: string
  }) => http.post<{ id: string; title: string }>('/lms/courses', payload).then((response) => response.data),

  updateCourse: (id: string, payload: Record<string, unknown>) =>
    http.patch(`/lms/courses/${id}`, payload).then((response) => response.data),

  preview: (id: string) =>
    http.get<LmsCoursePreview>(`/lms/courses/${id}/preview`).then((response) => response.data),

  submit: (id: string) => http.post(`/lms/courses/${id}/submit`).then((response) => response.data),
  review: (id: string, approve: boolean, reason?: string) =>
    http.post(`/lms/courses/${id}/review`, { approve, reason }).then((response) => response.data),
  copyCourse: (id: string) =>
    http.post<{ id: string; title: string }>(`/lms/courses/${id}/copy`).then((response) => response.data),

  createModule: (courseId: string, payload: { title: string; description?: string }) =>
    http.post<{ id: string }>(`/lms/courses/${courseId}/modules`, payload).then((response) => response.data),
  updateModule: (moduleId: string, payload: { title?: string; description?: string }) =>
    http.patch(`/lms/modules/${moduleId}`, payload).then((response) => response.data),
  removeModule: (moduleId: string) => http.delete(`/lms/modules/${moduleId}`),

  createLesson: (moduleId: string, payload: { title: string; description?: string; durationMinutes?: number }) =>
    http.post<{ id: string }>(`/lms/modules/${moduleId}/lessons`, payload).then((response) => response.data),
  copyLesson: (lessonId: string, targetModuleId?: string) =>
    http
      .post<{ id: string }>(`/lms/lessons/${lessonId}/copy`, targetModuleId ? { targetModuleId } : {})
      .then((response) => response.data),

  builder: (lessonId: string) =>
    http.get<LmsBuilderLesson>(`/lms/lessons/${lessonId}/builder`).then((response) => response.data),
  saveBlocks: (
    lessonId: string,
    payload: { blocks: LmsBlock[]; autosave: boolean; note?: string; title?: string; durationMinutes?: number },
  ) => http.patch(`/lms/lessons/${lessonId}/blocks`, payload).then((response) => response.data),
  lessonVersions: (lessonId: string) =>
    http
      .get<{ items: LmsVersion[]; current: number }>(`/lms/lessons/${lessonId}/versions`)
      .then((response) => response.data),
  restoreLesson: (lessonId: string, version: number) =>
    http.post(`/lms/lessons/${lessonId}/versions/${version}/restore`).then((response) => response.data),

  courseVersions: (courseId: string) =>
    http
      .get<{ items: LmsVersion[]; current: number }>(`/lms/courses/${courseId}/versions`)
      .then((response) => response.data),
  saveCourseVersion: (courseId: string, note?: string) =>
    http.post(`/lms/courses/${courseId}/versions`, { note }).then((response) => response.data),
  restoreCourseVersion: (courseId: string, version: number) =>
    http.post(`/lms/courses/${courseId}/versions/${version}/restore`).then((response) => response.data),

  participants: (courseId: string) =>
    http
      .get<{
        totalLessons: number
        items: Array<{
          id: string
          name: string
          email: string
          status: string
          progress: number
          completedLessons: number
          enrolledAt: string
        }>
      }>(`/lms/courses/${courseId}/participants`)
      .then((response) => response.data),
  stats: (courseId: string) =>
    http
      .get<{
        lessons: number
        materials: number
        tests: number
        homework: number
        enrollments: number
        averageProgress: number
        completionRate: number
        lessonStats: Array<{ id: string; title: string; completed: number; materials: number }>
      }>(`/lms/courses/${courseId}/stats`)
      .then((response) => response.data),

  addMaterial: (
    lessonId: string,
    payload: { type: string; title: string; url: string; mimeType?: string; sizeBytes?: number; allowDownload?: boolean },
  ) => http.post<LmsMaterial>(`/lms/lessons/${lessonId}/materials`, payload).then((response) => response.data),
  removeMaterial: (materialId: string) => http.delete(`/lms/materials/${materialId}`),

  // ---------- ученик ----------
  learnCourse: (courseId: string) =>
    http.get<LearnCourse>(`/lms/learn/courses/${courseId}`).then((response) => response.data),
  learnLesson: (lessonId: string) =>
    http.get<LearnLesson>(`/lms/learn/lessons/${lessonId}`).then((response) => response.data),
  toggleBookmark: (materialId: string) =>
    http.post<{ bookmarked: boolean }>(`/lms/materials/${materialId}/bookmark`).then((response) => response.data),
  addHighlight: (materialId: string, payload: { quote: string; note?: string; color?: string }) =>
    http.post(`/lms/materials/${materialId}/highlights`, payload).then((response) => response.data),
  removeHighlight: (highlightId: string) => http.delete(`/lms/highlights/${highlightId}`),
  saveNote: (lessonId: string, body: string) =>
    http.put<{ body: string; savedAt: string }>(`/lms/lessons/${lessonId}/note`, { body }).then((response) => response.data),
  complete: (lessonId: string) => http.post(`/lessons/${lessonId}/complete`).then((response) => response.data),
  library: () => http.get<LibraryData>('/lms/library').then((response) => response.data),

  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http
      .post<{ url: string; name: string; mimeType: string; size: number; isImage: boolean }>('/uploads', form)
      .then((response) => response.data)
  },
}
