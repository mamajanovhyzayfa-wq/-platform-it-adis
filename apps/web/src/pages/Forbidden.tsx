import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { http, errorMessage, getSession, type SessionRole } from '../api/client'
import { homeForRole, roleLabels } from '../app/navigation'

const roleOptions: { value: SessionRole; label: string }[] = [
  { value: 'ADMIN', label: 'Администратор' },
  { value: 'MANAGER', label: 'Менеджер' },
  { value: 'TEACHER', label: 'Наставник' },
  { value: 'STUDENT', label: 'Ученик' },
  { value: 'PARENT', label: 'Родитель' },
]

const sectionNames: Record<string, string> = {
  '/admin': 'панель администратора',
  '/manager': 'панель менеджера',
  '/mentor': 'панель наставника',
  '/student': 'кабинет ученика',
  '/parent': 'кабинет родителя',
  '/users': 'управление пользователями',
  '/courses': 'управление курсами',
  '/finance': 'финансы',
  '/reports': 'отчёты',
  '/schedule': 'расписание',
  '/access': 'заявки и роли',
}

/** Понятное сообщение об отсутствии доступа и запрос дополнительной роли у администратора. */
export function ForbiddenPage() {
  const session = getSession()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const requestedSection = from ? (sectionNames[from] ?? from) : null
  const selectableRoles = roleOptions.filter((option) => option.value !== session?.role)
  const suggestedRole: SessionRole =
    session?.role === 'STUDENT'
      ? 'PARENT'
      : session?.role === 'PARENT'
        ? 'STUDENT'
        : selectableRoles[0]?.value ?? 'STUDENT'
  const [role, setRole] = useState<SessionRole>(suggestedRole)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const requestRole = async (event: React.FormEvent) => {
    event.preventDefault()
    setMessage(null)
    setLoading(true)
    try {
      await http.post('/roles/requests', { role, reason: reason.trim() || undefined })
      setMessage({ kind: 'ok', text: 'Запрос отправлен. Роль появится после подтверждения администратором филиала.' })
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error, 'Не удалось отправить запрос') })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h1>Нет доступа к этому разделу</h1>
      <p className="muted">
        {requestedSection ? `Раздел «${requestedSection}» недоступен. ` : ''}
        Ваша текущая роль{session ? ` — ${roleLabels[session.role]}` : ''} не даёт доступа. Вы можете запросить
        дополнительную роль: администратор филиала проверит и подтвердит её.
      </p>

      <form onSubmit={requestRole}>
        <label className="field">
          <span>Роль</span>
          <select value={role} onChange={(event) => setRole(event.target.value as SessionRole)}>
            {selectableRoles.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Комментарий (необязательно)</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
        </label>

        {message ? <div className={message.kind === 'ok' ? 'alert' : 'alert alert-error'}>{message.text}</div> : null}

        <button className="button" type="submit" disabled={loading}>
          {loading ? 'Отправка…' : 'Запросить роль'}
        </button>
      </form>

      <p>
        <Link to={homeForRole(session?.role)}>В свой кабинет</Link>
      </p>
    </div>
  )
}
