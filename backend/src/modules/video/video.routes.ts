import { Router } from 'express'
import { z } from 'zod'
import type { RoleName } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { COIN_RULES, awardCoins } from '../../lib/coins.js'
import { AppError, conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import {
  buildJoinToken,
  createProviderRoom,
  deleteProviderRoom,
  isVideoConfigured,
  livekitConfig,
  recordingStorage,
  startRoomRecording,
  stopRoomRecording,
  verifyWebhook,
  type WebhookEvent,
} from './livekit.js'

export const videoRouter = Router()
export const videoWebhookRouter = Router()

/** Окно входа для ученика: 15 минут до начала и 15 минут после окончания. */
const JOIN_EARLY_MS = 15 * 60 * 1000
const JOIN_LATE_MS = 15 * 60 * 1000

type Auth = { userId: string; role: RoleName; email: string }

const scheduleIdSchema = z.object({ scheduleId: z.string().uuid() })
const recordingIdSchema = z.object({ recordingId: z.string().uuid() })

async function loadScheduleAccess(scheduleId: string, auth: Auth) {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      course: {
        select: {
          id: true,
          title: true,
          teacherId: true,
          teacher: { select: { firstName: true, lastName: true } },
        },
      },
      room: true,
    },
  })
  if (!schedule) throw notFound('Занятие не найдено')
  if (auth.role === 'ADMIN') return schedule
  if (schedule.teacherId === auth.userId || schedule.course.teacherId === auth.userId) return schedule

  if (auth.role === 'STUDENT') {
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: schedule.courseId, studentId: auth.userId } },
      select: { id: true },
    })
    if (enrollment) return schedule
  }

  throw forbidden('Нет доступа к этому занятию')
}

async function loadRoomAccess(roomId: string, auth: Auth) {
  const room = await prisma.videoRoom.findUnique({
    where: { id: roomId },
    include: { schedule: { include: { course: { select: { id: true, title: true, teacherId: true } } } } },
  })
  if (!room) throw notFound('Комната не найдена')

  if (auth.role === 'ADMIN') return room
  if (room.schedule.teacherId === auth.userId || room.schedule.course.teacherId === auth.userId) return room

  if (auth.role === 'STUDENT') {
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: room.schedule.courseId, studentId: auth.userId } },
      select: { id: true },
    })
    if (enrollment) return room
  }

  throw forbidden('Нет доступа к этой комнате')
}

/** Закрывает открытое присутствие и накапливает длительность. */
async function closeAttendance(scheduleId: string, userId: string) {
  const attendance = await prisma.attendance.findUnique({
    where: { scheduleId_userId: { scheduleId, userId } },
  })
  if (!attendance || attendance.leftAt) return

  const now = new Date()
  const seconds = Math.max(0, Math.round((now.getTime() - attendance.joinedAt.getTime()) / 1000))
  await prisma.attendance.update({
    where: { id: attendance.id },
    data: { leftAt: now, durationSeconds: attendance.durationSeconds + seconds },
  })
}

videoRouter.get('/status', requireAuth, (_req, res) => {
  res.json({ enabled: isVideoConfigured(), recording: recordingStorage() !== null })
})

/** Комната создаётся преподавателем; запись в БД появляется только после ответа провайдера. */
videoRouter.post('/rooms', requireAuth, requireRole('TEACHER', 'ADMIN'), validate(scheduleIdSchema), async (req, res) => {
  const auth = req.auth!
  const schedule = await loadScheduleAccess(req.body.scheduleId, auth)

  if (schedule.room) {
    res.json({ id: schedule.room.id, roomName: schedule.room.roomName, status: schedule.room.status })
    return
  }

  const config = livekitConfig()
  if (!config) {
    throw new AppError(
      503,
      'VIDEO_NOT_CONFIGURED',
      'Видеозанятия не настроены: задайте LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET на сервере',
    )
  }

  const roomName = `itadis-${schedule.id.slice(0, 8)}-${Date.now().toString(36)}`
  await createProviderRoom(roomName)

  const room = await prisma.videoRoom.create({
    data: { scheduleId: schedule.id, roomName, createdById: auth.userId, provider: 'livekit' },
  })

  res.status(201).json({ id: room.id, roomName: room.roomName, status: room.status })
})

