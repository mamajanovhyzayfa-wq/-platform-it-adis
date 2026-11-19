import { Link } from 'react-router-dom'
import { Brand, Icon } from './ui.jsx'

const navItems = [
  { href: '/#roles', label: 'Роли' },
  { href: '/#features', label: 'Возможности' },
  { href: '/#pricing', label: 'Тарифы' },
  { href: '/#coins', label: 'IT Coins' },
  { href: '/#stack', label: 'Технологии' },
]

export function Header({ onApply, isDark, onToggleTheme }) {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="brand-link" to="/" aria-label="ITadis — на главную">
          <Brand />
        </Link>

        <nav className="site-nav" aria-label="Разделы страницы">
          {navItems.map((item) => (
            <Link key={item.href} to={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <button type="button" className="button button-sm header-cta" onClick={onApply}>
            Подать заявку
          </button>

          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
            title={isDark ? 'Светлая тема' : 'Тёмная тема'}
          >
            <Icon name={isDark ? 'sun' : 'moon'} />
          </button>
        </div>
      </div>
    </header>
  )
}
