import { describe, expect, it } from 'vitest'
import {
  notificationListQuerySchema,
  notificationPreferenceSchema,
} from '../src/modules/notifications/notifications.schemas.js'
import {
  backupRestoreSchema,
  backupSettingsSchema,
} from '../src/modules/backups/backups.schemas.js'

describe('контракты уведомлений', () => {
  it('ограничивает размер страницы и задаёт значения по умолчанию', () => {
    expect(notificationListQuerySchema.parse({})).toEqual({ limit: 30, offset: 0 })
    expect(notificationListQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(notificationListQuerySchema.safeParse({ offset: -1 }).success).toBe(false)
  })

  it('принимает частичные каналы и отклоняет неизвестный ключ', () => {
    expect(notificationPreferenceSchema.safeParse({ settings: { PAYMENT_DUE: { email: true } } }).success).toBe(true)
    expect(notificationPreferenceSchema.safeParse({ unknown: true }).success).toBe(false)
    expect(notificationPreferenceSchema.safeParse({ digestHour: 24 }).success).toBe(false)
  })
})

describe('контракты резервного копирования', () => {
  it('не разрешает квоту меньше лимита одного файла', () => {
    expect(backupSettingsSchema.safeParse({ fileMaxSizeMb: 50, fileQuotaMb: 40 }).success).toBe(false)
    expect(backupSettingsSchema.safeParse({ fileMaxSizeMb: 50, fileQuotaMb: 50 }).success).toBe(true)
  })

  it('требует копию БД для заявки на восстановление', () => {
    expect(backupRestoreSchema.safeParse({ reason: 'сбой' }).success).toBe(false)
    expect(backupRestoreSchema.parse({ backupId: 'backup-1' })).toMatchObject({ backupId: 'backup-1' })
  })
})