/** Подключение: сервер проверяет доступ, окно времени и выдаёт короткоживущий токен. */
videoRouter.post('/rooms/join', requireAuth, validate(scheduleIdSchema), async (req, res) => {
  const auth = req.auth!
  const schedule = await loadScheduleAccess(req.body.scheduleId, auth)
  const room = schedule.room

  if (!room) throw notFound('Комната ещё не создана преподавателем')
  if (room.status === 'ENDED') throw conflict('Занятие завершено')

  const config = livekitConfig()
  if (!config) {
    throw new AppError(
      503,
      'VIDEO_NOT_CONFIGURED',
      'Видеозанятия не настроены: задайте LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET на сервере',
    )
  }

  const isModerator = auth.role !== 'STUDENT'
  if (!isModerator) {
    if (Date.now() < schedule.startsAt.getTime() - JOIN_EARLY_MS) {
      throw conflict('Подключение откроется за 15 минут до начала занятия')
    }
    if (Date.now() > schedule.endsAt.getTime() + JOIN_LATE_MS) {
      throw conflict('Время подключения к этому занятию истекло')
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { firstName: true, lastName: true },
  })
  if (!user) throw unauthorized()

  if (room.status === 'CREATED') {
    await prisma.videoRoom.update({
      where: { id: room.id },
      data: { status: 'LIVE', startedAt: room.startedAt ?? new Date() },
    })
  }

  await prisma.$transaction(async (tx) => {
    await tx.attendance.upsert({
      where: { scheduleId_userId: { scheduleId: schedule.id, userId: auth.userId } },
      create: { scheduleId: schedule.id, userId: auth.userId, joinedAt: new Date() },
      update: { joinedAt: new Date(), leftAt: null },
    })

    // Ученик получает монеты за присутствие один раз за занятие, даже при переподключении.
    if (!isModerator) {
      await awardCoins(tx, {
        userId: auth.userId,
        amount: COIN_RULES.attendance,
        reason: `Посещение занятия: ${schedule.title}`,
        sourceType: 'ATTENDANCE',
        sourceId: schedule.id,
      })
    }
  })

  const { token, expiresAt } = buildJoinToken(
    {
      identity: auth.userId,
      name: `${user.firstName} ${user.lastName}`,
      roomName: room.roomName,
      canPublish: true,
      roomAdmin: isModerator,
    },
    config,
  )

  res.json({
    roomId: room.id,
    roomName: room.roomName,
    url: config.url,
    token,
    expiresAt,
    canPublish: true,
    isModerator,
    schedule: {
      id: schedule.id,
      title: schedule.title,
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
    },
    course: { id: schedule.course.id, title: schedule.course.title },
    teacher: `${schedule.course.teacher.firstName} ${schedule.course.teacher.lastName}`,
  })
})

videoRouter.post('/rooms/:id/leave', requireAuth, async (req, res) => {
  const auth = req.auth!
  const room = await loadRoomAccess(String(req.params.id), auth)
  await closeAttendance(room.scheduleId, auth.userId)
  res.json({ ok: true })
})

