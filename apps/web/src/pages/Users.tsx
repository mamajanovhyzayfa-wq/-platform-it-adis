import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accessApi } from '../api/access'
import { adminApi, type Role } from '../api/admin'
import { errorMessage } from '../api/client'

const roles: Role[] = ['STUDENT', 'PARENT', 'TEACHER', 'MANAGER', 'ADMIN']
const roleLabels: Record<Role, string> = {
  STUDENT: 'Ученик',
  PARENT: 'Родитель',
  TEACHER: 'Преподаватель',
  MANAGER: 'Менеджер',
  ADMIN: 'Администратор',
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)
  const [adminPassword, setAdminPassword] = useState('')

  const users = useQuery({
    queryKey: ['admin-users', page, search, role],
    queryFn: () => adminApi.users({ page, limit: 20, search, role }),
  })

  const update = useMutation({
    mutationFn: async (payload: { id: string; role?: Role; isActive?: boolean }) => {
      if (!adminPassword.trim()) throw new Error('Введите свой пароль для подтверждения изменения роли или блокировки')
      await accessApi.stepUp(adminPassword.trim())
      return adminApi.updateUser(payload.id, { role: payload.role, isActive: payload.isActive })
    },
    onSuccess: () => {
      setNotice('Изменения сохранены и записаны в аудит')
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => setNotice(errorMessage(error, error instanceof Error ? error.message : undefined)),
  })

  const totalPages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.limit)) : 1

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <h1>Пользователи</h1>
          <p className="muted">Роли, блокировка и активность аккаунтов.</p>
        </div>
      </header>

      <div className="card stack-sm">
        <label className="field">
          <span>Подтверждение изменений</span>
          <input
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Ваш пароль"
          />
        </label>
        <p className="muted small">
          Смена роли и блокировка требуют повторного пароля. Пароль хранится только в памяти страницы.
        </p>
      </div>

      <div className="filters">
        <input
          placeholder="Поиск по имени, email, телефону"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <select
          value={role}
          onChange={(event) => {
            setRole(event.target.value as Role | '')
            setPage(1)
          }}
        >
          <option value="">Все роли</option>
          {roles.map((item) => (
            <option key={item} value={item}>
              {roleLabels[item]}
            </option>
          ))}
        </select>
      </div>

      {notice ? <div className="alert">{notice}</div> : null}
      {users.isLoading ? <div className="state">Загрузка…</div> : null}
      {users.error ? <div className="alert alert-error">{errorMessage(users.error)}</div> : null}

      {users.data ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Контакты</th>
                  <th>Роль</th>
                  <th>Курсы</th>
                  <th>Последний вход</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>
                        {user.firstName} {user.lastName}
                      </strong>
                      <div className="muted small">с {new Date(user.createdAt).toLocaleDateString('ru-RU')}</div>
                    </td>
                    <td>
                      <div>{user.email}</div>
                      <div className="muted small">{user.phone ?? '—'}</div>
                    </td>
                    <td>
                      <select
                        value={user.role}
                        disabled={update.isPending}
                        onChange={(event) => update.mutate({ id: user.id, role: event.target.value as Role })}
                      >
                        {roles.map((item) => (
                          <option key={item} value={item}>
                            {roleLabels[item]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{user.courses}</td>
                    <td className="small">
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('ru-RU') : 'не входил'}
                    </td>
                    <td>
                      <span className={user.isActive ? 'badge badge-active' : 'badge badge-blocked'}>
                        {user.isActive ? 'активен' : 'заблокирован'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button button-ghost"
                        type="button"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: user.id, isActive: !user.isActive })}
                      >
                        {user.isActive ? 'Заблокировать' : 'Разблокировать'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button className="button button-ghost" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Назад
            </button>
            <span className="muted">
              Страница {page} из {totalPages} · всего {users.data.total}
            </span>
            <button
              className="button button-ghost"
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Вперёд
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
