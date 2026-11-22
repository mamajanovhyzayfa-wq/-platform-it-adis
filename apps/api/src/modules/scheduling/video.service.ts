import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { conflict, forbidden, notFound, AppError } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { awardCoins, COIN_RULES } from '../../lib/coins.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import {
  analyticsCalls,
  analyticsReport,
  createJoinCredentials,
  createRoom,
  deleteRecord,
  deleteRoom,
  finishCall,
  isLiveDigitalConfigured,
  listRecords,
  liveDigitalStatus,
  recordDownloadUrl,
  startRecording,
  stopRecording,
  updateRoomRecording,
  type LiveDigitalWebhookPayload,
} from './livedigital.js'
import { formatLocalTime, localDateKey } from './scheduling.time.js'

const JOIN_EARLY_MS = 15 * 60 * 1000
const JOIN_LATE_MS = 30 * 60 * 1000
const RECORDINGS_DIR = resolve(process.env.UPLOADS_DIR ?? 'uploads', 'recordings')
const MAX_TRANSFER_ATTEMPTS = 3

type ScheduleWithContext = {
  id: string
  title: string
  startsAt: Date
  endsAt: Date
  status: string
  kind: string
  deliveryMode: string
  teacherId: string
  courseId: string
  recordingEnabled: boolean | null
  autoRecord: boolean | null
  capacity: number | null
  course: {
    id: string
    title: string
    teacherId: string
    recordingEnabled: boolean | null
    recordingAuto: boolean | null
    endDate: Date | null
  }
  classroom: { id: string; name: string; capacity: number } | null
  room: {
    id: string
    provider: string
    roomName: string
    providerRoomId: string | null
    providerSpaceId: string | null
    status: string
    settings: unknown
  } | null
}

