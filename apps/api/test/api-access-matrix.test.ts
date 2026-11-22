import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AllExceptionsFilter } from '../src/nest/common/all-exceptions.filter.js'
import { JwtAuthGuard } from '../src/nest/common/guards/jwt-auth.guard.js'
import { RolesGuard } from '../src/nest/common/guards/roles.guard.js'
import { signAccessToken } from '../src/lib/security.js'
import { CoursesController } from '../src/modules/courses/courses.controller.js'
import { CoursesService } from '../src/modules/courses/courses.service.js'
import { LessonsController } from '../src/modules/lessons/lessons.controller.js'
import { LessonsService } from '../src/modules/lessons/lessons.service.js'
import { HomeworkController } from '../src/modules/homework/homework.controller.js'
import { HomeworkService } from '../src/modules/homework/homework.service.js'
import { TestsController } from '../src/modules/tests/tests.controller.js'
import { TestingService } from '../src/modules/tests/testing.service.js'
import { ExamAssessmentController } from '../src/modules/exams/exam-assessment.controller.js'
import { ExamService } from '../src/modules/exams/exam.service.js'
import { GradingService } from '../src/modules/exams/grading.service.js'
import { EconomyController } from '../src/modules/economy/economy.controller.js'
import { EconomyService } from '../src/modules/economy/economy.service.js'
import { AnalyticsCenterController } from '../src/modules/analytics-center/analytics-center.controller.js'
import { AnalyticsCenterService } from '../src/modules/analytics-center/analytics-center.service.js'
import { NotificationsController } from '../src/modules/notifications/notifications.controller.js'
import { NotificationsService } from '../src/modules/notifications/notifications.service.js'

/**
 * HTTP-матрица доступа к учебным и экономическим разделам.
 *
 * Проверяются настоящие глобальные guard'ы и контроллеры, а доменные сервисы
 * заменены заглушками: это фиксирует 401/403 и контракт маршрутов независимо
 * от состояния БД.
 */
const courses = {
  categories: vi.fn(async () => ({ items: [] })),
  my: vi.fn(async () => ({ items: [] })),
  overview: vi.fn(async () => ({ activeCoursesCount: 0 })),
  catalog: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
  detail: vi.fn(async () => ({ id: 'course-1' })),
  enroll: vi.fn(async () => ({ created: true })),
}
const lessons = {
  detail: vi.fn(async () => ({ id: 'lesson-1' })),
  saveProgress: vi.fn(async () => ({ status: 'IN_PROGRESS' })),
  complete: vi.fn(async () => ({ progress: 100 })),
  create: vi.fn(async () => ({ id: 'lesson-1' })),
  update: vi.fn(async () => ({ id: 'lesson-1' })),
  remove: vi.fn(async () => undefined),
}
const homework = {
  list: vi.fn(async () => ({ items: [] })),
  detail: vi.fn(async () => ({ id: 'homework-1' })),
  create: vi.fn(async () => ({ id: 'homework-1' })),
  update: vi.fn(async () => ({ id: 'homework-1' })),
  submit: vi.fn(async () => ({ id: 'submission-1' })),
  review: vi.fn(async () => ({ id: 'review-1' })),
  aiReview: vi.fn(async () => ({ id: 'review-1' })),
  history: vi.fn(async () => ({ items: [] })),
}
const testing = {
  list: vi.fn(async () => ({ items: [] })),
  detail: vi.fn(async () => ({ id: 'test-1' })),
  create: vi.fn(async () => ({ id: 'test-1' })),
  update: vi.fn(async () => ({ id: 'test-1' })),
  publish: vi.fn(async () => ({ id: 'test-1' })),
  remove: vi.fn(async () => undefined),
  results: vi.fn(async () => ({ items: [] })),
  addQuestion: vi.fn(async () => ({ id: 'question-1' })),
  updateQuestion: vi.fn(async () => ({ id: 'question-1' })),
  removeQuestion: vi.fn(async () => undefined),
  importQuestions: vi.fn(async () => ({ imported: 0 })),
  generate: vi.fn(async () => ({ questions: [] })),
}
const exams = {
  list: vi.fn(async () => ({ items: [] })),
  detail: vi.fn(async () => ({ id: 'exam-1' })),
  create: vi.fn(async () => ({ id: 'exam-1' })),
  update: vi.fn(async () => ({ id: 'exam-1' })),
  publish: vi.fn(async () => ({ id: 'exam-1' })),
  register: vi.fn(async () => ({ id: 'registration-1' })),
  cancelRegistration: vi.fn(async () => undefined),
  start: vi.fn(async () => ({ attemptId: 'attempt-1' })),
  results: vi.fn(async () => ({ items: [] })),
}
const grading = {
  list: vi.fn(async () => ({ items: [] })),
  create: vi.fn(async () => ({ id: 'scale-1' })),
  update: vi.fn(async () => ({ id: 'scale-1' })),
  remove: vi.fn(async () => undefined),
  setDefault: vi.fn(async () => undefined),
}
const economy = {
  overview: vi.fn(async () => ({ balance: 0 })),
  transactions: vi.fn(async () => ({ items: [] })),
  pending: vi.fn(async () => ({ items: [] })),
  orders: vi.fn(async () => ({ items: [] })),
}
const analytics = {
  overview: vi.fn(async () => ({ metrics: {} })),
}
const notifications = {
  list: vi.fn(async () => ({ items: [], total: 0, unread: 0 })),
  preferences: vi.fn(async () => ({ settings: {} })),
  updatePreferences: vi.fn(async () => ({ settings: {} })),
  readAll: vi.fn(async () => ({ updated: 0 })),
  markRead: vi.fn(async () => ({ id: 'notification-1', readAt: new Date() })),
  runDigest: vi.fn(async () => ({ sent: 0 })),
}