/** Завершение занятия преподавателем: остановка записи, закрытие посещаемости, удаление комнаты. */
videoRouter.post('/rooms/:id/end', requireAuth, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const auth = req.auth!
  const room = await loadRoomAccess(String(req.params.id), auth)
  if (room.status === 'ENDED') {
    res.json({ ok: true, alreadyEnded: true })
    return
  }

  const recordings = await prisma.videoRecording.findMany({
    where: { roomId: room.id, url: null },
    select: { id: true, egressId: true },
  })
  for (const recording of recordings) {
    try {
      await stopRoomRecording(recording.egressId)
      await prisma.videoRecording.update({ where: { id: recording.id }, data: { status: 'STOPPING' } })
    } catch (error) {
      console.warn('[video] не удалось остановить запись', recording.egressId, error)
    }
  }

  const openAttendance = await prisma.attendance.findMany({
    where: { scheduleId: room.scheduleId, leftAt: null },
    select: { userId: true },
  })
  for (const item of openAttendance) {
    await closeAttendance(room.scheduleId, item.userId)
  }

  await prisma.videoRoom.update({ where: { id: room.id }, data: { status: 'ENDED', endedAt: new Date() } })
  await prisma.schedule.update({ where: { id: room.scheduleId }, data: { status: 'COMPLETED' } })

  try {
    await deleteProviderRoom(room.roomName)
  } catch (error) {
    console.warn('[video] не удалось удалить комнату у провайдера', room.roomName, error)
  }

  res.json({ ok: true })
})

videoRouter.post('/rooms/:id/recording/start', requireAuth, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const room = await loadRoomAccess(String(req.params.id), req.auth!)
  if (room.status === 'ENDED') throw conflict('Занятие завершено')

  const active = await prisma.videoRecording.findFirst({
    where: { roomId: room.id, url: null },
    select: { id: true },
  })
  if (active) throw conflict('Запись уже идёт')

  const egressId = await startRoomRecording(room.roomName)
  const recording = await prisma.videoRecording.create({
    data: { roomId: room.id, egressId, startedById: req.auth!.userId, status: 'ACTIVE' },
  })

  res.status(201).json({ id: recording.id, status: recording.status, startedAt: recording.startedAt })
})

videoRouter.post('/rooms/:id/recording/stop', requireAuth, requireRole('TEACHER', 'ADMIN'), validate(recordingIdSchema), async (req, res) => {
  const room = await loadRoomAccess(String(req.params.id), req.auth!)
  const recording = await prisma.videoRecording.findFirst({
    where: { id: req.body.recordingId, roomId: room.id },
  })
  if (!recording) throw notFound('Запись не найдена')
  if (recording.url) throw conflict('Запись уже завершена')

  await stopRoomRecording(recording.egressId)
  const updated = await prisma.videoRecording.update({
    where: { id: recording.id },
    data: { status: 'STOPPING' },
  })

  res.json({ id: updated.id, status: updated.status })
})

videoRouter.get('/rooms/:id/attendance', requireAuth, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const room = await loadRoomAccess(String(req.params.id), req.auth!)

  const items = await prisma.attendance.findMany({
    where: { scheduleId: room.scheduleId },
    include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
    orderBy: { joinedAt: 'asc' },
  })

  res.json({
    items: items.map((item) => ({
      userId: item.userId,
      name: `${item.user.firstName} ${item.user.lastName}`,
      role: item.user.role,
      joinedAt: item.joinedAt,
      leftAt: item.leftAt,
      durationSeconds:
        item.durationSeconds + (item.leftAt ? 0 : Math.max(0, Math.round((Date.now() - item.joinedAt.getTime()) / 1000))),
    })),
  })
})

/** Записи видны только тем, у кого есть доступ к соответствующему занятию. */
videoRouter.get('/recordings', requireAuth, async (req, res) => {
  const auth = req.auth!

  const where =
    auth.role === 'ADMIN'
      ? {}
      : auth.role === 'TEACHER'
        ? { room: { schedule: { course: { teacherId: auth.userId } } } }
        : { room: { schedule: { course: { enrollments: { some: { studentId: auth.userId } } } } } }

  const items = await prisma.videoRecording.findMany({
    where,
    include: {
      room: {
        include: {
          schedule: { select: { id: true, title: true, startsAt: true, course: { select: { id: true, title: true } } } },
        },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: 100,
  })

  res.json({
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      url: item.url,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      schedule: {
        id: item.room.schedule.id,
        title: item.room.schedule.title,
        startsAt: item.room.schedule.startsAt,
        course: item.room.schedule.course,
      },
    })),
  })
})

