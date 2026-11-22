import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { forbidden } from '../../../lib/errors.js'
import { writeAudit } from '../../../lib/audit.js'
import { aiJson } from '../../assessment/ai.service.js'
import { PrismaService } from '../../../nest/prisma/prisma.service.js'
import { BRANCH_TIMEZONE, addDays, parseTime } from '../scheduling.time.js'
import { SchedulingSettingsService } from './scheduling-settings.service.js'

/** Статистика расписания и AI-анализ нагрузки. */
@Injectable()
export class SchedulingAnalyticsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SchedulingSettingsService) private readonly settings: SchedulingSettingsService,
  ) {}

  private assertStaff(role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'TEACHER') {
      throw forbidden('Раздел доступен наставнику, менеджеру или администратору')
    }
  }

  async stats(from: Date, to: Date, userId: string, role: RoleName) {
    const scope: Prisma.ScheduleWhereInput =
      role === 'TEACHER' ? { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] } : {}
    const [schedules, attendance, rooms, settings] = await Promise.all([
      this.prisma.client.schedule.findMany({
        where: { ...scope, startsAt: { lt: to }, endsAt: { gt: from } },
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          teacherId: true,
          classroomId: true,
          kind: true,
        },
      }),
      this.prisma.client.attendance.findMany({
        where: {
          schedule: {
            ...scope,
            startsAt: { lt: to },
            endsAt: { gt: from },
            status: { not: 'CANCELLED' },
          },
        },
        select: { status: true, durationSeconds: true },
      }),
      this.prisma.client.classroom.findMany({ select: { id: true, name: true, capacity: true } }),
      this.settings.branchSettings(),
    ])

    const now = Date.now()
    const cancelled = schedules.filter((item) => item.status === 'CANCELLED')
    const conducted = schedules.filter(
      (item) => item.status !== 'CANCELLED' && item.kind === 'REGULAR' && item.endsAt.getTime() < now,
    )
    const byTeacher = new Map<string, { minutes: number; lessons: number; cancelled: number }>()
    for (const item of schedules) {
      const entry = byTeacher.get(item.teacherId) ?? { minutes: 0, lessons: 0, cancelled: 0 }
      if (item.status === 'CANCELLED') entry.cancelled += 1
      else {
        entry.lessons += 1
        entry.minutes += Math.round((item.endsAt.getTime() - item.startsAt.getTime()) / 60_000)
      }
      byTeacher.set(item.teacherId, entry)
    }
    const teacherIds = [...byTeacher.keys()]
    const teachers = await this.prisma.client.user.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, firstName: true, lastName: true },
    })
    const teacherName = new Map(teachers.map((item) => [item.id, `${item.firstName} ${item.lastName}`.trim()]))

    const workingStart = parseTime(settings.workingHoursStart)
    const workingEnd = parseTime(settings.workingHoursEnd)
    const workingMinutes = Math.max(60, workingEnd.hours * 60 + workingEnd.minutes - (workingStart.hours * 60 + workingStart.minutes))
    const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60_000)))

    return {
      period: { from, to },
      lessons: {
        total: schedules.filter((item) => item.kind === 'REGULAR').length,
        conducted: conducted.length,
        cancelled: cancelled.length,
        cancelRate:
          schedules.filter((item) => item.kind === 'REGULAR').length === 0
            ? 0
            : Math.round(
                (cancelled.filter((item) => item.kind === 'REGULAR').length /
                  schedules.filter((item) => item.kind === 'REGULAR').length) *
                  100,
              ),
        extra: schedules.filter((item) => item.kind === 'EXTRA').length,
      },
      attendance: {
        marked: attendance.length,
        present: attendance.filter((item) => item.status !== 'ABSENT').length,
        absent: attendance.filter((item) => item.status === 'ABSENT').length,
        late: attendance.filter((item) => item.status === 'LATE').length,
        earlyLeave: attendance.filter((item) => item.status === 'LEFT_EARLY').length,
        totalHours: Math.round((attendance.reduce((sum, item) => sum + item.durationSeconds, 0) / 3600) * 10) / 10,
      },
      teacherLoad: [...byTeacher.entries()]
        .map(([id, value]) => ({
          teacherId: id,
          teacher: teacherName.get(id) ?? 'Наставник',
          lessons: value.lessons,
          cancelled: value.cancelled,
          hours: Math.round((value.minutes / 60) * 10) / 10,
        }))
        .sort((a, b) => b.hours - a.hours),
      classroomUsage: rooms.map((room) => {
        const bookings = schedules.filter(
          (item) => item.classroomId === room.id && item.status !== 'CANCELLED',
        )
        const bookedMinutes = bookings.reduce(
          (sum, item) =>
            sum +
            Math.max(
              0,
              (Math.min(item.endsAt.getTime(), to.getTime()) - Math.max(item.startsAt.getTime(), from.getTime())) / 60_000,
            ),
          0,
        )
        return {
          id: room.id,
          name: room.name,
          capacity: room.capacity,
          lessons: bookings.length,
          hours: Math.round((bookedMinutes / 60) * 10) / 10,
          utilization: Math.min(100, Math.round((bookedMinutes / (workingMinutes * days)) * 100)),
        }
      }),
    }
  }

  async aiAnalyze(userId: string, role: RoleName) {
    this.assertStaff(role)
    const from = new Date()
    const to = addDays(from, 14)
    const scope: Prisma.ScheduleWhereInput =
      role === 'TEACHER' ? { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] } : {}
    const schedules = await this.prisma.client.schedule.findMany({
      where: { ...scope, startsAt: { lt: to }, endsAt: { gt: from }, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        teacherId: true,
        classroomId: true,
        deliveryMode: true,
        capacity: true,
        course: { select: { title: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } },
        classroom: { select: { name: true, capacity: true } },
      },
      orderBy: { startsAt: 'asc' },
    })
    const rooms = await this.prisma.client.classroom.findMany({ select: { id: true, name: true, capacity: true } })
    const loadByTeacher = new Map<string, { lessons: number; minutes: number }>()
    for (const item of schedules) {
      const load = loadByTeacher.get(item.teacherId) ?? { lessons: 0, minutes: 0 }
      load.lessons += 1
      load.minutes += Math.max(0, Math.round((item.endsAt.getTime() - item.startsAt.getTime()) / 60_000))
      loadByTeacher.set(item.teacherId, load)
    }
    const teacherIds = [...loadByTeacher.keys()]
    const teachers = await this.prisma.client.user.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, firstName: true, lastName: true },
    })
    const teacherName = new Map(teachers.map((item) => [item.id, `${item.firstName} ${item.lastName}`.trim()]))
    const teacherLoad = [...loadByTeacher.entries()].map(([teacherId, value]) => ({
      teacherId,
      teacher: teacherName.get(teacherId) ?? 'Наставник',
      lessons: value.lessons,
      hours: Math.round((value.minutes / 60) * 10) / 10,
    }))

    const payload = schedules.map((item) => ({
      id: item.id,
      title: item.title,
      course: item.course.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      teacherId: item.teacherId,
      room: item.classroom?.name ?? null,
      roomCapacity: item.classroom?.capacity ?? null,
      classroomId: item.classroomId,
      enrolled: item.course._count.enrollments,
      deliveryMode: item.deliveryMode,
    }))

    const result = await aiJson<{
      summary?: string
      suggestions?: Array<{ title: string; reason: string; impact?: string; scheduleIds?: string[] }>
      risks?: string[]
    }>(
      [
        'Ты — аналитик расписания образовательного филиала ITadis.',
        'Анализируй только переданные занятия. Не выдумывай данные.',
        'Ищи перегрузку наставников, простои аудиторий, несоответствие вместимости, неудобные окна и возможности объединить группы.',
        'Для каждого предложения укажи конкретные scheduleIds и ожидаемый эффект: освободившиеся часы, аудиторию или более равномерную нагрузку.',
        'Верни JSON: summary (строка), suggestions (массив {title, reason, impact, scheduleIds}), risks (массив строк).',
        'Все рекомендации носят совещательный характер: окончательное решение принимает менеджер.',
      ].join('\n'),
      JSON.stringify({ period: { from, to }, timezone: BRANCH_TIMEZONE, schedules: payload, rooms, teacherLoad }),
      1600,
    )

    await writeAudit({ actorId: userId, action: 'schedule.ai.analyze', entity: 'Schedule' })
    return {
      ...result,
      disclaimer: 'AI предлагает варианты; изменения расписания применяет менеджер или администратор.',
      checkedSchedules: schedules.length,
    }
  }
}
