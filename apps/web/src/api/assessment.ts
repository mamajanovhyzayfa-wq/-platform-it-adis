import { http } from './client'

export interface Attachment {
  name: string
  url: string
  type?: string
  size?: number
}

interface HomeworkListItem {
  id: string
  title: string
  description: string
  dueAt: string
  maxScore: number
  maxAttempts: number
  allowResubmit: boolean
  allowLate: boolean
  latePenalty: number
  assignAll: boolean
  course: { id: string; title: string }
  lesson: { id: string; title: string } | null
  submissions: number
  targets: number
  overdue: boolean
  mySubmission: {
    id: string
    attempt: number
    status: string
    score: number | null
    submittedAt: string
    review: { score: number; comment: string | null; returnForRevision: boolean; createdAt: string } | null
  } | null
}

export interface HomeworkVersion {
  id: string
  attempt: number
  text: string | null
  projectUrl: string | null
  files: Attachment[] | null
  comments: Array<{ author: string; text: string; at: string }> | null
  status: string
  submittedAt: string
  reviewedAt: string | null
  score: number | null
  aiFeedback: AiHomeworkReview | null
  aiReviewedAt: string | null
  review: {
    id: string
    score: number
    comment: string | null
    returnForRevision: boolean
    criteriaScores: Array<{ title: string; score: number }> | null
    aiFeedback: unknown
    createdAt: string
  } | null
  student?: { id: string; name: string; email: string }
}

export interface HomeworkDetail {
  id: string
  title: string
  description: string
  dueAt: string
  maxScore: number
  materials: Attachment[] | null
  criteria: Array<{ title: string; weight: number; description?: string }> | null
  maxAttempts: number
  allowResubmit: boolean
  allowLate: boolean
  latePenalty: number
  assignAll: boolean
  course: { id: string; title: string }
  lesson: { id: string; title: string } | null
  teacher: { id: string; name: string }
  gradingScale: { id: string; name: string; bands: Array<{ label: string; minPercent: number; maxPercent: number }> } | null
  targets: Array<{ id: string; name: string; email: string }>
  mySubmissions?: HomeworkVersion[]
  attemptsUsed?: number
  attemptsLeft?: number
  canSubmit?: boolean
  submitBlockedReason?: string | null
  submissions?: HomeworkVersion[]
  students?: Array<{
    id: string
    name: string
    email: string
    versions: number
    status: string
    score: number | null
    submittedAt: string | null
    latestSubmissionId: string | null
  }>
  stats?: { assigned: number; submitted: number; reviewed: number; returned: number; pending: number }
}

export interface AiHomeworkReview {
  scoreSuggestion: number
  maxScore: number
  summary: string
  strengths: string[]
  improvements: string[]
  criteria: Array<{ title?: string; score?: number; comment?: string }>
  risks: string[]
  confidence: number
  disclaimer: string
}

export type QuestionType = 'SINGLE' | 'MULTIPLE' | 'TEXT' | 'MATCHING' | 'NUMBER' | 'BOOLEAN'

export interface QuestionInput {
  type: QuestionType
  prompt: string
  points: number
  explanation?: string
  topic?: string
  timeLimitSeconds?: number
  options?: Array<{ text: string; isCorrect: boolean }>
  matchPairs?: Array<{ left: string; right: string }>
  correctNumber?: number
  correctBoolean?: boolean
  correctText?: string
}

export interface TestQuestion extends QuestionInput {
  id: string
  position: number
  options?: Array<{ id: string; text: string; isCorrect: boolean }>
}

interface AttemptHistoryItem {
  id: string
  status: string
  score: number | null
  maxScore: number | null
  percent: number | null
  needsManualReview: boolean
  startedAt: string
  submittedAt: string | null
}

