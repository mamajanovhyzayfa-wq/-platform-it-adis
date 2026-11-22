import { Module } from '@nestjs/common'
import { z } from 'zod'
import { createReadController } from '../read-model/read-model.controller.js'
import { createReadService } from '../read-model/read-model.service.js'
import type { ReadModelOptions } from '../read-model/read-model.types.js'

export const attendanceOptions: ReadModelOptions = {
  slug: 'attendance',
  model: 'attendance',
  entity: 'Посещаемость',
  roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT'],
  scope: (user) => (user.role === 'STUDENT' ? { userId: user.userId } : {}),
  querySchema: z.object({
    scheduleId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
  }),
  filters: (query) => ({
    ...(query.scheduleId ? { scheduleId: query.scheduleId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
  }),
  select: {
    id: true,
    scheduleId: true,
    userId: true,
    joinedAt: true,
    leftAt: true,
    durationSeconds: true,
    status: true,
    source: true,
    lateMinutes: true,
    earlyLeaveMinutes: true,
    reconnectCount: true,
    note: true,
    updatedAt: true,
    user: { select: { id: true, firstName: true, lastName: true, email: true } },
    schedule: {
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        course: { select: { id: true, title: true } },
        classroom: { select: { id: true, name: true } },
      },
    },
  },
  orderBy: { joinedAt: 'desc' },
}

const AttendanceService = createReadService(attendanceOptions)
const AttendanceController = createReadController(attendanceOptions, AttendanceService)

@Module({ controllers: [AttendanceController], providers: [AttendanceService] })
export class AttendanceModule {}
