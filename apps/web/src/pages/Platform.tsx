import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../api/client'
import {
  clearPlatformToken,
  getPlatformToken,
  platformApi,
  type BranchStatus,
  type CreateBranchInput,
  type PlatformBranch,
  type ProvisionResult,
} from '../api/platform'

const statusLabels: Record<BranchStatus, string> = {
  PROVISIONING: 'Создаётся',
  PROVISIONED: 'Создан, ждёт активации',
  ACTIVE: 'Активен',
  FAILED: 'Ошибка создания',
}

const statusClasses: Record<BranchStatus, string> = {
  PROVISIONING: 'badge badge-draft',
  PROVISIONED: 'badge badge-issued',
  ACTIVE: 'badge badge-active',
  FAILED: 'badge badge-blocked',
}

const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'

const emptyForm: CreateBranchInput = {
  name: '',
  domain: '',
  slug: '',
  adminEmail: '',
  adminName: '',
  logoUrl: '',
  description: '',
  contactPhone: '',
  contactEmail: '',
  contactAddress: '',
  directions: '',
}

export function PlatformPage() {
  const [token, setToken] = useState<string | null>(getPlatformToken())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!token) {
    const submit = async (event: React.FormEvent) => {
      event.preventDefault()
      setError(null)
      setLoading(true)
      try {
        await platformApi.login(email.trim(), password)
        setToken(getPlatformToken())
      } catch (loginError) {
        setError(errorMessage(loginError, 'Не удалось войти в консоль'))
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="login-page">
        <form className="card login-card" onSubmit={submit}>
          <div className="brand brand-large">
            <span className="brand-mark">IA</span>
            <div>
              <strong>IT Adis</strong>
              <span className="brand-sub">консоль главного администратора</span>
            </div>
          </div>
          <h1>Создание филиалов</h1>
          <p className="muted">
            Консоль управляет только реестром филиалов. Учебные данные, платежи и пользователи филиалов здесь недоступны.
          </p>
          <label className="field">
            <span>Email главного администратора</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <div className="alert alert-error">{error}</div> : null}
          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <PlatformConsole
      onLogout={() => {
        clearPlatformToken()
        setToken(null)
      }}
    />
  )
}

