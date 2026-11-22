import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import {
  FileCategory,
  FileStorageAccess,
  Prisma,
  type RoleName,
  type StorageFile,
} from '@prisma/client'
import { badRequest, conflict, forbidden, notFound, payloadTooLarge } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'
import { getTenant } from '../../lib/tenant.js'
import { controlPrisma } from '../../lib/control-prisma.js'
import { prisma } from '../../lib/prisma.js'
import { scanFile } from '../../lib/file-scan.js'
import { writeFileAudit } from '../../lib/file-audit.js'
import { deleteObject, makeStorageKey, openObject, saveObject, storageDriver } from '../../lib/file-storage.js'

/**
 * Файловая библиотека филиала.
 *
 * Метаданные лежат в БД филиала, объекты — в S3 (или локальном STORAGE_DIR).
 * Ключ объекта всегда начинается с branches/{slug}/, а доступ проверяется по
 * роли и владельцу до выдачи байтов. Статический /uploads для библиотеки не
 * используется: иначе ACL можно было бы обойти прямой ссылкой.
 */

const MIME_TO_EXTENSION = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/heic', '.heic'],
  ['image/tiff', '.tiff'],
  ['image/bmp', '.bmp'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/aac', '.aac'],
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
  ['audio/ogg', '.ogg'],
  ['audio/flac', '.flac'],
  ['audio/webm', '.weba'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['video/x-matroska', '.mkv'],
  ['video/x-msvideo', '.avi'],
  ['video/mpeg', '.mpeg'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/markdown', '.md'],
  ['text/csv', '.csv'],
  ['application/rtf', '.rtf'],
  ['application/json', '.json'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['application/vnd.oasis.opendocument.text', '.odt'],
  ['application/vnd.oasis.opendocument.spreadsheet', '.ods'],
  ['application/vnd.oasis.opendocument.presentation', '.odp'],
  ['application/zip', '.zip'],
  ['application/x-zip-compressed', '.zip'],
  ['application/x-rar-compressed', '.rar'],
  ['application/vnd.rar', '.rar'],
  ['application/x-7z-compressed', '.7z'],
  ['application/gzip', '.gz'],
  ['application/x-tar', '.tar'],
])

const CATEGORY_BY_MIME = (mime: string): FileCategory => {
  if (mime.startsWith('image/')) return FileCategory.IMAGE
  if (mime.startsWith('audio/')) return FileCategory.AUDIO
  if (mime.startsWith('video/')) return FileCategory.VIDEO
  if (mime === 'application/pdf') return FileCategory.PDF
  if (
    mime.includes('presentation') ||
    mime.includes('powerpoint') ||
    mime === 'application/vnd.oasis.opendocument.presentation'
  ) {
    return FileCategory.PRESENTATION
  }
  if (
    ['application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/vnd.rar', 'application/x-7z-compressed', 'application/gzip', 'application/x-tar'].includes(mime)
  ) {
    return FileCategory.ARCHIVE
  }
  if (
    mime.startsWith('text/') ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime === 'application/rtf' ||
    mime === 'application/json' ||
    mime === 'application/vnd.oasis.opendocument.text'
  ) {
    return FileCategory.DOCUMENT
  }
  return FileCategory.OTHER
}

const uploadTempDir = join(tmpdir(), 'itadis-file-library')
if (!existsSync(uploadTempDir)) mkdirSync(uploadTempDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadTempDir,
    filename: (_req, file, callback) => {
      const extension = MIME_TO_EXTENSION.get(file.mimetype) ?? extname(file.originalname).toLowerCase() ?? '.bin'
      callback(null, `${randomUUID()}${extension}`)
    },
  }),
  // Абсолютный защитный потолок; реальный лимит филиала проверяется после
  // получения файла, потому что Host определяет филиал до маршрута.
  limits: { fileSize: 512 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!MIME_TO_EXTENSION.has(file.mimetype)) {
      callback(badRequest(`Тип файла не поддерживается: ${file.mimetype}`))
      return
    }
    callback(null, true)
  },
})

