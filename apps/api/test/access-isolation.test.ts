import 'reflect-metadata'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => ({
  resolveBranchByDomain: vi.fn(),
  getPrimaryBranch: vi.fn(),
  normalizeHost: (host: string) => host.trim().toLowerCase().replace(/:\d+$/, ''),
}))

vi.mock('../src/lib/branch-registry.js', () => registry)

import { JwtAuthGuard } from '../src/nest/common/guards/jwt-auth.guard.js'
import { PermissionsGuard } from '../src/nest/common/guards/permissions.guard.js'
import { RolesGuard } from '../src/nest/common/guards/roles.guard.js'
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, ROLES_KEY, type AuthUser } from '../src/nest/common/decorators.js'
import { signAccessToken } from '../src/lib/security.js'
import {
  branchDatabaseUrl,
  branchDirectDatabaseUrl,
  getTenant,
  runWithTenant,
  type TenantContext,
} from '../src/lib/tenant.js'
import { tenantMiddleware } from '../src/lib/tenant.middleware.js'
import { authorizeSocket } from '../src/websocket/realtime-auth.js'

function catchError(action: () => unknown): { status?: number; message?: string; code?: string } {
  try {
    action()
  } catch (error) {
    return error as { status?: number; message?: string; code?: string }
  }
  throw new Error('Ожидалась ошибка, но вызов прошёл')
}

function contextFor(
  requestData: Record<string, unknown>,
  handler: () => void = () => undefined,
  controller: new () => unknown = class Controller {},
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => requestData }),
  } as unknown as ExecutionContext
}

function tenant(branchId: string, isPrimary = false): TenantContext {
  return {
    branchId,
    branchSlug: branchId,
    domain: `${branchId}.itadis.kg`,
    isPrimary,
    prisma: {} as TenantContext['prisma'],
    uploadsDir: '/tmp',
  }
}

function branch(id: string, isPrimary = false) {
  return {
    id,
    slug: id,
    domain: `${id}.itadis.kg`,
    databaseName: `itadis_branch_${id}`,
    isPrimary,
    status: 'ACTIVE' as const,
  }
}

describe('JWT guard: филиал из токена, а не из запроса', () => {
  const guard = new JwtAuthGuard(new Reflector())

  it('без access-токена отвечает 401', () => {
    expect(catchError(() => guard.canActivate(contextFor({ headers: {} }))).status).toBe(401)
  })

  it('публичный маршрут доступен без токена', () => {
    const handler = () => undefined
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler)
    expect(guard.canActivate(contextFor({ headers: {} }, handler))).toBe(true)
  })

  it('токен другого филиала отклоняется', () => {
    const token = signAccessToken({ sub: 'u1', role: 'ADMIN', email: 'a@itadis.kg', branchId: 'branch-a' })
    const error = runWithTenant(tenant('branch-b'), () =>
      catchError(() => guard.canActivate(contextFor({ headers: { authorization: `Bearer ${token}` } }))),
    )
    expect(error.status).toBe(401)
    expect(error.message).toContain('другого филиала')
  })

  it('токен без филиала не работает в дочернем филиале', () => {
    const token = signAccessToken({ sub: 'u1', role: 'STUDENT', email: 's@itadis.kg' })
    const error = runWithTenant(tenant('branch-b'), () =>
      catchError(() => guard.canActivate(contextFor({ headers: { authorization: `Bearer ${token}` } }))),
    )
    expect(error.status).toBe(401)
  })

  it('валидный токен филиала кладёт пользователя в запрос', () => {
    const token = signAccessToken({ sub: 'u1', role: 'ADMIN', email: 'a@itadis.kg', branchId: 'branch-a' })
    const requestData: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } }
    expect(runWithTenant(tenant('branch-a'), () => guard.canActivate(contextFor(requestData, () => undefined, class Controller {})))).toBe(true)
    expect(requestData.user).toMatchObject({ userId: 'u1', role: 'ADMIN' })
  })

  it('переключает активную роль только при подтверждённом гранте', async () => {
    const token = signAccessToken({ sub: 'u1', role: 'STUDENT', email: 's@itadis.kg', branchId: 'branch-a' })
    const requestData: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}`, 'x-active-role': 'MANAGER' },
    }
    const withGrant: TenantContext = {
      ...tenant('branch-a'),
      prisma: { userRoleGrant: { findFirst: vi.fn().mockResolvedValue({ id: 'grant-1' }) } } as unknown as TenantContext['prisma'],
    }
    await expect(
      runWithTenant(withGrant, () => guard.canActivate(contextFor(requestData, () => undefined, class Controller {}))),
    ).resolves.toBe(true)
    expect(requestData.user).toMatchObject({ role: 'MANAGER', primaryRole: 'STUDENT' })
  })

  it('не подменяет роль на неподтверждённую', async () => {
    const token = signAccessToken({ sub: 'u1', role: 'STUDENT', email: 's@itadis.kg', branchId: 'branch-a' })
    const requestData: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}`, 'x-active-role': 'ADMIN' },
    }
    const withoutGrant: TenantContext = {
      ...tenant('branch-a'),
      prisma: { userRoleGrant: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as TenantContext['prisma'],
    }
    await expect(
      runWithTenant(withoutGrant, () => guard.canActivate(contextFor(requestData, () => undefined, class Controller {}))),
    ).resolves.toBe(true)
    expect(requestData.user).toMatchObject({ role: 'STUDENT', primaryRole: 'STUDENT' })
  })
})

