import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getSession } from '../api/client'
import { notificationApi, type NotificationChannels } from '../api/notifications'

const typeLabels: Record<string, string> = {
  LESSON_PUBLISHED: 'Новый урок',
  SCHEDULE_CHANGED: 'Изменение расписания',
  HOMEWORK_ASSIGNED: 'Домашнее задание',
  HOMEWORK_DUE_SOON: 'Срок сдачи ДЗ',
  HOMEWORK_REVIEWED: 'Проверка ДЗ',
  GRADE_RECEIVED: 'Оценка',
  TEST_ASSIGNED: 'Новый тест',
  EXAM_PUBLISHED: 'Экзамен',
  EXAM_REGISTERED: 'Регистрация на экзамен',
  EXAM_RESULT: 'Результат экзамена',
  TEST_RESULT: 'Результат теста',
  LESSON_CANCELLED: 'Отмена занятия',
  LESSON_RESCHEDULED: 'Перенос занятия',
  EVENT_CANCELLED: 'Отмена мероприятия',
  SUSPICIOUS_LOGIN: 'Подозрительный вход',
  MESSAGE_RECEIVED: 'Сообщения и обсуждения',
  PAYMENT_RECEIVED: 'Оплата получена',
  PAYMENT_DUE: 'Задолженность',
  INVOICE_ISSUED: 'Счёт',
  REFUND_PROCESSED: 'Возврат',
  COINS_AWARDED: 'IT Coins',
  ACHIEVEMENT_UNLOCKED: 'Достижение',
  SHOP_ORDER: 'Магазин IT Coins',
  CERTIFICATE_ISSUED: 'Сертификат выдан',
  CERTIFICATE_REVOKED: 'Сертификат отозван',
  ANNOUNCEMENT: 'Объявления',
  EVENT: 'Мероприятия',
  CONTEST: 'Конкурсы и олимпиады',
  MEETING_REQUEST: 'Запрос встречи',
  MEETING_RESPONSE: 'Ответ по встрече',
  ATTENDANCE_ABSENCE: 'Пропуск занятия',
  LESSON_STARTING: 'Занятие начинается',
  DIGEST: 'Сводки',
  SYSTEM: 'Системные',
}

const channelLabels: Record<keyof NotificationChannels, string> = {
  inApp: 'Внутренние',
  push: 'Push',
  email: 'Email',
  sms: 'SMS',
}

const emptyChannels: NotificationChannels = { inApp: true, push: true, email: false, sms: false }

