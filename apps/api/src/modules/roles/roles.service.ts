import { Inject, Injectable } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import type { RoleName } from '@prisma/client'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { writeAudit } from '../../lib/audit.js'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { STANDARD_ROLES } from '../../lib/roles.js'

/** Пять стандартных ролей. Произвольные роли не создаются. */
export { STANDARD_ROLES }

/** Срок жизни кода привязки ребёнка, часы. */
const PARENT_CODE_TTL_HOURS = 72

@Injectable()
export class RolesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Роли пользователя: основная (User.role) и подтверждённые дополнительные. */
  async getMyRoles(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })
    if (!user) throw notFound('Пользователь не найден')
    const grants = await this.prisma.client.userRoleGrant.findMany({
      where: { userId },
      select: { role: true, status: true, requestedAt: true },
      orderBy: { requestedAt: 'asc' },
    })
    const approved = new Set<RoleName>([user.role, ...grants.filter((g) => g.status === 'APPROVED').map((g) => g.role)])
    return {
      primary: user.role,
      roles: [...approved],
      requests: grants.filter((g) => g.status === 'PENDING'),
    }
  }

  /** Проверка доступа по БД: дополнительные роли не попадают в токен. */
  async hasRole(userId: string, role: RoleName): Promise<boolean> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (user?.role === role) return true
    const grant = await this.prisma.client.userRoleGrant.findFirst({
      where: { userId, role, status: 'APPROVED' },
      select: { id: true },
    })
    return Boolean(grant)
  }

  /** Пользователь просит дополнительную роль; действует только после подтверждения администратором. */
  async requestRole(userId: string, role: RoleName, reason?: string) {
    if (!STANDARD_ROLES.includes(role)) throw badRequest('Такой роли не существует')
    if (await this.hasRole(userId, role)) throw conflict('Роль уже подтверждена')
    const pending = await this.prisma.client.userRoleGrant.findFirst({
      where: { userId, role, status: 'PENDING' },
      select: { id: true },
    })
    if (pending) throw conflict('Запрос на эту роль уже отправлен')

    return this.prisma.client.userRoleGrant.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role, reason: reason ?? null },
      update: { status: 'PENDING', reason: reason ?? null, requestedAt: new Date(), decidedAt: null, approvedById: null },
    })
  }

  /** Очередь запросов для администратора филиала. */
  listPendingRequests() {
    return this.prisma.client.userRoleGrant.findMany({
      where: { status: 'PENDING' },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
      orderBy: { requestedAt: 'asc' },
    })
  }

  /** Решение администратора по запросу роли. */
  async decideRequest(adminId: string, grantId: string, approve: boolean) {
    const grant = await this.prisma.client.userRoleGrant.findUnique({ where: { id: grantId } })
    if (!grant) throw notFound('Запрос не найден')
    if (grant.status !== 'PENDING') throw conflict('Запрос уже рассмотрен')

    const updated = await this.prisma.client.userRoleGrant.update({
      where: { id: grantId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedAt: new Date(),
        approvedById: adminId,
      },
    })
    await writeAudit({
      actorId: adminId,
      action: approve ? 'role.grant.approve' : 'role.grant.reject',
      entity: 'UserRoleGrant',
      entityId: grantId,
      metadata: { userId: grant.userId, role: grant.role },
    })
    return updated
  }

  /** Код привязки ребёнка выдаёт администратор; родитель вводит его сам. */
  async createParentLinkCode(actorId: string, studentId: string) {
    const student = await this.prisma.client.student.findUnique({ where: { id: studentId }, select: { id: true } })
    if (!student) throw notFound('Ученик не найден')

    const code = String(randomInt(100000, 1000000))
    const expiresAt = new Date(Date.now() + PARENT_CODE_TTL_HOURS * 60 * 60 * 1000)
    return this.prisma.client.parentLinkCode.create({
      data: { code, studentId, createdById: actorId, expiresAt },
    })
  }

  /** Родитель вводит код: создаётся связь, которую администратор ещё должен подтвердить. */
  async redeemParentLinkCode(parentUserId: string, code: string) {
    const parent = await this.prisma.client.parent.findUnique({ where: { userId: parentUserId }, select: { id: true } })
    if (!parent) throw forbidden('Привязка доступна только родителю')

    const link = await this.prisma.client.parentLinkCode.findUnique({ where: { code } })
    if (!link || link.usedAt || link.expiresAt < new Date()) throw badRequest('Код недействителен или истёк')

    const existing = await this.prisma.client.parentStudentLink.findUnique({
      where: { parentId_studentId: { parentId: parent.id, studentId: link.studentId } }, 
      select: { id: true },
    })
    if (existing) throw conflict('Этот ребёнок уже привязан')

    await this.prisma.client.parentLinkCode.update({ where: { id: link.id }, data: { usedAt: new Date() } })
    return this.prisma.client.parentStudentLink.create({
      data: { parentId: parent.id, studentId: link.studentId, verifiedAt: null },
    })
  }

  /** Очередь привязок, ожидающих подтверждения администратором. */
  listPendingParentLinks() {
    return this.prisma.client.parentStudentLink.findMany({
      where: { verifiedAt: null },
      include: {
        parent: {
          select: {
            id: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        student: {
          select: {
            id: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  /** Администратор подтверждает привязку родителя к ребёнку. */
  async verifyParentLink(adminId: string, linkId: string) {
    const link = await this.prisma.client.parentStudentLink.findUnique({ where: { id: linkId } })
    if (!link) throw notFound('Связь не найдена')
    if (link.verifiedAt) throw conflict('Связь уже подтверждена')

    const updated = await this.prisma.client.parentStudentLink.update({
      where: { id: linkId },
      data: { verifiedAt: new Date() },
    })
    await writeAudit({
      actorId: adminId,
      action: 'parent.link.verify',
      entity: 'ParentStudentLink',
      entityId: linkId,
    })
    return updated
  }
}
