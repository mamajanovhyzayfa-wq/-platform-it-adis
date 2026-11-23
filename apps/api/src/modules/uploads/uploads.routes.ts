import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { badRequest, forbidden, payloadTooLarge } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'
import { getTenant } from '../../lib/tenant.js'
import { scanFile } from '../../lib/file-scan.js'
import { writeFileAudit } from '../../lib/file-audit.js'
import { signFileToken } from '../../lib/security.js'

/**
 * Загрузка вложений: фото и документы для чата и решений домашних заданий.
 *
 * Файлы складываются в локальный каталог `UPLOADS_DIR` и отдаются статически по `/uploads`.
 * Для нескольких инстансов или Serverless этот каталог нужно заменить на объектное
 * хранилище (S3/R2), интерфейс ответа при этом не меняется.
 */

export const uploadsDir = resolve(process.env.UPLOADS_DIR ?? 'uploads')
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true })

const MAX_SIZE_BYTES = 10 * 1024 * 1024

/** Готовые сертификаты: только PDF и изображения, и только от администратора. */
const CERTIFICATE_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

/** Разрешённые типы: изображения, аудио/видео, PDF, офисные документы и архивы с кодом. */
const allowedMimeTypes = new Map<string, string>([
  ['audio/mpeg', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
  ['audio/ogg', '.ogg'],
  ['audio/webm', '.weba'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['video/x-matroska', '.mkv'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
  ['image/gif', '.gif'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/markdown', '.md'],
  ['application/zip', '.zip'],
  ['application/x-zip-compressed', '.zip'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
])

const storage = multer.diskStorage({
  // В запросе филиала файл попадает в его собственный каталог — общего хранилища нет.
  destination: (req, _file, callback) => {
    const base = getTenant()?.uploadsDir ?? uploadsDir
    // Сертификаты не отдаются публичной статикой: только через API с проверкой роли/владельца.
    const dir = req.query.purpose === 'certificate' ? join(base, 'certificates') : base
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    callback(null, dir)
  },
  filename: (_req, file, callback) => {
    const extension = allowedMimeTypes.get(file.mimetype) ?? (extname(file.originalname).toLowerCase() || '.bin')
    callback(null, `${randomUUID()}${extension}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(badRequest(`Тип файла не поддерживается: ${file.mimetype}`))
      return
    }
    callback(null, true)
  },
})

export const uploadsRouter = Router()

uploadsRouter.post('/', requireAuth, (req, res, next) => {
  const certificateUpload = req.query.purpose === 'certificate'
  if (certificateUpload && req.auth?.role !== 'ADMIN') {
    next(forbidden('Загружать сертификаты может только администратор'))
    return
  }

  upload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(payloadTooLarge('Файл больше 10 МБ'))
        return
      }
      next(badRequest(`Не удалось принять файл: ${error.code}`))
      return
    }
    if (error) {
      next(error)
      return
    }

    if (!req.file) {
      next(badRequest('Файл не передан: ожидается поле file'))
      return
    }

    void (async () => {
      const file = req.file!
      if (certificateUpload && !CERTIFICATE_MIME_TYPES.has(file.mimetype)) {
        try {
          unlinkSync(file.path)
        } catch {
          // временный файл мог быть уже удалён
        }
        next(badRequest('Сертификат должен быть PDF, JPEG, PNG или WebP'))
        return
      }

      const scan = await scanFile(file.path)
      await writeFileAudit({
        userId: req.auth?.userId,
        action: 'UPLOAD',
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256: scan.sha256,
        scanStatus: scan.status,
        ip: req.ip,
        userAgent: req.get('user-agent') ?? null,
      })

      if (!scan.clean) {
        try {
          unlinkSync(file.path)
        } catch {
          // Файл мог быть уже удалён внешним сканером.
        }
        next(badRequest(`Файл отклонён проверкой безопасности: ${scan.reason ?? 'подозрительное содержимое'}`))
        return
      }

      const origin = `${req.protocol}://${req.get('host')}`
      res.status(201).json({
        name: file.originalname.slice(0, 255),
        url: `${origin}/uploads/${certificateUpload ? 'certificates/' : ''}${file.filename}?t=${signFileToken(file.filename)}`,
        mimeType: file.mimetype,
        size: file.size,
        isImage: file.mimetype.startsWith('image/'),
        scanStatus: scan.status,
      })
    })().catch(next)
  })
})
