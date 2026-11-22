import type { NextFunction, Request, Response } from 'express'
import type { RoleName } from '@prisma/client'
import { forbidden, unauthorized } from '../lib/errors.js'
import { verifyAccessToken } from '../lib/security.js'
import { ACTIVE_ROLE_HEADER, readActiveRoleHeader } from '../lib/roles.js'
import { resolveActiveRole } from '../lib/active-role.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; role: RoleName; primaryRole: RoleName; email: string }
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('Не передан access-токен'))
    return
  }

  try {
    const payload = verifyAccessToken(header.slice(7))
    // Токен консоли платформы не является токеном пользователя филиала.
    if (!payload.role || typeof payload.sub !== 'string') {
      next(unauthorized('Требуется токен пользователя филиала'))
      return
    }
    const activeRole = await resolveActiveRole(
      payload.sub,
      payload.role,
      readActiveRoleHeader(req.headers[ACTIVE_ROLE_HEADER]),
    )
    req.auth = { userId: payload.sub, role: activeRole, primaryRole: payload.role, email: payload.email }
    next()
  } catch {
    next(unauthorized('Access-токен истёк или недействителен'))
  }
}

export function requireRole(...roles: RoleName[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(unauthorized())
      return
    }
    if (!roles.includes(req.auth.role)) {
      next(forbidden('Роль не имеет доступа к этому разделу'))
      return
    }
    next()
  }
}
