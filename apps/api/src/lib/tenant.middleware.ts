import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import type { RoleName } from '@prisma/client'
import { verifyAccessToken, verifyFileToken } from './security.js'
import { canReadAttachment, findAttachmentOwner } from './attachment-access.js'
import { writeFileAudit } from './file-audit.js'
import { getPrimaryBranch, normalizeHost, resolveBranchByDomain } from './branch-registry.js'
import { defaultPrisma } from './prisma.js'
import { getBranchPrisma, getTenant, runWithTenant, tenantUploadsDir } from './tenant.js'

/** Служебные маршруты, которым филиал не нужен. */
function isTenantFree(path: string): boolean {
  return path === '/healthz' || path.startsWith('/docs') || path.startsWith('/api/platform')
}

/**
 * Филиал определяется только по Host. Заголовок проверяется на каждом запросе,
 * параметры URL/тела в выборе БД не участвуют.
 */
export const tenantMiddleware: RequestHandler = (req, res, next) => {
  if (isTenantFree(req.path)) {
    next()
    return
  }

  void (async () => {
    const host = normalizeHost(req.hostname)
    let branch = await resolveBranchByDomain(host)
    let isPrimary = false
    let client = defaultPrisma

    // Домен занят филиалом, но он ещё не активирован: основная БД не подставляется.
    if (branch && branch.status !== 'ACTIVE') {
      res.status(404).json({
        error: { code: 'BRANCH_NOT_ACTIVE', message: 'Филиал ещё не активирован' },
      })
      return
    }

    if (!branch && env.ALLOW_PRIMARY_FALLBACK) {
      branch = await getPrimaryBranch()
    }
    isPrimary = branch?.isPrimary ?? false

    if (!branch) {
      res.status(404).json({
        error: { code: 'BRANCH_NOT_FOUND', message: 'Филиал для этого домена не найден или не активирован' },
      })
      return
    }

    if (!isPrimary) {
      client = getBranchPrisma(branch.id, branch.databaseName)
    }

    const context = {
      branchId: branch.id,
      branchSlug: branch.slug,
      domain: branch.domain,
      isPrimary,
      prisma: client,
      uploadsDir: tenantUploadsDir(branch.slug, isPrimary),
    }

    runWithTenant(context, () => {
      // Токен, выданный в другом филиале, не должен работать на этом домене.
      const header = req.headers.authorization
      if (typeof header === 'string' && header.startsWith('Bearer ')) {
        try {
          const payload = verifyAccessToken(header.slice(7))
          if (payload.role) {
            if (payload.branchId && payload.branchId !== context.branchId) {
              res.status(403).json({
                error: { code: 'FOREIGN_BRANCH_TOKEN', message: 'Токен выдан для другого филиала' },
              })
              return
            }
            if (!payload.branchId && !isPrimary) {
              res.status(403).json({
                error: { code: 'TOKEN_WITHOUT_BRANCH', message: 'Токен не привязан к филиалу, войдите заново' },
              })
              return
            }
          }
        } catch {
          // Недействительный токен отклонит guard конкретного маршрута.
        }
      }
      next()
    })
  })().catch(next)
}

/** Статика вложений из каталога текущего филиала. */
export const tenantUploadsStatic: RequestHandler = (req, res, next) => {
  const dir = getTenant()?.uploadsDir
  if (!dir) {
    next()
    return
  }
  let name: string
  try {
    name = basename(decodeURIComponent(req.path))
  } catch {
    res.status(400).end()
    return
  }
  const file = resolve(dir, name)
  if (!name || name.startsWith('.') || !existsSync(file)) {
    res.status(404).end()
    return
  }
  void (async () => {
    // Владелец файла берётся из Bearer-токена либо из подписанной ссылки ?t=,
    // где он зашит в sub и которую нельзя выпустить на чужой файл.
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
    let userId: string | null = null
    let role: RoleName | null = null
    if (bearer) {
      try {
        const payload = verifyAccessToken(bearer)
        userId = payload.sub
        role = payload.role
      } catch {
        // Недействительный токен не даёт доступа.
      }
    }

    const queryToken = typeof req.query.t === 'string' ? req.query.t : ''
    const fileToken = queryToken ? verifyFileToken(queryToken, name) : null
    if (!userId && !fileToken) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Требуется авторизация для просмотра файла' })
      return
    }

    const ownerId = await findAttachmentOwner(name)
    let authorized = canReadAttachment({ ownerId, userId, role })
    // Ссылка выпущена владельцу файла и подтверждает его. Если запрос пришёл
    // с Bearer другого пользователя, чужой ссылкой воспользоваться нельзя.
    if (!authorized && fileToken) {
      authorized = canReadAttachment({ ownerId, userId: fileToken.sub, role: null })
      if (authorized && userId && userId !== fileToken.sub) authorized = false
    }
    if (!authorized) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Файл принадлежит другому пользователю' })
      return
    }

    // Вложения чата и решений не должны исполняться как HTML/SVG в браузере.
    // Приватные документы (библиотека, сертификаты) идут только через API с ACL.
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox")
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
    res.setHeader('Cache-Control', 'private, no-store')
    if (!/\.(jpe?g|png|webp|gif|heic|mp4|webm|mov|mkv|mp3|m4a|wav|ogg|pdf|txt|md|docx?|xlsx?|pptx?|zip)$/i.test(name)) {
      res.setHeader('Content-Disposition', 'attachment')
    }

    res.sendFile(file, (error) => {
      if (!error) {
        void writeFileAudit({
          userId: userId ?? fileToken?.sub,
          action: 'DOWNLOAD',
          fileName: name,
          url: req.path,
          ip: req.ip,
          userAgent: req.get('user-agent') ?? null,
        })
      }
      if (error) next(error)
    })
  })().catch(next)
}
