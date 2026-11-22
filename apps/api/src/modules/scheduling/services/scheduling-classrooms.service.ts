import { Inject, Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { z } from 'zod'
import { conflict, forbidden, notFound } from '../../../lib/errors.js'
import { writeAudit } from '../../../lib/audit.js'
import { PrismaService } from '../../../nest/prisma/prisma.service.js'
import { classroomSchema, classroomUpdateSchema } from '../scheduling.schemas.js'
import { parseTime } from '../scheduling.time.js'
import { SchedulingSettingsService } from './scheduling-settings.service.js'

type ClassroomInput = z.infer<typeof classroomSchema>

/** Аудитории и их загрузка. Вынесено из SchedulingService по доменному признаку. */
@Injectable()
export class SchedulingClassroomsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SchedulingSettingsService) private readonly settings: SchedulingSettingsService,
  ) {}

  private isManager(role: RoleName) {
    return role === 'ADMIN' || role === 'MANAGER'
  }

  async classrooms() {
    const items = await this.prisma.client.classroom.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { schedules: { where: { status: { not: 'CANCELLED' }, endsAt: { gt: new Date() } } } } } },
    })
    return {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        capacity: item.capacity,
        equipment: Array.isArray(item.equipment) ? item.equipment : [],
        location: item.location,
        isActive: item.isActive,
        upcoming: item._count.schedules,
      })),
    }
  }

  async createClassroom(input: ClassroomInput, actorId: string, role: RoleName) {
    if (!this.isManager(role)) throw forbidden('Аудитории создают менеджер или администратор')
    const room = await this.prisma.client.classroom.create({
      data: {
        name: input.name,
        capacity: input.capacity,
        equipment: input.equipment,
        location: input.location ?? null,
        isActive: input.isActive,
      },
    })
    await writeAudit({ actorId, action: 'classroom.create', entity: 'Classroom', entityId: room.id })
    return room
  }

  async updateClassroom(id: string, input: z.infer<typeof classroomUpdateSchema>, actorId: string, role: RoleName) {
    if (!this.isManager(role)) throw forbidden('Аудитории меняют менеджер или администратор')
    const existing = await this.prisma.client.classroom.findUnique({ where: { id } })
    if (!existing) throw notFound('Аудитория не найдена')

    if (input.capacity !== undefined && input.capacity > 0) {
      const upcoming = await this.prisma.client.schedule.findMany({
        where: { classroomId: id, endsAt: { gt: new Date() }, status: { not: 'CANCELLED' } },
        select: {
          title: true,
          course: {
            select: {
              title: true,
              _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
            },
          },
        },
      })
      const overflow = upcoming.find((row) => row.course._count.enrollments > (input.capacity ?? 0))
      if (overflow) {
        throw conflict(
          `В аудитории уже запланирована группа «${overflow.course.title}» больше ${input.capacity} человек`,
        )
      }
    }

    const room = await this.prisma.client.classroom.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.equipment !== undefined ? { equipment: input.equipment } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    await writeAudit({ actorId, action: 'classroom.update', entity: 'Classroom', entityId: id })
    return room
  }

  async deleteClassroom(id: string, actorId: string, role: RoleName) {
    if (!this.isManager(role)) throw forbidden('Аудитории удаляют менеджер или администратор')
    const used = await this.prisma.client.schedule.count({ where: { classroomId: id } })
    if (used > 0) {
      const room = await this.prisma.client.classroom.update({ where: { id }, data: { isActive: false } })
      await writeAudit({ actorId, action: 'classroom.deactivate', entity: 'Classroom', entityId: id })
      return { ok: true, deactivated: true, room }
    }
    await this.prisma.client.classroom.delete({ where: { id } })
    await writeAudit({ actorId, action: 'classroom.delete', entity: 'Classroom', entityId: id })
    return { ok: true }
  }

  async classroomAvailability(from: Date, to: Date) {
    const settings = await this.settings.branchSettings()
    const [rooms, schedules] = await Promise.all([
      this.prisma.client.classroom.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.client.schedule.findMany({
        where: { classroomId: { not: null }, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } },
        select: { id: true, classroomId: true, title: true, startsAt: true, endsAt: true, course: { select: { title: true } } },
        orderBy: { startsAt: 'asc' },
      }),
    ])

    const workingStart = parseTime(settings.workingHoursStart)
    const workingEnd = parseTime(settings.workingHoursEnd)
    const workingMinutes = Math.max(60, workingEnd.hours * 60 + workingEnd.minutes - (workingStart.hours * 60 + workingStart.minutes))
    const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60_000)))

    return {
      items: rooms.map((room) => {
        const bookings = schedules.filter((item) => item.classroomId === room.id)
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
          equipment: Array.isArray(room.equipment) ? room.equipment : [],
          location: room.location,
          bookedMinutes: Math.round(bookedMinutes),
          utilization: Math.min(100, Math.round((bookedMinutes / (workingMinutes * days)) * 100)),
          bookings: bookings.map((item) => ({
            id: item.id,
            title: item.title,
            course: item.course.title,
            startsAt: item.startsAt,
            endsAt: item.endsAt,
          })),
        }
      }),
      workingHours: { start: settings.workingHoursStart, end: settings.workingHoursEnd },
    }
  }
}
