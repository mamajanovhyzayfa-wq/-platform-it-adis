import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantUploadsStatic } from '../src/lib/tenant.middleware.js'
import { runWithTenant } from '../src/lib/tenant.js'
import { signAccessToken, signFileToken } from '../src/lib/security.js'

const dir = mkdtempSync(join(tmpdir(), 'itadis-uploads-'))
const fileName = 'homework.pdf'
const app = express()
app.use('/uploads', (req, res, next) =>
  runWithTenant({ slug: 'test', uploadsDir: dir } as never, () => tenantUploadsStatic(req, res, next)),
)

const bearer = signAccessToken({ sub: 'user-1', role: 'STUDENT', email: 'student@itadis.kg' })

beforeAll(() => {
  writeFileSync(join(dir, fileName), '%PDF-1.4 test')
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

  it('подписанная ссылка на другой файл не открывает этот файл', async () => {
    const response = await request(app).get(`/uploads/${fileName}?t=${signFileToken('other.pdf')}`)
    expect(response.status).toBe(401)
  })

  it('с Bearer-токеном файл отдаётся', async () => {
    const response = await request(app).get(`/uploads/${fileName}`).set('Authorization', `Bearer ${bearer}`)
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('по действующей подписанной ссылке файл отдаётся', async () => {
    const response = await request(app).get(`/uploads/${fileName}?t=${signFileToken(fileName)}`)
    expect(response.status).toBe(200)
  })

  it('несуществующий файл даёт 404 только при наличии авторизации', async () => {
    const response = await request(app).get('/uploads/missing.pdf').set('Authorization', `Bearer ${bearer}`)
    expect(response.status).toBe(404)
  })
})
