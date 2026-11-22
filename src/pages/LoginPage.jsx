import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { roles } from '../data.js'
import { cabinetUrl } from '../config.js'
import { Brand, Icon } from '../components/ui.jsx'

/**
 * Вход в кабинет живёт в полноценном веб-приложении (apps/web).
 * Лендинг лишь передаёт выбранную роль и открывает его страницу входа.
 */
export function LoginPage() {
  const [params] = useSearchParams()
  const role = roles.find((item) => item.slug === params.get('role'))
  const loginUrl = `${cabinetUrl('/login')}${role ? `?role=${encodeURIComponent(role.slug)}` : ''}`

  useEffect(() => {
    window.location.replace(loginUrl)
  }, [loginUrl])

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
              <p className="muted">Кабинет ученика, наставника, родителя, менеджера или администратора филиала.</p>
            )}
          </div>

          <p className="login-status" role="status">
            Открываем веб-кабинет ITadis…
          </p>

          <a className="button" href={loginUrl}>
            Открыть кабинет
          </a>

          <div className="login-links">
            <Link to="/#roles">← Все роли</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
