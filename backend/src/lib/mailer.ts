import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env.js'

let transporter: Transporter | null = null

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  })
  return transporter
}

/**
 * Письма уходят через SMTP, если он настроен. Без SMTP письмо печатается в лог —
 * это позволяет проверять сценарии сброса пароля локально, не выдумывая внешний сервис.
 */
export async function sendMail(options: { to: string; subject: string; text: string }) {
  const client = getTransporter()
  if (!client) {
    console.info(`[mail:dev] to=${options.to} subject="${options.subject}"\n${options.text}`)
    return
  }
  await client.sendMail({ from: env.MAIL_FROM, ...options })
}
