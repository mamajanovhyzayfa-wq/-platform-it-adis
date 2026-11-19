import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../api/admin'
import { errorMessage, saveSession } from '../api/client'

export function LoginPage() {
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await adminApi.login(identifier.trim(), password)
      if (result.user.role !== 'ADMIN') {
        setError('Панель доступна только администраторам платформы')
        return
      }
      saveSession(result.tokens.accessToken, {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
      })
      navigate('/', { replace: true })
    } catch (loginError) {
      setError(errorMessage(loginError, 'Неверный email или пароль'))
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
            <span className="brand-sub">администрирование</span>
          </div>
        </div>

        <h1>Вход в панель</h1>
        <p className="muted">Доступ только для аккаунтов с ролью администратора.</p>

        <label className="field">
          <span>Email или телефон</span>
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            required
          />
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