/** Обработка событий LiveKit: присутствие и готовые записи фиксируются на сервере. */
async function handleWebhook(event: WebhookEvent): Promise<void> {
  const roomName = event.room?.name
  if (!roomName) return

  const room = await prisma.videoRoom.findUnique({
    where: { roomName },
    select: { id: true, scheduleId: true, status: true },
  })
  if (!room) return

  if (event.event === 'room_started') {
    if (room.status !== 'LIVE') {
      await prisma.videoRoom.update({
        where: { id: room.id },
        data: { status: 'LIVE', startedAt: new Date() },
      })
    }
    return
  }

  if (event.event === 'room_finished') {
    const openAttendance = await prisma.attendance.findMany({
      where: { scheduleId: room.scheduleId, leftAt: null },
      select: { userId: true },
    })
    for (const item of openAttendance) {
      await closeAttendance(room.scheduleId, item.userId)
    }
    await prisma.videoRoom.update({ where: { id: room.id }, data: { status: 'ENDED', endedAt: new Date() } })
    await prisma.schedule.update({ where: { id: room.scheduleId }, data: { status: 'COMPLETED' } })
    return
  }

  const identity = event.participant?.identity
  if (identity && (event.event === 'participant_joined' || event.event === 'participant_left')) {
    const user = await prisma.user.findUnique({ where: { id: identity }, select: { id: true } })
    if (!user) return

    if (event.event === 'participant_joined') {
      await prisma.attendance.upsert({
        where: { scheduleId_userId: { scheduleId: room.scheduleId, userId: user.id } },
        create: { scheduleId: room.scheduleId, userId: user.id, joinedAt: new Date() },
        update: { joinedAt: new Date(), leftAt: null },
      })
    } else {
      await closeAttendance(room.scheduleId, user.id)
    }
    return
  }

  const egressId = event.egressInfo?.egressId
  if (!egressId) return

  const recording = await prisma.videoRecording.findUnique({ where: { egressId } })
  if (!recording) return

  if (event.event === 'egress_ended') {
    const status = event.egressInfo?.status ?? 'EGRESS_COMPLETE'
    const url =
      event.egressInfo?.file?.location ??
      event.egressInfo?.fileResults?.find((file) => file.location)?.location ??
      null
    await prisma.videoRecording.update({
      where: { id: recording.id },
      data: {
        url,
        status: status === 'EGRESS_COMPLETE' ? 'COMPLETED' : status === 'EGRESS_FAILED' ? 'FAILED' : status,
        endedAt: new Date(),
      },
    })
    return
  }

  if (event.event === 'egress_updated' && event.egressInfo?.status) {
    await prisma.videoRecording.update({
      where: { id: recording.id },
      data: { status: event.egressInfo.status },
    })
  }
}

videoWebhookRouter.post('/livekit', async (req, res) => {
  const config = livekitConfig()
  if (!config) {
    res.status(503).json({ error: { code: 'VIDEO_NOT_CONFIGURED', message: 'Видеозанятия не настроены' } })
    return
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}))

  let event: WebhookEvent
  try {
    event = verifyWebhook(rawBody, req.headers.authorization, config)
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400
    res.status(status).json({
      error: { code: 'INVALID_WEBHOOK', message: error instanceof Error ? error.message : 'Некорректный вебхук' },
    })
    return
  }

  try {
    await handleWebhook(event)
    res.json({ ok: true })
  } catch (error) {
    console.error('[video] ошибка обработки вебхука', error)
    res.status(500).json({ error: { code: 'WEBHOOK_FAILED', message: 'Не удалось обработать событие' } })
  }
})
