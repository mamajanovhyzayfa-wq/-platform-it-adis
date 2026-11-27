import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AppError, errorHandler } from '../src/lib/errors.js'
import { containsNulByte, rejectNulBytes } from '../src/lib/input-guard.js'

/** Тот же порядок, что в main.ts: json → guard → маршруты → обработчик ошибок. */
function makeApp() {
  const app = express()
  app.use(express.json())
  app.use(rejectNulBytes)
  app.post('/api/auth/login', (req, res) => {
    res.json({ received: req.body })
  })
  app.get('/api/search', (req, res) => {
    res.json({ query: req.query })
  })
  app.use(errorHandler)
  return app
}

describe('NUL-байт в запросе не доходит до базы', () => {
  it('находит NUL в строке, массиве и вложенном объекте', () => {
    expect(containsNulByte('a\u0000b')).toBe(true)
    expect(containsNulByte(['ok', 'x\u0000'])).toBe(true)
    expect(containsNulByte({ nested: { value: '\u0000' } })).toBe(true)
    expect(containsNulByte(Buffer.from([0x41, 0x00]))).toBe(true)
  })

  it('не считает NUL-ом обычные данные', () => {
    expect(containsNulByte({ email: 'student@itadis.kg', phone: '+996700000001' })).toBe(false)
    expect(containsNulByte(null)).toBe(false)
    expect(containsNulByte(42)).toBe(false)
  })

  it('возвращает 400 на identifier с NUL вместо 500 от PostgreSQL', async () => {
    const response = await request(makeApp())
      .post('/api/auth/login')
      .send({ identifier: 'admin@itadis.kg\u0000', password: 'x' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('BAD_REQUEST')
    expect(response.body.error.message).toContain('NUL')
  })

  it('возвращает 400 на NUL в query', async () => {
    const response = await request(makeApp()).get('/api/search').query({ q: 'x\u0000' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('BAD_REQUEST')
  })

  it('пропускает обычный запрос без изменений', async () => {
    const response = await request(makeApp())
      .post('/api/auth/login')
      .send({ identifier: 'admin@itadis.kg', password: 'secret' })
    expect(response.status).toBe(200)
    expect(response.body.received.identifier).toBe('admin@itadis.kg')
  })

  it('ошибка guard-а — AppError со статусом 400, а не голый Error', () => {
    let captured: unknown
    rejectNulBytes(
      { body: { a: '\u0000' }, query: {}, params: {} } as never,
      {} as never,
      (error?: unknown) => {
        captured = error
      },
    )
    expect(captured).toBeInstanceOf(AppError)
    expect((captured as AppError).status).toBe(400)
  })
})
