import type { PrismaClient, RoleName } from '@prisma/client'

/**
 * Базовый каталог RBAC: роли, права и матрица доступа.
 *
 * Это не демонстрационные данные, а часть схемы: `User.role` ссылается на
 * `Role.code`, а проверки прав читают `RolePermission`. Поэтому каталог
 * создаётся и при seed, и при создании первого администратора в production,
 * где демо-данные не заливаются.
 */
export const permissionCatalog = [
  { code: 'courses.manage', description: 'Создание и редактирование курсов' },
  { code: 'homework.review', description: 'Проверка домашних заданий' },
  { code: 'coins.award', description: 'Начисление изикоинов' },
  { code: 'users.manage', description: 'Управление пользователями' },
  { code: 'analytics.view', description: 'Просмотр аналитики' },
  { code: 'audit.view', description: 'Просмотр журнала аудита' },
  { code: 'leads.manage', description: 'Обработка заявок и CRM' },
  { code: 'students.view', description: 'Просмотр списка учеников' },
  { code: 'attendance.manage', description: 'Учёт посещаемости' },
  { code: 'payments.cash', description: 'Регистрация наличных платежей' },
  { code: 'schedule.manage', description: 'Управление расписанием' },
  { code: 'finance.view', description: 'Просмотр финансовой аналитики филиала' },
  { code: 'finance.manage', description: 'Счета, платежи, расходы и тарифы' },
  { code: 'finance.refunds', description: 'Рассмотрение заявок на возврат' },
] as const

/** Каталог ролей: код совпадает с `User.role`, поэтому связь не дублируется. */
export const roleCatalog: Array<{ code: RoleName; name: string; description: string }> = [
  { code: 'ADMIN', name: 'Администратор', description: 'Полный доступ ко всем разделам платформы' },
  { code: 'MANAGER', name: 'Менеджер', description: 'Заявки, ученики, расписание и поддержка клиентов' },
  { code: 'TEACHER', name: 'Преподаватель', description: 'Ведёт курсы, проверяет задания, начисляет изикоины' },
  { code: 'STUDENT', name: 'Ученик', description: 'Учится на курсах и выполняет задания' },
  { code: 'PARENT', name: 'Родитель', description: 'Следит за успеваемостью и оплатой обучения ребёнка' },
]

/** Матрица прав: администратор получает всё, преподаватель — учебный контур. */
export const roleGrants: Record<RoleName, string[]> = {
  ADMIN: permissionCatalog.map((permission) => permission.code),
  MANAGER: [
    'leads.manage',
    'students.view',
    'attendance.manage',
    'payments.cash',
    'schedule.manage',
    'analytics.view',
  ],
  TEACHER: ['courses.manage', 'homework.review', 'coins.award', 'analytics.view'],
  STUDENT: [],
  PARENT: [],
}

export async function bootstrapRbac(prisma: PrismaClient): Promise<void> {
  for (const permission of permissionCatalog) {
    await prisma.permission.upsert({ where: { code: permission.code }, update: {}, create: permission })
  }

  for (const role of roleCatalog) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: { ...role, isSystem: true },
    })
  }

  for (const [roleCode, codes] of Object.entries(roleGrants) as Array<[RoleName, string[]]>) {
    for (const code of codes) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } })
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role: roleCode, permissionId: permission.id } },
        update: {},
        create: { role: roleCode, permissionId: permission.id },
      })
    }
  }
}
