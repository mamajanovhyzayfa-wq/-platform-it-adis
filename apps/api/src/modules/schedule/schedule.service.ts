import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { z } from 'zod'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { notifyUsers } from '../../lib/notify.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'

/** Окно расписания: мобильное приложение запрашивает только видимый период. */
export const scheduleQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    courseId: z.string().uuid().optional(),
  })
  .strict()

export const scheduleCreateSchema = z
  .object({
    courseId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).optional(),
    startsAt: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(480),
  })
  .strict()

export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>
export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>

const MAX_RANGE_MS = 1000 * 60 * 60 * 24 * 120
const DEFAULT_PAST_MS = 1000 * 60 * 60 * 24 * 7
const DEFAULT_FUTURE_MS = 1000 * 60 * 60 * 24 * 60

/**
 * Расписание занятий.
 *
 * Видимость повторяет остальные разделы: ученик видит занятия своих курсов,
 * преподаватель — только своих курсов, администратор — все. Создание занятия
 * проверяет владение курсом и пересечения по времени, чтобы в одном кабинете
 * или у одного преподавателя не оказалось двух занятий одновременно.
 */
@Injectable()
export class ScheduleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string, role: RoleName, query: ScheduleQuery) {
    const now = Date.now()
    const from = query.from ? new Date(query.from) : new Date(now - DEFAULT_PAST_MS)
    const to = query.to ? new Date(query.to) : new Date(now + DEFAULT_FUTURE_MS)

    if (from.getTime() >= to.getTime()) throw badRequest('Начало периода должно быть раньше конца')
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw badRequest('Период не может превышать 120 дней')
    }

    const scope: Prisma.ScheduleWhereInput =
      role === 'ADMIN' || role === 'MANAGER'
        ? {}
        : role === 'TEACHER'
          ? { course: { teacherId: userId } }
          : { course: { enrollments: { some: { studentId: userId } } } }

    const items = await this.prisma.client.schedule.findMany({
      where: {
        ...scope,
        ...(query.courseId ? { courseId: query.courseId } : {}),
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      include: {
        course: { select: { id: true, title: true, teacher: { select: { firstName: true, lastName: true } } } },
        room: { select: { id: true, status: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    })

    return {
      items: items.map((item) => this.toCard(item)),
      range: { from: from.toISOString(), to: to.toISOString() },
    }
  }

  /** Создание занятия: проверка владения курсом, времени и конфликтов. */
  async create(input: ScheduleCreateInput, userId: string, role: RoleName) {
    if (role !== 'TEACHER' && role !== 'ADMIN' && role !== 'MANAGER') {
      throw forbidden('Создавать занятия может преподаватель, менеджер или администратор')
    }

    const course = await this.prisma.client.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, title: true, teacherId: true },
    })
    if (!course) throw notFound('Курс не найден')
    if (role === 'TEACHER' && course.teacherId !== userId) {
      throw forbidden('Курс принадлежит другому преподавателю')
    }

    const startsAt = new Date(input.startsAt)
    if (Number.isNaN(startsAt.getTime())) throw badRequest('Некорректная дата начала')

    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000)
    if (endsAt.getTime() <= Date.now()) throw badRequest('Занятие должно заканчиваться в будущем')

    await this.assertNoConflict({
      courseId: course.id,
      teacherId: course.teacherId,
      startsAt,
      endsAt,
    })

    const created = await this.prisma.client.$transaction(async (tx) => {
      const schedule = await tx.schedule.create({
        data: {
          courseId: course.id,
          teacherId: course.teacherId,
          title: input.title,
          description: input.description ?? null,
          startsAt,
          endsAt,
        },
        include: {
          course: { select: { id: true, title: true, teacher: { select: { firstName: true, lastName: true } } } },
          room: { select: { id: true, status: true } },
        },
      })

      return schedule
    })

    const students = await this.prisma.client.courseEnrollment.findMany({
      where: { courseId: course.id, status: 'ACTIVE' },
      select: { studentId: true },
    })
    if (students.length > 0) {
      await notifyUsers(students.map((item) => item.studentId), {
        type: 'SCHEDULE_CHANGED',
        title: 'Новое занятие в расписании',
        body: `${course.title}: ${input.title}`,
        data: { kind: 'schedule', scheduleId: created.id, courseId: course.id },
      })
    }

    await writeAudit({
      actorId: userId,
      action: 'schedule.created',
      entity: 'schedule',
      entityId: created.id,
      metadata: { courseId: course.id, startsAt: startsAt.toISOString(), durationMinutes: input.durationMinutes },
    })

    return this.toCard(created)
  }

  /**
   * Пересечение по времени запрещено в двух случаях:
   * у преподавателя уже есть занятие в этом интервале или тот же курс уже идёт.
   * Отменённые занятия конфликтом не считаются.
   */
  private async assertNoConflict(input: {
    courseId: string
    teacherId: string
    startsAt: Date
    endsAt: Date
  }): Promise<void> {
    const overlapping = await this.prisma.client.schedule.findFirst({
      where: {
        status: { not: 'CANCELLED' },
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
        OR: [{ teacherId: input.teacherId }, { courseId: input.courseId }],
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        course: { select: { title: true } },
      },
      orderBy: { startsAt: 'asc' },
    })

    if (!overlapping) return

    const formatter = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bishkek',
    })
    throw conflict(
      `Пересечение с занятием «${overlapping.title}» (${overlapping.course.title}) ` +
        `${formatter.format(overlapping.startsAt)} — ${formatter.format(overlapping.endsAt)}`,
    )
  }

  private toCard(item: {
    id: string
    title: string
    description: string | null
    startsAt: Date
    endsAt: Date
    timezone: string
    status: string
    course: { id: string; title: string; teacher: { firstName: string; lastName: string } }
    room: { id: string; status: string } | null
  }) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      timezone: item.timezone,
      status: item.status,
      course: { id: item.course.id, title: item.course.title },
      teacher: `${item.course.teacher.firstName} ${item.course.teacher.lastName}`.trim(),
      hasRoom: Boolean(item.room),
    }
  }
}
