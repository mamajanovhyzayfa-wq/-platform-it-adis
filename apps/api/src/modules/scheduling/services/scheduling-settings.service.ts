import { Inject, Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { z } from 'zod'
import { forbidden, notFound } from '../../../lib/errors.js'
import { writeAudit } from '../../../lib/audit.js'
import { PrismaService } from '../../../nest/prisma/prisma.service.js'
import { courseRecordingSchema, recordingSettingsSchema } from '../scheduling.schemas.js'

/** Настройки филиала и записи занятий. */
@Injectable()
export class SchedulingSettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private isManager(role: RoleName) {
    return role === 'ADMIN' || role === 'MANAGER'
  }

  async branchSettings() {
    return this.prisma.client.branchSettings.upsert({
      where: { id: 'branch' },
      create: { id: 'branch' },
      update: {},
    })
  }

  async recordingSettings() {
    const settings = await this.branchSettings()
    return {
      ...settings,
      provider: 'livedigital',
      levels: 'Филиал → группа (курс) → занятие',
    }
  }

  async updateRecordingSettings(input: z.infer<typeof recordingSettingsSchema>, userId: string, role: RoleName) {
    if (!this.isManager(role)) throw forbidden('Настройки записи меняет администратор или менеджер')
    const settings = await this.prisma.client.branchSettings.upsert({
      where: { id: 'branch' },
      create: {
        id: 'branch',
        recordingEnabled: input.recordingEnabled,
        recordingAuto: input.recordingAuto,
        workingHoursStart: input.workingHoursStart ?? '08:00',
        workingHoursEnd: input.workingHoursEnd ?? '21:00',
        slotStepMinutes: input.slotStepMinutes ?? 30,
        notifyAbsenceStudent: input.notifyAbsenceStudent ?? true,
        notifyAbsenceParent: input.notifyAbsenceParent ?? true,
        notifyAbsenceTeacher: input.notifyAbsenceTeacher ?? true,
        notifyAbsenceManager: input.notifyAbsenceManager ?? true,
        updatedById: userId,
      },
      update: {
        recordingEnabled: input.recordingEnabled,
        recordingAuto: input.recordingAuto,
        ...(input.workingHoursStart ? { workingHoursStart: input.workingHoursStart } : {}),
        ...(input.workingHoursEnd ? { workingHoursEnd: input.workingHoursEnd } : {}),
        ...(input.slotStepMinutes ? { slotStepMinutes: input.slotStepMinutes } : {}),
        ...(input.notifyAbsenceStudent !== undefined ? { notifyAbsenceStudent: input.notifyAbsenceStudent } : {}),
        ...(input.notifyAbsenceParent !== undefined ? { notifyAbsenceParent: input.notifyAbsenceParent } : {}),
        ...(input.notifyAbsenceTeacher !== undefined ? { notifyAbsenceTeacher: input.notifyAbsenceTeacher } : {}),
        ...(input.notifyAbsenceManager !== undefined ? { notifyAbsenceManager: input.notifyAbsenceManager } : {}),
        updatedById: userId,
      },
    })
    await writeAudit({ actorId: userId, action: 'settings.recording', entity: 'BranchSettings', entityId: 'branch' })
    return settings
  }

  async updateCourseRecording(courseId: string, input: z.infer<typeof courseRecordingSchema>, userId: string, role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'TEACHER') {
      throw forbidden('Настройки курса меняет наставник, менеджер или администратор')
    }
    const course = await this.prisma.client.course.findUnique({
      where: { id: courseId },
      select: { id: true, teacherId: true },
    })
    if (!course) throw notFound('Курс не найден')
    if (role === 'TEACHER' && course.teacherId !== userId) throw forbidden('Курс принадлежит другому наставнику')
    const updated = await this.prisma.client.course.update({
      where: { id: courseId },
      data: {
        ...(input.recordingEnabled !== undefined ? { recordingEnabled: input.recordingEnabled } : {}),
        ...(input.recordingAuto !== undefined ? { recordingAuto: input.recordingAuto } : {}),
      },
      select: { id: true, title: true, recordingEnabled: true, recordingAuto: true },
    })
    await writeAudit({ actorId: userId, action: 'course.recording', entity: 'Course', entityId: courseId })
    return updated
  }
}