describe('RolesGuard: роли и подтверждённые дополнительные права', () => {
  const guard = new RolesGuard(new Reflector())

  function adminHandler() {
    const handler = () => undefined
    Reflect.defineMetadata(ROLES_KEY, ['ADMIN'], handler)
    return handler
  }

  function tenantWithGrants(findFirst: () => Promise<unknown>): TenantContext {
    return {
      ...tenant('branch-a'),
      prisma: { userRoleGrant: { findFirst } } as unknown as TenantContext['prisma'],
    }
  }

  it('разрешает роль из токена', async () => {
    const user: AuthUser = { userId: 'admin', role: 'ADMIN', email: 'a@itadis.kg' }
    await expect(
      runWithTenant(tenant('branch-a'), () => guard.canActivate(contextFor({ user }, adminHandler()))),
    ).resolves.toBe(true)
  })

  it('запрещает ученику админский раздел', async () => {
    const user: AuthUser = { userId: 'student', role: 'STUDENT', email: 's@itadis.kg' }
    await expect(
      runWithTenant(tenantWithGrants(async () => null), () =>
        guard.canActivate(contextFor({ user }, adminHandler())),
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('без пользователя в запросе отвечает 401', async () => {
    await expect(
      runWithTenant(tenantWithGrants(async () => null), () => guard.canActivate(contextFor({}, adminHandler()))),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('учитывает только подтверждённые записи UserRoleGrant', async () => {
    const user: AuthUser = { userId: 'teacher', role: 'TEACHER', email: 't@itadis.kg' }
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'grant-1' })
    const withPrisma = {
      ...tenant('branch-a'),
      prisma: { userRoleGrant: { findFirst } } as unknown as TenantContext['prisma'],
    }

    await expect(
      runWithTenant(withPrisma, () => guard.canActivate(contextFor({ user }, adminHandler()))),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      runWithTenant(withPrisma, () => guard.canActivate(contextFor({ user }, adminHandler()))),
    ).resolves.toBe(true)

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'APPROVED' }) }),
    )
  })
})

