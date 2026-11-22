import type { RoleName } from '@prisma/client'
import { getTenant } from './tenant.js'
import { isStandardRole } from './roles.js'

/**
 * Разрешает интерфейс роли для запроса.
 *
 * Основная роль берётся из access-токена. Другая роль допускается только при
 * наличии подтверждённой записи UserRoleGrant в БД текущего филиала. Поэтому
 * подмена заголовка X-Active-Role не даёт новых прав.
 */
export async function resolveActiveRole(
  userId: string,
  primaryRole: RoleName,
  requestedRole: unknown,
): Promise<RoleName> {
  if (typeof requestedRole !== 'string' || requestedRole === primaryRole) return primaryRole
  if (!isStandardRole(requestedRole)) return primaryRole

  const tenant = getTenant()
  if (!tenant) return primaryRole

  const grant = await tenant.prisma.userRoleGrant.findFirst({
    where: { userId, role: requestedRole, status: 'APPROVED' },
    select: { id: true },
  })
  return grant ? requestedRole : primaryRole
}
