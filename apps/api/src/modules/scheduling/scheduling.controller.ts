import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common'
import type { Response } from 'express'
import { z } from 'zod'
import { CurrentUser, Public, Roles, type AuthUser } from '../../nest/common/decorators.js'
import { zodBody } from '../../nest/common/zod.pipe.js'
import { badRequest } from '../../lib/errors.js'
import {
  attendanceMarkSchema,
  calendarConnectionSchema,
  cancelSchema,
  changeDecisionSchema,
  changeRequestSchema,
  classroomSchema,
  classroomUpdateSchema,
  courseRecordingSchema,
  freeSlotsQuerySchema,
  recordingSettingsSchema,
  recurringSchema,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  substituteSchema,
  taskSchema,
  taskUpdateSchema,
  templateSchema,
  templateUpdateSchema,
} from '../../modules/scheduling/scheduling.schemas.js'
import { SchedulingService } from './scheduling.service.js'
import { SchedulingClassroomsService } from './services/scheduling-classrooms.service.js'
import { SchedulingAnalyticsService } from './services/scheduling-analytics.service.js'
import { SchedulingSettingsService } from './services/scheduling-settings.service.js'
import { CalendarService } from './calendar.service.js'
import { VideoService } from './video.service.js'
import { ScheduleChatService } from './schedule-chat.service.js'

const applyTemplateSchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()
const conflictsSchema = z
  .object({
    courseId: z.string().uuid(),
    teacherId: z.string().uuid(),
    classroomId: z.string().uuid().nullable().optional(),
    startsAt: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(480),
  })
  .strict()

function range(query: Record<string, unknown>) {
  const now = Date.now()
  const from = new Date(String(query.from ?? new Date(now - 7 * 24 * 60 * 60_000).toISOString()))
  const to = new Date(String(query.to ?? new Date(now + 60 * 24 * 60 * 60_000).toISOString()))
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('Некорректный период')
  if (from >= to) throw badRequest('Начало периода должно быть раньше конца')
  return { from, to }
}