interface TestListItem {
  id: string
  title: string
  description: string | null
  course: { id: string; title: string }
  lesson: { id: string; title: string } | null
  timeLimitMinutes: number
  questionTimeLimitSeconds: number | null
  passingScore: number
  attemptsAllowed: number
  questions: number
  submissions: number
  isPublished: boolean
  shuffleQuestions: boolean
  shuffleOptions: boolean
  myAttempts: number
  bestPercent: number
  hasActiveAttempt: boolean
  attemptHistory: AttemptHistoryItem[]
}

export interface TestDetail {
  id: string
  title: string
  description: string | null
  course: { id: string; title: string; teacherId?: string }
  lesson?: string | null
  timeLimitMinutes: number
  questionTimeLimitSeconds: number | null
  passingScore: number
  attemptsAllowed: number
  shuffleQuestions?: boolean
  shuffleOptions?: boolean
  showExplanations?: boolean
  showCorrectAnswers?: boolean
  gradingScaleId?: string | null
  isPublished: boolean
  questions: TestQuestion[]
  questionsCount?: number
  attemptsLeft?: number
  attempts?: Array<Record<string, unknown>>
  gradingScale?: { id: string; name: string; bands: Array<{ label: string; minPercent: number; maxPercent: number }> } | null
}

export interface AttemptQuestion {
  id: string
  type: QuestionType
  prompt: string
  points: number
  timeLimitSeconds: number | null
  options: Array<{ id: string; text: string }>
  matchPairsLeft: string[]
  matchPairsRight: string[]
}

export interface AttemptPayload {
  attemptId: string
  expiresAt: string
  resumed: boolean
  currentQuestionId: string | null
  questionExpiresAt: string | null
  questionTimeLimitSeconds: number | null
  questions: AttemptQuestion[]
  savedAnswers: Array<{ questionId: string; value: unknown }>
}

export interface TestResult {
  attemptId: string
  examId: string | null
  test: { id: string; title: string; course: { id: string; title: string } }
  student: { id: string; name: string; email: string }
  status: string
  startedAt: string
  submittedAt: string | null
  expiresAt: string
  score: number | null
  maxScore: number | null
  percent: number | null
  passed: boolean
  passingScore: number
  needsManualReview: boolean
  gradedAt: string | null
  questions: Array<{
    id: string
    type: QuestionType
    prompt: string
    topic: string | null
    points: number
    pointsAwarded: number
    isCorrect: boolean | null
    answer: unknown
    correctAnswer: unknown
    explanation: string | null
    comment: string | null
  }>
  recommendations: Array<{ topic: string; errors: number; total: number; advice: string }>
  grade: { label: string; description: string | null } | null
  scale: { id: string; name: string; bands: Array<{ label: string; minPercent: number; maxPercent: number }> } | null
}

export interface ExamListItem {
  id: string
  title: string
  description: string | null
  course: { id: string; title: string } | null
  test: { id: string; title: string; questions: number }
  startsAt: string
  endsAt: string
  durationMinutes: number
  maxAttempts: number
  passingScore: number
  isPublished: boolean
  allowLateRegistration: boolean
  registrationOpen: boolean
  phase: 'UPCOMING' | 'ACTIVE' | 'FINISHED'
  registrations: number
  attempts: number
  myRegistration: string | null
  myAttempts: number
  myBestPercent: number
  hasActiveAttempt: boolean
  myAttemptHistory: AttemptHistoryItem[]
}

