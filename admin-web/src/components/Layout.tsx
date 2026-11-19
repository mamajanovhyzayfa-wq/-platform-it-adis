import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { clearSession, getSession } from '../api/client'

const links = [
  { to: '/', label: 'Обзор', end: true },
  { to: '/users', label: 'Пользователи' },
  { to: '/courses', label: 'Курсы' },
  { to: '/schedule', label: 'Расписание' },
  { to: '/review', label: 'Проверка работ' },
  { to: '/shop', label: 'Магазин' },
  { to: '/coins', label: 'IT Coins' },
  { to: '/audit', label: 'Аудит' },
]

export function Layout() {
  const navigate = useNavigate()
  const session = getSession()

  const logout = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">IA</span>
          <div>
            <strong>IT Adis</strong>
            <span className="brand-sub">администрирование</span>
          </div>
        </div>

        <nav className="nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user">
            {session ? `${session.firstName} ${session.lastName}` : 'Администратор'}
            <span>{session?.email ?? ''}</span>
          </div>
          <button className="button button-ghost" type="button" onClick={logout}>
            Выйти
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
