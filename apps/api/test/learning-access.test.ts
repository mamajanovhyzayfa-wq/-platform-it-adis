import { beforeEach, describe, expect, it, vi } from 'vitest'

const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }))
vi.mock('../src/lib/audit.js', () => ({ writeAudit: audit.writeAudit }))

import type { PrismaService } from '../src/nest/prisma/prisma.service.js'
import { CoursesService } from '../src/modules/courses/courses.service.js'
import { LessonsService } from '../src/modules/lessons/lessons.service.js'
import { HomeworkService } from '../src/modules/homework/homework.service.js'
import { TestingService } from '../src/modules/tests/testing.service.js'
import { ExamService } from '../src/modules/exams/exam.service.js'
import { EconomyService } from '../src/modules/economy/economy.service.js'
import { LmsService } from '../src/modules/lms/lms.service.js'
import type { AiCenterService } from '../src/modules/ai-center/ai-center.service.js'

/**
 * Проверки прав на учебном контуре и в магазине.
 *
 * Сервисы получают подменённый Prisma-клиент, но их настоящая логика доступа
 * выполняется целиком: роли, владение курсом, запись на курс, выдача задания,
 * публикация теста/экзамена и баланс IT Coins.
 */

function prismaWith(client: Record<string, unknown>): PrismaService {
  return { client } as unknown as PrismaService
}

const ai = { triggerEvent: vi.fn(async () => undefined) } as unknown as AiCenterService
const testingStub = {} as TestingService

