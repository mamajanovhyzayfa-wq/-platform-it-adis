import { z } from 'zod'

/** Время в формате HH:MM в часовом поясе филиала. */
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время должно быть в формате ЧЧ:ММ')
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата должна быть в формате ГГГГ-ММ-ДД')

export const classroomSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    capacity: z.number().int().min(0).max(1000).default(0),
    equipment: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
    location: z.string().trim().max(300).optional(),
    isActive: z.boolean().default(true),
  })
  .strict()

export const classroomUpdateSchema = classroomSchema.partial()

export const templateSchema = z
  .object({
    courseId: z.string().uuid(),
    teacherId: z.string().uuid().optional(),
    classroomId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startTime: timeSchema,
    durationMinutes: z.number().int().min(15).max(480),
    deliveryMode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).default('ONLINE'),
    capacity: z.number().int().min(1).max(1000).optional(),
    allowSelfEnrollment: z.boolean().default(false),
    recordingEnabled: z.boolean().nullable().optional(),
    autoRecord: z.boolean().nullable().optional(),
  })
  .strict()

export const templateUpdateSchema = templateSchema.partial()

export const scheduleCreateSchema = z
  .object({
    courseId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(4000).optional(),
    startsAt: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(480),
    teacherId: z.string().uuid().optional(),
    classroomId: z.string().uuid().nullable().optional(),
    deliveryMode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).default('ONLINE'),
    kind: z.enum(['REGULAR', 'EXTRA']).default('REGULAR'),
    capacity: z.number().int().min(1).max(1000).optional(),
    allowSelfEnrollment: z.boolean().default(false),
    published: z.boolean().default(true),
    recordingEnabled: z.boolean().nullable().optional(),
    autoRecord: z.boolean().nullable().optional(),
    templateId: z.string().uuid().optional(),
  })
  .strict()

export const scheduleUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    startsAt: z.string().datetime().optional(),
    durationMinutes: z.number().int().min(15).max(480).optional(),
    teacherId: z.string().uuid().optional(),
    classroomId: z.string().uuid().nullable().optional(),
    deliveryMode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
    capacity: z.number().int().min(1).max(1000).nullable().optional(),
    allowSelfEnrollment: z.boolean().optional(),
    published: z.boolean().optional(),
    recordingEnabled: z.boolean().nullable().optional(),
    autoRecord: z.boolean().nullable().optional(),
    /// Причина замены/переноса при прямом редактировании менеджером.
    changeReason: z.string().trim().max(2000).optional(),
  })
  .strict()

export const recurringSchema = z
  .object({
    courseId: z.string().uuid(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000).optional(),
    teacherId: z.string().uuid().optional(),
    classroomId: z.string().uuid().nullable().optional(),
    deliveryMode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).default('ONLINE'),
    rule: z.enum(['DAILY', 'WEEKLY', 'SELECTED_DAYS', 'INTERVAL']),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    interval: z.number().int().min(1).max(12).default(1),
    startsOn: dateSchema,
    endsOn: dateSchema.optional(),
    startTime: timeSchema,
    durationMinutes: z.number().int().min(15).max(480),
    capacity: z.number().int().min(1).max(1000).optional(),
    allowSelfEnrollment: z.boolean().default(false),
    recordingEnabled: z.boolean().nullable().optional(),
    autoRecord: z.boolean().nullable().optional(),
  })
  .strict()
  .refine((value) => value.rule !== 'SELECTED_DAYS' || value.weekdays.length > 0, {
    message: 'Выберите хотя бы один день недели',
    path: ['weekdays'],
  })

export const changeRequestSchema = z
  .object({
    type: z.enum(['RESCHEDULE', 'CANCEL']),
    reason: z.string().trim().min(3).max(2000),
    proposedStartsAt: z.string().datetime().optional(),
    proposedTeacherId: z.string().uuid().nullable().optional(),
    proposedClassroomId: z.string().uuid().nullable().optional(),
  })
  .strict()

export const changeDecisionSchema = z
  .object({
    comment: z.string().trim().max(2000).optional(),
  })
  .strict()

export const cancelSchema = z
  .object({
    reason: z.string().trim().min(3).max(2000),
  })
  .strict()

export const substituteSchema = z
  .object({
    teacherId: z.string().uuid(),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict()

export const attendanceMarkSchema = z
  .object({
    items: z
      .array(
        z.object({
          userId: z.string().uuid(),
          status: z.enum(['PRESENT', 'LATE', 'LEFT_EARLY', 'ABSENT']),
          note: z.string().trim().max(500).optional(),
          lateMinutes: z.number().int().min(0).max(480).optional(),
          earlyLeaveMinutes: z.number().int().min(0).max(480).optional(),
        }),
      )
      .min(1)
      .max(500),
  })
  .strict()

export const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    dueAt: z.string().datetime(),
    courseId: z.string().uuid().nullable().optional(),
  })
  .strict()

export const taskUpdateSchema = taskSchema.partial().extend({ completed: z.boolean().optional() })

export const calendarConnectionSchema = z.object({ provider: z.enum(['GOOGLE', 'APPLE', 'OUTLOOK']) }).strict()

export const recordingSettingsSchema = z
  .object({
    recordingEnabled: z.boolean(),
    recordingAuto: z.boolean(),
    workingHoursStart: timeSchema.optional(),
    workingHoursEnd: timeSchema.optional(),
    slotStepMinutes: z.number().int().min(10).max(120).optional(),
    notifyAbsenceStudent: z.boolean().optional(),
    notifyAbsenceParent: z.boolean().optional(),
    notifyAbsenceTeacher: z.boolean().optional(),
    notifyAbsenceManager: z.boolean().optional(),
  })
  .strict()

export const courseRecordingSchema = z
  .object({
    recordingEnabled: z.boolean().nullable().optional(),
    recordingAuto: z.boolean().nullable().optional(),
  })
  .strict()
  .refine((value) => value.recordingEnabled !== undefined || value.recordingAuto !== undefined, {
    message: 'Укажите хотя бы одну настройку записи',
  })

export const freeSlotsQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    durationMinutes: z.coerce.number().int().min(15).max(480).default(90),
    teacherId: z.string().uuid().optional(),
    classroomId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
  })
  .strict()
