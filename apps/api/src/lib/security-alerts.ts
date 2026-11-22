import { notifyUsers } from './notify.js'

/**
 * Уведомление о подозрительном входе: новый IP или новое устройство.
 *
 * Событие идёт через общий notifyUsers: внутреннее уведомление, push, email
 * и SMS отправляются по настройкам пользователя. Ошибка уведомления не должна
 * ломать вход, поэтому всё обёрнуто в try/catch.
 */
export async function notifySuspiciousLogin(input: {
  userId: string
  email: string
  ip?: string | null
  userAgent?: string | null
  newDevice: boolean
  newIp: boolean
}): Promise<void> {
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })
  const reasons = [input.newDevice ? 'новое устройство' : null, input.newIp ? 'новый IP-адрес' : null]
    .filter(Boolean)
    .join(', ')
  const details = [input.ip ? `IP: ${input.ip}` : null, input.userAgent ? `устройство: ${input.userAgent}` : null]
    .filter(Boolean)
    .join(' · ')
  const body = `${when}${reasons ? `, ${reasons}` : ''}${details ? ` (${details})` : ''}. Если это не вы, смените пароль.`

  try {
    await notifyUsers([input.userId], {
      type: 'SUSPICIOUS_LOGIN',
      title: 'Новый вход в аккаунт',
      body,
      data: { kind: 'suspicious_login', ip: input.ip ?? null, userAgent: input.userAgent ?? null },
      email: {
        subject: 'ITadis: вход в аккаунт с нового устройства',
        text: `Зафиксирован вход в аккаунт ${when}.${details ? ` ${details}.` : ''} Если это не вы, смените пароль и сообщите администратору филиала.`,
      },
      sms: `ITadis: вход в аккаунт ${when}. Если это не вы, смените пароль.`.slice(0, 160),
    })
  } catch (error) {
    console.warn('[security] не удалось отправить уведомление о входе', error instanceof Error ? error.message : error)
  }
}

/**
 * Сессия завершена автоматически: повторное использование refresh-токена или
 * резкая смена IP и клиента. Пользователь должен узнать об этом сразу.
 */
export async function notifySuspiciousSession(input: {
  userId: string
  email: string
  reason: 'token_reuse' | 'fingerprint_changed'
  ip?: string | null
  userAgent?: string | null
}): Promise<void> {
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })
  const reason =
    input.reason === 'token_reuse'
      ? 'зафиксировано повторное использование токена сессии'
      : 'зафиксирована резкая смена IP-адреса и устройства'
  const details = [input.ip ? `IP: ${input.ip}` : null, input.userAgent ? `устройство: ${input.userAgent}` : null]
    .filter(Boolean)
    .join(' · ')

  try {
    await notifyUsers([input.userId], {
      type: 'SUSPICIOUS_LOGIN',
      title: 'Подозрительная сессия завершена',
      body: `${when}: ${reason}${details ? ` (${details})` : ''}. Все сессии завершены. Смените пароль, если это были не вы.`,
      data: { kind: 'session_revoked', reason: input.reason, ip: input.ip ?? null },
      email: {
        subject: 'ITadis: подозрительная сессия завершена',
        text: `В ${when} все сессии аккаунта были завершены автоматически: ${reason}.${details ? ` ${details}.` : ''} Если это были не вы, немедленно смените пароль и сообщите администратору.`,
      },
      sms: `ITadis: подозрительная сессия завершена. Если это не вы, смените пароль.`.slice(0, 160),
    })
  } catch (error) {
    console.warn('[security] не удалось отправить уведомление о сессии', error instanceof Error ? error.message : error)
  }
}