function homeworkFixture() {
  return {
    id: 'homework-1',
    courseId: 'course-1',
    lessonId: null,
    teacherId: 'teacher-b',
    title: 'Домашняя работа',
    description: 'Описание',
    dueAt: new Date(Date.now() + 86_400_000),
    maxScore: 100,
    maxAttempts: 3,
    allowResubmit: false,
    allowLate: false,
    latePenalty: 0,
    assignAll: true,
    materials: [],
    criteria: [],
    course: { id: 'course-1', title: 'Курс', teacherId: 'teacher-b' },
    lesson: null,
    teacher: { id: 'teacher-b', firstName: 'Борис', lastName: 'Беков' },
    gradingScale: null,
    targets: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('курсы: создание, владение и запись', () => {
  const courseInput = {
    title: 'Новый курс',
    description: 'Описание нового курса',
    level: 'BEGINNER' as const,
  }

  it('ученик не создаёт курс', async () => {
    await expect(
      new LmsService(prismaWith({})).createCourse(courseInput, 'student-a', 'STUDENT'),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('наставник не создаёт курс на другого преподавателя', async () => {
    await expect(
      new LmsService(prismaWith({})).createCourse(
        { ...courseInput, teacherId: '00000000-0000-4000-8000-000000000002' },
        'teacher-a',
        'TEACHER',
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('наставник создаёт черновик курса на себя', async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'course-new',
      title: data.title,
      slug: data.slug,
      approvalStatus: data.approvalStatus,
    }))
    const service = new LmsService(prismaWith({ course: { create } }))

    const course = await service.createCourse(courseInput, 'teacher-a', 'TEACHER')
    expect(course).toMatchObject({ id: 'course-new', approvalStatus: 'DRAFT' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teacherId: 'teacher-a',
          authorId: 'teacher-a',
          status: 'DRAFT',
          approvalStatus: 'DRAFT',
        }),
      }),
    )
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lms.course.create', actorId: 'teacher-a' }),
    )
  })

  it('преподаватель не открывает курс другого преподавателя', async () => {
    const prisma = prismaWith({
      course: {
        findUnique: vi.fn(async () => ({
          id: 'course-1',
          title: 'Чужой курс',
          slug: 'foreign',
          status: 'ACTIVE',
          teacherId: 'teacher-b',
          modules: [],
        })),
      },
    })

    await expect(new CoursesService(prisma).detail('course-1', 'teacher-a', 'TEACHER')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('преподаватель не может записаться на курс как ученик', async () => {
    const prisma = prismaWith({})
    await expect(new CoursesService(prisma).enroll('course-1', 'teacher-a', 'TEACHER')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('нельзя добавить модуль в чужой курс', async () => {
    const prisma = prismaWith({
      course: { findUnique: vi.fn(async () => ({ id: 'course-1', teacherId: 'teacher-b' })) },
    })

    await expect(
      new CoursesService(prisma).createModule('course-1', { title: 'Модуль' }, 'teacher-a', 'TEACHER'),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('уроки: доступ ученика и преподавателя', () => {
  const lesson = {
    id: 'lesson-1',
    title: 'Урок',
    description: null,
    content: 'Материал',
    videoUrl: null,
    durationMinutes: 20,
    publishedAt: new Date('2026-11-01T00:00:00.000Z'),
    moduleId: 'module-1',
    module: {
      id: 'module-1',
      title: 'Модуль',
      course: { id: 'course-1', title: 'Курс', teacherId: 'teacher-b' },
    },
    materials: [],
  }

  it('ученик без записи на курс не получает урок', async () => {
    const prisma = prismaWith({
      lesson: { findUnique: vi.fn(async () => lesson) },
      courseEnrollment: { findUnique: vi.fn(async () => null) },
    })

    await expect(new LessonsService(prisma).detail('lesson-1', 'student-a', 'STUDENT')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('преподаватель не открывает урок чужого курса', async () => {
    const prisma = prismaWith({
      lesson: { findUnique: vi.fn(async () => lesson) },
    })

    await expect(new LessonsService(prisma).detail('lesson-1', 'teacher-a', 'TEACHER')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('преподаватель не сохраняет прогресс ученика', async () => {
    const prisma = prismaWith({})
    await expect(
      new LessonsService(prisma).saveProgress('lesson-1', 'teacher-a', 'TEACHER', 30),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('преподаватель создаёт урок только в своём модуле', async () => {
    const prisma = prismaWith({
      module: { findUnique: vi.fn(async () => ({ id: 'module-1', course: { teacherId: 'teacher-a' } })) },
      lesson: {
        aggregate: vi.fn(async () => ({ _max: { position: 2 } })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'lesson-new',
          title: data.title,
          publishedAt: data.publishedAt,
        })),
      },
    })

    const lesson = await new LessonsService(prisma).create(
      {
        moduleId: '00000000-0000-4000-8000-000000000001',
        title: 'Новый урок',
        durationMinutes: 30,
        published: true,
      },
      'teacher-a',
      'TEACHER',
    )

    expect(lesson).toMatchObject({ id: 'lesson-new', title: 'Новый урок' })
    expect(lesson.publishedAt).toBeInstanceOf(Date)
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lesson.created', actorId: 'teacher-a' }),
    )
  })
})

describe('домашние задания: адресность и проверка', () => {
  it('ученик без записи на курс не видит задание', async () => {
    const prisma = prismaWith({
      homework: { findUnique: vi.fn(async () => homeworkFixture()) },
      courseEnrollment: { findUnique: vi.fn(async () => null) },
    })

    await expect(
      new HomeworkService(prisma, ai).detail('homework-1', 'student-a', 'STUDENT'),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('ученик не может сдать задание курса, на который не записан', async () => {
    const prisma = prismaWith({
      homework: { findUnique: vi.fn(async () => ({ ...homeworkFixture(), course: undefined })) },
      courseEnrollment: { findUnique: vi.fn(async () => null) },
    })

    await expect(
      new HomeworkService(prisma, ai).submit('homework-1', 'student-a', { text: 'Ответ' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('преподаватель не проверяет задание другого наставника', async () => {
    const prisma = prismaWith({
      homework: { findUnique: vi.fn(async () => homeworkFixture()) },
    })

    await expect(
      new HomeworkService(prisma, ai).detail('homework-1', 'teacher-a', 'TEACHER'),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('тесты и экзамены: публикация и запись на курс', () => {
  it('ученик не видит неопубликованный тест', async () => {
    const prisma = prismaWith({
      test: {
        findUnique: vi.fn(async () => ({
          id: 'test-1',
          courseId: 'course-1',
          isPublished: false,
          course: { id: 'course-1', title: 'Курс' },
          questions: [],
          gradingScale: null,
        })),
      },
    })

    await expect(new TestingService(prisma).detail('test-1', 'student-a', 'STUDENT')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('ученик без записи не видит опубликованный тест', async () => {
    const prisma = prismaWith({
      test: {
        findUnique: vi.fn(async () => ({
          id: 'test-1',
          courseId: 'course-1',
          isPublished: true,
          course: { id: 'course-1', title: 'Курс' },
          questions: [],
          gradingScale: null,
        })),
      },
      courseEnrollment: { findUnique: vi.fn(async () => null) },
    })

    await expect(new TestingService(prisma).detail('test-1', 'student-a', 'STUDENT')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('ученик без записи не получает экзамен курса', async () => {
    const prisma = prismaWith({
      exam: {
        findUnique: vi.fn(async () => ({
          id: 'exam-1',
          isPublished: true,
          courseId: 'course-1',
          createdById: 'teacher-b',
          course: { id: 'course-1', title: 'Курс', teacherId: 'teacher-b' },
          test: { questions: [] },
          registrations: [],
          attempts: [],
          gradingScale: null,
        })),
      },
      courseEnrollment: { findUnique: vi.fn(async () => null) },
    })

    await expect(
      new ExamService(prisma, testingStub).detail('exam-1', 'student-a', 'STUDENT'),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('ученик не видит неопубликованный экзамен', async () => {
    const prisma = prismaWith({
      exam: {
        findUnique: vi.fn(async () => ({
          id: 'exam-1',
          isPublished: false,
          courseId: 'course-1',
          createdById: 'teacher-b',
          course: { id: 'course-1', title: 'Курс', teacherId: 'teacher-b' },
          test: { questions: [] },
          registrations: [],
          attempts: [],
          gradingScale: null,
        })),
      },
    })

    await expect(
      new ExamService(prisma, testingStub).detail('exam-1', 'student-a', 'STUDENT'),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('IT Coins и магазин', () => {
  const product = {
    id: 'product-1',
    title: 'Награда',
    description: 'Описание',
    priceCoins: 100,
    stock: 2,
    unlimitedStock: false,
    isActive: true,
    fulfillment: 'MANUAL',
    deliveryUrl: null,
  }

  it('администратор не оформляет покупку как ученик', async () => {
    const prisma = prismaWith({})
    await expect(
      new EconomyService(prisma).createOrder('admin-1', 'ADMIN', { productId: 'product-1' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('покупка при недостатке IT Coins отклоняется', async () => {
    const prisma = prismaWith({
      shopProduct: { findFirst: vi.fn(async () => product) },
      coinBalance: { findUnique: vi.fn(async () => ({ balance: 40 })) },
    })

    await expect(
      new EconomyService(prisma).createOrder('student-a', 'STUDENT', { productId: 'product-1' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('закончившийся товар не продаётся даже при достаточном балансе', async () => {
    const prisma = prismaWith({
      shopProduct: { findFirst: vi.fn(async () => ({ ...product, stock: 0 })) },
    })

    await expect(
      new EconomyService(prisma).createOrder('student-a', 'STUDENT', { productId: 'product-1' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('ученик видит только свои заказы, администратор — все', async () => {
    const findMany = vi.fn(async () => [])
    const prisma = prismaWith({
      shopOrder: { findMany, count: vi.fn(async () => 0) },
    })
    const service = new EconomyService(prisma)

    await service.orders('student-a', 'STUDENT', {})
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'student-a' }) }),
    )

    await service.orders('admin-1', 'ADMIN', {})
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ userId: expect.anything() }) }),
    )
  })
})
