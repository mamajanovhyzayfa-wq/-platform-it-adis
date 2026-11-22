import { Logger } from '@nestjs/common'
import { env } from '../config/env.js'

const logger = new Logger('Alert')

/**
 * Единая точка оповещений об ошибках. В production задайте ALERT_WEBHOOK_URL
 * (Slack/Telegram-бот/корпоративный вебхук): сообщение содержит только
 * технический контекст, без персональных данных и содержимого файлов.
 */
export async function sendAlert(
  title: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  logger.error(`${title} ${JSON.stringify(details)}`)
  if (!env.ALERT_WEBHOOK_URL) return
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: `ITadis: ${title}`,
        title,
        service: 'itadis-api',
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
        ...details,
      }),
    }).finally(() => clearTimeout(timer))
  } catch (error) {
    logger.warn(`Не удалось отправить alert: ${error instanceof Error ? error.message : String(error)}`)
  }
}
