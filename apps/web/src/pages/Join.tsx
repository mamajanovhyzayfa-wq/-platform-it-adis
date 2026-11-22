import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { accessApi } from '../api/access'
import { errorMessage, saveSession, type SessionRole } from '../api/client'
import { cabinetByRole, roleLabels } from '../app/navigation'

/** Активация приглашения: ссылка вида /join?code=ABC12345. */
export function JoinPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const code = params.get('code') ?? ''
  const [form, setForm] = useState({
    code,
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    birthDate: '',
    guardianName: '',
    guardianPhone: '',
    guardianConsent: false,
    password: '',
    passwordRepeat: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const age = form.birthDate
    ? Math.floor((Date.now() - new Date(`${form.birthDate}T00:00:00Z`).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null
  const isMinor = age !== null && age < 18

  const preview = useQuery({
    queryKey: ['invitation', code],
    queryFn: () => accessApi.previewInvitation(code),
    enabled: Boolean(code),
    retry: false,
  })

  useEffect(() => {
    if (!preview.data) return
    setForm((current) => ({
      ...current,
      email: preview.data?.email ?? current.email,
      phone: preview.data?.phone ?? current.phone,
    }))
  }, [preview.data])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await accessApi.acceptInvitation({
        code: form.code.trim(),
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        ...(form.phone ? { phone: form.phone } : {}),
        birthDate: form.birthDate,
        ...(isMinor
          ? {
              guardianName: form.guardianName,
              guardianPhone: form.guardianPhone,
              guardianConsent: form.guardianConsent as true,
            }
          : {}),
        password: form.password,
        passwordRepeat: form.passwordRepeat,
      })
      if (!result.user || !result.tokens) throw new Error('Не удалось активировать приглашение')
      saveSession(result.tokens.accessToken, {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role as SessionRole,
        ...(result.user.locale ? { locale: result.user.locale } : {}),
      })
      navigate(cabinetByRole[result.user.role as SessionRole] ?? '/', { replace: true })
    } catch (joinError) {
      setError(errorMessage(joinError, 'Не удалось активировать приглашение'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell auth-shell-single">
      <main className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">Приглашение</span>
          <h2>Регистрация по приглашению</h2>

          {!code ? (
            <div className="alert alert-error">В ссылке нет кода приглашения. Запросите новую ссылку у администратора.</div>
          ) : preview.isLoading ? (
            <p className="muted">Проверяем приглашение…</p>
          ) : preview.error ? (
            <div className="alert alert-error">{errorMessage(preview.error, 'Приглашение недействительно')}</div>
          ) : (
            <p className="muted small">
              Вас пригласили как «{roleLabels[preview.data?.role ?? 'STUDENT']}». Приглашение действует до{' '}
              {new Date(preview.data?.expiresAt ?? Date.now()).toLocaleString('ru-RU')}.
            </p>
          )}

          {error ? <div className="alert alert-error">{error}</div> : null}

          <form className="stack-sm" onSubmit={submit}>
            <label className="field">
              <span>Код приглашения</span>
              <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Имя</span>
                <input
                  value={form.firstName}
                  onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>Фамилия</span>
                <input
                  value={form.lastName}
                  onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                  required
                />
              </label>
            </div>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                autoComplete="email"
                required
              />
            </label>
            <label className="field">
              <span>Телефон (необязательно)</span>
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </label>
            <label className="field">
              <span>Дата рождения</span>
              <input
                type="date"
                value={form.birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
                required
              />
            </label>
            {isMinor ? (
              <fieldset className="consent-fieldset">
                <legend>Законный представитель</legend>
                <label className="field">
                  <span>ФИО представителя</span>
                  <input
                    value={form.guardianName}
                    onChange={(event) => setForm({ ...form, guardianName: event.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>Телефон представителя</span>
                  <input
                    value={form.guardianPhone}
                    onChange={(event) => setForm({ ...form, guardianPhone: event.target.value })}
                    placeholder="+996700000000"
                    required
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.guardianConsent}
                    onChange={(event) => setForm({ ...form, guardianConsent: event.target.checked })}
                    required
                  />
                  <span>Подтверждаю согласие на обработку данных ребёнка и ознакомление с политикой.</span>
                </label>
              </fieldset>
            ) : null}
            <label className="field">
              <span>Пароль</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                autoComplete="new-password"
                required
              />
            </label>
            <label className="field">
              <span>Повторите пароль</span>
              <input
                type="password"
                value={form.passwordRepeat}
                onChange={(event) => setForm({ ...form, passwordRepeat: event.target.value })}
                autoComplete="new-password"
                required
              />
            </label>

            <button
              className="button"
              type="submit"
              disabled={
                loading ||
                !code ||
                !form.birthDate ||
                (isMinor && (!form.guardianName.trim() || !form.guardianPhone.trim() || !form.guardianConsent))
              }
            >
              {loading ? 'Создаём аккаунт…' : 'Активировать и войти'}
            </button>
          </form>

          <p className="muted small">
            Уже есть аккаунт? <Link to="/login">Войти</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
