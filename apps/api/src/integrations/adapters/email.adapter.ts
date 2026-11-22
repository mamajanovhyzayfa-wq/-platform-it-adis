import nodemailer from 'nodemailer'
import { env } from '../../config/env.js'
import { missingVariables } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'

function missing(): string[] {
  return missingVariables([
    ['SMTP_HOST', env.SMTP_HOST],
    ['SMTP_PORT', env.SMTP_PORT],
  ])
}

function transport() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 7_000,
    greetingTimeout: 7_000,
    socketTimeout: 7_000,
  })
}

/** Транзакционная почта: SMTP-сервер филиала или общий сервер платформы. */
export const emailAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'email',
    name: 'Email (SMTP)',
    category: 'email',
    description: 'Письма: подтверждение адреса, восстановление пароля, счета и уведомления.',
    docsUrl: 'https://nodemailer.com/smtp/',
    envVars: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'],
  },
  missingEnv: missing,
  isConfigured: () => missing().length === 0,
  async probe(): Promise<IntegrationProbe> {
    const transporter = transport()
    try {
      await transporter.verify()
      return { ok: true }
    } catch (error) {
      return { ok: false, message: `SMTP: ${error instanceof Error ? error.message : 'нет соединения'}` }
    } finally {
      transporter.close()
    }
  },
}
