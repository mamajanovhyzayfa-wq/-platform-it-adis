import { Inject, Injectable } from '@nestjs/common'
import type { CalendarProvider, Prisma, RoleName } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { env } from '../../config/env.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { taskSchema, taskUpdateSchema } from '../../modules/scheduling/scheduling.schemas.js'
import {
  BRANCH_TIMEZONE,
  addDays,
  parseTime,
  startOfLocalDay,
} from './scheduling.time.js'

type CalendarEventType = 'lesson' | 'task' | 'homework' | 'exam'

const DEFAULT_TYPES: CalendarEventType[] = ['lesson', 'task', 'homework', 'exam']

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Календари всех ролей, задачи, свободное время и синхронизация.
 *
 * Наружу ITadis отдаёт стандартный ICS-фид с токеном-возможностью.
 * Его можно подписать в Google Calendar, Apple Calendar и Outlook без OAuth —
 * это официальный механизм подписки на внешний календарь.
 */
@Injectable()
export class CalendarService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async scope(userId: string, role: RoleName): Promise<Prisma.ScheduleWhereInput> {
    if (role === 'ADMIN' || role === 'MANAGER') return {}
    if (role === 'TEACHER') return { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] }
    if (role === 'STUDENT') {
      return {
        AND: [
          {
            OR: [
              { course: { enrollments: { some: { studentId: userId } } } },
              { extraEnrollments: { some: { userId, status: 'REGISTERED' } } },
            ],
          },
          { OR: [{ kind: 'REGULAR' }, { publishedAt: { not: null } }] },
        ],
      }
    }
    return { id: { in: [] } }
  }

  private async branchSettings() {
    return this.prisma.client.branchSettings.upsert({
      where: { id: 'branch' },
      create: { id: 'branch' },
      update: {},
    })
  }

  async calendar(
    userId: string,
    role: RoleName,
    query: {
      from: Date
      to: Date
      courseId?: string
      teacherId?: string
      classroomId?: string
      types?: string
      status?: string
    },
  ) {
    if (query.from >= query.to) throw badRequest('Начало периода должно быть раньше конца')
    const types = (query.types ? query.types.split(',').filter(Boolean) : DEFAULT_TYPES) as CalendarEventType[]
    const events: Array<Record<string, unknown>> = []
    const scope = await this.scope(userId, role)

    if (types.includes('lesson')) {
      const schedules = await this.prisma.client.schedule.findMany({
        where: {
          ...scope,
          ...(query.courseId ? { courseId: query.courseId } : {}),
          ...(query.teacherId ? { teacherId: query.teacherId } : {}),
          ...(query.classroomId ? { classroomId: query.classroomId } : {}),
          ...(query.status && query.status !== 'ALL' ? { status: query.status as 'SCHEDULED' } : {}),
          startsAt: { lt: query.to },
          endsAt: { gt: query.from },
        },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
              enrollments: { where: { studentId: userId, status: 'ACTIVE' }, select: { id: true }, take: 1 },
            },
          },
          classroom: { select: { id: true, name: true, location: true } },
          room: { select: { id: true, status: true, providerRoomId: true } },
          cancelledBy: { select: { firstName: true, lastName: true } },
          extraEnrollments: { where: { userId }, select: { status: true }, take: 1 },
          _count: { select: { extraEnrollments: { where: { status: 'REGISTERED' } } } },
        },
        orderBy: { startsAt: 'asc' },
        take: 500,
      })
      const teacherIds = [...new Set(schedules.map((item) => item.teacherId))]
      const teachers = await this.prisma.client.user.findMany({
        where: { id: { in: teacherIds } },
        select: { id: true, firstName: true, lastName: true },
      })
      const teacherName = new Map(teachers.map((item) => [item.id, `${item.firstName} ${item.lastName}`.trim()]))
      for (const item of schedules) {
        const baseEnrolled = item.course._count.enrollments
        const extraEnrolled = item._count.extraEnrollments
        const isCourseStudent = item.course.enrollments.length > 0
        const myExtraEnrollment = item.extraEnrollments[0]?.status ?? null
        const seatsLeft = item.capacity ? Math.max(0, item.capacity - baseEnrolled - extraEnrolled) : null
        events.push({
          id: `lesson:${item.id}`,
          entityId: item.id,
          type: 'lesson',
          title: item.title,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          allDay: false,
          status: item.status,
          kind: item.kind,
          deliveryMode: item.deliveryMode,
          course: { id: item.course.id, title: item.course.title },
          teacher: teacherName.get(item.teacherId) ?? null,
          classroom: item.classroom,
          location: item.classroom?.name ?? (item.deliveryMode === 'ONLINE' ? 'Онлайн' : null),
          canJoin: item.deliveryMode !== 'OFFLINE' && item.status !== 'CANCELLED' && Boolean(item.room?.providerRoomId),
          extraSeats: item.kind === 'EXTRA' ? seatsLeft : null,
          isCourseStudent,
          myExtraEnrollment,
          canEnrollExtra:
            role === 'STUDENT' &&
            item.kind === 'EXTRA' &&
            Boolean(item.allowSelfEnrollment) &&
            item.status !== 'CANCELLED' &&
            item.startsAt.getTime() > Date.now() &&
            !isCourseStudent &&
            (seatsLeft === null || seatsLeft > 0),
          cancellationReason: item.cancellationReason,
          cancelledAt: item.cancelledAt,
          cancelledBy: item.cancelledBy
            ? { name: `${item.cancelledBy.firstName} ${item.cancelledBy.lastName}`.trim() }
            : null,
        })
      }
    }

    if (types.includes('task')) {
      const tasks = await this.prisma.client.calendarTask.findMany({
        where: { userId, dueAt: { gte: query.from, lt: query.to } },
        include: { course: { select: { id: true, title: true } } },
        orderBy: { dueAt: 'asc' },
      })
      for (const task of tasks) {
        events.push({
          id: `task:${task.id}`,
          entityId: task.id,
          type: 'task',
          title: task.title,
          startsAt: task.dueAt,
          endsAt: task.dueAt,
          allDay: false,
          completed: Boolean(task.completedAt),
          description: task.description,
          course: task.course,
        })
      }
    }

    if (types.includes('homework')) {
      const where: Prisma.HomeworkWhereInput =
        role === 'STUDENT'
          ? { course: { enrollments: { some: { studentId: userId } } }, dueAt: { gte: query.from, lt: query.to } }
          : role === 'TEACHER'
            ? { course: { teacherId: userId }, dueAt: { gte: query.from, lt: query.to } }
            : { dueAt: { gte: query.from, lt: query.to } }
      if (role !== 'PARENT') {
        const homework = await this.prisma.client.homework.findMany({
          where,
          include: { course: { select: { id: true, title: true } } },
          orderBy: { dueAt: 'asc' },
          take: 200,
        })
        for (const item of homework) {
          events.push({
            id: `homework:${item.id}`,
            entityId: item.id,
            type: 'homework',
            title: `ДЗ: ${item.title}`,
            startsAt: item.dueAt,
            endsAt: item.dueAt,
            allDay: false,
            course: item.course,
            link: '/homework',
          })
        }
      }
    }

    if (types.includes('exam')) {
      const where: Prisma.ExamWhereInput =
        role === 'STUDENT'
          ? {
              isPublished: true,
              OR: [{ courseId: null }, { course: { enrollments: { some: { studentId: userId } } } }],
              startsAt: { lt: query.to },
              endsAt: { gt: query.from },
            }
          : role === 'TEACHER'
            ? { OR: [{ createdById: userId }, { course: { teacherId: userId } }], startsAt: { lt: query.to }, endsAt: { gt: query.from } }
            : { startsAt: { lt: query.to }, endsAt: { gt: query.from } }
      if (role !== 'PARENT') {
        const exams = await this.prisma.client.exam.findMany({
          where,
          include: { course: { select: { id: true, title: true } } },
          orderBy: { startsAt: 'asc' },
          take: 100,
        })
        for (const item of exams) {
          events.push({
            id: `exam:${item.id}`,
            entityId: item.id,
            type: 'exam',
            title: `Экзамен: ${item.title}`,
            startsAt: item.startsAt,
            endsAt: item.endsAt,
            allDay: false,
            course: item.course,
            link: '/exams',
          })
        }
      }
    }

    events.sort((a, b) => new Date(a.startsAt as string).getTime() - new Date(b.startsAt as string).getTime())
    return {
      items: events,
      range: { from: query.from, to: query.to, timezone: BRANCH_TIMEZONE },
      filters: { types, status: query.status ?? 'SCHEDULED' },
    }
  }

  async freeSlots(
    userId: string,
    role: RoleName,
    query: {
      from: Date
      to: Date
      durationMinutes: number
      teacherId?: string
      classroomId?: string
      courseId?: string
    },
  ) {
    const settings = await this.branchSettings()
    const start = parseTime(settings.workingHoursStart)
    const end = parseTime(settings.workingHoursEnd)
    const step = settings.slotStepMinutes
    const teacherId = query.teacherId ?? (role === 'TEACHER' ? userId : undefined)
    const course = query.courseId
      ? await this.prisma.client.course.findUnique({
          where: { id: query.courseId },
          select: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
        })
      : null

    // Занятость наставника и группы. Без выбранного наставника считаем слот
    // свободным только если в это время нет ни одного занятия. При фильтре
    // только по аудитории занятость проверяется отдельно по броням комнат.
    const busy: Array<{ startsAt: Date; endsAt: Date }> = []
    if (teacherId || query.courseId || !query.classroomId) {
      busy.push(
        ...(await this.prisma.client.schedule.findMany({
          where: {
            status: { not: 'CANCELLED' },
            startsAt: { lt: query.to },
            endsAt: { gt: query.from },
            ...(teacherId ? { teacherId } : {}),
            ...(query.courseId ? { courseId: query.courseId } : {}),
          },
          select: { startsAt: true, endsAt: true },
        })),
      )
    }
    // Аудитории проверяются по всем занятиям филиала, а не только по видимым пользователю.
    const roomBookings = await this.prisma.client.schedule.findMany({
      where: {
        status: { not: 'CANCELLED' },
        classroomId: { not: null },
        startsAt: { lt: query.to },
        endsAt: { gt: query.from },
        ...(query.classroomId ? { classroomId: query.classroomId } : {}),
      },
      select: { classroomId: true, startsAt: true, endsAt: true },
    })
    const rooms = (
      await this.prisma.client.classroom.findMany({
        where: { isActive: true, ...(query.classroomId ? { id: query.classroomId } : {}) },
        select: { id: true, name: true, capacity: true },
      })
    ).filter((room) => !course || room.capacity === 0 || room.capacity >= course._count.enrollments)

    const slots: Array<{ startsAt: Date; endsAt: Date; freeRooms: typeof rooms }> = []
    const days = Math.min(31, Math.ceil((query.to.getTime() - query.from.getTime()) / (24 * 60 * 60_000)))
    for (let day = 0; day < days && slots.length < 10; day += 1) {
      const base = startOfLocalDay(addDays(query.from, day))
      for (
        let minutes = start.hours * 60 + start.minutes;
        minutes + query.durationMinutes <= end.hours * 60 + end.minutes;
        minutes += step
      ) {
        const candidateStart = new Date(base.getTime() + minutes * 60_000)
        const candidateEnd = new Date(candidateStart.getTime() + query.durationMinutes * 60_000)
        if (candidateStart < new Date() || candidateStart < query.from || candidateEnd > query.to) continue
        const clash = busy.some((item) => candidateStart < item.endsAt && candidateEnd > item.startsAt)
        if (clash) continue
        const freeRooms = rooms.filter(
          (room) =>
            !roomBookings.some(
              (booking) =>
                booking.classroomId === room.id &&
                candidateStart < booking.endsAt &&
                candidateEnd > booking.startsAt,
            ),
        )
        if (query.classroomId && freeRooms.length === 0) continue
        slots.push({ startsAt: candidateStart, endsAt: candidateEnd, freeRooms })
        if (slots.length >= 10) break
      }
    }

    return {
      items: slots.map((slot) => ({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        freeRooms: slot.freeRooms,
      })),
      workingHours: { start: settings.workingHoursStart, end: settings.workingHoursEnd },
    }
  }

  async tasks(userId: string) {
    const items = await this.prisma.client.calendarTask.findMany({
      where: { userId },
      orderBy: [{ completedAt: 'asc' }, { dueAt: 'asc' }],
      take: 300,
      include: { course: { select: { id: true, title: true } } },
    })
    return { items }
  }

  async createTask(userId: string, input: z.infer<typeof taskSchema>) {
    return this.prisma.client.calendarTask.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        dueAt: new Date(input.dueAt),
        courseId: input.courseId ?? null,
      },
    })
  }

  async updateTask(id: string, userId: string, input: z.infer<typeof taskUpdateSchema>) {
    const task = await this.prisma.client.calendarTask.findUnique({ where: { id } })
    if (!task) throw notFound('Задача не найдена')
    if (task.userId !== userId) throw forbidden('Задача принадлежит другому пользователю')
    return this.prisma.client.calendarTask.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
        ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
        ...(input.completed !== undefined ? { completedAt: input.completed ? new Date() : null } : {}),
      },
    })
  }

  async deleteTask(id: string, userId: string) {
    const task = await this.prisma.client.calendarTask.findUnique({ where: { id } })
    if (!task) throw notFound('Задача не найдена')
    if (task.userId !== userId) throw forbidden('Задача принадлежит другому пользователю')
    await this.prisma.client.calendarTask.delete({ where: { id } })
    return { ok: true }
  }

  async connections(userId: string) {
    const items = await this.prisma.client.calendarConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })
    return {
      items: items.map((item) => ({
        id: item.id,
        provider: item.provider,
        isActive: item.isActive,
        feedUrl: `/api/scheduling/calendar/feed/${item.feedToken}.ics`,
        webcalUrl: `webcal://${new URL(env.API_PUBLIC_URL ?? 'http://localhost:4000').host}/api/scheduling/calendar/feed/${item.feedToken}.ics`,
        lastSyncedAt: item.lastSyncedAt,
        createdAt: item.createdAt,
      })),
      instructions: {
        GOOGLE: 'Google Calendar → Другие календари → Добавить по URL.',
        APPLE: 'Календарь → Файл → Новая подписка на календарь, вставьте webcal-ссылку.',
        OUTLOOK: 'Outlook → Добавить календарь → Подписаться из Интернета.',
      },
    }
  }

  async createConnection(userId: string, provider: CalendarProvider) {
    const existing = await this.prisma.client.calendarConnection.findUnique({
      where: { userId_provider: { userId, provider } },
    })
    if (existing) {
      const feedUrl = `/api/scheduling/calendar/feed/${existing.feedToken}.ics`
      const host = new URL(env.API_PUBLIC_URL ?? 'http://localhost:4000').host
      return { ...existing, feedUrl, webcalUrl: `webcal://${host}${feedUrl}` }
    }
    const connection = await this.prisma.client.calendarConnection.create({
      data: { userId, provider, feedToken: randomBytes(24).toString('hex') },
    })
    const feedUrl = `/api/scheduling/calendar/feed/${connection.feedToken}.ics`
    const host = new URL(env.API_PUBLIC_URL ?? 'http://localhost:4000').host
    return { ...connection, feedUrl, webcalUrl: `webcal://${host}${feedUrl}` }
  }

  async deleteConnection(id: string, userId: string) {
    const connection = await this.prisma.client.calendarConnection.findUnique({ where: { id } })
    if (!connection) throw notFound('Подписка не найдена')
    if (connection.userId !== userId) throw forbidden('Подписка принадлежит другому пользователю')
    await this.prisma.client.calendarConnection.delete({ where: { id } })
    return { ok: true }
  }

  /** Публичный ICS-фид: доступ по одноразовому токену-возможности. */
  async feed(token: string) {
    const connection = await this.prisma.client.calendarConnection.findUnique({
      where: { feedToken: token.replace(/\.ics$/, '') },
      include: { user: { select: { id: true, role: true } } },
    })
    if (!connection || !connection.isActive) throw notFound('Календарь не найден')
    await this.prisma.client.calendarConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date() },
    })

    const from = new Date(Date.now() - 30 * 24 * 60 * 60_000)
    const to = new Date(Date.now() + 180 * 24 * 60 * 60_000)
    const data = await this.calendar(connection.user.id, connection.user.role, {
      from,
      to,
      status: 'SCHEDULED',
    })

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ITadis//Schedule//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:ITadis',
      `X-WR-TIMEZONE:${BRANCH_TIMEZONE}`,
    ]
    for (const item of data.items) {
      const start = new Date(item.startsAt as string)
      const end = new Date(item.endsAt as string)
      const description = [
        item.course ? `Курс: ${(item.course as { title: string }).title}` : null,
        item.teacher ? `Наставник: ${item.teacher}` : null,
        item.classroom ? `Аудитория: ${(item.classroom as { name: string }).name}` : null,
        item.type === 'lesson' && item.deliveryMode === 'ONLINE' ? 'Онлайн-занятие' : null,
      ]
        .filter(Boolean)
        .join('\n')
      lines.push(
        'BEGIN:VEVENT',
        `UID:${item.id}@itadis`,
        `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${icsEscape(String(item.title))}`,
        `DESCRIPTION:${icsEscape(description)}`,
        `LOCATION:${icsEscape(String(item.location ?? ''))}`,
        'END:VEVENT',
      )
    }
    lines.push('END:VCALENDAR')
    return lines.join('\r\n')
  }
}
