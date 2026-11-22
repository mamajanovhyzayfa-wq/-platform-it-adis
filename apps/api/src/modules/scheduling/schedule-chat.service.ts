import { Inject, Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'

/** Чат занятия: доступен тем же участникам, что и видеокомната. */
@Injectable()
export class ScheduleChatService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async access(scheduleId: string, userId: string, role: RoleName) {
    const schedule = await this.prisma.client.schedule.findUnique({
      where: { id: scheduleId },
      select: {
        id: true,
        teacherId: true,
        courseId: true,
        course: { select: { teacherId: true } },
      },
    })
    if (!schedule) throw notFound('Занятие не найдено')
    if (role === 'ADMIN' || role === 'MANAGER') return schedule
    if (role === 'TEACHER' && (schedule.teacherId === userId || schedule.course.teacherId === userId)) return schedule
    if (role === 'STUDENT') {
      const enrolled = await this.prisma.client.courseEnrollment.findUnique({
        where: { courseId_studentId: { courseId: schedule.courseId, studentId: userId } },
        select: { id: true },
      })
      if (enrolled) return schedule
      const extra = await this.prisma.client.extraSessionEnrollment.findUnique({
        where: { scheduleId_userId: { scheduleId, userId } },
        select: { status: true },
      })
      if (extra?.status === 'REGISTERED') return schedule
    }
    throw forbidden('Чат доступен участникам занятия')
  }

  async list(scheduleId: string, userId: string, role: RoleName, after?: string) {
    await this.access(scheduleId, userId, role)
    const items = await this.prisma.client.scheduleMessage.findMany({
      where: {
        scheduleId,
        ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
    })
    return {
      items: items.map((item) => ({
        id: item.id,
        body: item.body,
        createdAt: item.createdAt,
        user: {
          id: item.user.id,
          name: `${item.user.firstName} ${item.user.lastName}`.trim(),
          role: item.user.role,
        },
      })),
    }
  }

  async send(scheduleId: string, userId: string, role: RoleName, body: string) {
    await this.access(scheduleId, userId, role)
    const text = body.trim()
    if (!text) throw badRequest('Сообщение не может быть пустым')
    if (text.length > 2000) throw badRequest('Сообщение длиннее 2000 символов')
    return this.prisma.client.scheduleMessage.create({
      data: { scheduleId, userId, body: text },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
    })
  }
}