export function NotificationSettingsPage() {
  const queryClient = useQueryClient()
  const session = getSession()
  const [settings, setSettings] = useState<Record<string, NotificationChannels>>({})
  const [digest, setDigest] = useState('NONE')
  const [digestHour, setDigestHour] = useState(9)
  const [notice, setNotice] = useState<string | null>(null)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [limit, setLimit] = useState(20)

  const preferences = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: notificationApi.preferences,
  })
  const notifications = useQuery({
    queryKey: ['notifications', limit],
    queryFn: () => notificationApi.list({ limit }),
    refetchInterval: 60_000,
  })

  useEffect(() => {
    if (!preferences.data) return
    setSettings(preferences.data.settings)
    setDigest(preferences.data.digest)
    setDigestHour(preferences.data.digestHour)
  }, [preferences.data])

  const save = useMutation({
    mutationFn: () => notificationApi.update({ settings, digest, digestHour }),
    onSuccess: () => {
      setNotice('Настройки уведомлений сохранены')
      void queryClient.invalidateQueries({ queryKey: ['notification-preferences'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const digestRun = useMutation({
    mutationFn: notificationApi.runDigest,
    onSuccess: (result) => setNotice(`Сводка сформирована для ${result.sent} пользователей`),
    onError: (error) => setNotice(errorMessage(error)),
  })

  const markAll = useMutation({
    mutationFn: notificationApi.readAll,
    onSuccess: () => {
      setNotice('Все уведомления отмечены прочитанными')
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const setChannel = (type: string, channel: keyof NotificationChannels, value: boolean) => {
    setSettings((current) => ({
      ...current,
      [type]: { ...(current[type] ?? emptyChannels), [channel]: value },
    }))
  }

  const applyPreset = (preset: 'internal' | 'all') => {
    setSettings((current) =>
      Object.fromEntries(
        Object.keys(current).map((type) => [
          type,
          preset === 'internal'
            ? { inApp: true, push: true, email: false, sms: false }
            : { inApp: true, push: true, email: true, sms: true },
        ]),
      ),
    )
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Уведомления</h1>
          <p className="muted">Внутренние, push, email и SMS — по каждому событию отдельно. Сводки приходят по расписанию.</p>
        </div>
      </header>

      {notice ? <div className="alert">{notice}</div> : null}

      <div className="grid-2">
        <section className="card stack">
          <div className="row-between">
            <h2>Сводки</h2>
            {session?.role === 'ADMIN' ? (
              <button className="button button-ghost button-small" type="button" onClick={() => digestRun.mutate()} disabled={digestRun.isPending}>
                Сформировать сейчас
              </button>
            ) : null}
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Периодичность</span>
              <select value={digest} onChange={(event) => setDigest(event.target.value)}>
                <option value="NONE">Не присылать</option>
                <option value="DAILY">Ежедневно</option>
                <option value="WEEKLY">Еженедельно (понедельник)</option>
              </select>
            </label>
            <label className="field">
              <span>Час отправки (UTC)</span>
              <select value={digestHour} onChange={(event) => setDigestHour(Number(event.target.value))}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">В сводку попадают непрочитанные уведомления за день или неделю. Email и SMS отправляются, только если включены для типа «Сводки».</p>
        </section>

        <section className="card stack">
          <div className="row-between">
            <div>
              <h2>Уведомления</h2>
              <p className="muted small">
                Непрочитанных: {notifications.data?.unread ?? 0} из {notifications.data?.total ?? 0}
              </p>
            </div>
            <button className="button button-ghost button-small" type="button" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              Прочитать все
            </button>
          </div>
          <label className="switch">
            <input type="checkbox" checked={onlyUnread} onChange={(event) => setOnlyUnread(event.target.checked)} />
            <span>Только непрочитанные</span>
          </label>
          <div className="stack">
            {(notifications.data?.items ?? [])
              .filter((item) => !onlyUnread || !item.readAt)
              .map((item) => (
                <article key={item.id} className={item.readAt ? 'notice' : 'notice notice-unread'}>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <div className="row-between">
                    <time className="muted small">{new Date(item.createdAt).toLocaleString('ru-RU')}</time>
                    {!item.readAt ? (
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => notificationApi.read(item.id).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))}
                      >
                        прочитано
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            {(notifications.data?.items ?? []).length === 0 ? <p className="muted">Уведомлений пока нет.</p> : null}
            {(notifications.data?.items.length ?? 0) < (notifications.data?.total ?? 0) ? (
              <button className="button button-ghost button-small" type="button" onClick={() => setLimit((current) => current + 20)}>
                Показать ещё
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <section className="card stack">
        <div className="row-between">
          <div>
            <h2>Каналы по событиям</h2>
            <p className="muted small">По умолчанию включены внутренние и push. Email и SMS включайте осознанно; для подозрительного входа email включён по умолчанию.</p>
          </div>
          <div className="row-actions">
            <button className="button button-ghost button-small" type="button" onClick={() => applyPreset('internal')}>
              Только в кабинете
            </button>
            <button className="button button-ghost button-small" type="button" onClick={() => applyPreset('all')}>
              Все каналы
            </button>
          </div>
        </div>

        {preferences.isLoading ? <p className="muted">Загрузка настроек…</p> : null}
        {preferences.error ? <div className="alert alert-error">{errorMessage(preferences.error)}</div> : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Событие</th>
                {(['inApp', 'push', 'email', 'sms'] as const).map((channel) => (
                  <th key={channel}>{channelLabels[channel]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(settings).map(([type, channels]) => (
                <tr key={type}>
                  <td>{typeLabels[type] ?? type}</td>
                  {(['inApp', 'push', 'email', 'sms'] as const).map((channel) => (
                    <td key={channel}>
                      <input
                        type="checkbox"
                        checked={Boolean(channels[channel])}
                        onChange={(event) => setChannel(type, channel, event.target.checked)}
                        aria-label={`${typeLabels[type] ?? type}: ${channelLabels[channel]}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row-actions">
          <button className="button" type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить настройки'}
          </button>
        </div>
      </section>
    </div>
  )
}
