import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { z } from 'zod'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { awardCoins, homeworkCoinReward } from '../../lib/coins.js'
import { notifyUsers } from '../../lib/notify.js'
import { evaluateAchievements } from '../../modules/achievements/evaluate.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'

/** Фильтры очереди проверки. PENDING — работы, ожидающие оценки. */
export const submissionQuerySchema = z.object({
  status: z.enum(['PENDING', 'REVIEWED', 'RETURNED', 'ALL']).default('PENDING'),
  courseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
})

export const reviewSchema = z
  .object({
    score: z.number().int().min(0).max(1000),
    comment: z.string().trim().max(4000).optional(),
    returnForRevision: z.boolean().default(false),
  })
  .strict()
  .refine((data) => !data.returnForRevision || Boolean(data.comment?.trim()), {
    message: 'Опишите, что нужно исправить',
    path: ['comment'],
  })

export type SubmissionQuery = z.infer<typeof submissionQuerySchema>
export type ReviewInput = z.infer<typeof reviewSchema>

/** Задание: дедлайн, максимальный балл и правила повторной сдачи. */
export const homeworkCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(5000),
    dueAt: z.string().datetime(),
    maxScore: z.number().int().min(1).max(1000).default(10),
    maxAttempts: z.number().int().min(1).max(10).default(2),
    allowResubmit: z.boolean().default(false),
    lessonId: z.string().uuid().optional(),
  })
  .strict()

/** Отдельная схема без default: частичное обновление не должно сбрасывать поля. */
export const homeworkUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(3).max(5000).optional(),
    dueAt: z.string().datetime().optional(),
    maxScore: z.number().int().min(1).max(1000).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    allowResubmit: z.boolean().optional(),
    lessonId: z.string().uuid().optional(),
  })
  .strict()

export type HomeworkCreateInput = z.infer<typeof homeworkCreateSchema>
export type HomeworkUpdateInput = z.infer<typeof homeworkUpdateSchema>

const select = {
  id: true,
  title: true,
  description: true,
  coverUrl: true,
  level: true,
  status: true,
  createdAt: true,
  category: { select: { id: true, slug: true, title: true, icon: true } },
} satisfies Prisma.CourseSelect

/** Карточка задания для редактора: поля формы и число работ на проверке. */
const homeworkCardSelect = {
  id: true,
  title: true,
  description: true,
  dueAt: true,
  maxScore: true,
  allowResubmit: true,
  lessonId: true,
  createdAt: true,
  lesson: { select: { id: true, title: true } },
  _count: { select: { submissions: { where: { status: 'SUBMITTED' } } } },
} satisfies Prisma.HomeworkSelect

/**
 * Кабинет преподавателя.
 *
 * Доступ к курсам, модулям, урокам и работам проверяется по `teacherId`
 * на сервере: преподаватель видит и меняет только свои материалы, администратор — все.
 */