function tenantOrThrow() {
  const tenant = getTenant()
  if (!tenant) throw notFound('Филиал не определён')
  return tenant
}

function isStaff(role: RoleName): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'TEACHER'
}

function canView(file: Pick<StorageFile, 'ownerId' | 'access'>, role: RoleName, userId: string): boolean {
  if (role === 'ADMIN' || file.ownerId === userId) return true
  if (file.access === FileStorageAccess.PRIVATE) return false
  if (file.access === FileStorageAccess.STAFF) return isStaff(role)
  return true
}

function visibleWhere(role: RoleName, userId: string): Prisma.StorageFileWhereInput {
  if (role === 'ADMIN') return { deletedAt: null }
  if (isStaff(role)) {
    return {
      deletedAt: null,
      OR: [
        { access: FileStorageAccess.BRANCH },
        { access: FileStorageAccess.STAFF },
        { ownerId: userId },
      ],
    }
  }
  return {
    deletedAt: null,
    OR: [{ access: FileStorageAccess.BRANCH }, { ownerId: userId }],
  }
}

function serialize(file: StorageFile & { owner?: { id: string; firstName: string; lastName: string } | null }) {
  return {
    id: file.id,
    title: file.title,
    originalName: file.originalName,
    category: file.category,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    scanStatus: file.scanStatus,
    access: file.access,
    description: file.description,
    tags: file.tags,
    downloadCount: file.downloadCount,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    owner: file.owner
      ? { id: file.owner.id, name: `${file.owner.firstName} ${file.owner.lastName}`.trim() }
      : null,
  }
}

const uploadMetaSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).optional(),
  access: z.nativeEnum(FileStorageAccess).optional(),
  tags: z.string().max(500).optional(),
})

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  category: z.nativeEnum(FileCategory).optional(),
  access: z.nativeEnum(FileStorageAccess).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
})

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.nativeEnum(FileCategory).optional(),
  access: z.nativeEnum(FileStorageAccess).optional(),
  tag: z.string().trim().max(40).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'size']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
})

function parseTags(value: string | undefined): string[] {
  if (!value) return []
  return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20)
}

export const filesRouter = Router()

filesRouter.get('/categories', requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth!
    const grouped = await prisma.storageFile.groupBy({
      by: ['category'],
      where: visibleWhere(auth.role, auth.userId),
      _count: { _all: true },
      _sum: { sizeBytes: true },
    })
    res.json({
      categories: Object.values(FileCategory).map((category) => {
        const row = grouped.find((item) => item.category === category)
        return { category, count: row?._count._all ?? 0, sizeBytes: row?._sum.sizeBytes ?? 0 }
      }),
    })
  } catch (error) {
    next(error)
  }
})

filesRouter.get('/storage', requireAuth, async (req, res, next) => {
  try {
    const tenant = tenantOrThrow()
    const branch = await controlPrisma.branch.findUnique({ where: { id: tenant.branchId } })
    if (!branch) throw notFound('Филиал не найден')
    const aggregate = await prisma.storageFile.aggregate({
      where: visibleWhere(req.auth!.role, req.auth!.userId),
      _sum: { sizeBytes: true },
      _count: { _all: true },
    })
    res.json({
      driver: storageDriver(),
      prefix: `branches/${tenant.branchSlug}/library`,
      maxFileSizeMb: branch.fileMaxSizeMb,
      quotaMb: branch.fileQuotaMb,
      usedBytes: aggregate._sum.sizeBytes ?? 0,
      files: aggregate._count._all,
    })
  } catch (error) {
    next(error)
  }
})

filesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth!
    const query = listSchema.parse(req.query)
    const filters: Prisma.StorageFileWhereInput[] = [visibleWhere(auth.role, auth.userId)]
    if (query.search) {
      filters.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { originalName: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { tags: { has: query.search } },
        ],
      })
    }
    if (query.category) filters.push({ category: query.category })
    if (query.access) filters.push({ access: query.access })
    if (query.tag) filters.push({ tags: { has: query.tag } })
    const where: Prisma.StorageFileWhereInput = { AND: filters }
    const orderBy: Prisma.StorageFileOrderByWithRelationInput =
      query.sort === 'oldest'
        ? { createdAt: 'asc' }
        : query.sort === 'name'
          ? { title: 'asc' }
          : query.sort === 'size'
            ? { sizeBytes: 'desc' }
            : { createdAt: 'desc' }
    const [total, rows] = await Promise.all([
      prisma.storageFile.count({ where }),
      prisma.storageFile.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { owner: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ])
    res.json({
      items: rows.map(serialize),
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    })
  } catch (error) {
    next(error)
  }
})

