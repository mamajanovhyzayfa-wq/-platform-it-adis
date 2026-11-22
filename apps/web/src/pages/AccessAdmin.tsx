import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accessApi } from '../api/access'
import { adminApi, type AdminUser } from '../api/admin'
import { appUrl, errorMessage, type SessionRole } from '../api/client'
import { rolesApi } from '../api/roles'
import { Empty, PageHeader, Section, StatusBadge, formatDateTime } from '../components/ui'
import { roleLabels } from '../app/navigation'

type Tab = 'registrations' | 'invitations' | 'roles' | 'access'
type RegistrationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'

const invitationLinks = (code: string) =>
  `${window.location.origin}${appUrl('/join')}?code=${encodeURIComponent(code)}`

/** Администрирование доступа: заявки, приглашения и восстановление доступа. */
export function AccessAdminPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('registrations')
  const [status, setStatus] = useState<RegistrationStatus>('PENDING')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [stepUpPassword, setStepUpPassword] = useState('')

  const confirmAdminPassword = async () => {
    if (!stepUpPassword.trim()) throw new Error('Введите свой пароль для подтверждения важного действия')
    await accessApi.stepUp(stepUpPassword.trim())
  }

  const registrations = useQuery({
    queryKey: ['registrations', status],
    queryFn: () => accessApi.registrations(status),
  })

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      await confirmAdminPassword()
      return accessApi.decide(id, approve)
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['registrations'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const roleRequests = useQuery({
    queryKey: ['roles-pending'],
    queryFn: rolesApi.pendingRequests,
    enabled: tab === 'roles',
  })
  const decideRole = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      await confirmAdminPassword()
      return rolesApi.decideRequest(id, approve)
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['roles-pending'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const pendingParentLinks = useQuery({
    queryKey: ['parent-links-pending'],
    queryFn: rolesApi.pendingParentLinks,
    enabled: tab === 'roles',
  })
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<AdminUser | null>(null)
  const [parentCode, setParentCode] = useState<string | null>(null)
  const studentResults = useQuery({
    queryKey: ['parent-student-search', studentSearch],
    queryFn: () => adminApi.users({ page: 1, limit: 5, search: studentSearch.trim() }),
    enabled: studentSearch.trim().length >= 3,
  })
  const issueParentCode = useMutation({
    mutationFn: (studentId: string) => rolesApi.issueParentCode(studentId),
    onSuccess: (result) => {
      setError(null)
      setParentCode(result.code)
      queryClient.invalidateQueries({ queryKey: ['parent-links-pending'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })
  const verifyParentLink = useMutation({
    mutationFn: async (id: string) => {
      await confirmAdminPassword()
      return rolesApi.verifyParentLink(id)
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['parent-links-pending'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const invitations = useQuery({ queryKey: ['invitations'], queryFn: accessApi.invitations })
  const [invitation, setInvitation] = useState({
    channel: 'LINK' as 'LINK' | 'CODE' | 'EMAIL' | 'PHONE',
    role: 'STUDENT' as SessionRole,
    email: '',
    phone: '',
    ttlHours: 72,
  })

  const createInvitation = useMutation({
    mutationFn: async () => {
      await confirmAdminPassword()
      return accessApi.createInvitation({
        channel: invitation.channel,
        role: invitation.role,
        ttlHours: invitation.ttlHours,
        ...(invitation.email ? { email: invitation.email } : {}),
        ...(invitation.phone ? { phone: invitation.phone } : {}),
      })
    },
    onSuccess: () => {
      setError(null)
      setInvitation((current) => ({ ...current, email: '', phone: '' }))
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  })

  const [search, setSearch] = useState('')
  const users = useQuery({
    queryKey: ['access-users', search],
    queryFn: () => adminApi.users({ page: 1, limit: 6, search: search.trim() }),
    enabled: search.trim().length >= 3,
  })
  const [target, setTarget] = useState<AdminUser | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [resetResult, setResetResult] = useState<string | null>(null)

  const resetAccess = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('Выберите пользователя')
      await accessApi.stepUp(adminPassword)
      return accessApi.resetAccess(target.id)
    },
    onSuccess: (result) => {
      setError(null)
      setAdminPassword('')
      setResetResult(
        result.temporaryPassword
          ? `Временный пароль: ${result.temporaryPassword} — передайте его пользователю лично.`
          : result.message,
      )
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось восстановить доступ')),
  })

  return (
    <div className="stack">
      <PageHeader
        title="Доступ и регистрация"
        subtitle="Заявки на регистрацию, приглашения и восстановление доступа пользователей."
      />

      <div className="tabs" role="tablist" aria-label="Разделы доступа">
        {(
          [
            ['registrations', 'Заявки'],
            ['invitations', 'Приглашения'],
            ['roles', 'Роли и родители'],
            ['access', 'Восстановление доступа'],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card stack-sm">
        <label className="field">
          <span>Подтверждение важных действий</span>
          <input
            type="password"
            value={stepUpPassword}
            onChange={(event) => setStepUpPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Ваш пароль"
          />
        </label>
        <p className="muted small">
          Подтверждение требуется для решений по заявкам, ролям, привязке родителей и приглашениям. Пароль хранится
          только в памяти страницы.
        </p>
      </div>

      {tab === 'registrations' ? (
        <Section
          title="Заявки на регистрацию"
          subtitle="Аккаунт создаётся только после подтверждения"
          action={
            <div className="segmented" role="group" aria-label="Статус заявки">
              {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as RegistrationStatus[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={status === value ? 'segmented-item segmented-active' : 'segmented-item'}
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {value === 'PENDING' ? 'Ожидают' : value === 'APPROVED' ? 'Одобрены' : value === 'REJECTED' ? 'Отклонены' : 'Все'}
                </button>
              ))}
            </div>
          }
        >
          {registrations.isLoading ? <p className="muted">Загрузка…</p> : null}
          {registrations.data && registrations.data.length === 0 ? <Empty>Заявок нет.</Empty> : null}
          {registrations.data && registrations.data.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Заявитель</th>
                    <th>Контакты</th>
                    <th>Роль</th>
                    <th>Создана</th>
                    <th>Статус</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {registrations.data.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>
                          {item.firstName} {item.lastName}
                        </strong>
                        {item.message ? <p className="muted small">{item.message}</p> : null}
                        {item.birthDate ? (
                          <p className="muted small">
                            Дата рождения: {new Date(item.birthDate).toLocaleDateString('ru-RU')}
                          </p>
                        ) : null}
                        {item.guardianName ? (
                          <p className="muted small">
                            Представитель: {item.guardianName}
                            {item.guardianPhone ? `, ${item.guardianPhone}` : ''}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        {item.email}
                        {item.phone ? <p className="muted small">{item.phone}</p> : null}
                      </td>
                      <td>{roleLabels[item.requestedRole] ?? item.requestedRole}</td>
                      <td className="muted small">{formatDateTime(item.createdAt)}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      <td>
                        {item.status === 'PENDING' ? (
                          <div className="row-actions">
                            <button
                              className="button button-small"
                              type="button"
                              onClick={() => decide.mutate({ id: item.id, approve: true })}
                              disabled={decide.isPending}
                            >
                              Подтвердить
                            </button>
                            <button
                              className="button button-ghost button-small"
                              type="button"
                              onClick={() => decide.mutate({ id: item.id, approve: false })}
                              disabled={decide.isPending}
                            >
                              Отклонить
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>
      ) : null}

      {tab === 'invitations' ? (
        <div className="grid two">
          <Section title="Новое приглашение" subtitle="Ссылка, код, email или телефон">
            <form
              className="stack-sm"
              onSubmit={(event) => {
                event.preventDefault()
                createInvitation.mutate()
              }}
            >
              <label className="field">
                <span>Тип приглашения</span>
                <select
                  value={invitation.channel}
                  onChange={(event) =>
                    setInvitation({ ...invitation, channel: event.target.value as typeof invitation.channel })
                  }
                >
                  <option value="LINK">Ссылка</option>
                  <option value="CODE">Код</option>
                  <option value="EMAIL">На email</option>
                  <option value="PHONE">На телефон</option>
                </select>
              </label>

              <label className="field">
                <span>Роль</span>
                <select
                  value={invitation.role}
                  onChange={(event) => setInvitation({ ...invitation, role: event.target.value as SessionRole })}
                >
                  {Object.entries(roleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              {invitation.channel === 'EMAIL' || invitation.channel === 'LINK' ? (
                <label className="field">
                  <span>Email {invitation.channel === 'EMAIL' ? '' : '(необязательно)'}</span>
                  <input
                    type="email"
                    value={invitation.email}
                    onChange={(event) => setInvitation({ ...invitation, email: event.target.value })}
                    required={invitation.channel === 'EMAIL'}
                  />
                </label>
              ) : null}

              {invitation.channel === 'PHONE' || invitation.channel === 'LINK' ? (
                <label className="field">
                  <span>Телефон {invitation.channel === 'PHONE' ? '' : '(необязательно)'}</span>
                  <input
                    value={invitation.phone}
                    onChange={(event) => setInvitation({ ...invitation, phone: event.target.value })}
                    placeholder="+996700000000"
                    required={invitation.channel === 'PHONE'}
                  />
                </label>
              ) : null}

              <label className="field">
                <span>Срок действия, часов</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={invitation.ttlHours}
                  onChange={(event) => setInvitation({ ...invitation, ttlHours: Number(event.target.value) })}
                />
              </label>

              <button className="button" type="submit" disabled={createInvitation.isPending}>
                {createInvitation.isPending ? 'Создаём…' : 'Создать приглашение'}
              </button>
            </form>
          </Section>

          <Section title="Выданные приглашения" subtitle="Активные и использованные">
            {invitations.isLoading ? <p className="muted">Загрузка…</p> : null}
            {invitations.data && invitations.data.length === 0 ? <Empty>Приглашений пока нет.</Empty> : null}
            {invitations.data && invitations.data.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Код</th>
                      <th>Роль</th>
                      <th>Действует до</th>
                      <th>Статус</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.data.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong className="code-block">{item.code}</strong>
                        </td>
                        <td>{roleLabels[item.role]}</td>
                        <td className="muted small">{formatDateTime(item.expiresAt)}</td>
                        <td>
                          <span className={item.usedAt ? 'badge' : 'badge badge-active'}>
                            {item.usedAt ? 'использовано' : 'активно'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            onClick={async () => {
                              await navigator.clipboard.writeText(invitationLinks(item.code))
                              setCopied(item.id)
                            }}
                          >
                            {copied === item.id ? 'Скопировано' : 'Ссылка'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>
        </div>
      ) : null}

      {tab === 'roles' ? (
        <div className="stack">
          <Section
            title="Запросы дополнительных ролей"
            subtitle="Роль действует только после подтверждения администратором филиала"
          >
            {roleRequests.isLoading ? <p className="muted">Загрузка…</p> : null}
            {roleRequests.data && roleRequests.data.length === 0 ? <Empty>Запросов ролей нет.</Empty> : null}
            {roleRequests.data && roleRequests.data.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Пользователь</th>
                      <th>Текущая роль</th>
                      <th>Запрошена</th>
                      <th>Причина</th>
                      <th>Дата</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {roleRequests.data.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>
                            {item.user.firstName} {item.user.lastName}
                          </strong>
                          <p className="muted small">{item.user.email}</p>
                        </td>
                        <td>{roleLabels[item.user.role]}</td>
                        <td>{roleLabels[item.role]}</td>
                        <td className="muted small">{item.reason ?? '—'}</td>
                        <td className="muted small">{formatDateTime(item.requestedAt)}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="button button-small"
                              type="button"
                              disabled={decideRole.isPending}
                              onClick={() => decideRole.mutate({ id: item.id, approve: true })}
                            >
                              Подтвердить
                            </button>
                            <button
                              className="button button-ghost button-small"
                              type="button"
                              disabled={decideRole.isPending}
                              onClick={() => decideRole.mutate({ id: item.id, approve: false })}
                            >
                              Отклонить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>

          <Section
            title="Привязка родителей"
            subtitle="Выдайте одноразовый код ученику и подтвердите связь после ввода кода родителем"
          >
            <div className="form-grid">
              <label className="field">
                <span>Найти ученика</span>
                <input
                  value={studentSearch}
                  onChange={(event) => {
                    setStudentSearch(event.target.value)
                    setSelectedStudent(null)
                    setParentCode(null)
                  }}
                  placeholder="Имя или email, минимум 3 символа"
                />
              </label>
              <div className="field">
                <span>Выбранный ученик</span>
                <strong>{selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : 'не выбран'}</strong>
              </div>
              <button
                className="button"
                type="button"
                disabled={!selectedStudent || issueParentCode.isPending}
                onClick={() => selectedStudent && issueParentCode.mutate(selectedStudent.id)}
              >
                Выдать код привязки
              </button>
            </div>
            {studentResults.data?.items.length ? (
              <div className="row-actions">
                {studentResults.data.items.filter((item) => item.role === 'STUDENT').map((item) => (
                  <button
                    key={item.id}
                    className="button button-ghost button-small"
                    type="button"
                    onClick={() => setSelectedStudent(item)}
                  >
                    {item.firstName} {item.lastName} · {item.email}
                  </button>
                ))}
              </div>
            ) : null}
            {parentCode ? (
              <div className="alert alert-success">
                Код привязки: <strong className="code-block">{parentCode}</strong> — передайте ученику или родителю. Код действует 72 часа.
              </div>
            ) : null}

            {pendingParentLinks.isLoading ? <p className="muted">Загрузка очереди…</p> : null}
            {pendingParentLinks.data && pendingParentLinks.data.length === 0 ? (
              <Empty>Нет привязок, ожидающих подтверждения.</Empty>
            ) : null}
            {pendingParentLinks.data && pendingParentLinks.data.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Родитель</th>
                      <th>Ученик</th>
                      <th>Создана</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pendingParentLinks.data.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>
                            {item.parent.user.firstName} {item.parent.user.lastName}
                          </strong>
                          <p className="muted small">{item.parent.user.email}</p>
                        </td>
                        <td>
                          <strong>
                            {item.student.user.firstName} {item.student.user.lastName}
                          </strong>
                          <p className="muted small">{item.student.user.email}</p>
                        </td>
                        <td className="muted small">{formatDateTime(item.createdAt)}</td>
                        <td>
                          <button
                            className="button button-small"
                            type="button"
                            disabled={verifyParentLink.isPending}
                            onClick={() => verifyParentLink.mutate(item.id)}
                          >
                            Подтвердить привязку
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>
        </div>
      ) : null}

      {tab === 'access' ? (
        <Section
          title="Восстановление доступа"
          subtitle="Важная операция: подтвердите свой пароль. Пользователь получит временный пароль на email."
        >
          <div className="form-grid">
            <label className="field">
              <span>Поиск пользователя</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Имя, email или телефон"
              />
            </label>
          </div>

          {users.data && users.data.items.length > 0 ? (
            <ul className="people">
              {users.data.items.map((user) => (
                <li key={user.id}>
                  <span className="avatar avatar-sm" aria-hidden="true">
                    {user.firstName[0]}
                    {user.lastName[0]}
                  </span>
                  <span>
                    <strong>
                      {user.firstName} {user.lastName}
                    </strong>
                    <span className="muted small"> · {user.email} · {roleLabels[user.role as SessionRole]}</span>
                  </span>
                  <button className="button button-small button-ghost" type="button" onClick={() => setTarget(user)}>
                    Выбрать
                  </button>
                </li>
              ))}
            </ul>
          ) : users.data ? (
            <Empty>Пользователи не найдены.</Empty>
          ) : null}

          {target ? (
            <form
              className="stack-sm"
              onSubmit={(event) => {
                event.preventDefault()
                resetAccess.mutate()
              }}
            >
              <div className="alert">
                Выбран пользователь: <strong>{target.email}</strong>. Все его сессии будут завершены.
              </div>
              <label className="field">
                <span>Ваш пароль для подтверждения</span>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button className="button" type="submit" disabled={resetAccess.isPending}>
                {resetAccess.isPending ? 'Сбрасываем…' : 'Сбросить доступ'}
              </button>
            </form>
          ) : null}

          {resetResult ? <div className="alert">{resetResult}</div> : null}
        </Section>
      ) : null}
    </div>
  )
}
