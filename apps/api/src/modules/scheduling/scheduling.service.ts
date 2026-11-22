import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type RoleName } from '@prisma/client'
import { z } from 'zod'
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { awardCoins, COIN_RULES } from '../../lib/coins.js'
import { notifyUsers } from '../../lib/notify.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { VideoService } from './video.service.js'
import { AiCenterService } from '../ai-center/ai-center.service.js'
import { SchedulingSettingsService } from './services/scheduling-settings.service.js'
import { SchedulingClassroomsService } from './services/scheduling-classrooms.service.js'
import {
  attendanceMarkSchema,
  cancelSchema,
  changeDecisionSchema,
  changeRequestSchema,
  recurringSchema,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  substituteSchema,
  templateSchema,
  templateUpdateSchema,
} from '../../modules/scheduling/scheduling.schemas.js'
import {
  BRANCH_TIMEZONE,
  addDays,
  combineLocal,
  formatLocal,
  localWeekday,
  manualAttendanceTiming,
  minutesOfDay,
  overlaps,
  parseTime,
  seriesDates,
  startOfLocalDay,
} from './scheduling.time.js'

type ScheduleCreate = z.infer<typeof scheduleCreateSchema>
type ScheduleUpdate = z.infer<typeof scheduleUpdateSchema>
type RecurringCreate = z.infer<typeof recurringSchema>
type TemplateInput = z.infer<typeof templateSchema>
type TemplateUpdate = z.infer<typeof templateUpdateSchema>
type ChangeRequest = z.infer<typeof changeRequestSchema>

const MAX_SERIES_OCCURRENCES = 180

const scheduleInclude = {
  course: {
    select: {
      id: true,
      title: true,
      teacherId: true,
      recordingEnabled: true,
      recordingAuto: true,
      endDate: true,
      _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
    },
  },
  classroom: { select: { id: true, name: true, capacity: true, equipment: true, location: true } },
  room: {
    select: {
      id: true,
      provider: true,
      roomName: true,
      providerRoomId: true,
      status: true,
      startedAt: true,
      endedAt: true,
    },
  },
  series: { select: { id: true, rule: true, weekdays: true, interval: true } },
  cancelledBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { extraEnrollments: { where: { status: 'REGISTERED' } } } },
} satisfies Prisma.ScheduleInclude

/**
 * Расписание, серии, переносы, замены и дополнительные занятия.
 * Аудитории и настройки записи вынесены в services/.
 *
 * Все конфликты проверяются на сервере: наставник, группа, аудитория и вместимость.
 * Перенос, инициированный наставником, создаёт заявку и применяется только после
 * решения менеджера или администратора.
 */
