import { Inject, Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { Prisma, type RoleName } from '@prisma/client'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { notifyUsers } from '../../lib/notify.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import type { z } from 'zod'
import type {
  blockSchema,
  courseCreateSchema,
  courseUpdateSchema,
  lessonCreateSchema,
  materialCreateSchema,
} from '../../modules/lms/lms.schemas.js'

type CourseCreateInput = z.infer<typeof courseCreateSchema>
type CourseUpdateInput = z.infer<typeof courseUpdateSchema>
type LessonCreateInput = z.infer<typeof lessonCreateSchema>
type MaterialCreateInput = z.infer<typeof materialCreateSchema>
type Block = z.infer<typeof blockSchema>

interface CourseSnapshot {
  title: string
  description: string
  coverUrl: string | null
  level: string
  modules: Array<{
    /** id появился в новых снимках; старые версии восстанавливаются по позиции. */
    id?: string
    title: string
    description: string | null
    position: number
    lessons: Array<{
      id?: string
      title: string
      description: string | null
      content: string | null
      videoUrl: string | null
      blocks: unknown
      durationMinutes: number
      position: number
      materials: Array<{
        id?: string
        type: string
        title: string
        url: string
        mimeType: string | null
        sizeBytes: number | null
        allowDownload?: boolean
      }>
    }>
  }>
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${base || 'course'}-${randomBytes(3).toString('hex')}`
}

/**
 * LMS: конструктор уроков, копирование, версии, согласование публикации,
 * ученическая работа с материалами и библиотека.
 *
 * Курсы создают администратор, менеджер и наставник. Наставник управляет только
 * своими курсами; администратор и менеджер — всеми курсами филиала.
 */
@Injectable()
export class LmsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private isManager(role: RoleName): boolean {
    return role === 'ADMIN' || role === 'MANAGER'
  }

  /**
   * Наставник создаёт курс только для себя. Администратор и менеджер обязаны
   * выбрать действующего наставника, а не записывать курс на случайного пользователя.
   */
  private async resolveTeacher(teacherId: string | undefined, userId: string, role: RoleName): Promise<string> {
    if (role === 'TEACHER') {
      if (teacherId && teacherId !== userId) throw forbidden('Наставник может создать курс только для себя')
      return userId
    }
    if (!teacherId) throw badRequest('Выберите наставника курса')
    const teacher = await this.prisma.client.user.findUnique({
      where: { id: teacherId },
      select: { role: true, isActive: true, deletedAt: true },
    })
    if (!teacher || teacher.deletedAt || !teacher.isActive || (teacher.role !== 'TEACHER' && teacher.role !== 'ADMIN')) {
      throw badRequest('Выбранный пользователь не может быть наставником курса')
    }
    return teacherId
  }

  /**
   * Любое изменение уже одобренного курса требует повторной проверки: курс
   * возвращается в черновик и перестаёт выдаваться ученикам до нового одобрения.
   */
  private async invalidateApproval(courseId: string): Promise<void> {
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { approvalStatus: true, status: true },
    })
    if (!course || (course.approvalStatus !== 'APPROVED' && course.status !== 'ACTIVE')) return
    await this.prisma.client.course.update({
      where: { id: courseId },
      data: {
        approvalStatus: 'DRAFT',
        status: 'DRAFT',
        submittedAt: null,
        approvedAt: null,
        approvedById: null,
        rejectionReason: null,
      },
    })
  }

  private async courseForManage(courseId: string, userId: string, role: RoleName) {
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { id: true, teacherId: true, authorId: true, title: true, approvalStatus: true, status: true, version: true },
    })
    if (!course) throw notFound('Курс не найден')
    if (!this.isManager(role) && role !== 'TEACHER') throw forbidden('Управлять курсами может администратор, менеджер или наставник')
    if (role === 'TEACHER' && course.teacherId !== userId && course.authorId !== userId) {
      throw forbidden('Курс принадлежит другому наставнику')
    }
    return course
  }

  // ---------- курсы ----------

  async listCourses(userId: string, role: RoleName) {
    const where: Prisma.CourseWhereInput =
      role === 'TEACHER' ? { OR: [{ teacherId: userId }, { authorId: userId }] } : {}

    const courses = await this.prisma.client.course.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        approvalStatus: true,
        coverUrl: true,
        createdAt: true,
        updatedAt: true,
        submittedAt: true,
        rejectionReason: true,
        teacher: { select: { id: true, firstName: true, lastName: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { modules: true, enrollments: true } },
        modules: { select: { _count: { select: { lessons: true } } } },
      },
    })

    return {
      items: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        status: course.status,
        approvalStatus: course.approvalStatus,
        coverUrl: course.coverUrl,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        submittedAt: course.submittedAt,
        rejectionReason: course.rejectionReason,
        teacher: `${course.teacher.firstName} ${course.teacher.lastName}`,
        author: course.author ? `${course.author.firstName} ${course.author.lastName}` : null,
        modules: course._count.modules,
        lessons: course.modules.reduce((sum, module) => sum + module._count.lessons, 0),
        students: course._count.enrollments,
      })),
    }
  }

  async createCourse(input: CourseCreateInput, userId: string, role: RoleName) {
    if (!this.isManager(role) && role !== 'TEACHER') {
      throw forbidden('Создавать курсы может администратор, менеджер или наставник')
    }

    const teacherId = await this.resolveTeacher(input.teacherId, userId, role)

    const course = await this.prisma.client.course.create({
      data: {
        title: input.title,
        description: input.description,
        coverUrl: input.coverUrl ?? null,
        level: input.level,
        slug: slugify(input.title),
        status: 'DRAFT',
        approvalStatus: 'DRAFT',
        teacherId,
        authorId: userId,
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      },
      select: { id: true, title: true, slug: true, approvalStatus: true },
    })
    await writeAudit({ actorId: userId, action: 'lms.course.create', entity: 'Course', entityId: course.id })
    return course
  }

  async updateCourse(courseId: string, input: CourseUpdateInput, userId: string, role: RoleName) {
    await this.courseForManage(courseId, userId, role)
    const current = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { title: true, description: true, coverUrl: true, level: true, categoryId: true },
    })
    if (!current) throw notFound('Курс не найден')
    if (input.teacherId) {
      if (role === 'TEACHER') {
        if (input.teacherId !== userId) throw forbidden('Наставник не может передать свой курс другому сотруднику')
      } else {
        const teacher = await this.prisma.client.user.findUnique({
          where: { id: input.teacherId },
          select: { role: true, isActive: true, deletedAt: true },
        })
        if (!teacher || teacher.deletedAt || !teacher.isActive || (teacher.role !== 'TEACHER' && teacher.role !== 'ADMIN')) {
          throw badRequest('Выбранный пользователь не может быть наставником курса')
        }
      }
    }

    const updated = await this.prisma.client.course.update({
      where: { id: courseId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
        ...(input.level !== undefined ? { level: input.level } : {}),
        ...(input.teacherId !== undefined ? { teacherId: input.teacherId } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      },
      select: { id: true, title: true, approvalStatus: true, teacherId: true },
    })
    const contentChanged =
      (input.title !== undefined && input.title !== current.title) ||
      (input.description !== undefined && input.description !== current.description) ||
      (input.coverUrl !== undefined && input.coverUrl !== current.coverUrl) ||
      (input.level !== undefined && input.level !== current.level) ||
      (input.categoryId !== undefined && input.categoryId !== current.categoryId)
    if (contentChanged) await this.invalidateApproval(courseId)
    return updated
  }

  async submitForReview(courseId: string, userId: string, role: RoleName) {
    const course = await this.courseForManage(courseId, userId, role)
    if (course.approvalStatus === 'PENDING_REVIEW') throw badRequest('Курс уже находится на согласовании')
    if (course.approvalStatus === 'APPROVED' || course.status === 'ACTIVE') {
      throw badRequest('Курс уже опубликован. Измените содержание или настройки, чтобы отправить новую версию на согласование')
    }

    const lessons = await this.prisma.client.lesson.count({ where: { module: { courseId } } })
    if (lessons === 0) throw badRequest('Добавьте хотя бы один урок, прежде чем отправлять курс на согласование')

    const updated = await this.prisma.client.course.update({
      where: { id: course.id },
      data: { approvalStatus: 'PENDING_REVIEW', status: 'DRAFT', submittedAt: new Date(), rejectionReason: null },
      select: { id: true, approvalStatus: true, submittedAt: true },
    })

    const admins = await this.prisma.client.user.findMany({
      where: { role: 'ADMIN', isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (admins.length > 0) {
      await notifyUsers(admins.map((admin) => admin.id), {
        type: 'SYSTEM',
        title: 'Курс ждёт согласования',
        body: `Курс «${course.title}» отправлен на проверку администратору.`,
        data: { kind: 'course_review', courseId: course.id },
      })
    }
    await writeAudit({ actorId: userId, action: 'lms.course.submit', entity: 'Course', entityId: course.id })
    return updated
  }

  async reviewCourse(courseId: string, adminId: string, approve: boolean, reason?: string) {
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, authorId: true, approvalStatus: true },
    })
    if (!course) throw notFound('Курс не найден')
    if (course.approvalStatus !== 'PENDING_REVIEW') throw badRequest('Курс не находится на согласовании')

    if (!approve) {
      const rejected = await this.prisma.client.course.update({
        where: { id: courseId },
        data: { approvalStatus: 'REJECTED', status: 'DRAFT', rejectionReason: reason ?? null },
        select: { id: true, approvalStatus: true, rejectionReason: true },
      })
      if (course.authorId) {
        await notifyUsers([course.authorId], {
          type: 'SYSTEM',
          title: 'Курс отклонён',
          body: `Курс «${course.title}» отклонён.${reason ? ` Причина: ${reason}` : ''}`,
          data: { kind: 'course_review', courseId },
        })
      }
      await writeAudit({ actorId: adminId, action: 'lms.course.reject', entity: 'Course', entityId: courseId, metadata: { reason } })
      return rejected
    }

    const publishedAt = new Date()
    const [, lessons] = await this.prisma.client.$transaction([
      this.prisma.client.course.update({
        where: { id: courseId },
        data: {
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedById: adminId,
          status: 'ACTIVE',
          rejectionReason: null,
        },
      }),
      // Все уроки открываются сразу: без постепенного раскрытия по датам.
      this.prisma.client.lesson.updateMany({
        where: { module: { courseId }, publishedAt: null },
        data: { publishedAt },
      }),
    ])

    if (course.authorId) {
      await notifyUsers([course.authorId], {
        type: 'SYSTEM',
        title: 'Курс опубликован',
        body: `Курс «${course.title}» одобрен администратором и опубликован.`,
        data: { kind: 'course_review', courseId },
      })
    }
    const students = await this.prisma.client.courseEnrollment.findMany({
      where: { courseId, status: 'ACTIVE' },
      select: { studentId: true },
    })
    if (students.length > 0) {
      await notifyUsers(students.map((item) => item.studentId), {
        type: 'LESSON_PUBLISHED',
        title: 'Новые уроки на курсе',
        body: `Курс «${course.title}» опубликован: открыто уроков — ${lessons.count}.`,
        data: { kind: 'course_published', courseId },
      })
    }
    await writeAudit({ actorId: adminId, action: 'lms.course.approve', entity: 'Course', entityId: courseId })
    return { id: courseId, approvalStatus: 'APPROVED' as const, publishedLessons: lessons.count }
  }

  /** Полный предпросмотр: доступен автору, наставнику и администратору в любом статусе. */
  async previewCourse(courseId: string, userId: string, role: RoleName) {
    await this.courseForManage(courseId, userId, role)
    return this.structure(courseId)
  }

  private async structure(courseId: string) {
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      include: {
        teacher: { select: { id: true, firstName: true, lastName: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
        category: { select: { id: true, title: true } },
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              orderBy: { position: 'asc' },
              include: {
                materials: { orderBy: { createdAt: 'asc' } },
                homework: { select: { id: true, title: true, dueAt: true } },
                _count: { select: { progress: true } },
              },
            },
          },
        },
        tests: { select: { id: true, title: true, isPublished: true } },
        _count: { select: { enrollments: true } },
      },
    })
    if (!course) throw notFound('Курс не найден')

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      coverUrl: course.coverUrl,
      level: course.level,
      status: course.status,
      approvalStatus: course.approvalStatus,
      rejectionReason: course.rejectionReason,
      submittedAt: course.submittedAt,
      approvedAt: course.approvedAt,
      version: course.version,
      category: course.category,
      teacher: { id: course.teacher.id, name: `${course.teacher.firstName} ${course.teacher.lastName}` },
      author: course.author ? { id: course.author.id, name: `${course.author.firstName} ${course.author.lastName}` } : null,
      students: course._count.enrollments,
      tests: course.tests,
      modules: course.modules.map((module) => ({
        id: module.id,
        title: module.title,
        description: module.description,
        position: module.position,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          durationMinutes: lesson.durationMinutes,
          position: lesson.position,
          publishedAt: lesson.publishedAt,
          version: lesson.version,
          blocks: Array.isArray(lesson.blocks) ? lesson.blocks : [],
          materials: lesson.materials,
          homework: lesson.homework,
          studentsStarted: lesson._count.progress,
        })),
      })),
    }
  }

  async copyCourse(courseId: string, userId: string, role: RoleName) {
    await this.courseForManage(courseId, userId, role)
    const source = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              orderBy: { position: 'asc' },
              include: { materials: true },
            },
          },
        },
        tests: {
          include: {
            questions: {
              orderBy: { position: 'asc' },
              include: { options: { orderBy: { position: 'asc' } } },
            },
          },
        },
        homework: { include: { targets: true } },
      },
    })
    if (!source) throw notFound('Курс не найден')

    const copy = await this.prisma.client.course.create({
      data: {
        title: `${source.title} (копия)`,
        slug: slugify(source.title),
        description: source.description,
        coverUrl: source.coverUrl,
        level: source.level,
        priceKgs: source.priceKgs,
        billing: source.billing,
        installmentsCount: source.installmentsCount,
        recordingEnabled: source.recordingEnabled,
        recordingAuto: source.recordingAuto,
        categoryId: source.categoryId,
        teacherId: source.teacherId,
        authorId: userId,
        status: 'DRAFT',
        approvalStatus: 'DRAFT',
        modules: {
          create: source.modules.map((module) => ({
            title: module.title,
            description: module.description,
            position: module.position,
            lessons: {
              create: module.lessons.map((lesson) => ({
                title: lesson.title,
                description: lesson.description,
                content: lesson.content,
                videoUrl: lesson.videoUrl,
                blocks: lesson.blocks ? (lesson.blocks as Prisma.InputJsonValue) : undefined,
                durationMinutes: lesson.durationMinutes,
                position: lesson.position,
                materials: {
                  create: lesson.materials.map((material) => ({
                    type: material.type,
                    title: material.title,
                    url: material.url,
                    mimeType: material.mimeType,
                    sizeBytes: material.sizeBytes,
                    allowDownload: material.allowDownload,
                  })),
                },
              })),
            },
          })),
        },
      },
      select: { id: true, title: true, approvalStatus: true },
    })

    const created = await this.prisma.client.course.findUnique({
      where: { id: copy.id },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: { lessons: { orderBy: { position: 'asc' } } },
        },
      },
    })
    if (!created) throw notFound('Не удалось прочитать созданную копию')

    const oldLessonToNew = new Map<string, string>()
    for (const module of source.modules) {
      const newModule = created.modules.find((item) => item.position === module.position)
      if (!newModule) continue
      for (const lesson of module.lessons) {
        const newLesson = newModule.lessons.find((item) => item.position === lesson.position)
        if (newLesson) oldLessonToNew.set(lesson.id, newLesson.id)
      }
    }

    // Тесты и задания — часть программы курса. Копируем их вместе с вопросами,
    // сохраняя привязку через карту старых и новых уроков.
    const testIdMap = new Map<string, string>()
    for (const test of source.tests) {
      const cloned = await this.prisma.client.test.create({
        data: {
          courseId: copy.id,
          lessonId: test.lessonId ? oldLessonToNew.get(test.lessonId) ?? null : null,
          teacherId: test.teacherId ?? source.teacherId,
          title: test.title,
          description: test.description,
          timeLimitMinutes: test.timeLimitMinutes,
          questionTimeLimitSeconds: test.questionTimeLimitSeconds,
          passingScore: test.passingScore,
          attemptsAllowed: test.attemptsAllowed,
          shuffleQuestions: test.shuffleQuestions,
          shuffleOptions: test.shuffleOptions,
          showExplanations: test.showExplanations,
          showCorrectAnswers: test.showCorrectAnswers,
          gradingScaleId: test.gradingScaleId,
          isPublished: test.isPublished,
          questions: {
            create: test.questions.map((question) => ({
              type: question.type,
              prompt: question.prompt,
              points: question.points,
              position: question.position,
              ...(question.matchPairs !== null
                ? { matchPairs: question.matchPairs as Prisma.InputJsonValue }
                : {}),
              correctNumber: question.correctNumber,
              correctBoolean: question.correctBoolean,
              correctText: question.correctText,
              explanation: question.explanation,
              topic: question.topic,
              timeLimitSeconds: question.timeLimitSeconds,
              options: {
                create: question.options.map((option) => ({
                  text: option.text,
                  isCorrect: option.isCorrect,
                  position: option.position,
                })),
              },
            })),
          },
        },
        select: { id: true },
      })
      testIdMap.set(test.id, cloned.id)
    }

    const homeworkIdMap = new Map<string, string>()
    for (const item of source.homework) {
      const cloned = await this.prisma.client.homework.create({
        data: {
          courseId: copy.id,
          lessonId: item.lessonId ? oldLessonToNew.get(item.lessonId) ?? null : null,
          teacherId: item.teacherId,
          title: item.title,
          description: item.description,
          dueAt: item.dueAt,
          maxScore: item.maxScore,
          allowResubmit: item.allowResubmit,
          materials: item.materials === null ? undefined : (item.materials as Prisma.InputJsonValue),
          criteria: item.criteria === null ? undefined : (item.criteria as Prisma.InputJsonValue),
          maxAttempts: item.maxAttempts,
          allowLate: item.allowLate,
          latePenalty: item.latePenalty,
          assignAll: item.assignAll,
          gradingScaleId: item.gradingScaleId,
          ...(item.targets.length > 0
            ? { targets: { create: item.targets.map((target) => ({ studentId: target.studentId })) } }
            : {}),
        },
        select: { id: true },
      })
      homeworkIdMap.set(item.id, cloned.id)
    }

    const sourceLessons = source.modules.flatMap((module) => module.lessons)
    for (const lesson of sourceLessons) {
      const targetId = oldLessonToNew.get(lesson.id)
      if (!targetId) continue
      const blocks = Array.isArray(lesson.blocks) ? (lesson.blocks as Array<Record<string, unknown>>) : []
      let changed = false
      const remapped = blocks.map((block) => {
        const next = { ...block }
        if (typeof block.testId === 'string') {
          const mapped = testIdMap.get(block.testId)
          if (mapped) next.testId = mapped
          else delete next.testId
          changed = true
        }
        if (typeof block.homeworkId === 'string') {
          const mapped = homeworkIdMap.get(block.homeworkId)
          if (mapped) next.homeworkId = mapped
          else delete next.homeworkId
          changed = true
        }
        return next
      })
      if (changed) {
        await this.prisma.client.lesson.update({
          where: { id: targetId },
          data: { blocks: remapped as unknown as Prisma.InputJsonValue },
        })
      }
    }

    await writeAudit({
      actorId: userId,
      action: 'lms.course.copy',
      entity: 'Course',
      entityId: copy.id,
      metadata: { sourceId: courseId },
    })
    return copy
  }

  // ---------- уроки и конструктор ----------

  async createLesson(input: LessonCreateInput, userId: string, role: RoleName) {
    const module = await this.prisma.client.module.findUnique({
      where: { id: input.moduleId },
      include: { course: { select: { id: true, teacherId: true, authorId: true } } },
    })
    if (!module) throw notFound('Модуль не найден')
    await this.courseForManage(module.course.id, userId, role)

    const position =
      ((await this.prisma.client.lesson.aggregate({ where: { moduleId: module.id }, _max: { position: true } }))._max
        .position ?? -1) + 1

    const lesson = await this.prisma.client.lesson.create({
      data: {
        moduleId: module.id,
        title: input.title,
        description: input.description,
        durationMinutes: input.durationMinutes,
        position,
        blocks: input.blocks ? (input.blocks as unknown as Prisma.InputJsonValue) : [],
        publishedAt: null,
      },
      select: { id: true, title: true, version: true },
    })
    await this.invalidateApproval(module.course.id)
    return lesson
  }

  async builderLesson(lessonId: string, userId: string, role: RoleName) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: {
        materials: { orderBy: { createdAt: 'asc' } },
        module: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                teacherId: true,
                authorId: true,
                tests: { select: { id: true, title: true } },
                homework: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.courseForManage(lesson.module.course.id, userId, role)

    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      durationMinutes: lesson.durationMinutes,
      blocks: Array.isArray(lesson.blocks) ? lesson.blocks : [],
      version: lesson.version,
      publishedAt: lesson.publishedAt,
      materials: lesson.materials,
      course: { id: lesson.module.course.id, title: lesson.module.course.title },
      module: { id: lesson.module.id, title: lesson.module.title },
      tests: lesson.module.course.tests,
      homework: lesson.module.course.homework,
    }
  }

  /**
   * Автосохранение меняет только блоки. Ручное сохранение фиксирует версию,
   * которую затем можно восстановить.
   */
  async saveLessonBlocks(
    lessonId: string,
    userId: string,
    role: RoleName,
    input: { blocks: Block[]; autosave: boolean; note?: string; title?: string; durationMinutes?: number },
  ) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: { select: { id: true, teacherId: true, authorId: true } } } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.courseForManage(lesson.module.course.id, userId, role)

    const blocks = input.blocks as unknown as Prisma.InputJsonValue
    const savedAt = new Date()
    const fields = {
      blocks,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
    }

    if (input.autosave) {
      await this.prisma.client.lesson.update({ where: { id: lessonId }, data: fields })
      await this.invalidateApproval(lesson.module.course.id)
      return { savedAt, version: lesson.version, autosaved: true }
    }

    const snapshot = {
      title: input.title ?? lesson.title,
      description: lesson.description,
      content: lesson.content,
      videoUrl: lesson.videoUrl,
      durationMinutes: input.durationMinutes ?? lesson.durationMinutes,
      blocks: input.blocks,
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const latest = await tx.lessonVersion.aggregate({
        where: { lessonId },
        _max: { version: true },
      })
      const nextVersion = Math.max(lesson.version, latest._max.version ?? 0) + 1
      // Ручное сохранение фиксирует именно то состояние, которое сохраняется,
      // поэтому восстановление всегда возвращает ожидаемую версию.
      await tx.lessonVersion.create({
        data: {
          lessonId,
          version: nextVersion,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          createdById: userId,
          note: input.note ?? null,
        },
      })
      return tx.lesson.update({
        where: { id: lessonId },
        data: { ...fields, version: nextVersion },
        select: { id: true, version: true, updatedAt: true },
      })
    })
    await this.invalidateApproval(lesson.module.course.id)
    return { savedAt, version: updated.version, autosaved: false }
  }

  async lessonVersions(lessonId: string, userId: string, role: RoleName) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: { select: { id: true, teacherId: true, authorId: true } } } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.courseForManage(lesson.module.course.id, userId, role)

    const versions = await this.prisma.client.lessonVersion.findMany({
      where: { lessonId },
      orderBy: { version: 'desc' },
      take: 50,
      select: { id: true, version: true, note: true, createdAt: true, createdById: true },
    })
    return { items: versions, current: lesson.version }
  }

  async restoreLessonVersion(lessonId: string, version: number, userId: string, role: RoleName) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: { select: { id: true, teacherId: true, authorId: true } } } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.courseForManage(lesson.module.course.id, userId, role)

    const record = await this.prisma.client.lessonVersion.findUnique({
      where: { lessonId_version: { lessonId, version } },
    })
    if (!record) throw notFound('Версия не найдена')

    const snapshot = record.snapshot as unknown as {
      title?: string
      description?: string | null
      content?: string | null
      videoUrl?: string | null
      durationMinutes?: number
      blocks?: unknown
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const latest = await tx.lessonVersion.aggregate({
        where: { lessonId },
        _max: { version: true },
      })
      const nextVersion = Math.max(lesson.version, latest._max.version ?? 0) + 1
      const next = await tx.lesson.update({
        where: { id: lessonId },
        data: {
          title: snapshot.title ?? lesson.title,
          description: snapshot.description ?? lesson.description,
          content: snapshot.content ?? lesson.content,
          videoUrl: snapshot.videoUrl ?? lesson.videoUrl,
          durationMinutes: snapshot.durationMinutes ?? lesson.durationMinutes,
          blocks: (snapshot.blocks ?? []) as Prisma.InputJsonValue,
          version: nextVersion,
        },
        select: { id: true, version: true },
      })
      await tx.lessonVersion.create({
        data: {
          lessonId,
          version: nextVersion,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          createdById: userId,
          note: `Восстановлено из версии ${version}`,
        },
      })
      return next
    })
    await this.invalidateApproval(lesson.module.course.id)
    await writeAudit({
      actorId: userId,
      action: 'lms.lesson.version.restore',
      entity: 'Lesson',
      entityId: lessonId,
      metadata: { restoredFrom: version },
    })
    return updated
  }

  async copyLesson(lessonId: string, userId: string, role: RoleName, targetModuleId?: string) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: {
        materials: true,
        module: { include: { course: { select: { id: true, teacherId: true, authorId: true } } } },
      },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.courseForManage(lesson.module.course.id, userId, role)

    let moduleId = lesson.module.id
    let targetCourseId = lesson.module.course.id
    if (targetModuleId) {
      const target = await this.prisma.client.module.findUnique({
        where: { id: targetModuleId },
        include: { course: { select: { id: true, teacherId: true, authorId: true } } },
      })
      if (!target) throw notFound('Модуль назначения не найден')
      await this.courseForManage(target.course.id, userId, role)
      moduleId = target.id
      targetCourseId = target.course.id
    }

    const position =
      ((await this.prisma.client.lesson.aggregate({ where: { moduleId }, _max: { position: true } }))._max.position ?? -1) + 1

    // Тест или задание другого курса нельзя оставлять в блоках копии: это
    // сослалось бы на чужой курс. Внутри курса связи сохраняются.
    const sourceBlocks = Array.isArray(lesson.blocks) ? (lesson.blocks as Array<Record<string, unknown>>) : []
    const copiedBlocks = sourceBlocks.map((block) => {
      const next = { ...block }
      if (targetCourseId !== lesson.module.course.id) {
        delete next.testId
        delete next.homeworkId
      }
      return next
    })

    const copy = await this.prisma.client.lesson.create({
      data: {
        moduleId,
        title: `${lesson.title} (копия)`,
        description: lesson.description,
        content: lesson.content,
        videoUrl: lesson.videoUrl,
        blocks: copiedBlocks as Prisma.InputJsonValue,
        durationMinutes: lesson.durationMinutes,
        position,
        materials: {
          create: lesson.materials.map((material) => ({
            type: material.type,
            title: material.title,
            url: material.url,
            mimeType: material.mimeType,
            sizeBytes: material.sizeBytes,
            allowDownload: material.allowDownload,
          })),
        },
      },
      select: { id: true, title: true },
    })
    await this.invalidateApproval(targetCourseId)
    if (targetCourseId !== lesson.module.course.id) await this.invalidateApproval(lesson.module.course.id)
    await writeAudit({
      actorId: userId,
      action: 'lms.lesson.copy',
      entity: 'Lesson',
      entityId: copy.id,
      metadata: { sourceId: lessonId },
    })
    return copy
  }

  async addMaterial(lessonId: string, input: MaterialCreateInput, userId: string, role: RoleName) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: { select: { id: true, teacherId: true, authorId: true } } } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.courseForManage(lesson.module.course.id, userId, role)

    const material = await this.prisma.client.lessonMaterial.create({
      data: {
        lessonId,
        type: input.type,
        title: input.title,
        url: input.url,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        allowDownload: input.allowDownload,
      },
    })
    await this.invalidateApproval(lesson.module.course.id)
    await writeAudit({
      actorId: userId,
      action: 'lms.material.create',
      entity: 'LessonMaterial',
      entityId: material.id,
      metadata: { lessonId, courseId: lesson.module.course.id, title: material.title, type: material.type },
    })
    return material
  }

  async removeMaterial(materialId: string, userId: string, role: RoleName) {
    const material = await this.prisma.client.lessonMaterial.findUnique({
      where: { id: materialId },
      include: { lesson: { include: { module: { include: { course: { select: { id: true, teacherId: true, authorId: true } } } } } } },
    })
    if (!material) throw notFound('Материал не найден')
    await this.courseForManage(material.lesson.module.course.id, userId, role)
    await this.prisma.client.lessonMaterial.delete({ where: { id: materialId } })
    await this.invalidateApproval(material.lesson.module.course.id)
    await writeAudit({
      actorId: userId,
      action: 'lms.material.delete',
      entity: 'LessonMaterial',
      entityId: materialId,
      metadata: { lessonId: material.lessonId, courseId: material.lesson.module.course.id, title: material.title },
    })
  }

  // ---------- модули ----------

  async createModule(courseId: string, input: { title: string; description?: string }, userId: string, role: RoleName) {
    await this.courseForManage(courseId, userId, role)
    const position =
      ((await this.prisma.client.module.aggregate({ where: { courseId }, _max: { position: true } }))._max.position ?? -1) + 1
    const module = await this.prisma.client.module.create({
      data: { courseId, title: input.title, description: input.description, position },
      select: { id: true, title: true, description: true, position: true },
    })
    await this.invalidateApproval(courseId)
    await writeAudit({
      actorId: userId,
      action: 'lms.module.create',
      entity: 'Module',
      entityId: module.id,
      metadata: { courseId, title: module.title },
    })
    return module
  }

  async updateModule(moduleId: string, input: { title?: string; description?: string }, userId: string, role: RoleName) {
    const module = await this.prisma.client.module.findUnique({
      where: { id: moduleId },
      select: { id: true, courseId: true },
    })
    if (!module) throw notFound('Модуль не найден')
    await this.courseForManage(module.courseId, userId, role)
    const updated = await this.prisma.client.module.update({ where: { id: moduleId }, data: input, select: { id: true, title: true } })
    await this.invalidateApproval(module.courseId)
    await writeAudit({
      actorId: userId,
      action: 'lms.module.update',
      entity: 'Module',
      entityId: moduleId,
      metadata: { courseId: module.courseId, changedFields: Object.keys(input), title: updated.title },
    })
    return updated
  }

  async removeModule(moduleId: string, userId: string, role: RoleName) {
    const module = await this.prisma.client.module.findUnique({
      where: { id: moduleId },
      select: { id: true, courseId: true, _count: { select: { lessons: true } } },
    })
    if (!module) throw notFound('Модуль не найден')
    await this.courseForManage(module.courseId, userId, role)
    if (module._count.lessons > 0) throw badRequest('Сначала перенесите или удалите уроки модуля')
    await this.prisma.client.module.delete({ where: { id: moduleId } })
    await writeAudit({
      actorId: userId,
      action: 'lms.module.delete',
      entity: 'Module',
      entityId: moduleId,
      metadata: { courseId: module.courseId },
    })
    await this.invalidateApproval(module.courseId)
  }

  // ---------- версии курса ----------

  async createCourseVersion(courseId: string, userId: string, role: RoleName, note?: string) {
    await this.courseForManage(courseId, userId, role)
    const structure = await this.structure(courseId)
    const course = await this.prisma.client.course.findUnique({ where: { id: courseId }, select: { version: true } })
    if (!course) throw notFound('Курс не найден')

    const snapshot: CourseSnapshot = {
      title: structure.title,
      description: structure.description,
      coverUrl: structure.coverUrl,
      level: structure.level,
      modules: structure.modules.map((module) => ({
        id: module.id,
        title: module.title,
        description: module.description,
        position: module.position,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          content: null,
          videoUrl: null,
          blocks: lesson.blocks,
          durationMinutes: lesson.durationMinutes,
          position: lesson.position,
          materials: lesson.materials.map((material) => ({
            id: material.id,
            type: material.type,
            title: material.title,
            url: material.url,
            mimeType: material.mimeType,
            sizeBytes: material.sizeBytes,
            allowDownload: material.allowDownload,
          })),
        })),
      })),
    }

    const nextVersion = course.version + 1
    const [record] = await this.prisma.client.$transaction([
      this.prisma.client.courseVersion.create({
        data: {
          courseId,
          version: nextVersion,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          note: note ?? null,
          createdById: userId,
        },
        select: { id: true, version: true, createdAt: true },
      }),
      this.prisma.client.course.update({ where: { id: courseId }, data: { version: nextVersion } }),
    ])
    return record
  }

  async courseVersions(courseId: string, userId: string, role: RoleName) {
    const course = await this.courseForManage(courseId, userId, role)
    const versions = await this.prisma.client.courseVersion.findMany({
      where: { courseId },
      orderBy: { version: 'desc' },
      take: 50,
      select: { id: true, version: true, note: true, createdAt: true },
    })
    return { items: versions, current: course.version }
  }

  async restoreCourseVersion(courseId: string, version: number, userId: string, role: RoleName) {
    const course = await this.courseForManage(courseId, userId, role)
    const record = await this.prisma.client.courseVersion.findUnique({
      where: { courseId_version: { courseId, version } },
    })
    if (!record) throw notFound('Версия не найдена')
    const snapshot = record.snapshot as unknown as CourseSnapshot

    const result = await this.prisma.client.$transaction(async (tx) => {
      const existingModules = await tx.module.findMany({
        where: { courseId },
        include: { lessons: { include: { materials: true } } },
      })
      const existingLessons = existingModules.flatMap((module) => module.lessons)
      const existingMaterials = existingLessons.flatMap((lesson) => lesson.materials)
      const claimedModuleIds = new Set<string>()
      const claimedLessonIds = new Set<string>()
      const claimedMaterialIds = new Set<string>()
      const keepLessons = new Map<string, string[]>()
      const keepMaterials = new Map<string, string[]>()

      const latest = await tx.courseVersion.aggregate({
        where: { courseId },
        _max: { version: true },
      })
      const nextVersion = Math.max(course.version, latest._max.version ?? 0) + 1

      await tx.course.update({
        where: { id: courseId },
        data: {
          title: snapshot.title,
          description: snapshot.description,
          coverUrl: snapshot.coverUrl,
          level: snapshot.level as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED',
          version: nextVersion,
          approvalStatus: 'DRAFT',
          status: 'DRAFT',
          submittedAt: null,
          approvedAt: null,
          approvedById: null,
          rejectionReason: null,
        },
      })

      const sortedModules = [...snapshot.modules].sort((a, b) => a.position - b.position)
      for (const moduleSnapshot of sortedModules) {
        let moduleRecord = moduleSnapshot.id
          ? existingModules.find(
              (item) => item.id === moduleSnapshot.id && !claimedModuleIds.has(item.id),
            )
          : undefined
        if (!moduleRecord) {
          moduleRecord = existingModules.find(
            (item) => !claimedModuleIds.has(item.id) && item.position === moduleSnapshot.position,
          )
        }

        let targetModuleId: string
        if (moduleRecord) {
          claimedModuleIds.add(moduleRecord.id)
          targetModuleId = moduleRecord.id
          await tx.module.update({
            where: { id: targetModuleId },
            data: {
              title: moduleSnapshot.title,
              description: moduleSnapshot.description,
              position: moduleSnapshot.position,
            },
          })
        } else {
          const created = await tx.module.create({
            data: {
              courseId,
              title: moduleSnapshot.title,
              description: moduleSnapshot.description,
              position: moduleSnapshot.position,
            },
            select: { id: true },
          })
          claimedModuleIds.add(created.id)
          targetModuleId = created.id
        }
        keepLessons.set(targetModuleId, [])

        const moduleLessons = existingLessons.filter((lesson) => lesson.moduleId === targetModuleId)
        const sortedLessons = [...moduleSnapshot.lessons].sort((a, b) => a.position - b.position)
        for (const lessonSnapshot of sortedLessons) {
          let lessonRecord = lessonSnapshot.id
            ? existingLessons.find(
                (item) => item.id === lessonSnapshot.id && !claimedLessonIds.has(item.id),
              )
            : undefined
          if (!lessonRecord) {
            lessonRecord = moduleLessons.find(
              (item) => !claimedLessonIds.has(item.id) && item.position === lessonSnapshot.position,
            )
          }

          let targetLessonId: string
          if (lessonRecord) {
            claimedLessonIds.add(lessonRecord.id)
            targetLessonId = lessonRecord.id
            await tx.lesson.update({
              where: { id: targetLessonId },
              data: {
                moduleId: targetModuleId,
                title: lessonSnapshot.title,
                description: lessonSnapshot.description,
                content: lessonSnapshot.content,
                videoUrl: lessonSnapshot.videoUrl,
                blocks: (lessonSnapshot.blocks ?? []) as Prisma.InputJsonValue,
                durationMinutes: lessonSnapshot.durationMinutes,
                position: lessonSnapshot.position,
                publishedAt: null,
              },
            })
          } else {
            const created = await tx.lesson.create({
              data: {
                moduleId: targetModuleId,
                title: lessonSnapshot.title,
                description: lessonSnapshot.description,
                content: lessonSnapshot.content,
                videoUrl: lessonSnapshot.videoUrl,
                blocks: (lessonSnapshot.blocks ?? []) as Prisma.InputJsonValue,
                durationMinutes: lessonSnapshot.durationMinutes,
                position: lessonSnapshot.position,
                publishedAt: null,
              },
              select: { id: true },
            })
            claimedLessonIds.add(created.id)
            targetLessonId = created.id
          }
          keepLessons.get(targetModuleId)?.push(targetLessonId)
          keepMaterials.set(targetLessonId, [])

          const sourceMaterials = lessonRecord?.materials ?? []
          for (const materialSnapshot of lessonSnapshot.materials) {
            let materialRecord = materialSnapshot.id
              ? existingMaterials.find(
                  (item) => item.id === materialSnapshot.id && !claimedMaterialIds.has(item.id),
                )
              : undefined
            if (!materialRecord) {
              materialRecord = sourceMaterials.find(
                (item) =>
                  !claimedMaterialIds.has(item.id) &&
                  item.title === materialSnapshot.title &&
                  item.url === materialSnapshot.url,
              )
            }

            let targetMaterialId: string
            if (materialRecord) {
              claimedMaterialIds.add(materialRecord.id)
              targetMaterialId = materialRecord.id
              await tx.lessonMaterial.update({
                where: { id: targetMaterialId },
                data: {
                  lessonId: targetLessonId,
                  type: materialSnapshot.type as Prisma.LessonMaterialCreateInput['type'],
                  title: materialSnapshot.title,
                  url: materialSnapshot.url,
                  mimeType: materialSnapshot.mimeType,
                  sizeBytes: materialSnapshot.sizeBytes,
                  allowDownload: materialSnapshot.allowDownload ?? true,
                },
              })
            } else {
              const created = await tx.lessonMaterial.create({
                data: {
                  lessonId: targetLessonId,
                  type: materialSnapshot.type as Prisma.LessonMaterialCreateInput['type'],
                  title: materialSnapshot.title,
                  url: materialSnapshot.url,
                  mimeType: materialSnapshot.mimeType,
                  sizeBytes: materialSnapshot.sizeBytes,
                  allowDownload: materialSnapshot.allowDownload ?? true,
                },
                select: { id: true },
              })
              claimedMaterialIds.add(created.id)
              targetMaterialId = created.id
            }
            keepMaterials.get(targetLessonId)?.push(targetMaterialId)
          }
        }
      }

      // Удаляем только то, чего нет в версии. Существующие уроки сохраняют id,
      // поэтому прогресс, заметки и закладки учеников не пропадают.
      for (const [moduleId, lessonIds] of keepLessons) {
        if (lessonIds.length === 0) {
          await tx.lesson.deleteMany({ where: { moduleId } })
        } else {
          await tx.lesson.deleteMany({ where: { moduleId, id: { notIn: lessonIds } } })
        }
      }
      for (const [lessonId, materialIds] of keepMaterials) {
        if (materialIds.length === 0) {
          await tx.lessonMaterial.deleteMany({ where: { lessonId } })
        } else {
          await tx.lessonMaterial.deleteMany({ where: { lessonId, id: { notIn: materialIds } } })
        }
      }
      if (claimedModuleIds.size === 0) {
        await tx.module.deleteMany({ where: { courseId } })
      } else {
        await tx.module.deleteMany({ where: { courseId, id: { notIn: [...claimedModuleIds] } } })
      }

      await tx.courseVersion.create({
        data: {
          courseId,
          version: nextVersion,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          createdById: userId,
          note: `Восстановлено из версии ${version}`,
        },
      })
      return { id: courseId, version: nextVersion }
    })

    await writeAudit({
      actorId: userId,
      action: 'lms.course.version.restore',
      entity: 'Course',
      entityId: courseId,
      metadata: { restoredFrom: version },
    })
    return result
  }

  // ---------- статистика и участники ----------

  async participants(courseId: string, userId: string, role: RoleName) {
    await this.courseForManage(courseId, userId, role)
    const enrollments = await this.prisma.client.courseEnrollment.findMany({
      where: { courseId },
      orderBy: { enrolledAt: 'desc' },
      take: 500,
      include: { student: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })

    const totalLessons = await this.prisma.client.lesson.count({ where: { module: { courseId } } })
    const completed = await this.prisma.client.lessonProgress.groupBy({
      by: ['studentId'],
      where: { status: 'COMPLETED', lesson: { module: { courseId } } },
      _count: { lessonId: true },
    })
    const completedByStudent = new Map(completed.map((row) => [row.studentId, row._count.lessonId]))

    return {
      totalLessons,
      items: enrollments.map((enrollment) => ({
        id: enrollment.student.id,
        name: `${enrollment.student.firstName} ${enrollment.student.lastName}`,
        email: enrollment.student.email,
        status: enrollment.status,
        progress: enrollment.progress,
        completedLessons: completedByStudent.get(enrollment.student.id) ?? 0,
        enrolledAt: enrollment.enrolledAt,
      })),
    }
  }

  async stats(courseId: string, userId: string, role: RoleName) {
    await this.courseForManage(courseId, userId, role)
    const [lessons, materials, tests, homework, enrollments, avgProgress, lessonStats] = await Promise.all([
      this.prisma.client.lesson.count({ where: { module: { courseId } } }),
      this.prisma.client.lessonMaterial.count({ where: { lesson: { module: { courseId } } } }),
      this.prisma.client.test.count({ where: { courseId } }),
      this.prisma.client.homework.count({ where: { courseId } }),
      this.prisma.client.courseEnrollment.count({ where: { courseId } }),
      this.prisma.client.courseEnrollment.aggregate({ where: { courseId }, _avg: { progress: true } }),
      this.prisma.client.lesson.findMany({
        where: { module: { courseId } },
        orderBy: { position: 'asc' },
        select: {
          id: true,
          title: true,
          _count: { select: { progress: { where: { status: 'COMPLETED' } }, materials: true } },
        },
      }),
    ])

    return {
      lessons,
      materials,
      tests,
      homework,
      enrollments,
      averageProgress: Math.round(avgProgress._avg.progress ?? 0),
      completionRate: enrollments === 0 ? 0 : Math.round(
        (lessonStats.reduce((sum, lesson) => sum + lesson._count.progress, 0) / (enrollments * Math.max(lessons, 1))) * 100,
      ),
      lessonStats: lessonStats.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        completed: lesson._count.progress,
        materials: lesson._count.materials,
      })),
    }
  }

  async listTeachers() {
    const teachers = await this.prisma.client.user.findMany({
      where: { role: { in: ['TEACHER', 'ADMIN'] }, deletedAt: null, isActive: true },
      orderBy: { firstName: 'asc' },
      select: { id: true, firstName: true, lastName: true, role: true },
    })
    return { items: teachers.map((teacher) => ({ id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}`, role: teacher.role })) }
  }

  // ---------- ученик ----------

  private async enrolledCourse(courseId: string, userId: string) {
    const enrollment = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId, studentId: userId } },
      select: { id: true },
    })
    if (!enrollment) throw forbidden('Нет доступа к курсу: нет записи')
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { id: true, status: true, approvalStatus: true },
    })
    if (!course || course.status !== 'ACTIVE') throw notFound('Курс не найден или не опубликован')
    void course.approvalStatus
    return enrollment
  }

  async learnCourse(courseId: string, userId: string) {
    await this.enrolledCourse(courseId, userId)
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      include: {
        teacher: { select: { firstName: true, lastName: true } },
        author: { select: { firstName: true, lastName: true } },
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              orderBy: { position: 'asc' },
              // Все уроки доступны сразу после выдачи доступа к курсу.
              include: {
                materials: { select: { id: true, title: true, type: true } },
                progress: { where: { studentId: userId }, select: { status: true } },
              },
            },
          },
        },
      },
    })
    if (!course) throw notFound('Курс не найден')

    const lessons = course.modules.flatMap((module) => module.lessons)
    const completed = lessons.filter((lesson) => lesson.progress.some((p) => p.status === 'COMPLETED')).length

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      coverUrl: course.coverUrl,
      level: course.level,
      teacher: `${course.teacher.firstName} ${course.teacher.lastName}`,
      author: course.author ? `${course.author.firstName} ${course.author.lastName}` : null,
      lessonsCount: lessons.length,
      completedLessons: completed,
      progress: lessons.length === 0 ? 0 : Math.round((completed / lessons.length) * 100),
      modules: course.modules.map((module) => ({
        id: module.id,
        title: module.title,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          durationMinutes: lesson.durationMinutes,
          materials: lesson.materials,
          completed: lesson.progress.some((p) => p.status === 'COMPLETED'),
        })),
      })),
    }
  }

  async learnLesson(lessonId: string, userId: string) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            course: { select: { id: true, title: true, status: true } },
          },
        },
        materials: true,
        homework: { select: { id: true, title: true, dueAt: true, description: true } },
      },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.enrolledCourse(lesson.module.course.id, userId)

    const [bookmarks, highlights, note, siblings, progress] = await Promise.all([
      this.prisma.client.materialBookmark.findMany({
        where: { userId, material: { lessonId } },
        select: { materialId: true },
      }),
      this.prisma.client.materialHighlight.findMany({
        where: { userId, material: { lessonId } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.lessonNote.findUnique({ where: { userId_lessonId: { userId, lessonId } } }),
      this.prisma.client.lesson.findMany({
        where: { module: { courseId: lesson.module.course.id } },
        orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
        select: { id: true, title: true },
      }),
      this.prisma.client.lessonProgress.findUnique({
        where: { lessonId_studentId: { lessonId, studentId: userId } },
      }),
    ])

    const bookmarked = new Set(bookmarks.map((bookmark) => bookmark.materialId))
    const index = siblings.findIndex((item) => item.id === lesson.id)
    const tests = await this.prisma.client.test.findMany({
      where: { courseId: lesson.module.course.id, isPublished: true },
      select: { id: true, title: true },
      take: 20,
    })

    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      durationMinutes: lesson.durationMinutes,
      blocks: Array.isArray(lesson.blocks) ? lesson.blocks : [],
      content: lesson.content,
      videoUrl: lesson.videoUrl,
      materials: lesson.materials.map((material) => ({
        id: material.id,
        type: material.type,
        title: material.title,
        url: material.url,
        mimeType: material.mimeType,
        sizeBytes: material.sizeBytes,
        allowDownload: material.allowDownload,
        bookmarked: bookmarked.has(material.id),
        highlights: highlights
          .filter((highlight) => highlight.materialId === material.id)
          .map((highlight) => ({ id: highlight.id, quote: highlight.quote, note: highlight.note, color: highlight.color, createdAt: highlight.createdAt })),
      })),
      homework: lesson.homework,
      tests,
      note: note?.body ?? '',
      course: { id: lesson.module.course.id, title: lesson.module.course.title },
      module: { id: lesson.module.id, title: lesson.module.title },
      prevLesson: index > 0 ? siblings[index - 1] : null,
      nextLesson: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null,
      progress: progress ? { status: progress.status, completedAt: progress.completedAt } : null,
    }
  }

  private async materialForStudent(materialId: string, userId: string) {
    const material = await this.prisma.client.lessonMaterial.findUnique({
      where: { id: materialId },
      include: { lesson: { include: { module: { select: { courseId: true } } } } },
    })
    if (!material) throw notFound('Материал не найден')
    await this.enrolledCourse(material.lesson.module.courseId, userId)
    return material
  }

  async toggleBookmark(materialId: string, userId: string) {
    await this.materialForStudent(materialId, userId)
    const existing = await this.prisma.client.materialBookmark.findUnique({
      where: { userId_materialId: { userId, materialId } },
    })
    if (existing) {
      await this.prisma.client.materialBookmark.delete({ where: { id: existing.id } })
      return { bookmarked: false }
    }
    await this.prisma.client.materialBookmark.create({ data: { userId, materialId } })
    return { bookmarked: true }
  }

  async addHighlight(
    materialId: string,
    userId: string,
    input: { quote: string; note?: string; color: string },
  ) {
    await this.materialForStudent(materialId, userId)
    return this.prisma.client.materialHighlight.create({
      data: { userId, materialId, quote: input.quote, note: input.note ?? null, color: input.color },
      select: { id: true, quote: true, note: true, color: true, createdAt: true },
    })
  }

  async removeHighlight(highlightId: string, userId: string) {
    const highlight = await this.prisma.client.materialHighlight.findFirst({ where: { id: highlightId, userId } })
    if (!highlight) throw notFound('Выделение не найдено')
    await this.prisma.client.materialHighlight.delete({ where: { id: highlightId } })
  }

  async saveNote(lessonId: string, userId: string, body: string) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { select: { courseId: true } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.enrolledCourse(lesson.module.courseId, userId)

    if (!body.trim()) {
      await this.prisma.client.lessonNote.deleteMany({ where: { userId, lessonId } })
      return { body: '', savedAt: new Date() }
    }
    const note = await this.prisma.client.lessonNote.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId, body },
      update: { body },
    })
    return { body: note.body, savedAt: note.updatedAt }
  }

  /** Библиотека ученика: материалы, заметки и выделения, сгруппированные по курсам. */
  async library(userId: string) {
    const enrollments = await this.prisma.client.courseEnrollment.findMany({
      where: { studentId: userId },
      select: { courseId: true },
    })
    const courseIds = enrollments.map((item) => item.courseId)

    const courses = await this.prisma.client.course.findMany({
      where: { id: { in: courseIds }, status: 'ACTIVE' },
      orderBy: { title: 'asc' },
      include: {
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              orderBy: { position: 'asc' },
              include: {
                materials: {
                  include: {
                    bookmarks: { where: { userId }, select: { id: true } },
                    highlights: { where: { userId }, orderBy: { createdAt: 'desc' } },
                  },
                },
                notes: { where: { userId } },
              },
            },
          },
        },
      },
    })

    const saved: Array<{
      id: string
      title: string
      type: string
      url: string
      allowDownload: boolean
      course: string
      courseId: string
      lessonId: string
      highlights: number
    }> = []

    const groups = courses.map((course) => {
      const lessons = course.modules.flatMap((module) => module.lessons)
      for (const lesson of lessons) {
        for (const material of lesson.materials) {
          if (material.bookmarks.length > 0 || material.highlights.length > 0) {
            saved.push({
              id: material.id,
              title: material.title,
              type: material.type,
              url: material.url,
              allowDownload: material.allowDownload,
              course: course.title,
              courseId: course.id,
              lessonId: lesson.id,
              highlights: material.highlights.length,
            })
          }
        }
      }

      return {
        course: { id: course.id, title: course.title, coverUrl: course.coverUrl },
        groups: course.modules.map((module) => ({
          id: module.id,
          title: module.title,
          lessons: module.lessons
            .filter((lesson) => lesson.materials.length > 0 || lesson.notes.length > 0)
            .map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              note: lesson.notes[0]?.body ?? null,
              noteUpdatedAt: lesson.notes[0]?.updatedAt ?? null,
              materials: lesson.materials.map((material) => ({
                id: material.id,
                title: material.title,
                type: material.type,
                url: material.url,
                mimeType: material.mimeType,
                sizeBytes: material.sizeBytes,
                allowDownload: material.allowDownload,
                bookmarked: material.bookmarks.length > 0,
                highlights: material.highlights.map((highlight) => ({
                  id: highlight.id,
                  quote: highlight.quote,
                  note: highlight.note,
                  color: highlight.color,
                })),
              })),
            })),
        })),
      }
    })

    return { saved, courses: groups }
  }
}