/** Расписание, календари, аудитории, замены, посещаемость и LiveDigital. */
@Controller('api/scheduling')
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly rooms: SchedulingClassroomsService,
    private readonly analytics: SchedulingAnalyticsService,
    private readonly settings: SchedulingSettingsService,
    private readonly calendar: CalendarService,
    private readonly video: VideoService,
    private readonly chat: ScheduleChatService,
  ) {}

  // ---------- справочники ----------

  @Get('courses')
  @Roles('ADMIN', 'MANAGER', 'TEACHER', 'STUDENT')
  courses(@CurrentUser() user: AuthUser) {
    return this.scheduling.courses(user.userId, user.role)
  }

  @Get('teachers')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  teachers() {
    return this.scheduling.teachers()
  }

  @Get('video/status')
  videoStatus() {
    return this.video.status()
  }

  // ---------- аудитории ----------

  @Get('classrooms')
  classrooms() {
    return this.rooms.classrooms()
  }

  @Get('classrooms/availability')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  classroomAvailability(@Query() query: Record<string, unknown>) {
    const { from, to } = range(query)
    return this.rooms.classroomAvailability(from, to)
  }

  @Post('classrooms')
  @Roles('ADMIN', 'MANAGER')
  createClassroom(@CurrentUser() user: AuthUser, @Body(zodBody(classroomSchema)) body: z.infer<typeof classroomSchema>) {
    return this.rooms.createClassroom(body, user.userId, user.role)
  }

  @Patch('classrooms/:id')
  @Roles('ADMIN', 'MANAGER')
  updateClassroom(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(classroomUpdateSchema)) body: z.infer<typeof classroomUpdateSchema>,
  ) {
    return this.rooms.updateClassroom(id, body, user.userId, user.role)
  }

  @Delete('classrooms/:id')
  @Roles('ADMIN', 'MANAGER')
  deleteClassroom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rooms.deleteClassroom(id, user.userId, user.role)
  }

  // ---------- шаблоны ----------

  @Get('templates')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  templates(@CurrentUser() user: AuthUser) {
    return this.scheduling.templates(user.userId, user.role)
  }

  @Post('templates')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  createTemplate(@CurrentUser() user: AuthUser, @Body(zodBody(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.scheduling.createTemplate(body, user.userId, user.role)
  }

  @Patch('templates/:id')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(templateUpdateSchema)) body: z.infer<typeof templateUpdateSchema>,
  ) {
    return this.scheduling.updateTemplate(id, body, user.userId, user.role)
  }

  @Delete('templates/:id')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  deleteTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.deleteTemplate(id, user.userId, user.role)
  }

  @Post('templates/:id/apply')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  applyTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(applyTemplateSchema)) body: z.infer<typeof applyTemplateSchema>,
  ) {
    return this.scheduling.applyTemplate(id, body.from, body.to, user.userId, user.role)
  }

  // ---------- занятия ----------

  @Get('schedules')
  schedules(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    const { from, to } = range(query)
    return this.scheduling.schedules(user.userId, user.role, {
      from,
      to,
      courseId: typeof query.courseId === 'string' ? query.courseId : undefined,
      teacherId: typeof query.teacherId === 'string' ? query.teacherId : undefined,
      classroomId: typeof query.classroomId === 'string' ? query.classroomId : undefined,
      kind: typeof query.kind === 'string' ? query.kind : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
    })
  }

  @Get('schedules/:id')
  scheduleDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.scheduleDetail(id, user.userId, user.role)
  }

  @Post('schedules')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  createSchedule(@CurrentUser() user: AuthUser, @Body(zodBody(scheduleCreateSchema)) body: z.infer<typeof scheduleCreateSchema>) {
    return this.scheduling.createSchedule(body, user.userId, user.role)
  }

  @Post('schedules/recurring')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  createRecurring(@CurrentUser() user: AuthUser, @Body(zodBody(recurringSchema)) body: z.infer<typeof recurringSchema>) {
    return this.scheduling.createSeries(body, user.userId, user.role)
  }

  @Patch('schedules/:id')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  updateSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(scheduleUpdateSchema)) body: z.infer<typeof scheduleUpdateSchema>,
  ) {
    return this.scheduling.updateSchedule(id, body, user.userId, user.role)
  }

  @Post('schedules/:id/cancel')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(cancelSchema)) body: z.infer<typeof cancelSchema>,
  ) {
    return this.scheduling.cancelSchedule(id, body.reason, user.userId, user.role)
  }

  @Post('schedules/conflicts')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  conflicts(@Body(zodBody(conflictsSchema)) body: z.infer<typeof conflictsSchema>) {
    return this.scheduling.conflicts(null, body)
  }

  @Get('schedules/:id/alternatives')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  alternatives(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.alternatives(id, user.userId, user.role)
  }

  @Get('schedules/:id/available-teachers')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  availableTeachers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.availableTeachers(id, user.userId, user.role)
  }

  @Post('schedules/:id/change-request')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  requestChange(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(changeRequestSchema)) body: z.infer<typeof changeRequestSchema>,
  ) {
    return this.scheduling.requestChange(id, body, user.userId, user.role)
  }

  @Post('schedules/:id/substitute')
  @Roles('ADMIN', 'MANAGER')
  substitute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(substituteSchema)) body: z.infer<typeof substituteSchema>,
  ) {
    return this.scheduling.substitute(id, body, user.userId, user.role)
  }

  // ---------- согласования ----------

  @Get('changes')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  changes(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.scheduling.changes(user.userId, user.role, status)
  }

  @Post('changes/:id/approve')
  @Roles('ADMIN', 'MANAGER')
  approveChange(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(changeDecisionSchema)) body: z.infer<typeof changeDecisionSchema>,
  ) {
    return this.scheduling.approveChange(id, body.comment, user.userId, user.role)
  }

  @Post('changes/:id/reject')
  @Roles('ADMIN', 'MANAGER')
  rejectChange(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(changeDecisionSchema)) body: z.infer<typeof changeDecisionSchema>,
  ) {
    return this.scheduling.rejectChange(id, body.comment, user.userId, user.role)
  }

  // ---------- дополнительные занятия ----------

  @Get('extra')
  extra(@CurrentUser() user: AuthUser) {
    return this.scheduling.extraSessions(user.userId, user.role)
  }

  @Post('schedules/:id/enroll')
  @Roles('STUDENT')
  enroll(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.enrollExtra(id, user.userId)
  }

  @Delete('schedules/:id/enroll')
  @Roles('STUDENT')
  cancelEnrollment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.cancelExtraEnrollment(id, user.userId)
  }

  // ---------- посещаемость ----------

  @Get('schedules/:id/attendance')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  attendance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.attendance(id, user.userId, user.role)
  }

  @Post('schedules/:id/attendance')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  markAttendance(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(attendanceMarkSchema)) body: z.infer<typeof attendanceMarkSchema>,
  ) {
    return this.scheduling.markAttendance(id, body, user.userId, user.role)
  }

  // ---------- статистика и AI ----------

  @Get('stats')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  stats(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    const { from, to } = range(query)
    return this.analytics.stats(from, to, user.userId, user.role)
  }

  @Post('ai/analyze')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  aiAnalyze(@CurrentUser() user: AuthUser) {
    return this.analytics.aiAnalyze(user.userId, user.role)
  }

  // ---------- настройки записи ----------

  @Get('settings/recording')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  recordingSettings() {
    return this.settings.recordingSettings()
  }

  @Patch('settings/recording')
  @Roles('ADMIN', 'MANAGER')
  updateRecordingSettings(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(recordingSettingsSchema)) body: z.infer<typeof recordingSettingsSchema>,
  ) {
    return this.settings.updateRecordingSettings(body, user.userId, user.role)
  }

  @Patch('courses/:id/recording')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  updateCourseRecording(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(courseRecordingSchema)) body: z.infer<typeof courseRecordingSchema>,
  ) {
    return this.settings.updateCourseRecording(id, body, user.userId, user.role)
  }

  // ---------- календарь ----------

  @Get('calendar')
  calendarView(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    const { from, to } = range(query)
    const status = typeof query.status === 'string' ? query.status : 'SCHEDULED'
    return this.calendar.calendar(user.userId, user.role, {
      from,
      to,
      courseId: typeof query.courseId === 'string' ? query.courseId : undefined,
      teacherId: typeof query.teacherId === 'string' ? query.teacherId : undefined,
      classroomId: typeof query.classroomId === 'string' ? query.classroomId : undefined,
      types: typeof query.types === 'string' ? query.types : undefined,
      status,
    })
  }

  @Get('calendar/free-slots')
  freeSlots(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) {
    const parsed = freeSlotsQuerySchema.safeParse(query)
    if (!parsed.success) throw badRequest('Некорректные параметры свободного времени')
    return this.calendar.freeSlots(user.userId, user.role, {
      ...parsed.data,
      from: new Date(parsed.data.from),
      to: new Date(parsed.data.to),
    })
  }

  @Get('calendar/tasks')
  tasks(@CurrentUser() user: AuthUser) {
    return this.calendar.tasks(user.userId)
  }

  @Post('calendar/tasks')
  createTask(@CurrentUser() user: AuthUser, @Body(zodBody(taskSchema)) body: z.infer<typeof taskSchema>) {
    return this.calendar.createTask(user.userId, body)
  }

  @Patch('calendar/tasks/:id')
  updateTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(zodBody(taskUpdateSchema)) body: z.infer<typeof taskUpdateSchema>,
  ) {
    return this.calendar.updateTask(id, user.userId, body)
  }

  @Delete('calendar/tasks/:id')
  deleteTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendar.deleteTask(id, user.userId)
  }

  @Get('calendar/connections')
  connections(@CurrentUser() user: AuthUser) {
    return this.calendar.connections(user.userId)
  }

  @Post('calendar/connections')
  createConnection(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(calendarConnectionSchema)) body: z.infer<typeof calendarConnectionSchema>,
  ) {
    return this.calendar.createConnection(user.userId, body.provider)
  }

  @Delete('calendar/connections/:id')
  deleteConnection(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendar.deleteConnection(id, user.userId)
  }

  @Public()
  @Get('calendar/feed/:token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async feed(@Param('token') token: string) {
    return this.calendar.feed(token)
  }

  // ---------- LiveDigital ----------

  @Post('schedules/:id/video/room')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  createVideoRoom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.video.ensureRoom(id, user.userId)
  }

  @Post('schedules/:id/video/join')
  joinVideo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.video.join(id, user.userId, user.role)
  }

  @Post('schedules/:id/video/leave')
  @HttpCode(200)
  leaveVideo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.video.leave(id, user.userId, user.role)
  }

  @Post('schedules/:id/video/end')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  endVideo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.video.end(id, user.userId, user.role)
  }

  @Post('schedules/:id/recording/start')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  startRecording(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.video.recordingStart(id, user.userId, user.role)
  }

  @Post('schedules/:id/recording/stop')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  stopRecording(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.video.recordingStop(id, user.userId, user.role)
  }

  @Get('schedules/:id/video/analytics')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  videoAnalytics(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.video.analytics(id, user.userId, user.role)
  }

  @Get('schedules/:id/chat')
  chatList(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('after') after?: string) {
    return this.chat.list(id, user.userId, user.role, after)
  }

  @Post('schedules/:id/chat')
  chatSend(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { body?: string }) {
    return this.chat.send(id, user.userId, user.role, String(body.body ?? ''))
  }

  @Get('recordings')
  recordings(@CurrentUser() user: AuthUser) {
    return this.video.recordings(user.userId, user.role)
  }

  @Get('recordings/:id/file')
  async recordingFile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.video.recordingFile(id, user.userId, user.role)
    response.setHeader('Content-Type', 'video/mp4')
    response.setHeader('Content-Length', String(file.size))
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
    return new StreamableFile(file.stream)
  }

  @Post('recordings/:id/transfer/retry')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  retryTransfer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.video.retryTransfer(id, user.userId, user.role)
  }
}