/** Видеозанятия LiveDigital: комнаты, вход, посещаемость, записи и вебхуки. */
@Injectable()
export class VideoService implements OnModuleInit, OnModuleDestroy {
  private retentionTimer: NodeJS.Timeout | null = null
  private transferTimer: NodeJS.Timeout | null = null

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Записи хранятся до окончания курса. Проверяем срок раз в 6 часов.
    this.retentionTimer = setInterval(() => void this.cleanupExpiredRecordings(), 6 * 60 * 60_000)
    this.retentionTimer.unref()
    // Если процесс перезапустился между вебхуком и скачиванием, запись могла
    // остаться в PENDING/DOWNLOADING. Догоняем такие переносы и повторяем.
    this.transferTimer = setInterval(() => void this.retryPendingTransfers(), 30 * 60_000)
    this.transferTimer.unref()
    void this.cleanupExpiredRecordings()
    setTimeout(() => void this.retryPendingTransfers(), 60_000).unref()
  }

  onModuleDestroy() {
    if (this.retentionTimer) clearInterval(this.retentionTimer)
    if (this.transferTimer) clearInterval(this.transferTimer)
    this.retentionTimer = null
    this.transferTimer = null
  }

  /** Повторяет незавершённые переносы: после сбоя процесса или временной ошибки провайдера. */
  async retryPendingTransfers(): Promise<number> {
    if (!isLiveDigitalConfigured()) return 0
    const pending = await this.prisma.client.videoRecording.findMany({
      where: {
        status: 'FINISHED',
        transferStatus: { in: ['PENDING', 'DOWNLOADING'] },
        providerRecordId: { not: null },
        attempts: { lt: MAX_TRANSFER_ATTEMPTS },
      },
      orderBy: { endedAt: 'asc' },
      take: 10,
      select: { id: true },
    })

    let transferred = 0
    for (const recording of pending) {
      try {
        await this.transferRecording(recording.id)
        transferred += 1
      } catch (error) {
        console.warn('[livedigital] повторный перенос записи не удался', recording.id, error)
      }
    }
    return transferred
  }

  status() {
    return liveDigitalStatus()
  }

  private async branchSettings() {
    return this.prisma.client.branchSettings.upsert({
      where: { id: 'branch' },
      create: { id: 'branch' },
      update: {},
    })
  }

  async resolveRecordingSettings(schedule: {
    recordingEnabled: boolean | null
    autoRecord: boolean | null
    course: { recordingEnabled: boolean | null; recordingAuto: boolean | null }
  }) {
    const branch = await this.branchSettings()
    return {
      recordingEnabled: schedule.recordingEnabled ?? schedule.course.recordingEnabled ?? branch.recordingEnabled,
      autoRecord: schedule.autoRecord ?? schedule.course.recordingAuto ?? branch.recordingAuto,
    }
  }

  private async loadSchedule(scheduleId: string): Promise<ScheduleWithContext> {
    const schedule = await this.prisma.client.schedule.findUnique({
      where: { id: scheduleId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            teacherId: true,
            recordingEnabled: true,
            recordingAuto: true,
            endDate: true,
          },
        },
        classroom: { select: { id: true, name: true, capacity: true } },
        room: {
          select: {
            id: true,
            provider: true,
            roomName: true,
            providerRoomId: true,
            providerSpaceId: true,
            status: true,
            settings: true,
          },
        },
      },
    })
    if (!schedule) throw notFound('Занятие не найдено')
    return schedule as ScheduleWithContext
  }

  private async assertAccess(
    schedule: ScheduleWithContext,
    userId: string,
    role: RoleName,
    options: { manage?: boolean; studentWindow?: boolean } = {},
  ) {
    const isManager = role === 'ADMIN' || role === 'MANAGER'
    const isTeacher = schedule.teacherId === userId || schedule.course.teacherId === userId
    if (isManager || (role === 'TEACHER' && isTeacher)) return
    if (options.manage) throw forbidden('Действие доступно наставнику занятия, менеджеру или администратору')
    if (role !== 'STUDENT') throw forbidden('Нет доступа к этому занятию')

    const enrolled = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId: schedule.courseId, studentId: userId } },
      select: { id: true },
    })
    if (enrolled) return

    const extra = await this.prisma.client.extraSessionEnrollment.findUnique({
      where: { scheduleId_userId: { scheduleId: schedule.id, userId } },
      select: { status: true },
    })
    if (extra?.status === 'REGISTERED') return
    throw forbidden('Занятие доступно ученикам группы')
  }

  /** Комната создаётся в LiveDigital и связывается с занятием. */
  async ensureRoom(scheduleId: string, actorId?: string) {
    const schedule = await this.loadSchedule(scheduleId)
    if (schedule.deliveryMode === 'OFFLINE') {
      return { room: schedule.room, warning: 'Офлайн-занятие не требует видеокомнаты' }
    }
    const settings = await this.resolveRecordingSettings(schedule)
    if (schedule.room?.providerRoomId) {
      const saved =
        schedule.room.settings && typeof schedule.room.settings === 'object' && !Array.isArray(schedule.room.settings)
          ? (schedule.room.settings as { recordingEnabled?: boolean; autoRecord?: boolean })
          : null
      if (saved?.recordingEnabled !== settings.recordingEnabled || saved?.autoRecord !== settings.autoRecord) {
        try {
          await updateRoomRecording(schedule.room.providerRoomId, settings)
          await this.prisma.client.videoRoom.update({
            where: { id: schedule.room.id },
            data: { settings: { recordingEnabled: settings.recordingEnabled, autoRecord: settings.autoRecord } },
          })
        } catch (error) {
          console.warn('[livedigital] не удалось обновить настройки записи комнаты', error)
        }
      }
      return { room: schedule.room }
    }

    if (!isLiveDigitalConfigured()) {
      throw new AppError(
        503,
        'LIVEDIGITAL_NOT_CONFIGURED',
        'Видеосвязь не настроена: задайте LIVEDIGITAL_API_TOKEN и LIVEDIGITAL_SPACE_ID',
      )
    }
    let providerRoom
    try {
      providerRoom = await createRoom({
        name: `${schedule.title} · ${formatLocalTime(schedule.startsAt)}`,
        recordingEnabled: settings.recordingEnabled,
        autoRecord: settings.autoRecord,
      })
    } catch (error) {
      await this.prisma.client.scheduleEvent
        .create({
          data: {
            scheduleId,
            actorId: actorId ?? null,
            action: 'VIDEO_ROOM_FAILED',
            message: error instanceof Error ? error.message.slice(0, 1000) : 'Ошибка LiveDigital',
          },
        })
        .catch(() => undefined)
      throw error
    }

    const room = await this.prisma.client.videoRoom.upsert({
      where: { scheduleId },
      create: {
        scheduleId,
        provider: 'livedigital',
        // alias уникален у провайдера; id — резерв, чтобы не нарушить unique(roomName).
        roomName: providerRoom.alias ?? providerRoom.id,
        providerRoomId: providerRoom.id,
        providerSpaceId: providerRoom.spaceId ?? null,
        providerAlias: providerRoom.alias ?? null,
        settings: {
          recordingEnabled: settings.recordingEnabled,
          autoRecord: settings.autoRecord,
        },
        createdById: actorId ?? schedule.teacherId,
      },
      update: {
        provider: 'livedigital',
        // alias уникален у провайдера; id — резерв, чтобы не нарушить unique(roomName).
        roomName: providerRoom.alias ?? providerRoom.id,
        providerRoomId: providerRoom.id,
        providerSpaceId: providerRoom.spaceId ?? null,
        providerAlias: providerRoom.alias ?? null,
        settings: {
          recordingEnabled: settings.recordingEnabled,
          autoRecord: settings.autoRecord,
        },
      },
    })

    await this.prisma.client.scheduleEvent
      .create({
        data: {
          scheduleId,
          actorId: actorId ?? null,
          action: 'VIDEO_ROOM_CREATED',
          message: `Комната LiveDigital создана: ${room.roomName}`,
          data: { providerRoomId: providerRoom.id },
        },
      })
      .catch(() => undefined)
    return { room }
  }

  /** Вход: проверка авторизации/прав, времени и выдача короткоживущего токена. */
  async join(scheduleId: string, userId: string, role: RoleName) {
    const schedule = await this.loadSchedule(scheduleId)
    if (schedule.status === 'CANCELLED') throw conflict('Занятие отменено')
    if (schedule.deliveryMode === 'OFFLINE') throw conflict('Это офлайн-занятие: видеокомната не создаётся')
    await this.assertAccess(schedule, userId, role)

    const isModerator = role !== 'STUDENT'
    if (!isModerator) {
      if (Date.now() < schedule.startsAt.getTime() - JOIN_EARLY_MS) {
        throw conflict('Подключение откроется за 15 минут до начала занятия')
      }
      if (Date.now() > schedule.endsAt.getTime() + JOIN_LATE_MS) {
        throw conflict('Время подключения к этому занятию истекло')
      }
    }

    const { room } = await this.ensureRoom(scheduleId, userId)
    if (!room?.providerRoomId) throw new AppError(503, 'LIVEDIGITAL_ROOM', 'Комната LiveDigital не создана')

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    })
    if (!user) throw notFound('Пользователь не найден')

    const displayName = `${user.firstName} ${user.lastName}`.trim() || user.email
    const credentials = await createJoinCredentials({
      providerRoomId: room.providerRoomId,
      name: displayName,
      // audience в LiveDigital не может публиковать камеру, микрофон и экран.
      // Ученик тоже входит как host; запись и завершение защищены на сервере ITadis.
      role: 'host',
      clientUniqueId: `itadis-${userId}`,
    })

    const now = new Date()
    const lateMinutes = isModerator
      ? 0
      : Math.max(0, Math.round((now.getTime() - schedule.startsAt.getTime()) / 60_000))
    const previousSessions = await this.prisma.client.attendanceSession.count({
      where: { scheduleId, userId },
    })
    const previousAttendance = await this.prisma.client.attendance.findUnique({
      where: { scheduleId_userId: { scheduleId, userId } },
    })

    await this.prisma.client.$transaction(async (tx) => {
      await tx.attendanceSession.create({ data: { scheduleId, userId, joinedAt: now, source: 'ONLINE' } })
      await tx.attendance.upsert({
        where: { scheduleId_userId: { scheduleId, userId } },
        create: {
          scheduleId,
          userId,
          joinedAt: now,
          status: isModerator ? 'PRESENT' : lateMinutes > 10 ? 'LATE' : 'PRESENT',
          lateMinutes: isModerator ? 0 : lateMinutes > 10 ? lateMinutes : 0,
          source: 'ONLINE',
        },
        update: {
          joinedAt: previousAttendance?.joinedAt ?? now,
          leftAt: null,
          status: lateMinutes > 10 ? 'LATE' : (previousAttendance?.status ?? 'PRESENT'),
          lateMinutes: Math.max(previousAttendance?.lateMinutes ?? 0, lateMinutes > 10 ? lateMinutes : 0),
          reconnectCount: { increment: previousSessions > 0 ? 1 : 0 },
        },
      })
      await tx.videoRoom.update({
        where: { id: room.id },
        data: { status: 'LIVE', startedAt: room.status === 'CREATED' ? now : undefined },
      })
      await tx.schedule.update({
        where: { id: scheduleId },
        data: { status: 'ONGOING' },
      })
      // Ученик получает монеты за присутствие один раз за занятие.
      if (!isModerator) {
        await awardCoins(tx, {
          userId,
          amount: COIN_RULES.attendance,
          reason: `Посещение занятия: ${schedule.title}`,
          sourceType: 'ATTENDANCE',
          sourceId: scheduleId,
        })
      }
    })

    await this.prisma.client.scheduleEvent
      .create({
        data: {
          scheduleId,
          actorId: userId,
          action: 'VIDEO_JOINED',
          message: `${displayName} подключился к занятию`,
        },
      })
      .catch(() => undefined)

    // Автозапись включает сама комната LiveDigital флагом isAutoRecordingAllowed:
    // провайдер запускает её при входе модератора и присылает record_started.
    // Повторно вызывать records/start нельзя — API ответит 409 «уже записывается».
    let autoRecording: { started: boolean; warning?: string } | null = null
    if (isModerator) {
      const settings = await this.resolveRecordingSettings(schedule)
      autoRecording =
        settings.recordingEnabled && settings.autoRecord
          ? { started: true }
          : { started: false }
    }

    return {
      autoRecording,
      provider: 'livedigital',
      roomName: room.roomName,
      providerRoomId: room.providerRoomId,
      signalingToken: credentials.signalingToken,
      participantId: credentials.participantId,
      isModerator,
      appData: { displayName, avatarUrl: null },
      schedule: {
        id: schedule.id,
        title: schedule.title,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        deliveryMode: schedule.deliveryMode,
      },
      course: { id: schedule.course.id, title: schedule.course.title },
    }
  }

  private async closeUserSessions(scheduleId: string, userId: string) {
    const now = new Date()
    const open = await this.prisma.client.attendanceSession.findMany({
      where: { scheduleId, userId, leftAt: null },
    })
    if (open.length === 0) return

    let added = 0
    for (const session of open) {
      const seconds = Math.max(0, Math.round((now.getTime() - session.joinedAt.getTime()) / 1000))
      added += seconds
      await this.prisma.client.attendanceSession.update({
        where: { id: session.id },
        data: { leftAt: now },
      })
    }

    const schedule = await this.loadSchedule(scheduleId)
    const earlyMinutes = Math.max(0, Math.round((schedule.endsAt.getTime() - now.getTime()) / 60_000))
    const attendance = await this.prisma.client.attendance.findUnique({
      where: { scheduleId_userId: { scheduleId, userId } },
    })
    if (!attendance) return

    const status =
      earlyMinutes > 10 && now < schedule.endsAt
        ? 'LEFT_EARLY'
        : attendance.status === 'ABSENT'
          ? 'PRESENT'
          : attendance.status
    await this.prisma.client.attendance.update({
      where: { id: attendance.id },
      data: {
        leftAt: now,
        durationSeconds: attendance.durationSeconds + added,
        status,
        earlyLeaveMinutes: earlyMinutes > 10 ? earlyMinutes : attendance.earlyLeaveMinutes,
      },
    })
  }

  async leave(scheduleId: string, userId: string, role: RoleName) {
    const schedule = await this.loadSchedule(scheduleId)
    await this.assertAccess(schedule, userId, role)
    await this.closeUserSessions(scheduleId, userId)
    return { ok: true }
  }

  /** Завершение конференции: LiveDigital закрывает звонок, запись останавливается. */
  async end(scheduleId: string, userId: string, role: RoleName) {
    const schedule = await this.loadSchedule(scheduleId)
    await this.assertAccess(schedule, userId, role, { manage: true })
    if (role === 'TEACHER' && schedule.teacherId !== userId && schedule.course.teacherId !== userId) {
      throw forbidden('Завершить занятие может наставник занятия, менеджер или администратор')
    }

    if (schedule.room?.providerRoomId) {
      try {
        await stopRecording(schedule.room.providerRoomId)
      } catch {
        // Запись могла не идти — это не мешает завершить звонок.
      }
      try {
        await finishCall(schedule.room.providerRoomId)
      } catch (error) {
        console.warn('[livedigital] finish-call не выполнен', error)
      }
    }

    const open = await this.prisma.client.attendanceSession.findMany({
      where: { scheduleId, leftAt: null },
      select: { userId: true },
    })
    for (const item of new Set(open.map((session) => session.userId))) {
      await this.closeUserSessions(scheduleId, item)
    }

    await this.prisma.client.$transaction([
      ...(schedule.room
        ? [
            this.prisma.client.videoRoom.update({
              where: { id: schedule.room.id },
              data: { status: 'ENDED', endedAt: new Date() },
            }),
          ]
        : []),
      this.prisma.client.schedule.update({
        where: { id: scheduleId },
        data: { status: 'COMPLETED' },
      }),
      this.prisma.client.scheduleEvent.create({
        data: { scheduleId, actorId: userId, action: 'VIDEO_ENDED', message: 'Конференция завершена' },
      }),
    ])

    await writeAudit({ actorId: userId, action: 'video.end', entity: 'Schedule', entityId: scheduleId })
    return { ok: true }
  }

  async recordingStart(scheduleId: string, userId: string, role: RoleName) {
    const schedule = await this.loadSchedule(scheduleId)
    await this.assertAccess(schedule, userId, role, { manage: true })
    if (!schedule.room?.providerRoomId) throw conflict('Комната ещё не создана')
    if (schedule.status === 'CANCELLED') throw conflict('Занятие отменено')
    const settings = await this.resolveRecordingSettings(schedule)
    if (!settings.recordingEnabled) throw conflict('Запись отключена настройками филиала, группы или занятия')

    const providerRecord = await startRecording(schedule.room.providerRoomId)
    const rec = await this.prisma.client.videoRecording.create({
      data: {
        roomId: schedule.room.id,
        egressId: providerRecord?.id ?? `ld-${schedule.room.id}-${Date.now()}`,
        providerRecordId: providerRecord?.id ?? null,
        provider: 'livedigital',
        status: 'RECORDING',
        transferStatus: 'PENDING',
        startedById: userId,
      },
    })
    await this.prisma.client.scheduleEvent
      .create({
        data: { scheduleId, actorId: userId, action: 'RECORDING_STARTED', message: 'Запущена запись занятия' },
      })
      .catch(() => undefined)
    return { id: rec.id, status: rec.status }
  }

  async recordingStop(scheduleId: string, userId: string, role: RoleName) {
    const schedule = await this.loadSchedule(scheduleId)
    await this.assertAccess(schedule, userId, role, { manage: true })
    if (!schedule.room?.providerRoomId) throw conflict('Комната ещё не создана')
    await stopRecording(schedule.room.providerRoomId)

    await this.prisma.client.videoRecording.updateMany({
      where: { roomId: schedule.room.id, transferStatus: 'PENDING', status: { not: 'FAILED' } },
      data: { status: 'STOPPING', endedAt: new Date() },
    })
    await this.prisma.client.scheduleEvent
      .create({
        data: { scheduleId, actorId: userId, action: 'RECORDING_STOPPED', message: 'Запись остановлена' },
      })
      .catch(() => undefined)
    return { ok: true }
  }

  private recordingAccessWhere(userId: string, role: RoleName) {
    if (role === 'ADMIN' || role === 'MANAGER') return {}
    if (role === 'TEACHER') {
      return { room: { schedule: { OR: [{ teacherId: userId }, { course: { teacherId: userId } }] } } }
    }
    // Ученик курса или участник дополнительного занятия, на котором велась запись.
    return {
      room: {
        schedule: {
          OR: [
            { course: { enrollments: { some: { studentId: userId } } } },
            { extraEnrollments: { some: { userId, status: 'REGISTERED' as const } } },
          ],
        },
      },
    }
  }

  async recordings(userId: string, role: RoleName) {
    const items = await this.prisma.client.videoRecording.findMany({
      where: this.recordingAccessWhere(userId, role),
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: {
        room: {
          include: {
            schedule: {
              select: {
                id: true,
                title: true,
                startsAt: true,
                course: { select: { id: true, title: true, endDate: true } },
              },
            },
          },
        },
      },
    })

    return {
      items: items.map((item) => ({
        id: item.id,
        status: item.status,
        transferStatus: item.transferStatus,
        url: item.url,
        durationSeconds: item.durationSeconds,
        attempts: item.attempts,
        error: item.error,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        available:
          item.transferStatus === 'STORED' &&
          (!item.room.schedule.course.endDate || item.room.schedule.course.endDate.getTime() >= Date.now()),
        expiresAt: item.room.schedule.course.endDate,
        schedule: {
          id: item.room.schedule.id,
          title: item.room.schedule.title,
          startsAt: item.room.schedule.startsAt,
          course: { id: item.room.schedule.course.id, title: item.room.schedule.course.title },
        },
      })),
    }
  }

  async recordingFile(recordingId: string, userId: string, role: RoleName) {
    const recording = await this.prisma.client.videoRecording.findFirst({
      where: { id: recordingId, ...this.recordingAccessWhere(userId, role) },
      include: {
        room: {
          include: {
            schedule: { select: { title: true, course: { select: { endDate: true } } } },
          },
        },
      },
    })
    if (!recording) throw notFound('Запись не найдена')
    if (recording.transferStatus !== 'STORED' || !recording.storageKey) {
      throw conflict('Запись ещё переносится в хранилище ITadis')
    }
    const endDate = recording.room.schedule.course.endDate
    if (endDate && endDate.getTime() < Date.now()) throw new AppError(410, 'RECORDING_EXPIRED', 'Срок хранения записи истёк')

    const path = resolve(RECORDINGS_DIR, recording.storageKey)
    if (!existsSync(path)) throw notFound('Файл записи не найден')
    const info = await stat(path)
    const safeTitle = recording.room.schedule.title.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'lesson'
    return {
      stream: createReadStream(path),
      size: info.size,
      filename: `${safeTitle}.mp4`,
    }
  }

  /** Скачивает запись от провайдера в файловое хранилище ITadis с повторами. */
  async transferRecording(recordingId: string, force = false): Promise<void> {
    const recording = await this.prisma.client.videoRecording.findUnique({
      where: { id: recordingId },
      include: { room: { include: { schedule: { include: { course: true } } } } },
    })
    if (!recording) throw notFound('Запись не найдена')
    if (recording.transferStatus === 'STORED') return
    if (!recording.room.providerRoomId || !recording.providerRecordId) {
      throw conflict('У записи нет идентификатора LiveDigital')
    }
    if (recording.attempts >= MAX_TRANSFER_ATTEMPTS && !force) {
      throw conflict('Исчерпаны попытки переноса, запустите повторно вручную')
    }

    await mkdir(RECORDINGS_DIR, { recursive: true })
    // Атомарно забираем перенос: вебхук и планировщик не должны скачивать один файл дважды.
    const claimed = await this.prisma.client.videoRecording.updateMany({
      where: { id: recordingId, transferStatus: recording.transferStatus },
      data: { transferStatus: 'DOWNLOADING', error: null, ...(force ? { attempts: 0 } : {}) },
    })
    if (claimed.count === 0) return

    let lastError = ''
    const firstAttempt = force ? 1 : recording.attempts + 1
    for (let attempt = firstAttempt; attempt <= MAX_TRANSFER_ATTEMPTS; attempt += 1) {
      try {
        await this.prisma.client.videoRecording.update({
          where: { id: recordingId },
          data: { attempts: attempt },
        })
        const url = await recordDownloadUrl(recording.room.providerRoomId, recording.providerRecordId)
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
        if (!response.ok || !response.body) throw new Error(`скачивание вернуло ${response.status}`)
        const contentType = response.headers.get('content-type') ?? ''
        if (/text\/html|application\/json/i.test(contentType)) {
          throw new Error(`вместо видео получен ${contentType}`)
        }

        const storageKey = `${recording.room.scheduleId}/${recording.providerRecordId}.mp4`
        const target = resolve(RECORDINGS_DIR, storageKey)
        await mkdir(dirname(target), { recursive: true })
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target))

        await this.prisma.client.videoRecording.update({
          where: { id: recordingId },
          data: {
            transferStatus: 'STORED',
            storageKey,
            url: `/api/scheduling/recordings/${recordingId}/file`,
            error: null,
            status: 'COMPLETED',
            technicalReport: { storedAt: new Date().toISOString(), attempts: attempt },
          },
        })
        await this.prisma.client.notification
          .create({
            data: {
              userId: recording.room.schedule.teacherId,
              type: 'SCHEDULE_CHANGED',
              title: 'Запись занятия готова',
              body: `«${recording.room.schedule.title}» перенесена в личный кабинет`,
              data: { kind: 'recording', recordingId, scheduleId: recording.room.scheduleId },
            },
          })
          .catch(() => undefined)
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (attempt < MAX_TRANSFER_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
      }
    }

    const report = {
      recordingId,
      provider: 'livedigital',
      providerRoomId: recording.room.providerRoomId,
      providerRecordId: recording.providerRecordId,
      attempts: MAX_TRANSFER_ATTEMPTS,
      failedAt: new Date().toISOString(),
      error: lastError,
    }
    await this.prisma.client.videoRecording.update({
      where: { id: recordingId },
      data: {
        transferStatus: 'FAILED',
        status: 'FAILED',
        error: lastError.slice(0, 1000),
        technicalReport: report,
      },
    })
    const admins = await this.prisma.client.user.findMany({
      where: { role: 'ADMIN', isActive: true, deletedAt: null },
      select: { id: true },
    })
    const recipients = [recording.room.schedule.teacherId, ...admins.map((item) => item.id)]
    await this.prisma.client.notification
      .createMany({
        data: recipients.map((userId) => ({
          userId,
          type: 'SCHEDULE_CHANGED' as const,
          title: 'Ошибка переноса записи',
          body: `Запись «${recording.room.schedule.title}» не перенесена. Технический отчёт сохранён.`,
          data: { kind: 'recording_failed', recordingId, scheduleId: recording.room.scheduleId },
        })),
      })
      .catch(() => undefined)
    throw new AppError(502, 'RECORDING_TRANSFER_FAILED', `Не удалось перенести запись: ${lastError}`)
  }

  async retryTransfer(recordingId: string, userId: string, role: RoleName) {
    if (role !== 'ADMIN' && role !== 'MANAGER' && role !== 'TEACHER') throw forbidden('Повторный перенос доступен сотрудникам')
    const allowed = await this.prisma.client.videoRecording.findFirst({
      where: { id: recordingId, ...this.recordingAccessWhere(userId, role) },
      select: { id: true },
    })
    if (!allowed) throw notFound('Запись не найдена')
    await this.transferRecording(recordingId, true)
    await writeAudit({ actorId: userId, action: 'recording.transfer.retry', entity: 'VideoRecording', entityId: recordingId })
    return { ok: true }
  }

  async analytics(scheduleId: string, userId: string, role: RoleName) {
    const schedule = await this.loadSchedule(scheduleId)
    await this.assertAccess(schedule, userId, role, { manage: true })
    if (!schedule.room?.providerRoomId) throw conflict('Комната ещё не создана')
    const calls = await analyticsCalls(schedule.room.providerRoomId, schedule.startsAt.toISOString())
    const call =
      calls.find((item) => localDateKey(new Date(item.startedAt ?? schedule.startsAt)) === localDateKey(schedule.startsAt)) ??
      calls[0]
    if (!call) return { call: null, report: null, note: 'Аналитика появится после завершения звонка' }
    const report = await analyticsReport({ providerRoomId: schedule.room.providerRoomId, callId: call.id })
    return { call, report }
  }

  /** Ищет запись по id провайдера или локальную запись, созданную при автостарте. */
  private async findRecordingForEvent(roomId: string, recordId: string) {
    const exact = await this.prisma.client.videoRecording.findFirst({
      where: { roomId, OR: [{ providerRecordId: recordId }, { egressId: recordId }] },
    })
    if (exact) return exact
    return this.prisma.client.videoRecording.findFirst({
      where: { roomId, providerRecordId: null, status: 'RECORDING' },
      orderBy: { startedAt: 'desc' },
    })
  }

  /** Обработка вебхука LiveDigital: звонки, записи и ошибки провайдера. */
  async handleWebhook(payload: LiveDigitalWebhookPayload) {
    const providerRoomId = payload.roomId
    if (!providerRoomId) return

    const room = await this.prisma.client.videoRoom.findUnique({
      where: { providerRoomId },
      include: {
        schedule: { include: { course: { select: { title: true, teacherId: true } } } },
      },
    })
    if (!room) return

    const scheduleId = room.scheduleId
    const now = new Date()

    if (payload.eventName === 'call_started') {
      await this.prisma.client.$transaction([
        this.prisma.client.videoRoom.update({
          where: { id: room.id },
          data: { status: 'LIVE', startedAt: room.startedAt ?? now },
        }),
        this.prisma.client.schedule.update({ where: { id: scheduleId }, data: { status: 'ONGOING' } }),
      ])
      return
    }

    if (payload.eventName === 'call_finished') {
      const open = await this.prisma.client.attendanceSession.findMany({
        where: { scheduleId, leftAt: null },
        select: { userId: true },
      })
      for (const userId of new Set(open.map((item) => item.userId))) {
        await this.closeUserSessions(scheduleId, userId)
      }
      await this.prisma.client.$transaction([
        this.prisma.client.videoRoom.update({
          where: { id: room.id },
          data: { status: 'ENDED', endedAt: now },
        }),
        this.prisma.client.schedule.update({ where: { id: scheduleId }, data: { status: 'COMPLETED' } }),
      ])
      return
    }

    if (!payload.recordId) return
    const recordId = payload.recordId

    if (payload.eventName === 'record_started') {
      const existing = await this.findRecordingForEvent(room.id, recordId)
      if (!existing) {
        await this.prisma.client.videoRecording.create({
          data: {
            roomId: room.id,
            egressId: recordId,
            providerRecordId: recordId,
            provider: 'livedigital',
            status: 'RECORDING',
            transferStatus: 'PENDING',
            startedById: room.createdById,
          },
        })
      } else {
        // При автостарте локальная запись создаётся до вебхука и ещё не знает recordId.
        await this.prisma.client.videoRecording.update({
          where: { id: existing.id },
          data: { providerRecordId: recordId, status: 'RECORDING', transferStatus: 'PENDING', error: null },
        })
      }
      await this.prisma.client.scheduleEvent
        .create({
          data: {
            scheduleId,
            actorId: null,
            action: 'RECORDING_STARTED',
            message: 'LiveDigital начал запись занятия',
            data: { providerRecordId: recordId },
          },
        })
        .catch(() => undefined)
      return
    }

    const terminalEvent =
      payload.eventName === 'record_finished' ||
      payload.eventName === 'record_failed' ||
      payload.eventName === 'record_aborted'
    if (!terminalEvent) return

    let details = null
    try {
      details = (await listRecords(providerRoomId)).find((item) => item.id === recordId) ?? null
    } catch (error) {
      console.warn('[livedigital] не удалось получить данные записи', error)
    }

    const existing = await this.findRecordingForEvent(room.id, recordId)
    const failed = payload.eventName !== 'record_finished'
    const data = {
      providerRecordId: recordId,
      provider: 'livedigital',
      callId: details?.callId ?? payload.callId ?? null,
      durationSeconds: details?.duration ? Math.round(details.duration / 1000) : null,
      endedAt: details?.finishedAt ? new Date(details.finishedAt) : now,
      status: failed ? 'FAILED' : 'FINISHED',
    }
    const recording = existing
      ? await this.prisma.client.videoRecording.update({ where: { id: existing.id }, data })
      : await this.prisma.client.videoRecording.create({
          data: {
            ...data,
            roomId: room.id,
            egressId: recordId,
            transferStatus: 'PENDING',
            startedById: room.createdById,
          },
        })

    if (failed) {
      const admins = await this.prisma.client.user.findMany({
        where: { role: 'ADMIN', isActive: true, deletedAt: null },
        select: { id: true },
      })
      await this.prisma.client.notification
        .createMany({
          data: [room.schedule.teacherId, ...admins.map((item) => item.id)].map((userId) => ({
            userId,
            type: 'SCHEDULE_CHANGED' as const,
            title: 'Запись занятия не удалась',
            body: `LiveDigital сообщил об ошибке записи «${room.schedule.title}». Сформирован технический отчёт.`,
            data: { kind: 'recording_failed', recordingId: recording.id, scheduleId },
          })),
        })
        .catch(() => undefined)
      await this.prisma.client.videoRecording.update({
        where: { id: recording.id },
        data: {
          transferStatus: 'FAILED',
          error: `LiveDigital: ${payload.eventName}`,
          technicalReport: {
            event: payload,
            state: details?.state ?? null,
            recordId,
            receivedAt: now.toISOString(),
          },
        },
      })
      return
    }

    // Перенос не должен задерживать ответ вебхуку: LiveDigital ждёт не дольше 10 секунд.
    setImmediate(() => {
      void this.transferRecording(recording.id).catch((error) => {
        console.warn('[livedigital] перенос записи не удался', error)
      })
    })
  }

  /**
   * Срок хранения записи — до окончания курса. После этой даты удаляем файл
   * из хранилища ITadis и запись у LiveDigital; доступ к ней уже закрыт.
   */
  async cleanupExpiredRecordings(): Promise<number> {
    const providerConfigured = isLiveDigitalConfigured()
    const expired = await this.prisma.client.videoRecording.findMany({
      where: {
        status: { not: 'DELETED' },
        room: { schedule: { course: { endDate: { lt: new Date() } } } },
      },
      include: {
        room: { select: { providerRoomId: true } },
      },
      take: 50,
    })

    let deleted = 0
    for (const recording of expired) {
      try {
        if (providerConfigured && recording.room.providerRoomId && recording.providerRecordId) {
          await deleteRecord(recording.room.providerRoomId, recording.providerRecordId)
        }
        if (recording.storageKey) {
          await unlink(resolve(RECORDINGS_DIR, recording.storageKey)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error
          })
        }
        const previousReport =
          recording.technicalReport && typeof recording.technicalReport === 'object' && !Array.isArray(recording.technicalReport)
            ? (recording.technicalReport as Record<string, unknown>)
            : {}
        await this.prisma.client.videoRecording.update({
          where: { id: recording.id },
          data: {
            status: 'DELETED',
            transferStatus: 'DELETED',
            storageKey: null,
            url: null,
            technicalReport: {
              ...previousReport,
              retention: { reason: 'course_ended', deletedAt: new Date().toISOString() },
            },
          },
        })
        deleted += 1
      } catch (error) {
        console.warn('[livedigital] не удалось удалить просроченную запись', recording.id, error)
      }
    }
    return deleted
  }

  /** Удаление комнаты при отмене занятия не обязательно: запись и история сохраняются. */
  async removeProviderRoom(scheduleId: string) {
    const schedule = await this.loadSchedule(scheduleId)
    if (schedule.room?.providerRoomId && isLiveDigitalConfigured()) {
      await deleteRoom(schedule.room.providerRoomId).catch(() => undefined)
    }
  }
}