export interface ExamDetail
  extends Omit<
    ExamListItem,
    'registrations' | 'attempts' | 'myAttempts' | 'myBestPercent' | 'hasActiveAttempt' | 'myRegistration' | 'myAttemptHistory'
  > {
  instructions: string | null
  allowLateRegistration: boolean
  registrationOpen: boolean
  gradingScale: { id: string; name: string; bands: Array<{ label: string; minPercent: number; maxPercent: number }> } | null
  myRegistration: { status: string; registeredAt: string } | null
  myAttempts: Array<{
    id: string
    status: string
    score: number | null
    maxScore: number | null
    percent: number | null
    needsManualReview: boolean
    startedAt: string
    submittedAt: string | null
  }>
  registrations?: Array<{ id: string; student: { id: string; name: string; email: string }; status: string; registeredAt: string }>
  results?: Array<{
    id: string
    student: { id: string; name: string; email: string }
    status: string
    score: number | null
    maxScore: number | null
    percent: number | null
    needsManualReview: boolean
    submittedAt: string | null
    passed: boolean | null
  }>
  analysis?: {
    attempts: number
    questions: Array<{
      id: string
      prompt: string
      topic: string
      points: number
      attempts: number
      answered: number
      correct: number
      percent: number
    }>
    topics: Array<{ topic: string; correct: number; total: number; percent: number }>
  }
}

export interface GradingScale {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  bands: Array<{ id?: string; label: string; minPercent: number; maxPercent: number; description: string | null }>
  usage: { tests: number; exams: number; homework: number }
  updatedAt: string
}

export const homeworkApi = {
  list: () => http.get<{ items: HomeworkListItem[] }>('/assessment/homework').then((response) => response.data.items),
  detail: (id: string) => http.get<HomeworkDetail>(`/assessment/homework/${id}`).then((response) => response.data),
  create: (payload: Record<string, unknown>) =>
    http.post<{ id: string }>('/assessment/homework', payload).then((response) => response.data),
  update: (id: string, payload: Record<string, unknown>) =>
    http.patch(`/assessment/homework/${id}`, payload).then((response) => response.data),
  submit: (id: string, payload: Record<string, unknown>) =>
    http.post(`/assessment/homework/${id}/submit`, payload).then((response) => response.data),
  review: (submissionId: string, payload: Record<string, unknown>) =>
    http.post(`/assessment/submissions/${submissionId}/review`, payload).then((response) => response.data),
  aiReview: (submissionId: string) =>
    http.post<AiHomeworkReview>(`/assessment/submissions/${submissionId}/ai-review`, {}).then((response) => response.data),
  history: (id: string) =>
    http
      .get<{
        items: Array<{
          id: string
          type: string
          message: string | null
          data?: unknown
          createdAt: string
          actor: string
        }>
      }>(`/assessment/homework/${id}/history`)
      .then((response) => response.data.items),
}

export const testsApi = {
  list: () => http.get<{ items: TestListItem[] }>('/assessment/tests').then((response) => response.data.items),
  detail: (id: string) => http.get<TestDetail>(`/assessment/tests/${id}`).then((response) => response.data),
  create: (payload: Record<string, unknown>) =>
    http.post<{ id: string }>('/assessment/tests', payload).then((response) => response.data),
  update: (id: string, payload: Record<string, unknown>) =>
    http.patch(`/assessment/tests/${id}`, payload).then((response) => response.data),
  publish: (id: string, published: boolean) =>
    http.post(`/assessment/tests/${id}/publish`, { published }).then((response) => response.data),
  remove: (id: string) => http.delete(`/assessment/tests/${id}`),
  addQuestion: (id: string, payload: QuestionInput) =>
    http.post<{ id: string }>(`/assessment/tests/${id}/questions`, payload).then((response) => response.data),
  updateQuestion: (questionId: string, payload: QuestionInput) =>
    http.patch(`/assessment/questions/${questionId}`, payload).then((response) => response.data),
  removeQuestion: (questionId: string) => http.delete(`/assessment/questions/${questionId}`),
  results: (id: string) =>
    http
      .get<{
        items: Array<{
          id: string
          student: { id: string; name: string; email: string }
          status: string
          score: number | null
          maxScore: number | null
          percent: number | null
          needsManualReview: boolean
          submittedAt: string | null
        }>
      }>(`/assessment/tests/${id}/results`)
      .then((response) => response.data.items),
  importQuestions: (id: string, questionIds: string[]) =>
    http.post<{ imported: number }>(`/assessment/tests/${id}/import`, { questionIds }).then((response) => response.data),
  start: (id: string) => http.post<AttemptPayload>(`/assessment/tests/${id}/start`).then((response) => response.data),
  banks: () =>
    http
      .get<{ items: Array<{ id: string; title: string; description: string | null; questions: number }> }>('/assessment/banks')
      .then((response) => response.data.items),
  bank: (id: string) =>
    http
      .get<{ id: string; title: string; questions: Array<TestQuestion> }>(`/assessment/banks/${id}`)
      .then((response) => response.data),
  createBank: (payload: { title: string; description?: string }) =>
    http.post<{ id: string }>('/assessment/banks', payload).then((response) => response.data),
  addBankQuestion: (bankId: string, payload: QuestionInput) =>
    http.post(`/assessment/banks/${bankId}/questions`, payload).then((response) => response.data),
  removeBankQuestion: (id: string) => http.delete(`/assessment/bank-questions/${id}`),
  aiGenerate: (payload: Record<string, unknown>) =>
    http
      .post<{ questions: QuestionInput[]; saved: number; testId: string | null }>('/assessment/tests/ai-generate', payload)
      .then((response) => response.data),
}

