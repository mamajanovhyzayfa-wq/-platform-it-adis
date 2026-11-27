import express, { type Express } from 'express'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { errorHandler, isJsonSyntaxError, sendJsonParseError } from '../src/lib/errors.js'
import { isCertificateFileUrl } from '../src/modules/certificates/certificates.util.js'

/**
 * S-8: body-parser отдавал текст ошибки парсера с позицией и именами полей.
 * Наружу должен уходить общий 400 без деталей.
 */

let app: Express

beforeAll(() => {
  app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isJsonSyntaxError(error)) {
      sendJsonParseError(res)
      return
    }
    next(error)
  })
  app.post('/echo', (_req, res) => res.json({ ok: true }))
  app.use(errorHandler)
})

describe('S-8: битый JSON', () => {
  it('возвращает 400 с общим текстом и без деталей парсера', async () => {
    const response = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@b.c",}')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Некорректный формат JSON' },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/Unexpected|position|JSON at/i)
  })

  it('корректный JSON проходит как обычно', async () => {
    const response = await request(app).post('/echo').send({ email: 'a@b.c' })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
  })

  it('не принимает за ошибку парсера другие SyntaxError', () => {
    expect(isJsonSyntaxError(new SyntaxError('ordinary'))).toBe(false)
    const parseError = Object.assign(new SyntaxError('Unexpected token'), { status: 400, body: '{"a":' })
    expect(isJsonSyntaxError(parseError)).toBe(true)
  })
})

describe('F-2: ссылка на файл сертификата', () => {
  it('принимает новый адрес API и старый путь /uploads', () => {
    expect(isCertificateFileUrl('https://itadis.kg/api/uploads/certificates/a.pdf')).toBe(true)
    expect(isCertificateFileUrl('https://itadis.kg/uploads/certificates/a.png')).toBe(true)
    expect(isCertificateFileUrl('https://itadis.kg/uploads/a.webp')).toBe(true)
  })

  it('отклоняет чужие пути и не-документы', () => {
    expect(isCertificateFileUrl('https://itadis.kg/api/certificates/1/file')).toBe(false)
    expect(isCertificateFileUrl('https://itadis.kg/uploads/a.exe')).toBe(false)
    expect(isCertificateFileUrl('not a url')).toBe(false)
  })
})
