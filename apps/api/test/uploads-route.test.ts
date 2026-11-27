import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express, { type Express } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { signAccessToken } from '../src/lib/security.js'
import { errorHandler } from '../src/lib/errors.js'
import { runWithTenant } from '../src/lib/tenant.js'

/**
 * Загрузка через настоящий Express-роутер и multer: проверяются пустой файл
 * (F-3) и ссылка на готовый сертификат (F-2). Внешние зависимости заменены:
 * роль берётся из токена, журнал файлов не пишется.
 */

vi.mock('../src/lib/active-role.js', () => ({
  resolveActiveRole: async (_userId: string, role: string) => role,
}))
vi.mock('../src/lib/file-audit.js', () => ({ writeFileAudit: vi.fn(async () => undefined) }))

const dir = mkdtempSync(join(tmpdir(), 'itadis-upload-route-'))

const attachments: Array<{ name: string; ownerId: string }> = []
const prismaFake = {
  attachment: {
    create: async ({ data }: { data: { name: string; ownerId: string } }) => {
      attachments.push({ name: data.name, ownerId: data.ownerId })
      return data
    },
  },
}

const adminToken = signAccessToken({ sub: 'admin-1', role: 'ADMIN', email: 'admin@itadis.kg' })
const studentToken = signAccessToken({ sub: 'student-1', role: 'STUDENT', email: 'student@itadis.kg' })

/** Минимальный PNG: сигнатура и IHDR — проходит проверку сигнатур. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f6e0000000049454e44ae426082',
  'hex',
)

let app: Express

beforeAll(async () => {
  process.env.UPLOADS_DIR = dir
  const { uploadsRouter } = await import('../src/modules/uploads/uploads.routes.js')
  app = express()
  app.use('/api/uploads', (req, res, next) =>
    runWithTenant(
      {
        branchId: 'branch-1',
        branchSlug: 'test',
        domain: 'test',
        isPrimary: true,
        uploadsDir: dir,
        prisma: prismaFake,
      } as never,
      () => uploadsRouter(req, res, next),
    ),
  )
  app.use(errorHandler)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('F-3: пустой файл не принимается', () => {
  it('отклоняет файл размером 0 байт с 400', async () => {
    const response = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${studentToken}`)
      .attach('file', Buffer.alloc(0), { filename: 'empty.png', contentType: 'image/png' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('BAD_REQUEST')
    expect(response.body.error.message).toContain('пустой')
    // Запись о вложении не создаётся: файла нет.
    expect(attachments).toHaveLength(0)
  })

  it('принимает непустой PNG', async () => {
    const response = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${studentToken}`)
      .attach('file', PNG, { filename: 'photo.png', contentType: 'image/png' })

    expect(response.status).toBe(201)
    expect(response.body.url).toMatch(/^http:\/\/[^/]+\/uploads\/[0-9a-f-]+\.png\?t=/)
    expect(attachments.at(-1)?.ownerId).toBe('student-1')
  })
})

describe('F-2: ссылка на готовый сертификат ведёт в API', () => {
  it('возвращает рабочий адрес /api/uploads/certificates/<file>', async () => {
    const response = await request(app)
      .post('/api/uploads?purpose=certificate')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'certificate.png', contentType: 'image/png' })

    expect(response.status).toBe(201)
    expect(response.body.url).toMatch(/^http:\/\/[^/]+\/api\/uploads\/certificates\/[0-9a-f-]+\.png$/)
    // Ссылка ведёт в API, а не в статику, и не несёт бесполезный токен.
    const parsed = new URL(response.body.url)
    expect(parsed.pathname.startsWith('/api/uploads/certificates/')).toBe(true)
    expect(response.body.url).not.toContain('?t=')
    expect(attachments.at(-1)?.ownerId).toBe('admin-1')

    const path = new URL(response.body.url).pathname
    const asAdmin = await request(app).get(path).set('Authorization', `Bearer ${adminToken}`)
    expect(asAdmin.status).toBe(200)
    expect(asAdmin.headers['x-content-type-options']).toBe('nosniff')

    const asStudent = await request(app).get(path).set('Authorization', `Bearer ${studentToken}`)
    expect(asStudent.status).toBe(403)
  })

  it('запрещает загрузку сертификата не администратору', async () => {
    const response = await request(app)
      .post('/api/uploads?purpose=certificate')
      .set('Authorization', `Bearer ${studentToken}`)
      .attach('file', PNG, { filename: 'certificate.png', contentType: 'image/png' })

    expect(response.status).toBe(403)
  })
})
