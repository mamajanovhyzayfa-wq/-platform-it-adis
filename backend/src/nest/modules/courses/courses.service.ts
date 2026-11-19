import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type CourseLevel, type RoleName } from '@prisma/client'
import { z } from 'zod'
import { badRequest, forbidden, notFound } from '../../../lib/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'

export const moduleCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  position: z.number().int().min(0).max(999).optional(),
})

export const moduleUpdateSchema = moduleCreateSchema.partial()

export type ModuleCreateInput = z.infer<typeof moduleCreateSchema>
export type ModuleUpdateInput = z.infer<typeof moduleUpdateSchema>

export const catalogQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  sort: z.enum(['new', 'popular', 'title']).default('new'),
  mine: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type CatalogQuery = z.infer<typeof catalogQuerySchema>

const studentSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  coverUrl: true,
  level: true,
  status: true,
  createdAt: true,
  category: { select: { id: true, slug: true, title: true, icon: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  modules: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      title: true,
      lessons: {
        where: { publishedAt: { not: null } },
        select: { id: true, durationMinutes: true },
      },
    },
  },
  _count: { select: { enrollments: true } },
} satisfies Prisma.CourseSelect

type CatalogCourse = Prisma.CourseGetPayload<{ select: typeof studentSelect }>

/** Курс, собранный для карточки каталога. */
export interface CatalogCourseCard {
  id: string
  title: string
  slug: string
  description: string
  coverUrl: string | null
  level: CourseLevel
  teacher: { id: string; name: string }
  category: { id: string; slug: string; title: string; icon: string | null } | null
  modulesCount: number
  lessonsCount: number
  durationMinutes: number
  studentsCount: number
  enrolled: boolean
  progress: number
}

const teacherName = (teacher: { firstName: string; lastName: string }) =>
  `${teacher.firstName} ${teacher.lastName}`.trim()

const sumDuration = (course: CatalogCourse) =>
  course.modules.reduce(
    (total, module) => total + module.lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
    0,
  )

const lessonsCount = (course: CatalogCourse) =>
  course.modules.reduce((total, module) => total + module.lessons.length, 0)

/**
 * Каталог и учебный контур ученика.
 *
 * Все вычисления (прогресс, следующий урок, доступ к уроку) выполняются на сервере:
 * клиент получает только готовые значения и не может их подделать.
 */
@Injectable()
export class CoursesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listCategories() {
    const categories = await this.prisma.client.courseCategory.findMany({
      orderBy: { position: 'asc' },
      include: { _count: { select: { courses: { where: { status: 'ACTIVE' } } } } },
    })