filesRouter.post('/', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (uploadError: unknown) => {
    if (uploadError instanceof multer.MulterError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        next(payloadTooLarge('Файл превышает допустимый размер'))
        return
      }
      next(badRequest(`Не удалось принять файл: ${uploadError.code}`))
      return
    }
    if (uploadError) {
      next(uploadError)
      return
    }
    if (!req.file) {
      next(badRequest('Файл не передан: ожидается поле file'))
      return
    }

    void (async () => {
      const file = req.file!
      try {
      const auth = req.auth!
      const tenant = tenantOrThrow()
      const meta = uploadMetaSchema.parse(req.body)
      const branch = await controlPrisma.branch.findUnique({ where: { id: tenant.branchId } })
      if (!branch) throw notFound('Филиал не найден')

      const maxBytes = branch.fileMaxSizeMb * 1024 * 1024
      if (file.size > maxBytes) {
        throw payloadTooLarge(`Файл больше лимита филиала (${branch.fileMaxSizeMb} МБ)`)
      }

      const used = await prisma.storageFile.aggregate({
        where: { deletedAt: null },
        _sum: { sizeBytes: true },
      })
      const quotaBytes = branch.fileQuotaMb * 1024 * 1024
      if ((used._sum.sizeBytes ?? 0) + file.size > quotaBytes) {
        throw conflict(`Квота файлового хранилища филиала исчерпана (${branch.fileQuotaMb} МБ)`)
      }

      const scan = await scanFile(file.path, file.mimetype)
      if (!scan.clean) {
        try {
          unlinkSync(file.path)
        } catch {
          // уже удалён сканером
        }
        await writeFileAudit({
          userId: auth.userId,
          action: 'UPLOAD',
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          sha256: scan.sha256,
          scanStatus: scan.status,
          ip: req.ip,
          userAgent: req.get('user-agent') ?? null,
        })
        throw badRequest(`Файл отклонён проверкой безопасности: ${scan.reason ?? 'подозрительное содержимое'}`)
      }

      const requestedAccess = meta.access ?? FileStorageAccess.BRANCH
      if (requestedAccess === FileStorageAccess.STAFF && !isStaff(auth.role)) {
        throw forbidden('Устанавливать доступ «только сотрудники» может сотрудник')
      }
      const extension = MIME_TO_EXTENSION.get(file.mimetype) ?? extname(file.originalname).toLowerCase() ?? '.bin'
      const storageKey = makeStorageKey(tenant.branchSlug, extension)
      await saveObject(storageKey, file.path, file.mimetype)
      try {
        unlinkSync(file.path)
      } catch {
        // временный файл мог быть уже удалён
      }

      let created: StorageFile
      try {
        created = await prisma.storageFile.create({
          data: {
            ownerId: auth.userId,
            category: CATEGORY_BY_MIME(file.mimetype),
            title: meta.title ?? file.originalname.slice(0, 200),
            originalName: file.originalname.slice(0, 255),
            storageKey,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            sha256: scan.sha256,
            scanStatus: scan.status,
            access: requestedAccess,
            description: meta.description,
            tags: parseTags(meta.tags),
          },
        })
      } catch (error) {
        await deleteObject(storageKey).catch(() => undefined)
        throw error
      }

      await writeFileAudit({
        userId: auth.userId,
        fileId: created.id,
        action: 'UPLOAD',
        fileName: created.originalName,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
        sha256: created.sha256,
        scanStatus: created.scanStatus,
        ip: req.ip,
        userAgent: req.get('user-agent') ?? null,
      })

      const owner = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, firstName: true, lastName: true },
      })
      res.status(201).json(serialize({ ...created, owner }))
      } finally {
        // Временный файл удаляется при любом исходе: успех, отказ сканера,
        // превышение квоты или ошибка записи в объектное хранилище.
        try {
          unlinkSync(file.path)
        } catch {
          // уже удалён
        }
      }
    })().catch(next)
  })
})

filesRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth!
    const file = await prisma.storageFile.findFirst({
      where: { id: String(req.params.id), deletedAt: null },
      include: { owner: { select: { id: true, firstName: true, lastName: true } } },
    })
    if (!file) throw notFound('Файл не найден')
    if (!canView(file, auth.role, auth.userId)) throw forbidden()
    res.json(serialize(file))
  } catch (error) {
    next(error)
  }
})

filesRouter.get('/:id/history', requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth!
    const file = await prisma.storageFile.findFirst({ where: { id: String(req.params.id) }, include: { owner: true } })
    if (!file) throw notFound('Файл не найден')
    if (auth.role !== 'ADMIN' && file.ownerId !== auth.userId) throw forbidden('История доступна владельцу или администратору')
    const logs = await prisma.fileAuditLog.findMany({
      where: { fileId: file.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        action: true,
        fileName: true,
        sizeBytes: true,
        scanStatus: true,
        ip: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    res.json({ items: logs })
  } catch (error) {
    next(error)
  }
})

filesRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth!
    const input = updateSchema.parse(req.body)
    const existing = await prisma.storageFile.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
    if (!existing) throw notFound('Файл не найден')
    if (auth.role !== 'ADMIN' && existing.ownerId !== auth.userId) throw forbidden('Изменять файл может владелец или администратор')
    if (input.access === FileStorageAccess.STAFF && !isStaff(auth.role)) {
      throw forbidden('Устанавливать доступ «только сотрудники» может сотрудник')
    }
    const updated = await prisma.storageFile.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        description: input.description,
        category: input.category,
        access: input.access,
        tags: input.tags,
      },
      include: { owner: { select: { id: true, firstName: true, lastName: true } } },
    })
    await writeFileAudit({
      userId: auth.userId,
      fileId: updated.id,
      action: 'UPDATE',
      fileName: updated.originalName,
      mimeType: updated.mimeType,
      sizeBytes: updated.sizeBytes,
      sha256: updated.sha256,
      scanStatus: updated.scanStatus,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    })
    res.json(serialize(updated))
  } catch (error) {
    next(error)
  }
})

filesRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth!
    const existing = await prisma.storageFile.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
    if (!existing) throw notFound('Файл не найден')
    if (auth.role !== 'ADMIN' && existing.ownerId !== auth.userId) throw forbidden('Удалять файл может владелец или администратор')
    // Мягкое удаление сохраняет историю и позволяет администратору восстановить
    // запись. Объект не удаляется мгновенно: на него может ссылаться аудит.
    await prisma.storageFile.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
    await writeFileAudit({
      userId: auth.userId,
      fileId: existing.id,
      action: 'DELETE',
      fileName: existing.originalName,
      mimeType: existing.mimeType,
      sizeBytes: existing.sizeBytes,
      sha256: existing.sha256,
      scanStatus: existing.scanStatus,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

filesRouter.get('/:id/download', requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth!
    const file = await prisma.storageFile.findFirst({ where: { id: String(req.params.id), deletedAt: null } })
    if (!file) throw notFound('Файл не найден')
    if (!canView(file, auth.role, auth.userId)) throw forbidden()

    const object = await openObject(file.storageKey)
    const encoded = encodeURIComponent(file.originalName)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encoded}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-store')
    if (object.size) res.setHeader('Content-Length', String(object.size))

    await prisma.storageFile.update({
      where: { id: file.id },
      data: { downloadCount: { increment: 1 } },
    })
    await writeFileAudit({
      userId: auth.userId,
      fileId: file.id,
      action: 'DOWNLOAD',
      fileName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      scanStatus: file.scanStatus,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    })

    object.stream.on('error', next)
    object.stream.pipe(res)
  } catch (error) {
    next(error)
  }
})