export const attemptsApi = {
  focus: (attemptId: string, questionId: string) =>
    http.post<{ questionId: string; questionExpiresAt: string | null }>(`/assessment/attempts/${attemptId}/focus`, { questionId }).then((response) => response.data),
  progress: (attemptId: string, answers: Array<{ questionId: string; value: unknown }>) =>
    http.post<{ savedAt: string; saved: number }>(`/assessment/attempts/${attemptId}/progress`, { answers }).then((response) => response.data),
  submit: (attemptId: string, answers: Array<{ questionId: string; value: unknown }>) =>
    http.post<TestResult>(`/assessment/attempts/${attemptId}/submit`, { answers }).then((response) => response.data),
  result: (attemptId: string) =>
    http.get<TestResult>(`/assessment/attempts/${attemptId}/result`).then((response) => response.data),
  review: (attemptId: string, answers: Array<{ questionId: string; pointsAwarded: number; comment?: string }>) =>
    http.post(`/assessment/attempts/${attemptId}/review`, { answers }).then((response) => response.data),
}

export const examsApi = {
  list: () => http.get<{ items: ExamListItem[] }>('/assessment/exams').then((response) => response.data.items),
  detail: (id: string) => http.get<ExamDetail>(`/assessment/exams/${id}`).then((response) => response.data),
  create: (payload: Record<string, unknown>) =>
    http.post<{ id: string }>('/assessment/exams', payload).then((response) => response.data),
  update: (id: string, payload: Record<string, unknown>) =>
    http.patch(`/assessment/exams/${id}`, payload).then((response) => response.data),
  publish: (id: string, published: boolean) =>
    http.post(`/assessment/exams/${id}/publish`, { published }).then((response) => response.data),
  register: (id: string) => http.post(`/assessment/exams/${id}/register`, {}).then((response) => response.data),
  cancel: (id: string) => http.delete(`/assessment/exams/${id}/register`),
  start: (id: string) => http.post<AttemptPayload>(`/assessment/exams/${id}/start`).then((response) => response.data),
  results: (id: string) =>
    http.get<{ items: ExamDetail['results'] }>(`/assessment/exams/${id}/results`).then((response) => response.data.items),
}

export const gradingApi = {
  list: () => http.get<{ items: GradingScale[] }>('/assessment/grading/scales').then((response) => response.data.items),
  create: (payload: Record<string, unknown>) =>
    http.post('/assessment/grading/scales', payload).then((response) => response.data),
  update: (id: string, payload: Record<string, unknown>) =>
    http.patch(`/assessment/grading/scales/${id}`, payload).then((response) => response.data),
  remove: (id: string) => http.delete(`/assessment/grading/scales/${id}`),
  setDefault: (id: string) => http.post(`/assessment/grading/scales/${id}/default`, {}).then((response) => response.data),
}
