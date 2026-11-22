import { Router } from 'express'
import { PrismaService } from '../../nest/prisma/prisma.service.js'
import { VideoService } from './video.service.js'
import {
  verifyWebhook,
  type LiveDigitalWebhookPayload,
} from './livedigital.js'

/**
 * Вебхук LiveDigital монтируется до express.json: подпись считается по сырому телу.
 * Один вебхук настраивается для space в личном кабинете LiveDigital.
 */
export const liveDigitalWebhookRouter = Router()

liveDigitalWebhookRouter.post('/webhook', async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}))
  let parsed: { signature?: string; body?: LiveDigitalWebhookPayload }
  try {
    parsed = JSON.parse(raw.toString('utf8')) as { signature?: string; body?: LiveDigitalWebhookPayload }
  } catch {
    res.status(400).json({ error: { code: 'INVALID_WEBHOOK', message: 'Тело вебхука не является JSON' } })
    return
  }

  try {
    const payload = verifyWebhook(raw, parsed)
    const video = new VideoService(new PrismaService())
    await video.handleWebhook(payload)
    res.json({ ok: true })
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 500
    console.warn('[livedigital] вебхук не обработан', error)
    res.status(Number.isFinite(status) && status >= 400 && status < 600 ? status : 500).json({
      error: {
        code: 'WEBHOOK_FAILED',
        message: error instanceof Error ? error.message : 'Не удалось обработать вебхук',
      },
    })
  }
})