@Injectable()
export class SchedulingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VideoService) private readonly video: VideoService,
    @Inject(AiCenterService) private readonly ai: AiCenterService,
    @Inject(SchedulingSettingsService) private readonly settings: SchedulingSettingsService,
    @Inject(SchedulingClassroomsService) private readonly rooms: SchedulingClassroomsService,
  ) {}

  private isManager(role: RoleName) {
    return role === 'ADMIN' || role === 'MANAGER'
  }

  private assertStaff(role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'TEACHER') {
      throw forbidden('Раздел доступен наставнику, менеджеру или администратору')
    }
  }

  async courses(userId: string, role: RoleName) {
    if (role === 'PARENT') throw forbidden('Календарь доступен ученику, наставнику, менеджеру и администратору')
    const items = await this.prisma.client.course.findMany({
      where:
        role === 'TEACHER'
          ? { teacherId: userId }
          : role === 'STUDENT'
            ? { enrollments: { some: { studentId: userId, status: 'ACTIVE' } } }
            : {},
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        status: true,
        teacherId: true,
        recordingEnabled: true,
        recordingAuto: true,
        endDate: true,
        teacher: { select: { firstName: true, lastName: true } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    })
    return {
      items: items.map((course) => ({
        id: course.id,
        title: course.title,
        status: course.status,
        teacherId: course.teacherId,
        teacher: `${course.teacher.firstName} ${course.teacher.lastName}`.trim(),
        students: course._count.enrollments,
        recordingEnabled: course.recordingEnabled,
        recordingAuto: course.recordingAuto,
        endDate: course.endDate,
      })),
    }
  }

  async teachers() {
    const items = await this.prisma.client.user.findMany({
      where: { role: 'TEACHER', isActive: true, deletedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    return { items }
  }

  // ---------- шаблоны ----------

  async templates(userId: string, role: RoleName) {
    this.assertStaff(role)
    const items = await this.prisma.client.scheduleTemplate.findMany({
      where: role === 'TEACHER' ? { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, title: true } },
        teacher: { select: { id: true, firstName: true, lastName: true } },
        classroom: { select: { id: true, name: true, capacity: true } },
      },
    })
    return { items }
  }

  async createTemplate(input: TemplateInput, userId: string, role: RoleName) {
    this.assertStaff(role)
    const course = await this.loadCourse(input.courseId, userId, role)
    const teacherId = input.teacherId ?? course.teacherId
    await this.validateTeacher(teacherId, userId, role, course.teacherId)
    if (input.classroomId) await this.validateClassroom(input.classroomId, course._count.enrollments)

    const template = await this.prisma.client.scheduleTemplate.create({
      data: {
        courseId: course.id,
        teacherId,
        classroomId: input.classroomId ?? null,
        title: input.title,
        description: input.description ?? null,
        weekdays: input.weekdays,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        deliveryMode: input.deliveryMode,
        capacity: input.capacity ?? null,
        allowSelfEnrollment: input.allowSelfEnrollment,
        recordingEnabled: input.recordingEnabled ?? null,
        autoRecord: input.autoRecord ?? null,
        createdById: userId,
      },
    })
    await writeAudit({ actorId: userId, action: 'schedule.template.create', entity: 'ScheduleTemplate', entityId: template.id })
    return template
  }

  async updateTemplate(id: string, input: TemplateUpdate, userId: string, role: RoleName) {
    const template = await this.prisma.client.scheduleTemplate.findUnique({
      where: { id },
      include: { course: { select: { id: true, teacherId: true } } },
    })
    if (!template) throw notFound('Шаблон не найден')
    if (!this.isManager(role) && template.teacherId !== userId && template.course.teacherId !== userId) {
      throw forbidden('Шаблон принадлежит другому наставнику')
    }
    if (input.teacherId) await this.validateTeacher(input.teacherId, userId, role, template.course.teacherId)
    if (input.classroomId) {
      const enrolled = await this.prisma.client.courseEnrollment.count({
        where: { courseId: template.courseId, status: 'ACTIVE' },
      })
      await this.validateClassroom(input.classroomId, enrolled)
    }

    return this.prisma.client.scheduleTemplate.update({
      where: { id },
      data: {
        ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
        ...(input.teacherId !== undefined ? { teacherId: input.teacherId } : {}),
        ...(input.classroomId !== undefined ? { classroomId: input.classroomId } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.weekdays !== undefined ? { weekdays: input.weekdays } : {}),
        ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.deliveryMode !== undefined ? { deliveryMode: input.deliveryMode } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.allowSelfEnrollment !== undefined ? { allowSelfEnrollment: input.allowSelfEnrollment } : {}),
        ...(input.recordingEnabled !== undefined ? { recordingEnabled: input.recordingEnabled } : {}),
        ...(input.autoRecord !== undefined ? { autoRecord: input.autoRecord } : {}),
      },
    })
  }

  async deleteTemplate(id: string, userId: string, role: RoleName) {
    const template = await this.prisma.client.scheduleTemplate.findUnique({
      where: { id },
      include: { course: { select: { teacherId: true } } },
    })
    if (!template) throw notFound('Шаблон не найден')
    if (!this.isManager(role) && template.teacherId !== userId && template.course.teacherId !== userId) {
      throw forbidden('Шаблон принадлежит другому наставнику')
    }
    await this.prisma.client.scheduleTemplate.delete({ where: { id } })
    return { ok: true }
  }

  async applyTemplate(id: string, from: string, to: string, userId: string, role: RoleName) {
    const template = await this.prisma.client.scheduleTemplate.findUnique({
      where: { id },
      include: { course: { select: { id: true, teacherId: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } } },
    })
    if (!template) throw notFound('Шаблон не найден')
    if (!this.isManager(role) && template.teacherId !== userId && template.course.teacherId !== userId) {
      throw forbidden('Шаблон принадлежит другому наставнику')
    }

    return this.createSeries(
      {
        courseId: template.courseId,
        title: template.title,
        description: template.description ?? undefined,
        teacherId: template.teacherId,
        classroomId: template.classroomId,
        deliveryMode: template.deliveryMode,
        rule: 'SELECTED_DAYS',
        weekdays: template.weekdays,
        interval: 1,
        startsOn: from,
        endsOn: to,
        startTime: template.startTime,
        durationMinutes: template.durationMinutes,
        capacity: template.capacity ?? undefined,
        allowSelfEnrollment: template.allowSelfEnrollment,
        recordingEnabled: template.recordingEnabled,
        autoRecord: template.autoRecord,
      },
      userId,
      role,
      template.id,
    )
  }

  // ---------- занятия ----------

  async schedules(userId: string, role: RoleName, query: {
    from: Date
    to: Date
    courseId?: string
    teacherId?: string
    classroomId?: string
    kind?: string
    status?: string
  }) {
    if (query.from >= query.to) throw badRequest('Начало периода должно быть раньше конца')
    const scope = await this.scheduleScope(userId, role)
    const items = await this.prisma.client.schedule.findMany({
      where: {
        ...scope,
        ...(query.courseId ? { courseId: query.courseId } : {}),
        ...(query.teacherId ? { teacherId: query.teacherId } : {}),
        ...(query.classroomId ? { classroomId: query.classroomId } : {}),
        ...(query.kind ? { kind: query.kind as 'REGULAR' | 'EXTRA' } : {}),
        ...(query.status && query.status !== 'ALL' ? { status: query.status as 'SCHEDULED' } : {}),
        startsAt: { lt: query.to },
        endsAt: { gt: query.from },
      },
      include: scheduleInclude,
      orderBy: { startsAt: 'asc' },
      take: 500,
    })

    return {
      items: await Promise.all(items.map((item) => this.toCard(item, userId))),
      range: { from: query.from, to: query.to, timezone: BRANCH_TIMEZONE },
    }
  }

  async scheduleDetail(id: string, userId: string, role: RoleName) {
    const scope = await this.scheduleScope(userId, role)
    const item = await this.prisma.client.schedule.findFirst({
      where: { id, ...scope },
      include: {
        ...scheduleInclude,
        changes: {
          orderBy: { createdAt: 'desc' },
          include: {
            requestedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
            decidedBy: { select: { id: true, firstName: true, lastName: true } },
            proposedTeacher: { select: { id: true, firstName: true, lastName: true } },
            proposedClassroom: { select: { id: true, name: true } },
          },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { actor: { select: { id: true, firstName: true, lastName: true } } },
        },
        substitutions: {
          orderBy: { createdAt: 'desc' },
          include: {
            fromTeacher: { select: { id: true, firstName: true, lastName: true } },
            toTeacher: { select: { id: true, firstName: true, lastName: true } },
            assignedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        attendance: {
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
          orderBy: { user: { lastName: 'asc' } },
        },
        extraEnrollments: {
          where: { status: 'REGISTERED' },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
      },
    })
    if (!item) throw notFound('Занятие не найдено')

    const teacher = await this.prisma.client.user.findUnique({
      where: { id: item.teacherId },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    const students = await this.prisma.client.courseEnrollment.findMany({
      where: { courseId: item.courseId, status: 'ACTIVE' },
      include: { student: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { student: { lastName: 'asc' } },
    })

    const canManage =
      this.isManager(role) || (role === 'TEACHER' && (item.teacherId === userId || item.course.teacherId === userId))

    return {
      ...(await this.toCard(item, userId)),
      description: item.description,
      timezone: item.timezone,
      capacity: item.capacity,
      allowSelfEnrollment: item.allowSelfEnrollment,
      recordingEnabled: item.recordingEnabled,
      autoRecord: item.autoRecord,
      teacherInfo: teacher,
      students: canManage
        ? students.map((row) => ({
            id: row.student.id,
            name: `${row.student.firstName} ${row.student.lastName}`.trim(),
            email: row.student.email,
            attendance: item.attendance.find((entry) => entry.userId === row.student.id) ?? null,
          }))
        : undefined,
      changes: canManage ? item.changes : undefined,
      events: canManage ? item.events : undefined,
      substitutions: canManage ? item.substitutions : undefined,
      attendance: canManage
        ? item.attendance.map((entry) => ({
            id: entry.id,
            userId: entry.userId,
            name: `${entry.user.firstName} ${entry.user.lastName}`.trim(),
            status: entry.status,
            source: entry.source,
            joinedAt: entry.joinedAt,
            leftAt: entry.leftAt,
            durationSeconds: entry.durationSeconds,
            reconnectCount: entry.reconnectCount,
            lateMinutes: entry.lateMinutes,
            earlyLeaveMinutes: entry.earlyLeaveMinutes,
            note: entry.note,
          }))
        : undefined,
      extraEnrollments: item.extraEnrollments.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        name: `${entry.user.firstName} ${entry.user.lastName}`.trim(),
        createdAt: entry.createdAt,
      })),
      canManage,
    }
  }

  async createSchedule(input: ScheduleCreate, userId: string, role: RoleName) {
    this.assertStaff(role)
    const course = await this.loadCourse(input.courseId, userId, role)
    const teacherId = input.teacherId ?? course.teacherId
    await this.validateTeacher(teacherId, userId, role, course.teacherId)
    const startsAt = new Date(input.startsAt)
    if (Number.isNaN(startsAt.getTime())) throw badRequest('Некорректная дата начала')
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000)
    if (endsAt.getTime() <= Date.now()) throw badRequest('Занятие должно заканчиваться в будущем')

    const capacity = await this.resolveCapacity(input.classroomId ?? null, input.capacity ?? null, course._count.enrollments)
    const conflicts = await this.findConflicts({
      courseId: course.id,
      teacherId,
      classroomId: input.classroomId ?? null,
      startsAt,
      endsAt,
      capacity,
      enrolled: course._count.enrollments,
    })
    if (conflicts.length > 0) {
      throw new AppError(409, 'SCHEDULE_CONFLICT', conflicts.map((item) => item.message).join('; '), conflicts)
    }

    const created = await this.prisma.client.schedule.create({
      data: {
        courseId: course.id,
        teacherId,
        title: input.title,
        description: input.description ?? null,
        startsAt,
        endsAt,
        kind: input.kind,
        deliveryMode: input.deliveryMode,
        classroomId: input.classroomId ?? null,
        capacity: capacity || null,
        allowSelfEnrollment: input.kind === 'EXTRA' ? input.allowSelfEnrollment : false,
        publishedAt: input.kind === 'EXTRA' ? (input.published ? new Date() : null) : new Date(),
        recordingEnabled: input.recordingEnabled ?? null,
        autoRecord: input.autoRecord ?? null,
        createdById: userId,
        templateId: input.templateId ?? null,
      },
      include: scheduleInclude,
    })

    await this.logEvent(created.id, userId, 'CREATED', `Занятие создано: ${created.title}`, {
      startsAt,
      teacherId,
    })
    await this.notifyParticipants(created.id, 'Новое занятие в расписании', `${course.title}: ${input.title} — ${formatLocal(startsAt)}`)

    let videoWarning: string | null = null
    if (input.deliveryMode !== 'OFFLINE') {
      try {
        await this.video.ensureRoom(created.id, userId)
      } catch (error) {
        videoWarning = error instanceof Error ? error.message : 'Не удалось создать комнату LiveDigital'
      }
    }

    await writeAudit({ actorId: userId, action: 'schedule.create', entity: 'Schedule', entityId: created.id })
    return { ...(await this.toCard(created, userId)), videoWarning }
  }

  async createSeries(input: RecurringCreate, userId: string, role: RoleName, templateId?: string) {
    this.assertStaff(role)
    const course = await this.loadCourse(input.courseId, userId, role)
    const teacherId = input.teacherId ?? course.teacherId
    await this.validateTeacher(teacherId, userId, role, course.teacherId)
    const capacity = await this.resolveCapacity(input.classroomId ?? null, input.capacity ?? null, course._count.enrollments)
    if (input.classroomId) await this.validateClassroom(input.classroomId, course._count.enrollments)

    const dates = seriesDates({
      rule: input.rule,
      weekdays: input.weekdays,
      interval: input.interval,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    })
    if (dates.length === 0) throw badRequest('По выбранному правилу не получилось ни одной даты')

    const series = await this.prisma.client.scheduleSeries.create({
      data: {
        courseId: course.id,
        templateId: templateId ?? null,
        teacherId,
        classroomId: input.classroomId ?? null,
        title: input.title,
        description: input.description ?? null,
        rule: input.rule,
        weekdays: input.weekdays,
        interval: input.interval,
        startsOn: new Date(`${input.startsOn}T00:00:00.000Z`),
        endsOn: input.endsOn ? new Date(`${input.endsOn}T00:00:00.000Z`) : null,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        deliveryMode: input.deliveryMode,
        capacity: capacity || null,
        allowSelfEnrollment: false,
        recordingEnabled: input.recordingEnabled ?? null,
        autoRecord: input.autoRecord ?? null,
        createdById: userId,
      },
    })

    const created: string[] = []
    const skipped: Array<{ startsAt: string; reason: string }> = []
    for (const date of dates.slice(0, MAX_SERIES_OCCURRENCES)) {
      const startsAt = combineLocal(date, input.startTime)
      if (startsAt.getTime() <= Date.now()) {
        skipped.push({ startsAt: startsAt.toISOString(), reason: 'Время уже прошло' })
        continue
      }
      const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000)
      const conflicts = await this.findConflicts({
        courseId: course.id,
        teacherId,
        classroomId: input.classroomId ?? null,
        startsAt,
        endsAt,
        capacity,
        enrolled: course._count.enrollments,
      })
      if (conflicts.length > 0) {
        skipped.push({ startsAt: startsAt.toISOString(), reason: conflicts.map((item) => item.message).join('; ') })
        continue
      }

      const schedule = await this.prisma.client.schedule.create({
        data: {
          courseId: course.id,
          teacherId,
          title: input.title,
          description: input.description ?? null,
          startsAt,
          endsAt,
          kind: 'REGULAR',
          deliveryMode: input.deliveryMode,
          classroomId: input.classroomId ?? null,
          capacity: capacity || null,
          recordingEnabled: input.recordingEnabled ?? null,
          autoRecord: input.autoRecord ?? null,
          seriesId: series.id,
          templateId: templateId ?? null,
          createdById: userId,
        },
        select: { id: true },
      })
      created.push(schedule.id)
      await this.logEvent(schedule.id, userId, 'SERIES_CREATED', 'Занятие создано серией', {
        seriesId: series.id,
        rule: input.rule,
      })
    }

    if (created.length > 0) {
      await this.notifyParticipants(
        created[0]!,
        'Новое расписание',
        `${course.title}: ${input.title}, занятий: ${created.length}. Первое — ${formatLocal(combineLocal(dates[0]!, input.startTime))}`,
      )
    }

    if (input.deliveryMode !== 'OFFLINE') {
      for (const scheduleId of created) {
        await this.video.ensureRoom(scheduleId, userId).catch((error) => {
          console.warn('[schedule] комната LiveDigital не создана', scheduleId, error)
        })
      }
    }

    await writeAudit({
      actorId: userId,
      action: 'schedule.series.create',
      entity: 'ScheduleSeries',
      entityId: series.id,
      metadata: { created: created.length, skipped: skipped.length },
    })
    return { seriesId: series.id, created: created.length, skipped, dates: dates.length }
  }

  async updateSchedule(id: string, input: ScheduleUpdate, userId: string, role: RoleName) {
    const schedule = await this.loadManageableSchedule(id, userId, role)
    const startsAt = input.startsAt ? new Date(input.startsAt) : schedule.startsAt
    const endsAt = input.durationMinutes
      ? new Date(startsAt.getTime() + input.durationMinutes * 60_000)
      : new Date(startsAt.getTime() + (schedule.endsAt.getTime() - schedule.startsAt.getTime()))
    const teacherId = input.teacherId ?? schedule.teacherId
    const teacherChanged = teacherId !== schedule.teacherId
    const classroomId = input.classroomId !== undefined ? input.classroomId : schedule.classroomId
    const enrolled = schedule.course._count.enrollments
    const capacity = await this.resolveCapacity(
      classroomId,
      input.capacity !== undefined ? input.capacity : schedule.capacity,
      enrolled,
    )

    if (input.teacherId !== undefined && input.teacherId !== schedule.teacherId) {
      await this.validateTeacher(input.teacherId, userId, role, schedule.course.teacherId)
      if (role === 'TEACHER') throw forbidden('Замену наставника назначает менеджер или администратор')
    }

    const conflicts = await this.findConflicts({
      id,
      courseId: schedule.courseId,
      teacherId,
      classroomId,
      startsAt,
      endsAt,
      capacity,
      enrolled,
    })
    if (conflicts.length > 0) {
      throw new AppError(409, 'SCHEDULE_CONFLICT', conflicts.map((item) => item.message).join('; '), conflicts)
    }

    const updated = await this.prisma.client.schedule.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.startsAt !== undefined ? { startsAt } : {}),
        ...(input.durationMinutes !== undefined ? { endsAt } : {}),
        ...(input.teacherId !== undefined ? { teacherId: input.teacherId } : {}),
        ...(teacherChanged ? { originalTeacherId: schedule.originalTeacherId ?? schedule.teacherId } : {}),
        ...(input.classroomId !== undefined ? { classroomId: input.classroomId } : {}),
        ...(input.deliveryMode !== undefined ? { deliveryMode: input.deliveryMode } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.allowSelfEnrollment !== undefined ? { allowSelfEnrollment: input.allowSelfEnrollment } : {}),
        ...(input.published !== undefined
          ? { publishedAt: input.published ? (schedule.publishedAt ?? new Date()) : null }
          : {}),
        ...(input.recordingEnabled !== undefined ? { recordingEnabled: input.recordingEnabled } : {}),
        ...(input.autoRecord !== undefined ? { autoRecord: input.autoRecord } : {}),
        ...(input.startsAt !== undefined || input.durationMinutes !== undefined || input.classroomId !== undefined
          ? { status: 'SCHEDULED' as const }
          : {}),
      },
      include: scheduleInclude,
    })

    await this.logEvent(id, userId, 'UPDATED', 'Занятие изменено', {
      before: { startsAt: schedule.startsAt, teacherId: schedule.teacherId, classroomId: schedule.classroomId },
      after: { startsAt, teacherId, classroomId },
    })
    if (teacherChanged) {
      await this.prisma.client.teacherSubstitution.create({
        data: {
          scheduleId: id,
          fromTeacherId: schedule.teacherId,
          toTeacherId: teacherId,
          assignedById: userId,
          reason: input.changeReason ?? 'Изменение наставника в занятии',
        },
      })
      await this.logEvent(id, userId, 'SUBSTITUTED', 'Замена наставника при редактировании занятия', {
        fromTeacherId: schedule.teacherId,
        toTeacherId: teacherId,
        reason: input.changeReason,
      })
    }
    const rescheduled = schedule.startsAt.getTime() !== startsAt.getTime()
    await this.notifyParticipants(
      id,
      rescheduled ? 'Занятие перенесено' : 'Занятие изменено',
      `«${updated.title}» — ${formatLocal(startsAt)}`,
      teacherChanged ? [schedule.teacherId] : [],
      rescheduled ? 'LESSON_RESCHEDULED' : 'SCHEDULE_CHANGED',
    )

    let videoWarning: string | null = null
    if (updated.deliveryMode !== 'OFFLINE') {
      try {
        await this.video.ensureRoom(id, userId)
      } catch (error) {
        videoWarning = error instanceof Error ? error.message : 'Не удалось создать комнату LiveDigital'
      }
    }
    return { ...(await this.toCard(updated, userId)), videoWarning }
  }

  async cancelSchedule(id: string, reason: string, userId: string, role: RoleName) {
    const schedule = await this.loadManageableSchedule(id, userId, role)
    if (schedule.status === 'CANCELLED') throw conflict('Занятие уже отменено')

    const updated = await this.prisma.client.schedule.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: new Date(),
        cancelledById: userId,
      },
      include: scheduleInclude,
    })
    await this.logEvent(id, userId, 'CANCELLED', `Занятие отменено: ${reason}`, { reason })
    await this.notifyParticipants(
      id,
      'Занятие отменено',
      `«${schedule.title}» ${formatLocal(schedule.startsAt)} отменено. Причина: ${reason}`,
      [],
      'LESSON_CANCELLED',
    )
    await writeAudit({ actorId: userId, action: 'schedule.cancel', entity: 'Schedule', entityId: id, metadata: { reason } })
    return this.toCard(updated, userId)
  }

  async conflicts(id: string | null, input: {
    courseId: string
    teacherId: string
    classroomId?: string | null
    startsAt: string
    durationMinutes: number
  }) {
    const startsAt = new Date(input.startsAt)
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000)
    const enrolled = await this.prisma.client.courseEnrollment.count({
      where: { courseId: input.courseId, status: 'ACTIVE' },
    })
    const capacity = await this.resolveCapacity(input.classroomId ?? null, null, enrolled)
    const conflicts = await this.findConflicts({
      id: id ?? undefined,
      courseId: input.courseId,
      teacherId: input.teacherId,
      classroomId: input.classroomId ?? null,
      startsAt,
      endsAt,
      capacity,
      enrolled,
    })
    return { conflicts, capacity, enrolled }
  }

  private async findConflicts(input: {
    id?: string
    courseId: string
    teacherId: string
    classroomId: string | null
    startsAt: Date
    endsAt: Date
    capacity: number
    enrolled: number
  }) {
    const base: Prisma.ScheduleWhereInput = {
      ...(input.id ? { id: { not: input.id } } : {}),
      status: { not: 'CANCELLED' },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    }
    const clauses: Prisma.ScheduleWhereInput[] = [{ teacherId: input.teacherId }, { courseId: input.courseId }]
    if (input.classroomId) clauses.push({ classroomId: input.classroomId })

    const overlapping = await this.prisma.client.schedule.findMany({
      where: { ...base, OR: clauses },
      select: {
        id: true,
        title: true,
        teacherId: true,
        courseId: true,
        classroomId: true,
        startsAt: true,
        endsAt: true,
        course: { select: { title: true } },
      },
      orderBy: { startsAt: 'asc' },
    })

    const result: Array<{ type: string; message: string; scheduleId?: string }> = []
    for (const item of overlapping) {
      const when = `${item.course.title} · ${formatLocal(item.startsAt)}`
      if (item.teacherId === input.teacherId) {
        result.push({ type: 'TEACHER', message: `Наставник занят: «${item.title}» (${when})`, scheduleId: item.id })
      }
      if (item.courseId === input.courseId) {
        result.push({ type: 'GROUP', message: `У группы уже есть занятие: «${item.title}» (${when})`, scheduleId: item.id })
      }
      if (input.classroomId && item.classroomId === input.classroomId) {
        result.push({ type: 'CLASSROOM', message: `Аудитория занята: «${item.title}» (${when})`, scheduleId: item.id })
      }
    }
    if (input.capacity > 0 && input.enrolled > input.capacity) {
      result.push({
        type: 'CAPACITY',
        message: `Превышена вместимость: в группе ${input.enrolled}, аудитория вмещает ${input.capacity}`,
      })
    }

    const seen = new Set<string>()
    return result.filter((item) => {
      const key = `${item.type}:${item.scheduleId ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  async alternatives(id: string, userId: string, role: RoleName) {
    const schedule = await this.loadManageableSchedule(id, userId, role)
    const settings = await this.settings.branchSettings()
    const durationMs = schedule.endsAt.getTime() - schedule.startsAt.getTime()
    const startMinutes = parseTime(settings.workingHoursStart)
    const endMinutes = parseTime(settings.workingHoursEnd)
    const step = settings.slotStepMinutes
    const enrolled = schedule.course._count.enrollments
    const capacity = await this.resolveCapacity(schedule.classroomId, schedule.capacity, enrolled)

    const from = new Date(Math.max(Date.now() + 60 * 60_000, schedule.startsAt.getTime()))
    const to = addDays(from, 21)
    const busy = await this.prisma.client.schedule.findMany({
      where: {
        id: { not: id },
        status: { not: 'CANCELLED' },
        startsAt: { lt: to },
        endsAt: { gt: from },
        OR: [{ teacherId: schedule.teacherId }, { courseId: schedule.courseId }],
      },
      select: { teacherId: true, courseId: true, startsAt: true, endsAt: true },
    })
    const roomBusy = schedule.classroomId
      ? await this.prisma.client.schedule.findMany({
          where: {
            id: { not: id },
            classroomId: schedule.classroomId,
            status: { not: 'CANCELLED' },
            startsAt: { lt: to },
            endsAt: { gt: from },
          },
          select: { startsAt: true, endsAt: true },
        })
      : []

    const slots: Array<{ startsAt: string; endsAt: string; teacherFree: boolean }> = []
    for (let day = 0; day < 21 && slots.length < 8; day += 1) {
      const base = addDays(startOfLocalDay(from), day)
      for (let minutes = startMinutes.hours * 60 + startMinutes.minutes; minutes + durationMs / 60_000 <= endMinutes.hours * 60 + endMinutes.minutes; minutes += step) {
        const candidateStart = new Date(base.getTime() + minutes * 60_000)
        const candidateEnd = new Date(candidateStart.getTime() + durationMs)
        if (candidateStart.getTime() <= Date.now()) continue
        const clash = busy.some(
          (item) =>
            overlaps(candidateStart, candidateEnd, item.startsAt, item.endsAt) &&
            (item.teacherId === schedule.teacherId || item.courseId === schedule.courseId),
        )
        // Перенос предлагаем только туда, где свободна текущая аудитория.
        const roomClash = roomBusy.some((item) => overlaps(candidateStart, candidateEnd, item.startsAt, item.endsAt))
        if (!clash && !roomClash) {
          slots.push({ startsAt: candidateStart.toISOString(), endsAt: candidateEnd.toISOString(), teacherFree: true })
          if (slots.length >= 8) break
        }
      }
    }

    const allTeachers = await this.prisma.client.user.findMany({
      where: { role: 'TEACHER', isActive: true, deletedAt: null, id: { not: schedule.teacherId } },
      select: { id: true, firstName: true, lastName: true },
    })
    // Для замены нужны все занятые наставники, а не только участники текущего
    // занятия: иначе система предлагала бы преподавателя с параллельным уроком.
    const busyAtOriginal = await this.prisma.client.schedule.findMany({
      where: {
        id: { not: id },
        status: { not: 'CANCELLED' },
        startsAt: { lt: schedule.endsAt },
        endsAt: { gt: schedule.startsAt },
      },
      select: { teacherId: true },
    })
    const busyTeachers = new Set(busyAtOriginal.map((item) => item.teacherId))
    const availableTeachers = allTeachers
      .filter((teacher) => !busyTeachers.has(teacher.id))
      .map((teacher) => ({ id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}`.trim() }))

    const freeClassrooms = (await this.rooms.classroomAvailability(schedule.startsAt, schedule.endsAt)).items
      .filter((room) => !room.bookings.some((booking) => booking.startsAt < schedule.endsAt && booking.endsAt > schedule.startsAt))
      .filter((room) => room.capacity === 0 || room.capacity >= enrolled)
      .map((room) => ({ id: room.id, name: room.name, capacity: room.capacity }))

    return {
      slots,
      availableTeachers,
      freeClassrooms,
      checkedCapacity: capacity,
      enrolled,
    }
  }

  async availableTeachers(id: string, userId: string, role: RoleName) {
    this.assertStaff(role)
    return this.alternatives(id, userId, role).then((data) => ({ items: data.availableTeachers }))
  }

  // ---------- переносы и отмены через согласование ----------

  async requestChange(id: string, input: ChangeRequest, userId: string, role: RoleName) {
    const schedule = await this.loadManageableSchedule(id, userId, role)
    if (schedule.status === 'CANCELLED') throw conflict('Занятие отменено')
    if (input.type === 'RESCHEDULE' && !input.proposedStartsAt) {
      throw badRequest('Для переноса укажите новое время')
    }
    if (input.proposedTeacherId) {
      const teacher = await this.prisma.client.user.findUnique({
        where: { id: input.proposedTeacherId },
        select: { role: true, isActive: true },
      })
      if (!teacher || teacher.role !== 'TEACHER' || !teacher.isActive) throw badRequest('Выбранный наставник недоступен')
    }

    const change = await this.prisma.client.scheduleChange.create({
      data: {
        scheduleId: id,
        type: input.type,
        reason: input.reason,
        requestedById: userId,
        proposedStartsAt: input.proposedStartsAt ? new Date(input.proposedStartsAt) : null,
        proposedTeacherId: input.proposedTeacherId ?? null,
        proposedClassroomId: input.proposedClassroomId ?? null,
      },
      include: { requestedBy: { select: { firstName: true, lastName: true } } },
    })

    const managers = await this.prisma.client.user.findMany({
      where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true, deletedAt: null },
      select: { id: true },
    })
    await notifyUsers(managers.map((manager) => manager.id), {
      type: 'SCHEDULE_CHANGED',
      title: input.type === 'RESCHEDULE' ? 'Заявка на перенос занятия' : 'Заявка на отмену занятия',
      body: `${schedule.title}: ${input.reason}`,
      data: { kind: 'schedule_change', changeId: change.id, scheduleId: id },
    }).catch(() => undefined)

    await this.logEvent(id, userId, 'CHANGE_REQUESTED', `Заявка: ${input.type.toLowerCase()} — ${input.reason}`, {
      changeId: change.id,
    })
    return change
  }

  async changes(userId: string, role: RoleName, status?: string) {
    if (role === 'STUDENT' || role === 'PARENT') throw forbidden('Согласование доступно сотрудникам')
    const where: Prisma.ScheduleChangeWhereInput = {
      ...(status && status !== 'ALL' ? { status: status as 'PENDING' } : {}),
      ...(role === 'TEACHER' ? { requestedById: userId } : {}),
    }
    const items = await this.prisma.client.scheduleChange.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        schedule: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            teacherId: true,
            course: { select: { id: true, title: true } },
          },
        },
        requestedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        decidedBy: { select: { id: true, firstName: true, lastName: true } },
        proposedTeacher: { select: { id: true, firstName: true, lastName: true } },
        proposedClassroom: { select: { id: true, name: true } },
      },
    })
    return { items }
  }

  async approveChange(changeId: string, comment: string | undefined, userId: string, role: RoleName) {
    if (!this.isManager(role)) throw forbidden('Подтверждает перенос менеджер или администратор')
    const change = await this.prisma.client.scheduleChange.findUnique({
      where: { id: changeId },
      include: {
        schedule: {
          include: {
            course: { select: { title: true, teacherId: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } },
          },
        },
      },
    })
    if (!change) throw notFound('Заявка не найдена')
    if (change.status !== 'PENDING') throw conflict('Заявка уже рассмотрена')
    if (change.schedule.status === 'CANCELLED') throw conflict('Занятие уже отменено')

    if (change.type === 'CANCEL') {
      await this.cancelSchedule(change.scheduleId, change.reason, userId, role)
    } else {
      if (!change.proposedStartsAt) throw badRequest('В заявке нет нового времени')
      await this.updateSchedule(
        change.scheduleId,
        {
          startsAt: change.proposedStartsAt.toISOString(),
          ...(change.proposedTeacherId ? { teacherId: change.proposedTeacherId } : {}),
          ...(change.proposedClassroomId !== undefined ? { classroomId: change.proposedClassroomId } : {}),
          changeReason: change.reason,
        },
        userId,
        role,
      )
    }

    const updated = await this.prisma.client.scheduleChange.update({
      where: { id: changeId },
      data: {
        status: 'APPROVED',
        decidedById: userId,
        decidedAt: new Date(),
        decisionComment: comment ?? null,
      },
    })
    await notifyUsers([change.requestedById], {
      type: 'SCHEDULE_CHANGED',
      title: 'Заявка по расписанию подтверждена',
      body: `${change.schedule.title}: ${comment ?? 'изменение применено'}`,
      data: { kind: 'schedule_change', changeId, scheduleId: change.scheduleId },
    }).catch(() => undefined)
    await this.logEvent(change.scheduleId, userId, 'CHANGE_APPROVED', 'Заявка подтверждена', { changeId, comment })
    return updated
  }

  async rejectChange(changeId: string, comment: string | undefined, userId: string, role: RoleName) {
    if (!this.isManager(role)) throw forbidden('Заявку рассматривает менеджер или администратор')
    const change = await this.prisma.client.scheduleChange.findUnique({
      where: { id: changeId },
      include: { schedule: { select: { id: true, title: true } } },
    })
    if (!change) throw notFound('Заявка не найдена')
    if (change.status !== 'PENDING') throw conflict('Заявка уже рассмотрена')

    const updated = await this.prisma.client.scheduleChange.update({
      where: { id: changeId },
      data: {
        status: 'REJECTED',
        decidedById: userId,
        decidedAt: new Date(),
        decisionComment: comment ?? null,
      },
    })
    await notifyUsers([change.requestedById], {
      type: 'SCHEDULE_CHANGED',
      title: 'Заявка по расписанию отклонена',
      body: `${change.schedule.title}: ${comment ?? 'без комментария'}`,
      data: { kind: 'schedule_change', changeId, scheduleId: change.scheduleId },
    }).catch(() => undefined)
    await this.logEvent(change.scheduleId, userId, 'CHANGE_REJECTED', 'Заявка отклонена', { changeId, comment })
    return updated
  }

  // ---------- замены ----------

  async substitute(id: string, input: z.infer<typeof substituteSchema>, userId: string, role: RoleName) {
    if (!this.isManager(role)) throw forbidden('Замену назначает менеджер или администратор')
    const schedule = await this.prisma.client.schedule.findUnique({
      where: { id },
      include: { course: { select: { title: true } } },
    })
    if (!schedule) throw notFound('Занятие не найдено')
    if (schedule.status === 'CANCELLED') throw conflict('Занятие отменено')
    if (schedule.teacherId === input.teacherId) throw badRequest('Этот наставник уже ведёт занятие')

    const teacher = await this.prisma.client.user.findUnique({
      where: { id: input.teacherId },
      select: { id: true, role: true, isActive: true, firstName: true, lastName: true },
    })
    if (!teacher || teacher.role !== 'TEACHER' || !teacher.isActive) throw badRequest('Наставник недоступен')

    const busy = await this.prisma.client.schedule.findFirst({
      where: {
        id: { not: id },
        teacherId: input.teacherId,
        status: { not: 'CANCELLED' },
        startsAt: { lt: schedule.endsAt },
        endsAt: { gt: schedule.startsAt },
      },
      select: { title: true, startsAt: true },
    })
    if (busy) throw conflict(`Наставник занят: «${busy.title}» (${formatLocal(busy.startsAt)})`)

    const updated = await this.prisma.client.schedule.update({
      where: { id },
      data: {
        teacherId: input.teacherId,
        originalTeacherId: schedule.originalTeacherId ?? schedule.teacherId,
      },
    })
    await this.prisma.client.teacherSubstitution.create({
      data: {
        scheduleId: id,
        fromTeacherId: schedule.teacherId,
        toTeacherId: input.teacherId,
        assignedById: userId,
        reason: input.reason ?? null,
      },
    })
    await this.logEvent(id, userId, 'SUBSTITUTED', `Замена наставника: ${teacher.firstName} ${teacher.lastName}`, {
      fromTeacherId: schedule.teacherId,
      toTeacherId: input.teacherId,
      reason: input.reason,
    })
    await this.notifyParticipants(
      id,
      'Замена наставника',
      `«${schedule.title}» проведёт ${teacher.firstName} ${teacher.lastName}`,
      [schedule.teacherId],
    )
    await notifyUsers([input.teacherId], {
      type: 'SCHEDULE_CHANGED',
      title: 'Вам назначена замена',
      body: `«${schedule.title}» — ${formatLocal(schedule.startsAt)}`,
      data: { kind: 'substitution', scheduleId: id },
    }).catch(() => undefined)
    await writeAudit({ actorId: userId, action: 'schedule.substitute', entity: 'Schedule', entityId: id, metadata: { to: input.teacherId } })
    return updated
  }

  // ---------- дополнительные занятия ----------

  async extraSessions(userId: string, role: RoleName) {
    if (role === 'STUDENT') {
      const items = await this.prisma.client.schedule.findMany({
        where: {
          kind: 'EXTRA',
          publishedAt: { not: null },
          status: { not: 'CANCELLED' },
          endsAt: { gt: new Date() },
          OR: [
            { course: { enrollments: { some: { studentId: userId } } } },
            { extraEnrollments: { some: { userId } } },
          ],
        },
        orderBy: { startsAt: 'asc' },
        include: {
          ...scheduleInclude,
          extraEnrollments: { where: { userId }, select: { status: true, createdAt: true } },
        },
      })
      const courseIds = [...new Set(items.map((item) => item.courseId))]
      const baseEnrollments = await this.prisma.client.courseEnrollment.findMany({
        where: { studentId: userId, status: 'ACTIVE', courseId: { in: courseIds } },
        select: { courseId: true },
      })
      const enrolledCourses = new Set(baseEnrollments.map((entry) => entry.courseId))
      return {
        items: await Promise.all(
          items.map(async (item) => {
            const isCourseStudent = enrolledCourses.has(item.courseId)
            const occupied = item.course._count.enrollments + item._count.extraEnrollments
            return {
              ...(await this.toCard(item, userId)),
              isCourseStudent,
              myEnrollment: item.extraEnrollments[0]?.status ?? null,
              canEnroll:
                !isCourseStudent &&
                Boolean(item.allowSelfEnrollment) &&
                item.startsAt.getTime() > Date.now() &&
                (item.capacity === null || occupied < item.capacity),
            }
          }),
        ),
      }
    }

    this.assertStaff(role)
    const items = await this.prisma.client.schedule.findMany({
      where: {
        kind: 'EXTRA',
        ...(role === 'TEACHER' ? { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] } : {}),
      },
      orderBy: { startsAt: 'desc' },
      take: 100,
      include: {
        ...scheduleInclude,
        extraEnrollments: {
          where: { status: 'REGISTERED' },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
      },
    })
    return {
      items: await Promise.all(
        items.map(async (item) => ({
          ...(await this.toCard(item, userId)),
          registrations: item.extraEnrollments.map((entry) => ({
            id: entry.id,
            userId: entry.userId,
            name: `${entry.user.firstName} ${entry.user.lastName}`.trim(),
            email: entry.user.email,
            createdAt: entry.createdAt,
          })),
        })),
      ),
    }
  }

  async enrollExtra(id: string, userId: string) {
    const schedule = await this.prisma.client.schedule.findUnique({
      where: { id },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            enrollments: { where: { studentId: userId, status: 'ACTIVE' }, select: { id: true } },
            _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
          },
        },
        _count: { select: { extraEnrollments: { where: { status: 'REGISTERED' } } } },
      },
    })
    if (!schedule || schedule.kind !== 'EXTRA' || !schedule.publishedAt) throw notFound('Дополнительное занятие не найдено')
    if (!schedule.allowSelfEnrollment) throw forbidden('Запись на это занятие открывает организатор')
    if (schedule.status === 'CANCELLED') throw conflict('Занятие отменено')
    if (schedule.endsAt.getTime() <= Date.now()) throw conflict('Занятие уже прошло')
    if (schedule.course.enrollments.length > 0) throw badRequest('Вы уже в группе этого занятия')
    const occupied = schedule.course._count.enrollments + schedule._count.extraEnrollments
    if (schedule.capacity && occupied >= schedule.capacity) throw conflict('Мест нет')

    const enrollment = await this.prisma.client.extraSessionEnrollment.upsert({
      where: { scheduleId_userId: { scheduleId: id, userId } },
      create: { scheduleId: id, userId, status: 'REGISTERED' },
      update: { status: 'REGISTERED', cancelledAt: null },
    })
    await this.logEvent(id, userId, 'EXTRA_ENROLLED', 'Ученик записался на дополнительное занятие')
    await notifyUsers([schedule.teacherId], {
      type: 'SCHEDULE_CHANGED',
      title: 'Новая запись на дополнительное занятие',
      body: `«${schedule.title}» — ${formatLocal(schedule.startsAt)}`,
      data: { kind: 'extra_enrollment', scheduleId: id },
    }).catch(() => undefined)
    return { status: enrollment.status }
  }

  async cancelExtraEnrollment(id: string, userId: string) {
    const enrollment = await this.prisma.client.extraSessionEnrollment.findUnique({
      where: { scheduleId_userId: { scheduleId: id, userId } },
    })
    if (!enrollment) throw notFound('Запись не найдена')
    await this.prisma.client.extraSessionEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })
    await this.logEvent(id, userId, 'EXTRA_CANCELLED', 'Ученик отменил запись')
    return { status: 'CANCELLED' }
  }

  // ---------- посещаемость ----------

  async attendance(id: string, userId: string, role: RoleName) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id, ...(await this.scheduleScope(userId, role)) },
      include: {
        course: { select: { id: true, title: true } },
        attendance: {
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
        extraEnrollments: {
          where: { status: 'REGISTERED' },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
      },
    })
    if (!schedule) throw notFound('Занятие не найдено')
    if (role === 'STUDENT' || role === 'PARENT') throw forbidden('Посещаемость доступна сотрудникам')

    const enrolled = await this.prisma.client.courseEnrollment.findMany({
      where: { courseId: schedule.courseId, status: 'ACTIVE' },
      include: { student: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })
    const participants = new Map<
      string,
      { id: string; name: string; email: string; extra: boolean }
    >()
    for (const row of enrolled) {
      participants.set(row.student.id, {
        id: row.student.id,
        name: `${row.student.firstName} ${row.student.lastName}`.trim(),
        email: row.student.email,
        extra: false,
      })
    }
    for (const row of schedule.extraEnrollments) {
      participants.set(row.user.id, {
        id: row.user.id,
        name: `${row.user.firstName} ${row.user.lastName}`.trim(),
        email: row.user.email,
        extra: true,
      })
    }
    for (const row of schedule.attendance) {
      if (!participants.has(row.userId)) {
        participants.set(row.userId, {
          id: row.user.id,
          name: `${row.user.firstName} ${row.user.lastName}`.trim(),
          email: row.user.email,
          extra: false,
        })
      }
    }

    return {
      schedule: {
        id: schedule.id,
        title: schedule.title,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        deliveryMode: schedule.deliveryMode,
        course: schedule.course,
      },
      items: [...participants.values()].map((participant) => {
        const record = schedule.attendance.find((entry) => entry.userId === participant.id)
        return {
          ...participant,
          attendance: record
            ? {
                id: record.id,
                status: record.status,
                source: record.source,
                joinedAt: record.joinedAt,
                leftAt: record.leftAt,
                durationSeconds: record.durationSeconds,
                reconnectCount: record.reconnectCount,
                lateMinutes: record.lateMinutes,
                earlyLeaveMinutes: record.earlyLeaveMinutes,
                note: record.note,
              }
            : null,
        }
      }),
    }
  }

  async markAttendance(id: string, input: z.infer<typeof attendanceMarkSchema>, userId: string, role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'TEACHER') throw forbidden('Отметки ставит наставник')
    const schedule = await this.loadManageableSchedule(id, userId, role)
    if (schedule.status === 'CANCELLED') throw conflict('Занятие отменено')
    if (schedule.deliveryMode === 'ONLINE') {
      // Онлайн-посещаемость фиксируется автоматически; ручная правка допустима как исключение.
    }
    const enrolled = await this.prisma.client.courseEnrollment.findMany({
      where: { courseId: schedule.courseId, status: 'ACTIVE' },
      select: { studentId: true },
    })
    const allowed = new Set(enrolled.map((row) => row.studentId))
    const extra = await this.prisma.client.extraSessionEnrollment.findMany({
      where: { scheduleId: id, status: 'REGISTERED' },
      select: { userId: true },
    })
    for (const row of extra) allowed.add(row.userId)

    const before = await this.prisma.client.attendance.findMany({
      where: { scheduleId: id, userId: { in: input.items.map((item) => item.userId) } },
      select: { userId: true, status: true },
    })
    const previousStatus = new Map(before.map((row) => [row.userId, row.status]))
    for (const item of input.items) {
      if (!allowed.has(item.userId)) throw badRequest('Ученик не относится к этой группе')
      const timing = manualAttendanceTiming({
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        status: item.status,
        lateMinutes: item.lateMinutes,
        earlyLeaveMinutes: item.earlyLeaveMinutes,
      })
      await this.prisma.client.$transaction(async (tx) => {
        await tx.attendance.upsert({
          where: { scheduleId_userId: { scheduleId: id, userId: item.userId } },
          create: {
            scheduleId: id,
            userId: item.userId,
            status: item.status,
            source: 'MANUAL',
            joinedAt: timing.joinedAt,
            leftAt: timing.leftAt,
            durationSeconds: timing.durationSeconds,
            lateMinutes: timing.lateMinutes,
            earlyLeaveMinutes: timing.earlyLeaveMinutes,
            note: item.note ?? null,
            markedById: userId,
          },
          update: {
            status: item.status,
            source: 'MANUAL',
            joinedAt: timing.joinedAt,
            leftAt: timing.leftAt,
            durationSeconds: timing.durationSeconds,
            lateMinutes: timing.lateMinutes,
            earlyLeaveMinutes: timing.earlyLeaveMinutes,
            note: item.note ?? null,
            markedById: userId,
          },
        })
        // Присутствие даёт монеты и при ручной отметке; пропуск — нет.
        if (item.status !== 'ABSENT') {
          await awardCoins(tx, {
            userId: item.userId,
            amount: COIN_RULES.attendance,
            reason: `Посещение занятия: ${schedule.title}`,
            sourceType: 'ATTENDANCE',
            sourceId: id,
            awardedById: userId,
          })
        }
      })
    }
    const newlyAbsent = input.items.filter((item) => item.status === 'ABSENT' && previousStatus.get(item.userId) !== 'ABSENT')
    if (newlyAbsent.length > 0) await this.notifyAbsence(schedule, newlyAbsent, userId)
    for (const student of newlyAbsent) {
      const monthAgo = new Date(Date.now() - 30 * 86400000)
      const history = await this.prisma.client.attendance.findMany({
        where: { userId: student.userId, joinedAt: { gte: monthAgo } },
        select: { status: true },
      })
      const present = history.filter((row) => row.status !== 'ABSENT').length
      const attendancePercent = history.length ? Math.round((present / history.length) * 100) : 0
      await this.ai.triggerEvent('LOW_ATTENDANCE', {
        studentId: student.userId,
        attendancePercent,
        courseId: schedule.courseId,
        role: 'STUDENT',
      }).catch((error) => console.warn('[scheduling] AI-автоматизация не запущена', error))
    }
    await this.logEvent(id, userId, 'ATTENDANCE_MARKED', `Отмечена посещаемость: ${input.items.length} учеников`)
    return this.attendance(id, userId, role)
  }

  /** Уведомления о пропуске по настройкам филиала: ученику, родителю, наставнику и менеджеру. */
  private async notifyAbsence(
    schedule: { id: string; title: string; startsAt: Date; teacherId: string; courseId: string },
    absent: Array<{ userId: string }>,
    actorId: string,
  ) {
    const settings = await this.settings.branchSettings()
    const recipients = new Map<string, { title: string; body: string; data: Record<string, unknown> }>()
    const dateLabel = formatLocal(schedule.startsAt)
    for (const item of absent) {
      if (settings.notifyAbsenceStudent) {
        recipients.set(item.userId, { title: 'Пропуск занятия', body: `Вы отсутствовали на занятии «${schedule.title}» ${dateLabel}.`, data: { kind: 'attendance_absence', scheduleId: schedule.id } })
      }
      if (settings.notifyAbsenceParent) {
        const parents = await this.prisma.client.parentStudentLink.findMany({
          where: { student: { userId: item.userId }, verifiedAt: { not: null } },
          select: { parent: { select: { userId: true } } },
        })
        for (const parent of parents) {
          recipients.set(parent.parent.userId, { title: 'Пропуск занятия учеником', body: `Ученик отсутствовал на занятии «${schedule.title}» ${dateLabel}.`, data: { kind: 'attendance_absence', scheduleId: schedule.id, studentUserId: item.userId } })
        }
      }
    }
    if (settings.notifyAbsenceTeacher) {
      recipients.set(schedule.teacherId, { title: 'Ученик пропустил занятие', body: `${absent.length} ученик(ов) отсутствовали на «${schedule.title}» ${dateLabel}.`, data: { kind: 'attendance_absence', scheduleId: schedule.id } })
    }
    if (settings.notifyAbsenceManager) {
      const managers = await this.prisma.client.user.findMany({
        where: { role: { in: ['MANAGER', 'ADMIN'] }, isActive: true, deletedAt: null, id: { not: actorId } },
        select: { id: true },
      })
      for (const manager of managers) {
        recipients.set(manager.id, { title: 'Пропуск занятия', body: `${absent.length} ученик(ов) отсутствовали на «${schedule.title}» ${dateLabel}.`, data: { kind: 'attendance_absence', scheduleId: schedule.id } })
      }
    }
    if (recipients.size === 0) return
    // notifyUsers учитывает персональные настройки каналов (внутренние/push/email/SMS)
    // и не отправляет уведомление пользователю, который отключил этот тип событий.
    await Promise.all(
      [...recipients.entries()].map(([userId, message]) =>
        notifyUsers([userId], {
          type: 'ATTENDANCE_ABSENCE',
          title: message.title,
          body: message.body,
          data: message.data,
          email: { subject: message.title, text: message.body },
          sms: message.body.slice(0, 160),
        }).catch((error) => {
          console.warn('[schedule] уведомление о пропуске не отправлено', error)
          return null
        }),
      ),
    )
  }

  // ---------- вспомогательные ----------

  private async scheduleScope(userId: string, role: RoleName): Promise<Prisma.ScheduleWhereInput> {
    if (role === 'ADMIN' || role === 'MANAGER') return {}
    if (role === 'TEACHER') {
      return { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] }
    }
    if (role === 'STUDENT') {
      return {
        AND: [
          {
            OR: [
              { course: { enrollments: { some: { studentId: userId } } } },
              { extraEnrollments: { some: { userId, status: 'REGISTERED' } } },
            ],
          },
          // Черновики дополнительных занятий не показываем до публикации.
          { OR: [{ kind: 'REGULAR' }, { publishedAt: { not: null } }] },
        ],
      }
    }
    return { id: { in: [] } }
  }

  private async loadCourse(courseId: string, userId: string, role: RoleName) {
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        teacherId: true,
        recordingEnabled: true,
        recordingAuto: true,
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    })
    if (!course) throw notFound('Курс не найден')
    if (role === 'TEACHER' && course.teacherId !== userId) throw forbidden('Курс принадлежит другому наставнику')
    return course
  }

  private async loadManageableSchedule(id: string, userId: string, role: RoleName) {
    const schedule = await this.prisma.client.schedule.findUnique({
      where: { id },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            teacherId: true,
            recordingEnabled: true,
            recordingAuto: true,
            _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
          },
        },
        classroom: { select: { id: true, name: true, capacity: true } },
      },
    })
    if (!schedule) throw notFound('Занятие не найдено')
    if (this.isManager(role)) return schedule
    if (role !== 'TEACHER') throw forbidden('Действие доступно сотрудникам')
    if (schedule.teacherId !== userId && schedule.course.teacherId !== userId) {
      throw forbidden('Занятие принадлежит другому наставнику')
    }
    return schedule
  }

  private async validateTeacher(candidateId: string, actorId: string, role: RoleName, courseTeacherId: string) {
    const teacher = await this.prisma.client.user.findUnique({
      where: { id: candidateId },
      select: { id: true, role: true, isActive: true, deletedAt: true },
    })
    if (!teacher || teacher.role !== 'TEACHER' || !teacher.isActive || teacher.deletedAt) {
      throw badRequest('Наставник недоступен')
    }
    if (role === 'TEACHER' && candidateId !== actorId && candidateId !== courseTeacherId) {
      throw forbidden('Наставник может назначать только себя')
    }
  }

  private async validateClassroom(classroomId: string, enrolled: number) {
    const room = await this.prisma.client.classroom.findUnique({ where: { id: classroomId } })
    if (!room || !room.isActive) throw badRequest('Аудитория недоступна')
    if (room.capacity > 0 && enrolled > room.capacity) {
      throw conflict(`Вместимость аудитории «${room.name}» — ${room.capacity}, в группе ${enrolled}`)
    }
    return room
  }

  private async resolveCapacity(classroomId: string | null, explicit: number | null, enrolled: number) {
    if (classroomId) {
      const room = await this.validateClassroom(classroomId, enrolled)
      if (explicit !== null && room.capacity > 0 && explicit > room.capacity) {
        throw conflict(`Вместимость аудитории «${room.name}» — ${room.capacity}, указано мест: ${explicit}`)
      }
      return explicit ?? room.capacity
    }
    return explicit ?? 0
  }

  private async logEvent(
    scheduleId: string,
    actorId: string | null,
    action: string,
    message?: string,
    data?: Prisma.InputJsonValue,
  ) {
    await this.prisma.client.scheduleEvent
      .create({
        data: {
          scheduleId,
          actorId,
          action,
          message: message ?? null,
          ...(data !== undefined ? { data } : {}),
        },
      })
      .catch((error) => console.warn('[schedule] событие не записано', error))
  }

  private async notifyParticipants(
    id: string,
    title: string,
    body: string,
    extraUserIds: string[] = [],
    type: 'SCHEDULE_CHANGED' | 'LESSON_CANCELLED' | 'LESSON_RESCHEDULED' = 'SCHEDULE_CHANGED',
  ) {
    const schedule = await this.prisma.client.schedule.findUnique({
      where: { id },
      select: {
        teacherId: true,
        courseId: true,
        course: { select: { enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } } },
        extraEnrollments: { where: { status: 'REGISTERED' }, select: { userId: true } },
      },
    })
    if (!schedule) return
    const recipients = new Set<string>([
      schedule.teacherId,
      ...schedule.course.enrollments.map((row) => row.studentId),
      ...schedule.extraEnrollments.map((row) => row.userId),
      ...extraUserIds,
    ])
    if (recipients.size === 0) return
    await notifyUsers([...recipients], {
      type,
      title,
      body,
      data: { kind: 'schedule', scheduleId: id },
    }).catch((error) => console.warn('[schedule] уведомления не отправлены', error))
  }

  private async toCard(
    item: {
      id: string
      title: string
      startsAt: Date
      endsAt: Date
      status: string
      kind: string
      deliveryMode: string
      capacity: number | null
      allowSelfEnrollment: boolean
      teacherId: string
      courseId: string
      classroomId: string | null
      publishedAt: Date | null
      cancellationReason: string | null
      cancelledAt: Date | null
      cancelledBy: { id: string; firstName: string; lastName: string } | null
      course: { id: string; title: string; teacherId: string; _count?: { enrollments: number } }
      classroom: { id: string; name: string; capacity: number; equipment?: unknown; location?: string | null } | null
      room: { id: string; provider: string; status: string; providerRoomId: string | null } | null
      _count?: { extraEnrollments: number }
    },
    viewerId: string,
  ) {
    const teacher = await this.prisma.client.user.findUnique({
      where: { id: item.teacherId },
      select: { firstName: true, lastName: true },
    })
    const myExtra = await this.prisma.client.extraSessionEnrollment.findUnique({
      where: { scheduleId_userId: { scheduleId: item.id, userId: viewerId } },
      select: { status: true },
    })
    const enrolled = item.course._count?.enrollments ?? 0
    const extraEnrolled = item._count?.extraEnrollments ?? 0
    return {
      id: item.id,
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      status: item.status,
      kind: item.kind,
      deliveryMode: item.deliveryMode,
      capacity: item.capacity,
      enrolled,
      extraEnrolled,
      seatsLeft: item.capacity ? Math.max(0, item.capacity - enrolled - extraEnrolled) : null,
      allowSelfEnrollment: item.allowSelfEnrollment,
      publishedAt: item.publishedAt,
      cancellationReason: item.cancellationReason,
      cancelledAt: item.cancelledAt,
      cancelledBy: item.cancelledBy
        ? {
            id: item.cancelledBy.id,
            name: `${item.cancelledBy.firstName} ${item.cancelledBy.lastName}`.trim(),
          }
        : null,
      teacher: {
        id: item.teacherId,
        name: teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : 'Наставник',
      },
      course: { id: item.course.id, title: item.course.title },
      classroom: item.classroom
        ? {
            id: item.classroom.id,
            name: item.classroom.name,
            capacity: item.classroom.capacity,
            equipment: item.classroom.equipment ?? [],
            location: item.classroom.location ?? null,
          }
        : null,
      video: item.room
        ? { id: item.room.id, provider: item.room.provider, status: item.room.status, ready: Boolean(item.room.providerRoomId) }
        : null,
      myExtraEnrollment: myExtra?.status ?? null,
      canJoin: item.deliveryMode !== 'OFFLINE' && item.status !== 'CANCELLED' && Boolean(item.room),
    }
  }
}
