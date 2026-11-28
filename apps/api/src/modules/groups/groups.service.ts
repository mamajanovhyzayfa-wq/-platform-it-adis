import { Injectable } from '@nestjs/common'
import { ZodError } from 'zod'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { AppError, notFound } from '../../lib/errors.js'
import { groupsQuerySchema, type GroupsQuery } from './groups.dto.js'

/**
 * Учебная группа в текущей модели — это курс с назначенным наставником и
 * активным составом. Группа вычисляется из Course + CourseEnrollment, чтобы
 * не дублировать данные и не ломать существующие записи на курс.
 */
interface GroupView {
  id: string
  title: string
  courseId: string
  teacherId: string
  teacherName: string
  status: string
  studentsCount: number
  activeStudentsCount: number
  createdAt: string
}

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  private parse(raw: Record<string, unknown>): GroupsQuery {
    try {
      return groupsQuerySchema.parse(raw)
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'Проверьте параметры учебных групп',
          error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        )
      }
      throw error
    }
  }

  async list(raw: Record<string, unknown>) {
    const query = this.parse(raw)
    const where = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {}),
    }
    const [courses, total] = await Promise.all([
      this.prisma.client.course.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          teacherId: true,
          createdAt: true,
          teacher: { select: { firstName: true, lastName: true } },
          _count: { select: { enrollments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.course.count({ where }),
    ])

    const data = courses.map((course) => this.toView(course))
    return { data, page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) }
  }

  async one(id: string) {
    const course = await this.prisma.client.course.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        teacherId: true,
        createdAt: true,
        teacher: { select: { firstName: true, lastName: true } },
        _count: { select: { enrollments: true } },
        enrollments: {
          select: {
            id: true,
            status: true,
            progress: true,
            enrolledAt: true,
            student: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { enrolledAt: 'asc' },
        },
      },
    })
    if (!course) throw notFound('Учебная группа не найдена')
    return { ...this.toView(course), students: course.enrollments }
  }

  private toView(course: {
    id: string
    title: string
    status: string
    teacherId: string
    createdAt: Date
    teacher: { firstName: string; lastName: string }
    _count: { enrollments: number }
  }): GroupView {
    return {
      id: course.id,
      title: course.title,
      courseId: course.id,
      teacherId: course.teacherId,
      teacherName: `${course.teacher.firstName} ${course.teacher.lastName}`.trim(),
      status: course.status,
      studentsCount: course._count.enrollments,
      activeStudentsCount: course._count.enrollments,
      createdAt: course.createdAt.toISOString(),
    }
  }
}
