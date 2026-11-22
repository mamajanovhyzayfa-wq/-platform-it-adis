import { env } from '../../config/env.js'
import { probeHttp } from '../core/http.js'
import { missingVariables } from '../core/secrets.js'
import type { IntegrationAdapter, IntegrationProbe } from '../core/types.js'
import { interpretProbe } from './helpers.js'

function missing(): string[] {
  return missingVariables([
    ['TWILIO_ACCOUNT_SID', env.TWILIO_ACCOUNT_SID],
    ['TWILIO_AUTH_TOKEN', env.TWILIO_AUTH_TOKEN],
    ['TWILIO_FROM', env.TWILIO_FROM],
  ])
}

/** SMS через Twilio-совместимый API: коды восстановления и критические оповещения. */
export const smsAdapter: IntegrationAdapter = {
  descriptor: {
    id: 'sms',
    name: 'SMS (Twilio)',
    category: 'sms',
    description: 'SMS-коды и уведомления по номеру телефона.',
    docsUrl: 'https://www.twilio.com/docs/messaging/api',
    envVars: ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
  },
  missingEnv: missing,
  isConfigured: () => missing().length === 0,
  async probe(): Promise<IntegrationProbe> {
    const sid = env.TWILIO_ACCOUNT_SID ?? ''
    const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN ?? ''}`).toString('base64')
    const result = await probeHttp(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
      // Секрет уходит только в заголовке и никогда не попадает в журнал.
      headers: { Authorization: `Basic ${auth}` },
    })
    return interpretProbe('Twilio', result)
  },
}
