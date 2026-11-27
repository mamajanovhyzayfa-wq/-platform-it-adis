import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantUploadsStatic } from '../src/lib/tenant.middleware.js'
import { runWithTenant } from '../src/lib/tenant.js'
import { env } from '../src/config/env.js'
import { signAccessToken, signFileToken } from '../src/lib/security.js'

const dir = mkdtempSync(join(tmpdir(), 'itadis-uploads-'))
const fileName = 'homework.pdf'
/** Файл, загруженный до появления таблицы Attachment: владельца нет. */
const legacyFile = 'legacy.pdf'

/** Владельцы файлов в реестре вложений. */
const owners = new Map<string, string>([[fileName, 'student-1']])

const prismaFake = {
  attachment: {
    findUnique: async ({ where }: { where: { name: string } }) => {
      const ownerId = owners.get(where.name)
      return ownerId ? { ownerId } : null
    },
  },
  // Журнал скачиваний не относится к ACL: запись в него не должна влиять на ответ.
  fileAuditLog: { create: async () => ({ id: 'audit-1' }) },
}

const app = express()
app.use('/uploads', (req, res, next) =>
  runWithTenant(
    { branchId: 'branch-1', branchSlug: 'test', domain: 'test', isPrimary: true, uploadsDir: dir, prisma: prismaFake } as never,
    () => tenantUploadsStatic(req, res, next),
  ),
)

const ownerToken = signAccessToken({ sub: 'student-1', role: 'STUDENT', email: 'student@itadis.kg' })
const strangerToken = signAccessToken({ sub: 'student-2', role: 'STUDENT', email: 'other@itadis.kg' })
const adminToken = signAccessToken({ sub: 'admin-1', role: 'ADMIN', email: 'admin@itadis.kg' })

beforeAll(() => {
  writeFileSync(join(dir, fileName), '%PDF-1.4 test')
  writeFileSync(join(dir, legacyFile), '%PDF-1.4 legacy')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('/uploads: файлы только с авторизацией', () => {
  it('без токена файл не отдаётся', async () => {
    const response = await request(app).get(`/uploads/${fileName}`)
    expect(response.status).toBe(401)
  })

  it('с неверным токеном файл не отдаётся', async () => {
    const response = await request(app).get(`/uploads/${fileName}`).set('Authorization', 'Bearer bad.token.value')
    expect(response.status).toBe(401)
  })

  it('несуществующий файл даёт 404', async () => {
    const response = await request(app).get('/uploads/missing.pdf').set('Authorization', `Bearer ${ownerToken}`)
    expect(response.status).toBe(404)
  })
})

describe('/uploads: IDOR — доступ только у владельца (S-1)', () => {
  it('владелец получает свой файл', async () => {
    const response = await request(app).get(`/uploads/${fileName}`).set('Authorization', `Bearer ${ownerToken}`)
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('другой пользователь получает 403, а не байты файла', async () => {
    const response = await request(app).get(`/uploads/${fileName}`).set('Authorization', `Bearer ${strangerToken}`)
    expect(response.status).toBe(403)
    expect(response.body.error).toBe('FORBIDDEN')
    expect(response.text).not.toContain('%PDF')
  })

  it('администратор читает файл любого пользователя', async () => {
    const response = await request(app).get(`/uploads/${fileName}`).set('Authorization', `Bearer ${adminToken}`)
    expect(response.status).toBe(200)
  })

  it('файл без записи о владельце закрыт для пользователя и открыт администратору', async () => {
    const student = await request(app).get(`/uploads/${legacyFile}`).set('Authorization', `Bearer ${ownerToken}`)
    expect(student.status).toBe(403)

    const admin = await request(app).get(`/uploads/${legacyFile}`).set('Authorization', `Bearer ${adminToken}`)
    expect(admin.status).toBe(200)
  })
})

describe('/uploads: короткая ссылка ?t= привязана к владельцу (S-2)', () => {
  it('действительная ссылка владельца открывает его файл без Bearer', async () => {
    const response = await request(app).get(`/uploads/${fileName}?t=${signFileToken(fileName, 'student-1')}`)
    expect(response.status).toBe(200)
  })

  it('ссылка, выписанная другому владельцу, не открывает файл', async () => {
    const response = await request(app).get(`/uploads/${fileName}?t=${signFileToken(fileName, 'student-2')}`)
    expect(response.status).toBe(403)
  })

  it('чужой Bearer не может воспользоваться ссылкой владельца', async () => {
    const response = await request(app)
      .get(`/uploads/${fileName}?t=${signFileToken(fileName, 'student-1')}`)
      .set('Authorization', `Bearer ${strangerToken}`)
    expect(response.status).toBe(403)
  })

  it('ссылка на другой файл не открывает этот файл', async () => {
    const response = await request(app).get(`/uploads/${fileName}?t=${signFileToken('other.pdf', 'student-1')}`)
    expect(response.status).toBe(401)
  })

  it('истёкшая ссылка не работает', async () => {
    const expired = jwt.sign(
      { scope: 'file', name: fileName, sub: 'student-1' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '-1s' },
    )
    const response = await request(app).get(`/uploads/${fileName}?t=${expired}`)
    expect(response.status).toBe(401)
  })

  it('ссылка старого формата без sub не работает', async () => {
    const legacy = jwt.sign({ scope: 'file', name: fileName }, env.JWT_ACCESS_SECRET, { expiresIn: '365d' })
    const response = await request(app).get(`/uploads/${fileName}?t=${legacy}`)
    expect(response.status).toBe(401)
  })
})
