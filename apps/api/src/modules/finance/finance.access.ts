import { Inject, Injectable } from '@nestjs/common'
import type { RoleName } from '@prisma/client'
import { forbidden, notFound } from '../../lib/errors.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'

/**
 * Проверки доступа и существования сущностей финансового модуля.
 *
 * Доступ всегда вычисляется по пользователю из access-токена: ученик видит только
 * свой счёт, родитель — только счёт подтверждённого ребёнка.
 */
@Injectable()
export class FinanceAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async assertStudentExists(studentId: string): Promise<void> {
    const student = await this.prisma.client.user.findFirst({
      where: { id: studentId, role: 'STUDENT', deletedAt: null },
      select: { id: true },
    })
    if (!student) throw notFound('Ученик не найден')
  }

  async assertCourseExists(courseId: string): Promise<void> {
    const course = await this.prisma.client.course.findUnique({ where: { id: courseId }, select: { id: true } })
    if (!course) throw notFound('Курс не найден')
  }

  async resolveStudentIds(userId: string, role: RoleName): Promise<string[]> {
    if (role === 'STUDENT') return [userId]
    if (role !== 'PARENT') throw forbidden('Финансовая история доступна ученику или родителю')

    const parent = await this.prisma.client.parent.findUnique({
      where: { userId },
      select: {
        childLinks: {
          where: { verifiedAt: { not: null } },
          select: { student: { select: { userId: true } } },
        },
      },
    })
    return parent?.childLinks.map((link) => link.student.userId) ?? []
  }

  async assertCanView(studentId: string, user: { userId: string; role: RoleName }): Promise<void> {
    if (user.role === 'ADMIN') return
    if (user.role === 'STUDENT') {
      if (studentId !== user.userId) throw forbidden('Счёт принадлежит другому ученику')
      return
    }
    if (user.role === 'PARENT') {
      // ParentStudentLink.studentId — идентификатор профиля Student, а не пользователя,
      // поэтому связь проверяется через student.userId.
      const parent = await this.prisma.client.parent.findUnique({
        where: { userId: user.userId },
        select: {
          childLinks: {
            where: { verifiedAt: { not: null }, student: { userId: studentId } },
            select: { id: true },
          },
        },
      })
      if (!parent?.childLinks.length) throw forbidden('Подтверждение связи с учеником отсутствует')
      return
    }
    throw forbidden('Раздел доступен ученику, родителю или администратору')
  }
}
