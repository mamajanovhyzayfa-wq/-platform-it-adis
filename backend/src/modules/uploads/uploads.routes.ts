import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { badRequest, payloadTooLarge } from '../../lib/errors.js'
import { requireAuth } from '../../middleware/auth.js'

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

/** Разрешённые типы: изображения, PDF, офисные документы и архивы с кодом. */
const allowedMimeTypes = new Map<string, string>([
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
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
])

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDir),
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

    const origin = `${req.protocol}://${req.get('host')}`
    res.status(201).json({
      name: req.file.originalname.slice(0, 255),
      url: `${origin}/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype,
      size: req.file.size,
      isImage: req.file.mimetype.startsWith('image/'),
    })
  })
})