@Injectable()
export class TeacherService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private assertStaff(role: RoleName): void {
    if (role !== 'TEACHER' && role !== 'ADMIN') throw forbidden('Раздел доступен преподавателю')
  }

  /** Курсы преподавателя с наполнением, учениками и очередью проверки. */
  async myCourses(userId: string, role: RoleName) {
    this.assertStaff(role)

    const courses = await this.prisma.client.course.findMany({
      where: role === 'ADMIN' ? {} : { teacherId: userId },
      select: {
        ...select,
        modules: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            _count: { select: { lessons: true } },
            lessons: { select: { durationMinutes: true, publishedAt: true } },
          },
        },
        enrollments: { select: { progress: true } },
        homework: {
          select: {
            _count: { select: { submissions: { where: { status: 'SUBMITTED' } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return {
      items: courses.map((course) => this.toCourseCard(course)),
    }
  }

  /** Полная программа курса для редактора: модули, уроки и счётчики. */
  async courseDetail(courseId: string, userId: string, role: RoleName) {
    this.assertStaff(role)

    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: {
        ...select,
        teacher: { select: { id: true, firstName: true, lastName: true } },
        modules: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            title: true,
            description: true,
            position: true,
            lessons: {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                title: true,
                description: true,
                durationMinutes: true,
                position: true,
                publishedAt: true,
                videoUrl: true,
                _count: { select: { materials: true } },
              },
            },
          },
        },
        enrollments: { select: { progress: true } },
        homework: {
          select: {
            id: true,
            title: true,
            description: true,
            dueAt: true,
            maxScore: true,
            allowResubmit: true,
            lessonId: true,
            createdAt: true,
            lesson: { select: { id: true, title: true } },
            _count: { select: { submissions: { where: { status: 'SUBMITTED' } } } },
          },
          orderBy: { dueAt: 'asc' },
        },
      },
    })

    if (!course) throw notFound('Курс не найден')
    if (role === 'TEACHER' && course.teacher.id !== userId) throw forbidden('Курс принадлежит другому преподавателю')

    const lessons = course.modules.flatMap((module) => module.lessons)
    const enrolled = course.enrollments.length

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      coverUrl: course.coverUrl,
      level: course.level,
      status: course.status,
      createdAt: course.createdAt,
      category: course.category,
      teacher: { id: course.teacher.id, name: `${course.teacher.firstName} ${course.teacher.lastName}`.trim() },
      studentsCount: enrolled,
      avgProgress: enrolled === 0 ? 0 : Math.round(course.enrollments.reduce((sum, item) => sum + item.progress, 0) / enrolled),
      lessonsCount: lessons.length,
      publishedLessonsCount: lessons.filter((lesson) => lesson.publishedAt !== null).length,
      durationMinutes: lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
      pendingReviews: course.homework.reduce((sum, item) => sum + item._count.submissions, 0),
      modules: course.modules.map((module) => ({
        id: module.id,
        title: module.title,
        description: module.description,
        position: module.position,
        lessonsCount: module.lessons.length,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          durationMinutes: lesson.durationMinutes,
          position: lesson.position,
          publishedAt: lesson.publishedAt,
          videoUrl: lesson.videoUrl,
          materialsCount: lesson._count.materials,
        })),
      })),
      homework: course.homework.map((item) => this.toHomeworkCard(item)),
    }
  }

  /** Данные главного экрана: счётчики, ближайшее занятие, последние работы. */
  async overview(userId: string, role: RoleName) {
    this.assertStaff(role)

    const courseWhere = role === 'ADMIN' ? {} : { teacherId: userId }

    const [courses, pendingReviews, enrollments, nextClass, recentSubmissions] = await Promise.all([
      this.myCourses(userId, role),
      this.prisma.client.homeworkSubmission.count({
        where: { status: 'SUBMITTED', homework: { course: courseWhere } },
      }),
      this.prisma.client.courseEnrollment.findMany({
        where: { course: courseWhere },
        select: { studentId: true, progress: true },
      }),
      this.prisma.client.schedule.findFirst({
        where: { ...(role === 'ADMIN' ? {} : { teacherId: userId }), endsAt: { gt: new Date() } },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          status: true,
          timezone: true,
          course: { select: { id: true, title: true } },
        },
      }),
      this.prisma.client.homeworkSubmission.findMany({
        where: { homework: { course: courseWhere } },
        orderBy: { submittedAt: 'desc' },
        take: 4,
        select: {
          id: true,
          status: true,
          attempt: true,
          submittedAt: true,
          score: true,
          student: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          homework: { select: { id: true, title: true, maxScore: true, course: { select: { id: true, title: true } } } },
        },
      }),
    ])

    const students = new Set(enrollments.map((item) => item.studentId))

    return {
      stats: {
        courses: courses.items.length,
        students: students.size,
        pendingReviews,
        avgProgress:
          enrollments.length === 0
            ? 0
            : Math.round(enrollments.reduce((sum, item) => sum + item.progress, 0) / enrollments.length),
      },
      nextClass,
      courses: courses.items.slice(0, 4),
      recentSubmissions: recentSubmissions.map((item) => ({
        id: item.id,
        status: item.status,
        attempt: item.attempt,
        submittedAt: item.submittedAt,
        score: item.score,
        student: {
          id: item.student.id,
          name: `${item.student.firstName} ${item.student.lastName}`.trim(),
          avatarUrl: item.student.avatarUrl,
        },
        homework: item.homework,
      })),
    }
  }

  /** Очередь работ на проверку. */
  async submissions(userId: string, role: RoleName, query: SubmissionQuery) {
    this.assertStaff(role)

    const where: Prisma.HomeworkSubmissionWhereInput = {
      homework: {
        course: role === 'ADMIN' ? {} : { teacherId: userId },
        ...(query.courseId ? { courseId: query.courseId } : {}),
      },
      ...(query.status === 'PENDING' ? { status: 'SUBMITTED' } : query.status === 'ALL' ? {} : { status: query.status }),
    }

    const items = await this.prisma.client.homeworkSubmission.findMany({
      where,
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
      skip: query.offset,
      take: query.limit,
      select: {
        id: true,
        status: true,
        attempt: true,
        submittedAt: true,
        reviewedAt: true,
        score: true,
        text: true,
        projectUrl: true,
        files: true,
        student: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
        homework: {
          select: {
            id: true,
            title: true,
            maxScore: true,
            dueAt: true,
            course: { select: { id: true, title: true } },
          },
        },
        review: { select: { score: true, comment: true, returnForRevision: true, createdAt: true } },
      },
    })

    return {
      items: items.map((item) => this.toSubmissionCard(item)),
      total: await this.prisma.client.homeworkSubmission.count({ where }),
      limit: query.limit,
      offset: query.offset,
    }
  }

  async submissionDetail(id: string, userId: string, role: RoleName) {
    this.assertStaff(role)

    const submission = await this.prisma.client.homeworkSubmission.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        attempt: true,
        submittedAt: true,
        reviewedAt: true,
        score: true,
        text: true,
        projectUrl: true,
        files: true,
        student: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
        homework: {
          select: {
            id: true,
            title: true,
            description: true,
            maxScore: true,
            dueAt: true,
            allowResubmit: true,
            teacherId: true,
            course: { select: { id: true, title: true } },
          },
        },
        review: {
          select: {
            id: true,
            score: true,
            comment: true,
            returnForRevision: true,
            createdAt: true,
            reviewer: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    })

    if (!submission) throw notFound('Работа не найдена')
    if (role === 'TEACHER' && submission.homework.teacherId !== userId) {
      throw forbidden('Работа относится к курсу другого преподавателя')
    }

    return {
      ...this.toSubmissionCard(submission),
      homework: {
        id: submission.homework.id,
        title: submission.homework.title,
        description: submission.homework.description,
        maxScore: submission.homework.maxScore,
        dueAt: submission.homework.dueAt,
        allowResubmit: submission.homework.allowResubmit,
        course: submission.homework.course,
      },
      review: submission.review
        ? {
            score: submission.review.score,
            comment: submission.review.comment,
            returnForRevision: submission.review.returnForRevision,
            createdAt: submission.review.createdAt,
            reviewer: `${submission.review.reviewer.firstName} ${submission.review.reviewer.lastName}`.trim(),
          }
        : null,
    }
  }

  /** Создание задания в своём курсе; записанные ученики получают уведомление. */
  async createHomework(courseId: string, input: HomeworkCreateInput, userId: string, role: RoleName) {
    this.assertStaff(role)

    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, teacherId: true },
    })
    if (!course) throw notFound('Курс не найден')
    if (role === 'TEACHER' && course.teacherId !== userId) {
      throw forbidden('Курс принадлежит другому преподавателю')
    }
    await this.assertLessonInCourse(input.lessonId, courseId)
    if (new Date(input.dueAt).getTime() < Date.now()) throw badRequest('Срок задания должен быть в будущем')

    const homework = await this.prisma.client.homework.create({
      data: {
        courseId,
        teacherId: userId,
        title: input.title,
        description: input.description,
        dueAt: new Date(input.dueAt),
        maxScore: input.maxScore,
        maxAttempts: input.maxAttempts,
        allowResubmit: input.allowResubmit,
        lessonId: input.lessonId ?? null,
      },
      select: homeworkCardSelect,
    })

    const students = await this.prisma.client.courseEnrollment.findMany({
      where: { courseId, status: 'ACTIVE' },
      select: { studentId: true },
    })
    if (students.length > 0) {
      await notifyUsers(students.map((item) => item.studentId), {
        type: 'HOMEWORK_ASSIGNED',
        title: 'Новое домашнее задание',
        body: `${course.title}: ${homework.title}`,
        data: { homeworkId: homework.id, courseId },
      })
    }

    await writeAudit({
      actorId: userId,
      action: 'homework.created',
      entity: 'homework',
      entityId: homework.id,
      metadata: { courseId, dueAt: input.dueAt, maxScore: input.maxScore },
    })
    await this.prisma.client.assessmentEvent
      .create({
        data: {
          entityType: 'HOMEWORK',
          entityId: homework.id,
          actorId: userId,
          type: 'CREATED',
          message: `Задание создано: ${homework.title}`,
          data: { courseId, dueAt: input.dueAt, maxScore: input.maxScore, allowResubmit: input.allowResubmit },
        },
      })
      .catch((error) => console.warn('[homework] событие создания не записано', error))

    return this.toHomeworkCard(homework)
  }

  /** Задание для редактора: поля формы и принадлежность курсу. */
  async homeworkDetail(id: string, userId: string, role: RoleName) {
    this.assertStaff(role)

    const homework = await this.prisma.client.homework.findUnique({
      where: { id },
      select: {
        ...homeworkCardSelect,
        course: { select: { id: true, title: true, teacherId: true } },
      },
    })
    if (!homework) throw notFound('Задание не найдено')
    if (role === 'TEACHER' && homework.course.teacherId !== userId) {
      throw forbidden('Задание относится к курсу другого преподавателя')
    }

    return {
      ...this.toHomeworkCard(homework),
      course: { id: homework.course.id, title: homework.course.title },
    }
  }

  /** Редактирование дедлайна, балла и правил повторной сдачи. */
  async updateHomework(id: string, input: HomeworkUpdateInput, userId: string, role: RoleName) {
    this.assertStaff(role)

    const homework = await this.prisma.client.homework.findUnique({
      where: { id },
      select: { id: true, courseId: true, course: { select: { teacherId: true } } },
    })
    if (!homework) throw notFound('Задание не найдено')
    if (role === 'TEACHER' && homework.course.teacherId !== userId) {
      throw forbidden('Задание относится к курсу другого преподавателя')
    }
    if (input.lessonId !== undefined) await this.assertLessonInCourse(input.lessonId, homework.courseId)

    // Нельзя опустить максимум ниже уже выставленного балла: оценки станут несогласованными.
    if (input.maxScore !== undefined) {
      const awarded = await this.prisma.client.homeworkSubmission.aggregate({
        where: { homeworkId: id, score: { not: null } },
        _max: { score: true },
      })
      if (awarded._max.score !== null && input.maxScore < awarded._max.score) {
        throw badRequest(`Максимальный балл не может быть ниже уже выставленного (${awarded._max.score})`)
      }
    }

    const updated = await this.prisma.client.homework.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
        ...(input.maxScore !== undefined ? { maxScore: input.maxScore } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.allowResubmit !== undefined ? { allowResubmit: input.allowResubmit } : {}),
        ...(input.lessonId !== undefined ? { lessonId: input.lessonId } : {}),
      },
      select: homeworkCardSelect,
    })

    await writeAudit({
      actorId: userId,
      action: 'homework.updated',
      entity: 'homework',
      entityId: id,
      metadata: { courseId: homework.courseId, changed: Object.keys(input) },
    })
    await this.prisma.client.assessmentEvent
      .create({
        data: {
          entityType: 'HOMEWORK',
          entityId: id,
          actorId: userId,
          type: 'UPDATED',
          message: `Изменены: ${Object.keys(input).join(', ') || 'настройки'}`,
          data: { changed: Object.keys(input) },
        },
      })
      .catch((error) => console.warn('[homework] событие обновления не записано', error))

    return this.toHomeworkCard(updated)
  }

  /** Урок можно привязать к заданию только в рамках курса задания. */
  private async assertLessonInCourse(lessonId: string | undefined, courseId: string): Promise<void> {
    if (!lessonId) return
    const lesson = await this.prisma.client.lesson.findFirst({
      where: { id: lessonId, module: { courseId } },
      select: { id: true },
    })
    if (!lesson) throw badRequest('Урок не относится к этому курсу')
  }

  /**
   * Оценка работы: фиксирует балл и комментарий, уведомляет ученика.
   * Повторная проверка обновляет существующий отзыв, а не создаёт второй.
   */
  async reviewSubmission(id: string, input: ReviewInput, reviewerId: string, role: RoleName) {
    this.assertStaff(role)

    const submission = await this.prisma.client.homeworkSubmission.findUnique({
      where: { id },
      select: {
        id: true,
        studentId: true,
        status: true,
        submittedAt: true,
        homework: {
          select: {
            id: true,
            title: true,
            maxScore: true,
            dueAt: true,
            latePenalty: true,
            teacherId: true,
            allowResubmit: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
    })
    if (!submission) throw notFound('Работа не найдена')
    if (role === 'TEACHER' && submission.homework.teacherId !== reviewerId) {
      throw forbidden('Работа относится к курсу другого преподавателя')
    }
    if (input.score > submission.homework.maxScore) {
      throw badRequest(`Максимальный балл за это задание — ${submission.homework.maxScore}`)
    }
    if (input.returnForRevision && !input.comment?.trim()) {
      throw badRequest('Опишите, что нужно исправить')
    }

    const late = new Date(submission.submittedAt).getTime() > submission.homework.dueAt.getTime()
    const penalty = late ? submission.homework.latePenalty : 0
    const finalScore = Math.max(0, Math.round(input.score * (1 - penalty / 100)))
    const status = input.returnForRevision ? 'RETURNED' : 'REVIEWED'

    // Оценка и отзыв сохраняются одной транзакцией; уведомление уходит после коммита.
    const [, review] = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.homeworkSubmission.update({
        where: { id },
        data: { status, score: finalScore, reviewedAt: new Date(), reviewerId },
      })
      const savedReview = await tx.homeworkReview.upsert({
        where: { submissionId: id },
        create: {
          submissionId: id,
          reviewerId,
          score: finalScore,
          comment: input.comment ?? null,
          returnForRevision: input.returnForRevision,
        },
        update: {
          reviewerId,
          score: finalScore,
          comment: input.comment ?? null,
          returnForRevision: input.returnForRevision,
        },
        select: { id: true, score: true, comment: true, returnForRevision: true, createdAt: true },
      })

      if (status === 'REVIEWED') {
        await awardCoins(tx, {
          userId: submission.studentId,
          amount: homeworkCoinReward(finalScore, submission.homework.maxScore),
          reason: `Домашняя работа: ${submission.homework.title}`,
          sourceType: 'HOMEWORK',
          sourceId: submission.homework.id,
          awardedById: reviewerId,
        })
      }

      return [updated, savedReview] as const
    })

    await notifyUsers([submission.studentId], {
      type: input.returnForRevision ? 'HOMEWORK_REVIEWED' : 'GRADE_RECEIVED',
      title: input.returnForRevision ? 'Работа возвращена на доработку' : 'Работа проверена',
      body: input.returnForRevision
        ? `${submission.homework.title}: ${input.comment ?? 'Исправьте замечания преподавателя и отправьте снова.'}`
        : `${submission.homework.title}: ${finalScore} из ${submission.homework.maxScore}` +
          (penalty ? ` (штраф за просрочку ${penalty}%)` : ''),
      data: {
        submissionId: id,
        homeworkId: submission.homework.id,
        courseId: submission.homework.course.id,
        courseTitle: submission.homework.course.title,
      },
    })

    await writeAudit({
      actorId: reviewerId,
      action: input.returnForRevision ? 'homework.returned' : 'homework.reviewed',
      entity: 'homework_submission',
      entityId: id,
      metadata: { score: finalScore, rawScore: input.score, penalty, homeworkId: submission.homework.id },
    })

    await this.prisma.client.assessmentEvent
      .create({
        data: {
          entityType: 'HOMEWORK',
          entityId: submission.homework.id,
          actorId: reviewerId,
          type: input.returnForRevision ? 'RETURNED' : 'REVIEWED',
          message: input.comment ?? null,
          data: { submissionId: id, score: finalScore, rawScore: input.score, penalty, late },
        },
      })
      .catch((error) => console.warn('[homework] событие проверки не записано', error))

    // Проверенная работа может закрыть достижение «Первое домашнее задание».
    if (!input.returnForRevision) {
      await evaluateAchievements(submission.studentId).catch((error) => {
        console.warn('[achievements]', error)
      })
    }
    // Наставник получает собственные достижения за проверку работ.
    if (role === 'TEACHER') {
      await evaluateAchievements(reviewerId).catch((error) => {
        console.warn('[achievements]', error)
      })
    }

    return {
      id,
      status,
      score: finalScore,
      rawScore: input.score,
      penalty,
      late,
      review,
    }
  }

  private toHomeworkCard(item: {
    id: string
    title: string
    description: string
    dueAt: Date
    maxScore: number
    allowResubmit: boolean
    lessonId: string | null
    createdAt: Date
    lesson: { id: string; title: string } | null
    _count: { submissions: number }
  }) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      dueAt: item.dueAt,
      maxScore: item.maxScore,
      allowResubmit: item.allowResubmit,
      lessonId: item.lessonId,
      lesson: item.lesson,
      createdAt: item.createdAt,
      pendingSubmissions: item._count.submissions,
    }
  }

  private toCourseCard(course: {
    id: string
    title: string
    description: string
    coverUrl: string | null
    level: string
    status: string
    createdAt: Date
    category: { id: string; slug: string; title: string; icon: string | null } | null
    modules: Array<{ id: string; _count: { lessons: number }; lessons: Array<{ durationMinutes: number; publishedAt: Date | null }> }>
    enrollments: Array<{ progress: number }>
    homework: Array<{ _count: { submissions: number } }>
  }) {
    const lessons = course.modules.flatMap((module) => module.lessons)
    const students = course.enrollments.length

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      coverUrl: course.coverUrl,
      level: course.level,
      status: course.status,
      createdAt: course.createdAt,
      category: course.category,
      modulesCount: course.modules.length,
      lessonsCount: lessons.length,
      publishedLessonsCount: lessons.filter((lesson) => lesson.publishedAt !== null).length,
      durationMinutes: lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
      studentsCount: students,
      avgProgress:
        students === 0 ? 0 : Math.round(course.enrollments.reduce((sum, item) => sum + item.progress, 0) / students),
      pendingReviews: course.homework.reduce((sum, item) => sum + item._count.submissions, 0),
    }
  }

  private toSubmissionCard(item: {
    id: string
    status: string
    attempt: number
    submittedAt: Date
    reviewedAt: Date | null
    score: number | null
    text: string | null
    projectUrl: string | null
    files: Prisma.JsonValue
    student: { id: string; firstName: string; lastName: string; avatarUrl: string | null; email: string }
    homework: { id: string; title: string; maxScore: number; dueAt: Date; course: { id: string; title: string } }
    review: { score: number; comment: string | null; returnForRevision: boolean; createdAt: Date } | null
  }) {
    return {
      id: item.id,
      status: item.status,
      attempt: item.attempt,
      submittedAt: item.submittedAt,
      reviewedAt: item.reviewedAt,
      score: item.score,
      text: item.text,
      projectUrl: item.projectUrl,
      files: item.files,
      student: {
        id: item.student.id,
        firstName: item.student.firstName,
        lastName: item.student.lastName,
        name: `${item.student.firstName} ${item.student.lastName}`.trim(),
        avatarUrl: item.student.avatarUrl,
        email: item.student.email,
      },
      homework: item.homework,
      review: item.review,
    }
  }
}
