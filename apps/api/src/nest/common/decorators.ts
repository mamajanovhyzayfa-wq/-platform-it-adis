import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common'
import type { RoleName } from '@prisma/client'

/** Данные авторизованного пользователя, извлечённые из access-токена. */
export interface AuthUser {
  userId: string
  role: RoleName
  /** Роль из access-токена; `role` может быть подтверждённой дополнительной ролью. */
  primaryRole?: RoleName
  email: string
}

export const IS_PUBLIC_KEY = 'isPublic'
/** Помечает маршрут как доступный без access-токена. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

export const ROLES_KEY = 'roles'
/** Ограничивает маршрут списком ролей: @Roles('ADMIN', 'TEACHER'). */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles)

export const STEP_UP_KEY = 'stepUp'
/** Требует повторного ввода пароля (заголовок X-Step-Up-Token) для важной операции. */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true)

export const PERMISSIONS_KEY = 'permissions'
/** Требует конкретные права: @RequirePermissions('users.read'). */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions)

/** Достаёт пользователя, положенного в запрос JwtAuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const request = context.switchToHttp().getRequest<{ user: AuthUser }>()
  return request.user
})