@Module({
  controllers: [
    CoursesController,
    LessonsController,
    HomeworkController,
    TestsController,
    ExamAssessmentController,
    EconomyController,
    AnalyticsCenterController,
    NotificationsController,
  ],
  providers: [
    { provide: CoursesService, useValue: courses },
    { provide: LessonsService, useValue: lessons },
    { provide: HomeworkService, useValue: homework },
    { provide: TestingService, useValue: testing },
    { provide: ExamService, useValue: exams },
    { provide: GradingService, useValue: grading },
    { provide: EconomyService, useValue: economy },
    { provide: AnalyticsCenterService, useValue: analytics },
    { provide: NotificationsService, useValue: notifications },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
class LearningSurfaceModule {}

const tokens = {
  student: signAccessToken({ sub: 'student-1', role: 'STUDENT', email: 'student@itadis.kg' }),
  teacher: signAccessToken({ sub: 'teacher-1', role: 'TEACHER', email: 'teacher@itadis.kg' }),
  parent: signAccessToken({ sub: 'parent-1', role: 'PARENT', email: 'parent@itadis.kg' }),
  admin: signAccessToken({ sub: 'admin-1', role: 'ADMIN', email: 'admin@itadis.kg' }),
}

function get(app: INestApplication, path: string, token?: string) {
  const call = request(app.getHttpServer()).get(path)
  return token ? call.set('Authorization', `Bearer ${token}`) : call
}

function post(app: INestApplication, path: string, token?: string, body: object = {}) {
  const call = request(app.getHttpServer()).post(path).send(body)
  return token ? call.set('Authorization', `Bearer ${token}`) : call
}

function patch(app: INestApplication, path: string, token?: string, body: object = {}) {
  const call = request(app.getHttpServer()).patch(path).send(body)
  return token ? call.set('Authorization', `Bearer ${token}`) : call
}

describe('HTTP-матрица доступа к учебному контуру', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await NestFactory.create(LearningSurfaceModule, { logger: false })
    app.useGlobalFilters(new AllExceptionsFilter())
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('без токена закрывает курсы, уроки, ДЗ, тесты, экзамены, экономику и аналитику', async () => {
    for (const path of [
      '/api/courses',
      '/api/lessons/lesson-1',
      '/api/assessment/homework',
      '/api/assessment/tests',
      '/api/assessment/exams',
      '/api/economy/overview',
      '/api/analytics-center/overview',
      '/api/notifications',
    ]) {
      const response = await get(app, path)
      expect(response.status, path).toBe(401)
      expect(response.body.error.code).toBe('UNAUTHORIZED')
    }
  })

  it('ученик читает каталог курсов, но не создаёт урок', async () => {
    const catalog = await get(app, '/api/courses', tokens.student)
    expect(catalog.status).toBe(200)
    expect(courses.catalog).toHaveBeenCalledWith(
      expect.any(Object),
      'student-1',
      'STUDENT',
    )

    const create = await post(app, '/api/lessons', tokens.student, {})
    expect(create.status).toBe(403)
    expect(create.body.error.code).toBe('FORBIDDEN')
    expect(lessons.create).not.toHaveBeenCalled()
  })

  it('ученик не создаёт и не проверяет домашние задания, но сдаёт свою работу', async () => {
    const create = await post(app, '/api/assessment/homework', tokens.student, {})
    expect(create.status).toBe(403)

    const review = await post(app, '/api/assessment/submissions/submission-1/review', tokens.student, {})
    expect(review.status).toBe(403)

    const submit = await post(app, '/api/assessment/homework/homework-1/submit', tokens.student, {
      text: 'Решение',
    })
    expect(submit.status).toBe(201)
    expect(homework.submit).toHaveBeenCalledWith('homework-1', 'student-1', expect.objectContaining({ text: 'Решение' }))
  })

  it('ученик не управляет тестами и экзаменами', async () => {
    const test = await post(app, '/api/assessment/tests', tokens.student, {})
    expect(test.status).toBe(403)

    const exam = await post(app, '/api/assessment/exams', tokens.student, {})
    expect(exam.status).toBe(403)
  })

  it('преподаватель видит результаты, но не управляет экономикой', async () => {
    const results = await get(app, '/api/assessment/tests/test-1/results', tokens.teacher)
    expect(results.status).toBe(200)
    expect(testing.results).toHaveBeenCalledWith('test-1', 'teacher-1', 'TEACHER')

    const pending = await get(app, '/api/economy/pending', tokens.teacher)
    expect(pending.status).toBe(403)
  })

  it('только администратор и менеджер видят очередь IT Coins', async () => {
    const admin = await get(app, '/api/economy/pending', tokens.admin)
    expect(admin.status).toBe(200)
    expect(economy.pending).toHaveBeenCalledWith('ADMIN')

    const student = await get(app, '/api/economy/pending', tokens.student)
    expect(student.status).toBe(403)
  })

  it('ученик читает только свои уведомления, а рассылку запускает администратор', async () => {
    const read = await patch(app, '/api/notifications/notification-1/read', tokens.student)
    expect(read.status).toBe(200)
    expect(notifications.markRead).toHaveBeenCalledWith('notification-1', 'student-1')

    const denied = await post(app, '/api/notifications/digest/run', tokens.student)
    expect(denied.status).toBe(403)

    const allowed = await post(app, '/api/notifications/digest/run', tokens.admin)
    expect(allowed.status).toBe(201)
    expect(notifications.runDigest).toHaveBeenCalledWith('admin-1')
  })

  it('аналитика запрещена родителю и проверяет период', async () => {
    const parent = await get(app, '/api/analytics-center/overview', tokens.parent)
    expect(parent.status).toBe(403)

    const invalid = await get(app, '/api/analytics-center/overview?from=not-a-date', tokens.student)
    expect(invalid.status).toBe(400)
    expect(analytics.overview).not.toHaveBeenCalled()

    const valid = await get(app, '/api/analytics-center/overview', tokens.student)
    expect(valid.status).toBe(200)
    expect(analytics.overview).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'student-1', role: 'STUDENT' }),
      {},
    )
  })
})
