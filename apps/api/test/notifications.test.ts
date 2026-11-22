import { describe, expect, it } from 'vitest'
import { channelsFor, DEFAULT_NOTIFICATION_CHANNELS, defaultPreferenceSettings, NOTIFICATION_TYPES } from '../src/lib/notify.js'

describe('каналы уведомлений', () => {
  it('по умолчанию включает внутренние и push, не включает email и SMS', () => {
    expect(DEFAULT_NOTIFICATION_CHANNELS).toEqual({ inApp: true, push: true, email: false, sms: false })
    expect(channelsFor({}, 'HOMEWORK_ASSIGNED')).toEqual(DEFAULT_NOTIFICATION_CHANNELS)
  })

  it('настройка пользователя меняет только указанные каналы', () => {
    const channels = channelsFor({ HOMEWORK_ASSIGNED: { email: true, push: false } }, 'HOMEWORK_ASSIGNED')
    expect(channels).toEqual({ inApp: true, push: false, email: true, sms: false })
  })

  it('настройки одного типа не влияют на другой', () => {
    const settings = { HOMEWORK_ASSIGNED: { email: true } }
    expect(channelsFor(settings, 'PAYMENT_DUE').email).toBe(false)
  })

  it('отдаёт настройки для каждого типа уведомления', () => {
    const defaults = defaultPreferenceSettings()
    expect(Object.keys(defaults)).toEqual(NOTIFICATION_TYPES)
    expect(Object.values(defaults).every((channels) => channels.inApp && channels.push)).toBe(true)
  })

  it('покрывает все события из требований к уведомлениям', () => {
    const required = [
      'LESSON_PUBLISHED',
      'SCHEDULE_CHANGED',
      'HOMEWORK_ASSIGNED',
      'HOMEWORK_DUE_SOON',
      'TEST_RESULT',
      'EXAM_PUBLISHED',
      'EXAM_REGISTERED',
      'EXAM_RESULT',
      'MESSAGE_RECEIVED',
      'PAYMENT_RECEIVED',
      'PAYMENT_DUE',
      'INVOICE_ISSUED',
      'COINS_AWARDED',
      'ACHIEVEMENT_UNLOCKED',
      'EVENT',
      'EVENT_CANCELLED',
      'LESSON_CANCELLED',
      'LESSON_RESCHEDULED',
      'SUSPICIOUS_LOGIN',
      'DIGEST',
    ] as const
    for (const type of required) expect(NOTIFICATION_TYPES).toContain(type)
  })

  it('подозрительный вход по умолчанию дублируется письмом', () => {
    expect(channelsFor({}, 'SUSPICIOUS_LOGIN')).toEqual({ inApp: true, push: true, email: true, sms: false })
    expect(channelsFor({ SUSPICIOUS_LOGIN: { email: false } }, 'SUSPICIOUS_LOGIN').email).toBe(false)
  })
})