describe('PermissionsGuard: тонкие права роли', () => {
  function permissionHandler(permission: string) {
    const handler = () => undefined
    Reflect.defineMetadata(PERMISSIONS_KEY, [permission], handler)
    return handler
  }

  it('разрешает действие при выданном праве', async () => {
    const guard = new PermissionsGuard(new Reflector(), {
      getPermissions: vi.fn(async () => new Set(['users.read'])),
    } as never)
    const user: AuthUser = { userId: 'manager', role: 'MANAGER', email: 'm@itadis.kg' }

    await expect(
      guard.canActivate(contextFor({ user }, permissionHandler('users.read'))),
    ).resolves.toBe(true)
  })

  it('запрещает действие без права и не показывает список лишних прав', async () => {
    const guard = new PermissionsGuard(new Reflector(), {
      getPermissions: vi.fn(async () => new Set<string>()),
    } as never)
    const user: AuthUser = { userId: 'manager', role: 'MANAGER', email: 'm@itadis.kg' }

    await expect(
      guard.canActivate(contextFor({ user }, permissionHandler('users.delete'))),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('без пользователя отвечает 401', async () => {
    const guard = new PermissionsGuard(new Reflector(), {
      getPermissions: vi.fn(async () => new Set(['users.read'])),
    } as never)

    await expect(guard.canActivate(contextFor({}, permissionHandler('users.read')))).rejects.toMatchObject({
      status: 401,
    })
  })
})

describe('HTTP middleware: филиал выбирается только по Host', () => {
  beforeEach(() => {
    registry.resolveBranchByDomain.mockReset()
    registry.getPrimaryBranch.mockReset()
  })

  function app() {
    const instance = express()
    instance.use(tenantMiddleware)
    instance.get('/probe', (_req, res) => {
      res.json({ branchId: getTenant()?.branchId ?? null })
    })
    return instance
  }

  it('чужой токен филиала получает 403', async () => {
    registry.resolveBranchByDomain.mockResolvedValue(branch('branch-b'))
    const token = signAccessToken({ sub: 'u1', role: 'ADMIN', email: 'a@itadis.kg', branchId: 'branch-a' })

    const response = await request(app())
      .get('/probe')
      .set('Host', 'branch-b.itadis.kg')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FOREIGN_BRANCH_TOKEN')
  })

  it('подмена филиала через query, body и заголовки не работает', async () => {
    registry.resolveBranchByDomain.mockResolvedValue(branch('branch-b'))

    const response = await request(app())
      .get('/probe?branchId=branch-a&domain=branch-a.itadis.kg')
      .set('Host', 'branch-b.itadis.kg')
      .set('X-Branch-Id', 'branch-a')
      .set('X-Tenant', 'branch-a')
      .set('X-Forwarded-Host', 'branch-a.itadis.kg')
      .send({ branchId: 'branch-a' })

    expect(response.status).toBe(200)
    expect(response.body.branchId).toBe('branch-b')
    expect(registry.resolveBranchByDomain).toHaveBeenCalledWith('branch-b.itadis.kg')
  })

  it('неизвестный домен без fallback получает 404', async () => {
    registry.resolveBranchByDomain.mockResolvedValue(null)
    registry.getPrimaryBranch.mockResolvedValue(null)

    const response = await request(app()).get('/probe').set('Host', 'unknown.itadis.kg')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('BRANCH_NOT_FOUND')
  })

  it('неактивированный филиал не обслуживается основной БД', async () => {
    registry.resolveBranchByDomain.mockResolvedValue({ ...branch('branch-c'), status: 'PROVISIONING' })

    const response = await request(app()).get('/probe').set('Host', 'branch-c.itadis.kg')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('BRANCH_NOT_ACTIVE')
  })
})

describe('WebSocket: изоляция филиалов при рукопожатии', () => {
  beforeEach(() => {
    registry.resolveBranchByDomain.mockReset()
    registry.getPrimaryBranch.mockReset()
  })

  it('без токена соединение отклоняется', async () => {
    registry.resolveBranchByDomain.mockResolvedValue(branch('branch-a'))
    await expect(authorizeSocket({ host: 'branch-a.itadis.kg' })).rejects.toThrow(/access-токен/)
  })

  it('токен другого филиала не пускает в комнаты', async () => {
    registry.resolveBranchByDomain.mockResolvedValue(branch('branch-b'))
    const token = signAccessToken({ sub: 'u1', role: 'STUDENT', email: 's@itadis.kg', branchId: 'branch-a' })

    await expect(authorizeSocket({ host: 'branch-b.itadis.kg', token })).rejects.toThrow(/другого филиала/)
  })

  it('токен без филиала не работает в дочернем филиале', async () => {
    registry.resolveBranchByDomain.mockResolvedValue(branch('branch-b'))
    const token = signAccessToken({ sub: 'u1', role: 'STUDENT', email: 's@itadis.kg' })

    await expect(authorizeSocket({ host: 'branch-b.itadis.kg', token })).rejects.toThrow(/не привязан/)
  })

  it('валидный токен даёт контекст только своего филиала', async () => {
    registry.resolveBranchByDomain.mockResolvedValue(branch('branch-a'))
    const token = signAccessToken({ sub: 'u1', role: 'STUDENT', email: 's@itadis.kg', branchId: 'branch-a' })

    const identity = await authorizeSocket({ host: 'branch-a.itadis.kg', token })
    expect(identity.tenant.branchId).toBe('branch-a')
    expect(identity.userId).toBe('u1')
    expect(identity.role).toBe('STUDENT')
  })

  it('неизвестный домен не пускает даже с валидным токеном', async () => {
    registry.resolveBranchByDomain.mockResolvedValue(null)
    registry.getPrimaryBranch.mockResolvedValue(null)
    const token = signAccessToken({ sub: 'u1', role: 'STUDENT', email: 's@itadis.kg', branchId: 'branch-a' })

    await expect(authorizeSocket({ host: 'unknown.itadis.kg', token })).rejects.toThrow(/не найден/)
  })
})

describe('подключение к БД филиала', () => {
  it('каждый филиал получает свою базу, схема не подставляется', () => {
    const a = branchDatabaseUrl('itadis_branch_a')
    const b = branchDatabaseUrl('itadis_branch_b')

    expect(a).not.toBe(b)
    expect(new URL(a).pathname).toBe('/itadis_branch_a')
    expect(new URL(b).pathname).toBe('/itadis_branch_b')
    expect(a).not.toContain('schema=')
    expect(new URL(a).searchParams.get('connection_limit')).toBe('10')
    expect(new URL(a).searchParams.get('pool_timeout')).toBe('10')
  })

  it('прямое подключение не содержит параметров Prisma и пулера', () => {
    const direct = branchDirectDatabaseUrl('itadis_branch_a')
    const url = new URL(direct)

    expect(url.pathname).toBe('/itadis_branch_a')
    expect(url.searchParams.get('schema')).toBeNull()
    expect(url.searchParams.get('connection_limit')).toBeNull()
    expect(url.searchParams.get('pool_timeout')).toBeNull()
    expect(url.searchParams.get('pgbouncer')).toBeNull()
  })
})
