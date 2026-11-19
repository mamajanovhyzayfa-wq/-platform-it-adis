import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { roles } from '../data.js'
import { Brand, Icon } from '../components/ui.jsx'

/**
 * Заглушка входа в кабинет: показывает выбранную роль и объясняет, где проходит
 * настоящая авторизация (мобильное приложение и админ-панель).
 */
export function LoginPage() {
  const [params] = useSearchParams()
  const role = roles.find((item) => item.slug === params.get('role'))
  const [notice, setNotice] = useState(false)

  return (
    <main id="main" className="login-page">
      <div className="container login-inner">
        <div className="card login-card">
          <Brand size={36} />

          <div className="login-head">
            <h1>Вход в кабинет</h1>
            {role ? (
              <span className="login-role">
                <Icon name={role.icon} className="login-role-icon" />
                {role.title}
              </span>
            ) : (
              <p className="muted">Кабинет ученика, преподавателя, родителя или менеджера.</p>
            )}
          </div>

          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault()
              setNotice(true)
            }}
          >
            <label className="field">
              <span>Email или телефон</span>
              <input placeholder="name@example.com" autoComplete="username" required />
            </label>
            <label className="field">
              <span>Пароль</span>
              <input type="password" placeholder="••••••••" autoComplete="current-password" required />
            </label>
            <button type="submit" className="button">
              Войти
            </button>
          </form>

          {notice ? (
            <p className="login-notice" role="status">
              Это демонстрационная заглушка: реальный вход выполняется в мобильном приложении ITadis и в
              административной панели. API авторизации уже работает — подключение формы выполним на следующем этапе.
            </p>
          ) : null}

          <div className="login-links">
            <Link to="/#roles">← Все роли</Link>
            <Link to="/#pricing">Тарифы</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
