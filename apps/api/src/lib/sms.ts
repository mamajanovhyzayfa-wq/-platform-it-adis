import { env } from '../config/env.js'
import { AppError } from './errors.js'

/**
 * Отправка SMS.
 *
 * Провайдер подключается переменными окружения: сейчас поддержан Twilio-совместимый
 * HTTP API (SMS_PROVIDER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).
 * Без ключей код печатается в лог — так же, как письма без SMTP, чтобы сценарии
 * восстановления можно было проверить локально.
 */
export async function sendSms(options: { to: string; text: string }): Promise<void> {
  const sid = env.TWILIO_ACCOUNT_SID
  const token = env.TWILIO_AUTH_TOKEN
  const from = env.TWILIO_FROM

  if (env.SMS_PROVIDER === 'twilio' && sid && token && from) {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: options.to, From: from, Body: options.text }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      console.error('[sms] провайдер ответил', response.status)
      throw new AppError(502, 'SMS_DELIVERY_FAILED', 'Не удалось отправить SMS, попробуйте позже')
    }
    return
  }

  console.info(`[sms:dev] to=${options.to} text="${options.text}"`)
}