    return {
      items: categories.map((category) => ({
        id: category.id,
        slug: category.slug,
        title: category.title,
        icon: category.icon,
        coursesCount: category._count.courses,
      })),
    }
  }

  async catalog(query: CatalogQuery, userId: string, role: RoleName) {
    const where: Prisma.CourseWhereInput = {
      status: 'ACTIVE',
      ...(query.level ? { level: query.level } : {}),
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.mine === 'true' ? { enrollments: { some: { studentId: userId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const orderBy: Prisma.CourseOrderByWithRelationInput[] =
      query.sort === 'popular'
        ? [{ enrollments: { _count: 'desc' } }, { createdAt: 'desc' }]
        : query.sort === 'title'
          ? [{ title: 'asc' }]
          : [{ createdAt: 'desc' }]

    const [courses, total, enrollments] = await Promise.all([
      this.prisma.client.course.findMany({
        where,
        select: studentSelect,
        orderBy,
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.client.course.count({ where }),
      role === 'STUDENT'
        ? this.prisma.client.courseEnrollment.findMany({
            where: { studentId: userId },
            select: { courseId: true, progress: true },
          })
        : Promise.resolve([]),
    ])

    const progressByCourse = new Map(enrollments.map((item) => [item.courseId, item.progress]))

    return {
      items: courses.map((course) => this.toCard(course, progressByCourse.get(course.id))),
      total,
      hasMore: query.offset + courses.length < total,
      filters: {
        search: query.search ?? null,
        category: query.category ?? null,
        level: query.level ?? null,
        sort: query.sort,
        mine: query.mine === 'true',
      },
    }
  }

  /** Курсы ученика с прогрессом и следующим незавершённым уроком. */
  async myCourses(userId: string) {
    const enrollments = await this.prisma.client.courseEnrollment.findMany({
      where: { studentId: userId },
      orderBy: { enrolledAt: 'desc' },
      include: {
        course: {
          include: {
            category: { select: { id: true, slug: true, title: true, icon: true } },
            teacher: { select: { id: true, firstName: true, lastName: true } },
            modules: {
              orderBy: { position: 'asc' },
              include: {
                lessons: {
                  where: { publishedAt: { not: null } },
                  orderBy: { position: 'asc' },
                  select: {
                    id: true,
                    title: true,
                    durationMinutes: true,
                    progress: { where: { studentId: userId }, select: { status: true } },
                  },
                },
              },
            },
          },
        },
      },
    })

    return {
      items: enrollments.map((enrollment) => {
        const lessons = enrollment.course.modules.flatMap((module) => module.lessons)
        const completed = lessons.filter((lesson) => lesson.progress.some((p) => p.status === 'COMPLETED')).length
        const nextLesson =
          enrollment.course.modules
            .flatMap((module) => module.lessons.map((lesson) => ({ ...lesson, moduleTitle: module.title })))
            .find((lesson) => !lesson.progress.some((p) => p.status === 'COMPLETED')) ?? null

        return {
          enrollmentId: enrollment.id,
          enrollmentStatus: enrollment.status,
          // Считаем по факту завершённых уроков: сохранённое поле может отставать после seed.
          progress: lessons.length === 0 ? enrollment.progress : Math.round((completed / lessons.length) * 100),
          lessonsCount: lessons.length,
          completedLessons: completed,
          course: {
            id: enrollment.course.id,
            title: enrollment.course.title,
            slug: enrollment.course.slug,
            description: enrollment.course.description,
            coverUrl: enrollment.course.coverUrl,
            level: enrollment.course.level,
            category: enrollment.course.category,
            teacher: { id: enrollment.course.teacher.id, name: teacherName(enrollment.course.teacher) },
            modulesCount: enrollment.course.modules.length,
            durationMinutes: lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
          },
          nextLesson: nextLesson
            ? { id: nextLesson.id, title: nextLesson.title, moduleTitle: nextLesson.moduleTitle, durationMinutes: nextLesson.durationMinutes }
            : null,
        }
      }),
    }
  }

  /**
   * Данные главного экрана ученика одним запросом: баланс, курсы, прогресс,
   * ближайшее занятие и урок для продолжения.
   */
  async overview(userId: string) {
    const [balance, myCourses, nextClass] = await Promise.all([
      this.prisma.client.coinBalance.findUnique({ where: { userId }, select: { balance: true } }),
      this.myCourses(userId),
      this.prisma.client.schedule.findFirst({
        where: {
          endsAt: { gt: new Date() },
          course: { enrollments: { some: { studentId: userId } } },
        },
        orderBy: { startsAt: 'asc' },
        include: {
          course: { select: { id: true, title: true } },
          room: { select: { id: true, status: true } },
        },
      }),
    ])

    const active = myCourses.items.filter((item) => item.enrollmentStatus !== 'COMPLETED')
    const totalLessons = active.reduce((sum, item) => sum + item.lessonsCount, 0)
    const completedLessons = active.reduce((sum, item) => sum + item.completedLessons, 0)
    const overallProgress =
      active.length === 0
        ? 0
        : Math.round(active.reduce((sum, item) => sum + item.progress, 0) / active.length)

    const continueLearning =
      active
        .filter((item) => item.nextLesson !== null)
        .sort((a, b) => b.progress - a.progress)[0] ?? null

    const teacher = nextClass
      ? await this.prisma.client.user.findUnique({
          where: { id: nextClass.teacherId },
          select: { firstName: true, lastName: true },
        })
      : null

    return {
      coinBalance: balance?.balance ?? 0,
      activeCoursesCount: active.length,
      completedCoursesCount: myCourses.items.length - active.length,
      overallProgress,
      totalLessons,
      completedLessons,
      activeCourses: active.slice(0, 4),
      continueLearning: continueLearning
        ? {
            courseId: continueLearning.course.id,
            courseTitle: continueLearning.course.title,
            lessonId: continueLearning.nextLesson?.id ?? null,
            lessonTitle: continueLearning.nextLesson?.title ?? null,
            moduleTitle: continueLearning.nextLesson?.moduleTitle ?? null,
            progress: continueLearning.progress,
          }
        : null,
      nextClass: nextClass
        ? {
            id: nextClass.id,
            title: nextClass.title,
            startsAt: nextClass.startsAt,
            endsAt: nextClass.endsAt,
            status: nextClass.status,
            timezone: nextClass.timezone,
            course: nextClass.course,
            teacher: teacher ? teacherName(teacher) : null,
            hasRoom: Boolean(nextClass.room),
          }
        : null,
    }
  }

  /** Карточка курса с модулями, уроками и прогрессом текущего ученика. */
  async detail(courseId: string, userId: string, role: RoleName) {
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      include: {
        category: { select: { id: true, slug: true, title: true, icon: true } },
        teacher: { select: { id: true, firstName: true, lastName: true } },
        modules: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              where: role === 'STUDENT' ? { publishedAt: { not: null } } : {},
              orderBy: { position: 'asc' },
              include: {
                materials: { select: { id: true } },
                progress: { where: { studentId: userId }, select: { status: true, lastPositionSeconds: true } },
              },
            },
          },
        },
      },
    })

    if (!course) throw notFound('Курс не найден')
    if (role === 'STUDENT' && course.status !== 'ACTIVE') throw notFound('Курс не найден')
    if (role === 'TEACHER' && course.teacherId !== userId) throw forbidden('Курс принадлежит другому преподавателю')

    const enrollment =
      role === 'STUDENT'
        ? await this.prisma.client.courseEnrollment.findUnique({
            where: { courseId_studentId: { courseId, studentId: userId } },
            select: { id: true, status: true, progress: true, enrolledAt: true },
          })
        : null

    const allLessons = course.modules.flatMap((module) => module.lessons)
    const completedLessons = allLessons.filter((lesson) =>
      lesson.progress.some((progress) => progress.status === 'COMPLETED'),
    ).length
    const computedProgress =
      allLessons.length === 0 ? 0 : Math.round((completedLessons / allLessons.length) * 100)

    const modules = course.modules.map((module, moduleIndex) => ({
      id: module.id,
      title: module.title,
      description: module.description,
      position: moduleIndex + 1,
      lessonsCount: module.lessons.length,
      completedLessons: module.lessons.filter((lesson) =>
        lesson.progress.some((progress) => progress.status === 'COMPLETED'),
      ).length,
      lessons: module.lessons.map((lesson) => {
        const lessonProgress = lesson.progress[0]
        return {
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          durationMinutes: lesson.durationMinutes,
          publishedAt: lesson.publishedAt,
          materialsCount: lesson.materials.length,
          status: lessonProgress?.status ?? 'NOT_STARTED',
          lastPositionSeconds: lessonProgress?.lastPositionSeconds ?? 0,
          locked: role === 'STUDENT' && !enrollment,
        }
      }),
    }))

    return {
      id: course.id,
      title: course.title,
      slug: course.slug,
      description: course.description,
      coverUrl: course.coverUrl,
      level: course.level,
      status: course.status,
      createdAt: course.createdAt,
      category: course.category,
      teacher: { id: course.teacher.id, name: teacherName(course.teacher) },
      enrollment,
      isEnrolled: Boolean(enrollment),
      progress: allLessons.length === 0 ? (enrollment?.progress ?? 0) : computedProgress,
      completedLessons,
      lessonsCount: allLessons.length,
      durationMinutes: allLessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
      modules,
    }
  }

  /** Создание модуля в своём курсе. Позиция по умолчанию — в конец программы. */
  async createModule(courseId: string, input: ModuleCreateInput, userId: string, role: RoleName) {
    await this.assertCourseOwner(courseId, userId, role)

    const position =
      input.position ??
      ((await this.prisma.client.module.aggregate({ where: { courseId }, _max: { position: true } }))._max.position ?? -1) + 1

    return this.prisma.client.module.create({
      data: {
        courseId,
        title: input.title,
        description: input.description,
        position,
      },
      select: { id: true, title: true, description: true, position: true },
    })
  }

  async updateModule(moduleId: string, input: ModuleUpdateInput, userId: string, role: RoleName) {
    const module = await this.prisma.client.module.findUnique({
      where: { id: moduleId },
      select: { id: true, courseId: true, course: { select: { teacherId: true } } },
    })
    if (!module) throw notFound('Модуль не найден')
    if (role === 'TEACHER' && module.course.teacherId !== userId) {
      throw forbidden('Модуль принадлежит другому курсу')
    }

    return this.prisma.client.module.update({
      where: { id: module.id },
      data: input,
      select: { id: true, title: true, description: true, position: true },
    })
  }

  /** Удаление пустого модуля: уроки сначала нужно удалить или перенести. */
  async removeModule(moduleId: string, userId: string, role: RoleName): Promise<void> {
    const module = await this.prisma.client.module.findUnique({
      where: { id: moduleId },
      select: { id: true, course: { select: { teacherId: true } }, _count: { select: { lessons: true } } },
    })
    if (!module) throw notFound('Модуль не найден')
    if (role === 'TEACHER' && module.course.teacherId !== userId) {
      throw forbidden('Модуль принадлежит другому курсу')
    }
    if (module._count.lessons > 0) {
      throw badRequest('В модуле есть уроки — удалите их или перенесите в другой модуль')
    }

    await this.prisma.client.module.delete({ where: { id: module.id } })
  }

  private async assertCourseOwner(courseId: string, userId: string, role: RoleName): Promise<void> {
    if (role !== 'TEACHER' && role !== 'ADMIN') throw forbidden('Раздел доступен преподавателю')

    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { id: true, teacherId: true },
    })
    if (!course) throw notFound('Курс не найден')
    if (role === 'TEACHER' && course.teacherId !== userId) {
      throw forbidden('Курс принадлежит другому преподавателю')
    }
  }

  /** Запись ученика на курс. Повторный вызов идемпотентен. */
  async enroll(courseId: string, userId: string, role: RoleName) {
    if (role !== 'STUDENT') throw forbidden('Запись доступна только ученикам')

    const course = await this.prisma.client.course.findFirst({
      where: { id: courseId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!course) throw notFound('Курс не найден или ещё не опубликован')

    const existing = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId, studentId: userId } },
      select: { id: true, status: true, progress: true, enrolledAt: true },
    })
    if (existing) return { enrollment: existing, created: false }

    const enrollment = await this.prisma.client.courseEnrollment.create({
      data: { courseId, studentId: userId, status: 'ACTIVE', progress: 0 },
      select: { id: true, status: true, progress: true, enrolledAt: true },
    })

    return { enrollment, created: true }
  }

  private toCard(course: CatalogCourse, progress: number | undefined): CatalogCourseCard {
    return {
      id: course.id,
      title: course.title,
      slug: course.slug,
      description: course.description,
      coverUrl: course.coverUrl,
      level: course.level,
      teacher: { id: course.teacher.id, name: teacherName(course.teacher) },
      category: course.category,
      modulesCount: course.modules.length,
      lessonsCount: lessonsCount(course),
      durationMinutes: sumDuration(course),
      studentsCount: course._count.enrollments,
      enrolled: progress !== undefined,
      progress: progress ?? 0,
    }
  }
}
