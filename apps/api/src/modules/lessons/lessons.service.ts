import { Inject, Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { z } from 'zod'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { awardCoins, COIN_RULES } from '../../lib/coins.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { evaluateAchievements } from '../../modules/achievements/evaluate.js'

export const lessonProgressSchema = z.object({
  positionSeconds: z.number().int().min(0).max(86400),
})

export const lessonCreateSchema = z.object({
  moduleId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  content: z.string().max(50000).optional(),
  videoUrl: z.string().url().max(2048).optional(),
  durationMinutes: z.number().int().min(0).max(600).default(0),
  position: z.number().int().min(0).max(999).optional(),
  published: z.boolean().default(false),
})

export const lessonUpdateSchema = lessonCreateSchema.omit({ moduleId: true }).partial()

export type LessonCreateInput = z.infer<typeof lessonCreateSchema>
export type LessonUpdateInput = z.infer<typeof lessonUpdateSchema>

/**
 * Уроки: содержимое, материалы, прогресс просмотра и завершение.
 *
 * Доступ проверяется здесь, а не на клиенте: ученик открывает только опубликованный
 * урок курса, на который записан; преподаватель — только уроки своих курсов.
 */
@Injectable()
export class LessonsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async detail(lessonId: string, userId: string, role: RoleName) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            course: { select: { id: true, title: true, teacherId: true } },
          },
        },
        materials: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!lesson) throw notFound('Урок не найден')
    await this.assertAccess(lesson.id, lesson.publishedAt, lesson.module.course, userId, role)

    const [progress, siblings, totalLessons, completedLessons] = await Promise.all([
      this.prisma.client.lessonProgress.findUnique({
        where: { lessonId_studentId: { lessonId: lesson.id, studentId: userId } },
      }),
      this.prisma.client.lesson.findMany({
        where: {
          module: { courseId: lesson.module.course.id },
          ...(role === 'STUDENT' ? { publishedAt: { not: null } } : {}),
        },
        orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
        select: { id: true, title: true, moduleId: true },
      }),
      this.prisma.client.lesson.count({
        where: { module: { courseId: lesson.module.course.id }, publishedAt: { not: null } },
      }),
      this.prisma.client.lessonProgress.count({
        where: {
          studentId: userId,
          status: 'COMPLETED',
          lesson: { module: { courseId: lesson.module.course.id } },
        },
      }),
    ])

    const index = siblings.findIndex((item) => item.id === lesson.id)
    const prevLesson = index > 0 ? siblings[index - 1] : undefined
    const nextLesson = index >= 0 ? siblings[index + 1] : undefined

    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      content: lesson.content,
      videoUrl: lesson.videoUrl,
      durationMinutes: lesson.durationMinutes,
      publishedAt: lesson.publishedAt,
      materials: lesson.materials.map((material) => ({
        id: material.id,
        type: material.type,
        title: material.title,
        url: material.url,
        mimeType: material.mimeType,
        sizeBytes: material.sizeBytes,
        allowDownload: material.allowDownload,
      })),
      course: {
        id: lesson.module.course.id,
        title: lesson.module.course.title,
        progress: totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100),
        lessonsCount: totalLessons,
        completedLessons,
      },
      module: { id: lesson.module.id, title: lesson.module.title },
      progress: progress
        ? {
            status: progress.status,
            lastPositionSeconds: progress.lastPositionSeconds,
            watchedSeconds: progress.watchedSeconds,
            completedAt: progress.completedAt,
          }
        : null,
      prevLesson: prevLesson ? { id: prevLesson.id, title: prevLesson.title } : null,
      nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
    }
  }

  /** Сохранение позиции плеера. Завершённый урок не переводится обратно в «в процессе». */
  async saveProgress(lessonId: string, userId: string, role: RoleName, positionSeconds: number) {
    if (role !== 'STUDENT') throw forbidden('Прогресс сохраняют только ученики')

    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: { select: { id: true, title: true, teacherId: true } } } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.assertAccess(lesson.id, lesson.publishedAt, lesson.module.course, userId, role)

    const existing = await this.prisma.client.lessonProgress.findUnique({
      where: { lessonId_studentId: { lessonId, studentId: userId } },
    })
    if (existing?.status === 'COMPLETED') {
      return { status: existing.status, lastPositionSeconds: existing.lastPositionSeconds }
    }

    const saved = await this.prisma.client.lessonProgress.upsert({
      where: { lessonId_studentId: { lessonId, studentId: userId } },
      create: {
        lessonId,
        studentId: userId,
        status: 'IN_PROGRESS',
        watchedSeconds: positionSeconds,
        lastPositionSeconds: positionSeconds,
      },
      update: {
        status: 'IN_PROGRESS',
        lastPositionSeconds: positionSeconds,
        watchedSeconds: positionSeconds,
      },
      select: { status: true, lastPositionSeconds: true },
    })

    return saved
  }

  /** Завершение урока: пересчёт прогресса курса и проверка достижений. */
  async complete(lessonId: string, userId: string, role: RoleName) {
    if (role !== 'STUDENT') throw forbidden('Завершать уроки могут только ученики')

    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: { select: { id: true, title: true, teacherId: true } } } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    await this.assertAccess(lesson.id, lesson.publishedAt, lesson.module.course, userId, role)

    await this.prisma.client.lessonProgress.upsert({
      where: { lessonId_studentId: { lessonId, studentId: userId } },
      create: { lessonId, studentId: userId, status: 'COMPLETED', completedAt: new Date() },
      update: { status: 'COMPLETED', completedAt: new Date() },
    })

    const courseId = lesson.module.course.id
    const [totalLessons, completedLessons] = await Promise.all([
      this.prisma.client.lesson.count({ where: { module: { courseId }, publishedAt: { not: null } } }),
      this.prisma.client.lessonProgress.count({
        where: {
          studentId: userId,
          status: 'COMPLETED',
          lesson: { module: { courseId }, publishedAt: { not: null } },
        },
      }),
    ])
    const progress = totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100)
    const enrollment = await this.prisma.client.courseEnrollment.findUnique({
      where: { courseId_studentId: { courseId, studentId: userId } },
      select: { status: true },
    })
    const courseCompleted = progress === 100 && enrollment?.status !== 'COMPLETED'

    await this.prisma.client.$transaction(async (tx) => {
      await tx.courseEnrollment.updateMany({
        where: { courseId, studentId: userId },
        data: { progress, ...(progress === 100 ? { status: 'COMPLETED' as const } : {}) },
      })
      // Награда за завершение курса начисляется один раз на курс.
      if (courseCompleted) {
        await awardCoins(tx, {
          userId,
          amount: COIN_RULES.courseCompleted,
          reason: `Завершение курса: ${lesson.module.course.title}`,
          sourceType: 'COURSE',
          sourceId: courseId,
        })
      }
    })

    const awarded = await evaluateAchievements(userId).catch((error) => {
      console.warn('[achievements]', error)
      return []
    })

    return { progress, totalLessons, completedLessons, lessonCompleted: true, awarded }
  }

  /** Создание урока преподавателем своего курса или администратором. */
  async create(input: LessonCreateInput, userId: string, role: RoleName) {
    const module = await this.prisma.client.module.findUnique({
      where: { id: input.moduleId },
      include: { course: { select: { teacherId: true } } },
    })
    if (!module) throw notFound('Модуль не найден')
    if (role === 'TEACHER' && module.course.teacherId !== userId) {
      throw forbidden('Модуль принадлежит другому курсу')
    }

    const position =
      input.position ??
      ((await this.prisma.client.lesson.aggregate({ where: { moduleId: module.id }, _max: { position: true } }))._max
        .position ?? -1) + 1

    const created = await this.prisma.client.lesson.create({
      data: {
        moduleId: module.id,
        title: input.title,
        description: input.description,
        content: input.content,
        videoUrl: input.videoUrl,
        durationMinutes: input.durationMinutes,
        position,
        publishedAt: input.published ? new Date() : null,
      },
    })
    await writeAudit({
      actorId: userId,
      action: 'lesson.created',
      entity: 'lesson',
      entityId: created.id,
      metadata: {
        moduleId: module.id,
        title: created.title,
        published: Boolean(created.publishedAt),
      },
    })
    return created
  }

  /** Изменение урока и управление публикацией. */
  async update(lessonId: string, input: LessonUpdateInput, userId: string, role: RoleName) {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: { select: { teacherId: true } } } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    if (role === 'TEACHER' && lesson.module.course.teacherId !== userId) {
      throw forbidden('Урок принадлежит другому курсу')
    }

    const { published, ...fields } = input
    const updated = await this.prisma.client.lesson.update({
      where: { id: lesson.id },
      data: {
        ...fields,
        publishedAt: published === undefined ? undefined : published ? lesson.publishedAt ?? new Date() : null,
      },
    })
    await writeAudit({
      actorId: userId,
      action: 'lesson.updated',
      entity: 'lesson',
      entityId: updated.id,
      metadata: {
        moduleId: lesson.moduleId,
        before: { title: lesson.title, published: Boolean(lesson.publishedAt) },
        after: { title: updated.title, published: Boolean(updated.publishedAt) },
        changedFields: Object.keys(fields),
      },
    })
    return updated
  }

  /** Удаление возможно только для черновика: опубликованный урок сначала снимается с публикации. */
  async remove(lessonId: string, userId: string, role: RoleName): Promise<void> {
    const lesson = await this.prisma.client.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: { select: { teacherId: true } } } } },
    })
    if (!lesson) throw notFound('Урок не найден')
    if (role === 'TEACHER' && lesson.module.course.teacherId !== userId) {
      throw forbidden('Урок принадлежит другому курсу')
    }
    if (lesson.publishedAt) throw badRequest('Опубликованный урок нельзя удалить, сначала снимите с публикации')

    await this.prisma.client.lesson.delete({ where: { id: lesson.id } })
    await writeAudit({
      actorId: userId,
      action: 'lesson.deleted',
      entity: 'lesson',
      entityId: lessonId,
      metadata: { moduleId: lesson.moduleId, title: lesson.title },
    })
  }

  private async assertAccess(
    lessonId: string,
    publishedAt: Date | null,
    course: { id: string; teacherId: string },
    userId: string,
    role: RoleName,
  ): Promise<void> {
    if (role === 'STUDENT') {
      if (!publishedAt) throw notFound('Урок не найден')
      const enrollment = await this.prisma.client.courseEnrollment.findUnique({
        where: { courseId_studentId: { courseId: course.id, studentId: userId } },
        select: { id: true },
      })
      if (!enrollment) throw notFound('Урок не найден')
    }

    if (role === 'TEACHER' && course.teacherId !== userId) {
      throw forbidden('Урок принадлежит другому курсу')
    }

    if (role !== 'STUDENT' && role !== 'TEACHER' && role !== 'ADMIN') {
      throw forbidden('Раздел недоступен для этой роли')
    }

    void lessonId
  }
}