function PlatformConsole({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateBranchInput>(emptyForm)
  const [result, setResult] = useState<ProvisionResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const branches = useQuery({ queryKey: ['platform', 'branches'], queryFn: platformApi.branches })

  const create = useMutation({
    mutationFn: () => platformApi.create({ ...form, slug: form.slug?.trim() || undefined }),
    onSuccess: (data) => {
      setResult(data)
      setForm(emptyForm)
      setNotice(`Филиал «${data.branch.name}» создан. Проверьте результат и подтвердите активацию.`)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['platform', 'branches'] })
    },
    onError: (mutationError) => {
      setError(errorMessage(mutationError, 'Не удалось создать филиал'))
      setResult(null)
    },
  })

  const retry = useMutation({
    mutationFn: (branch: PlatformBranch) => platformApi.retry(branch.id),
    onSuccess: (data) => {
      setResult(data)
      setNotice(`Филиал «${data.branch.name}» создан повторно. Проверьте результат и подтвердите активацию.`)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['platform', 'branches'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось повторить создание филиала')),
  })

  const activate = useMutation({
    mutationFn: (branch: PlatformBranch) => platformApi.activate(branch.id),
    onSuccess: (branch) => {
      setNotice(`Филиал «${branch.name}» активирован и доступен на ${branch.domain}.`)
      setError(null)
      setResult((current) => (current && current.branch.id === branch.id ? { ...current, branch } : current))
      void queryClient.invalidateQueries({ queryKey: ['platform', 'branches'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось активировать филиал')),
  })

  const confirmActivation = (branch: PlatformBranch) => {
    if (
      window.confirm(
        `Активировать филиал «${branch.name}» на домене ${branch.domain}? После активации филиал начнёт обслуживать запросы.`,
      )
    ) {
      activate.mutate(branch)
    }
  }

  const setField = (field: keyof CreateBranchInput, value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  return (
    <div className="stack" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <header className="page-header">
        <div>
          <h1>Консоль ITadis</h1>
          <p className="muted">Создание изолированных филиалов: своя база данных, домен, файлы и администратор.</p>
        </div>
        <button className="button button-ghost" type="button" onClick={onLogout}>
          Выйти
        </button>
      </header>

      {notice ? <div className="alert">{notice}</div> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="card">
        <h2>Новый филиал</h2>
        <p className="muted">
          Система проверит домен, создаст отдельную PostgreSQL, применит миграции, подготовит хранилище и администратора.
        </p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <div className="grid two">
            <label className="field">
              <span>Название филиала</span>
              <input value={form.name} onChange={(event) => setField('name', event.target.value)} required />
            </label>
            <label className="field">
              <span>Домен</span>
              <input
                value={form.domain}
                onChange={(event) => setField('domain', event.target.value)}
                placeholder="osh.itadis.kg"
                required
              />
            </label>
            <label className="field">
              <span>Идентификатор (необязательно)</span>
              <input
                value={form.slug}
                onChange={(event) => setField('slug', event.target.value)}
                placeholder="osh"
              />
            </label>
            <label className="field">
              <span>Email администратора филиала</span>
              <input
                type="email"
                value={form.adminEmail}
                onChange={(event) => setField('adminEmail', event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Имя администратора филиала</span>
              <input value={form.adminName} onChange={(event) => setField('adminName', event.target.value)} required />
            </label>
          </div>

          <div className="grid two">
            <label className="field">
              <span>Логотип (URL)</span>
              <input
                value={form.logoUrl ?? ''}
                onChange={(event) => setField('logoUrl', event.target.value)}
                placeholder="https://osh.itadis.kg/logo.png"
              />
            </label>
            <label className="field">
              <span>Телефон филиала</span>
              <input
                value={form.contactPhone ?? ''}
                onChange={(event) => setField('contactPhone', event.target.value)}
                placeholder="+996 700 000 000"
              />
            </label>
            <label className="field">
              <span>Контактный email</span>
              <input
                type="email"
                value={form.contactEmail ?? ''}
                onChange={(event) => setField('contactEmail', event.target.value)}
                placeholder={form.adminEmail || 'osh@itadis.kg'}
              />
            </label>
            <label className="field">
              <span>Адрес</span>
              <input
                value={form.contactAddress ?? ''}
                onChange={(event) => setField('contactAddress', event.target.value)}
                placeholder="г. Ош, ул. Ленина, 1"
              />
            </label>
          </div>

          <label className="field">
            <span>Описание филиала</span>
            <textarea
              value={form.description ?? ''}
              onChange={(event) => setField('description', event.target.value)}
              rows={3}
              placeholder="Коротко о филиале, его атмосфере и подходе к обучению"
            />
          </label>

          <label className="field">
            <span>Образовательные направления (через запятую)</span>
            <input
              value={form.directions ?? ''}
              onChange={(event) => setField('directions', event.target.value)}
              placeholder="Программирование, подготовка к экзаменам, английский"
            />
          </label>
          <div>
            <button className="button" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Создаём филиал…' : 'Создать филиал'}
            </button>
          </div>
        </form>
      </section>

      {result ? (
        <section className="card">
          <h2>Результат создания: {result.branch.name}</h2>
          <p className="muted">
            Домен: <strong>{result.branch.domain}</strong>. Статус: {statusLabels[result.branch.status]}.
          </p>
          <ol>
            {result.steps.map((step) => (
              <li key={step.key}>
                {step.status === 'ok' ? '✓' : '✗'} {step.label} — <span className="muted">{step.detail}</span>
              </li>
            ))}
          </ol>
          <div className="alert">
            Учётная запись администратора филиала: <strong>{result.credentials.email}</strong>
            <br />
            Временный пароль (показывается один раз): <strong>{result.credentials.temporaryPassword}</strong>
            <br />
            Передайте данные администратору филиала по защищённому каналу.
          </div>
          {result.branch.status === 'PROVISIONED' ? (
            <button className="button" type="button" onClick={() => confirmActivation(result.branch)} disabled={activate.isPending}>
              {activate.isPending ? 'Активация…' : 'Подтвердить и активировать филиал'}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="card">
        <h2>Филиалы</h2>
        {branches.isLoading ? <p className="muted">Загрузка…</p> : null}
        {branches.isError ? <div className="alert alert-error">{errorMessage(branches.error)}</div> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Филиал</th>
                <th>Домен</th>
                <th>Администратор</th>
                <th>Статус</th>
                <th>Создан</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {branches.data?.map((branch) => (
                <tr key={branch.id}>
                  <td>
                    {branch.name}
                    {branch.steps ? (
                      <details>
                        <summary className="muted">Шаги создания</summary>
                        <ol>
                          {branch.steps.map((step) => (
                            <li key={step.key}>
                              {step.status === 'ok' ? '✓' : '✗'} {step.label}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </td>
                  <td>{branch.domain}</td>
                  <td>
                    {branch.adminEmail}
                    <br />
                    <span className="muted">{branch.adminName ?? ''}</span>
                  </td>
                  <td>
                    <span className={statusClasses[branch.status]}>{statusLabels[branch.status]}</span>
                    {branch.lastError ? <div className="muted">{branch.lastError}</div> : null}
                  </td>
                  <td>{formatDate(branch.createdAt)}</td>
                  <td>
                    {branch.status === 'PROVISIONED' ? (
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() => confirmActivation(branch)}
                        disabled={activate.isPending}
                      >
                        Активировать
                      </button>
                    ) : branch.status === 'FAILED' ? (
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Повторить создание филиала «${branch.name}»?`)) retry.mutate(branch)
                        }}
                        disabled={retry.isPending}
                      >
                        Повторить
                      </button>
                    ) : branch.status === 'ACTIVE' ? (
                      <span className="muted">{formatDate(branch.activatedAt)}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
