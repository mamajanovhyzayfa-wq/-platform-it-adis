import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { currentLocale, currentLocaleTag, statusLabel, translate } from '../i18n'

export type IconName =
  | 'search'
  | 'bell'
  | 'menu'
  | 'close'
  | 'logout'
  | 'sun'
  | 'moon'
  | 'grid'
  | 'users'
  | 'calendar'
  | 'check'
  | 'wallet'
  | 'shield'
  | 'key'
  | 'plus'
  | 'spark'
  | 'book'
  | 'folder'
  | 'settings'
  | 'arrow'
  | 'message'
  | 'clock'
  | 'star'
  | 'chevron'
  | 'command'
  | 'zap'
  | 'trend'
  | 'play'
  | 'user'

const paths: Record<IconName, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>,
  moon: <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  check: <path d="m4 12 6 6L20 6" />,
  wallet: <><path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h13" /><path d="M3 6v12a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4" /><path d="M17 12h5v4h-5a2 2 0 0 1 0-4Z" /></>,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m11 12 9-9M16 3l4 4M14 5l3 3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  spark: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
  folder: <><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 10h18" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  star: <path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9L12 3Z" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  command: <><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" /></>,
  zap: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />,
  trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  play: <path d="m9 6 9 6-9 6V6Z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  tone = 'primary',
  icon,
}: {
  label: string
  value: ReactNode
  hint?: string
  trend?: string
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'muted'
  icon?: IconName
}) {
  return (
    <article className={`stat stat-${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon ? (
          <span className="stat-icon" aria-hidden="true">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>
      <div className="stat-value-row">
        <strong>{value}</strong>
        {trend ? <span className="stat-trend">{trend}</span> : null}
      </div>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </article>
  )
}

export function ProgressRing({
  value,
  label,
  size = 'md',
}: {
  value: number
  label?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const safe = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      className={`progress-ring progress-ring-${size}`}
      style={{ '--ring-value': `${safe * 3.6}deg` } as CSSProperties}
      role="progressbar"
      aria-valuenow={safe}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? translate(currentLocale(), 'common.progress')}
    >
      <div className="progress-ring-inner">
        <strong>{safe}%</strong>
        {label ? <span>{label}</span> : null}
      </div>
    </div>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials || 'IA'}
    </span>
  )
}

export function QuickTile({
  to,
  icon,
  label,
  hint,
  tone = 'primary',
}: {
  to: string
  icon: IconName
  label: string
  hint?: string
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'muted'
}) {
  return (
    <Link className={`quick-tile quick-tile-${tone}`} to={to}>
      <span className="quick-tile-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="quick-tile-copy">
        <strong>{label}</strong>
        {hint ? <span>{hint}</span> : null}
      </span>
      <Icon name="arrow" size={16} />
    </Link>
  )
}

export function Section({
  title,
  subtitle,
  action,
  children,
  id,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  id?: string
  className?: string
}) {
  return (
    <section className={className ? `card ${className}` : 'card'} id={id}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="muted small">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const safe = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="progress">
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={safe}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? translate(currentLocale(), 'common.progress')}
      >
        <div className="progress-fill" style={{ width: `${safe}%` }} />
      </div>
      <span className="progress-value">{safe}%</span>
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{statusLabel(status)}</span>
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return translate(currentLocale(), 'common.notSet')
  return new Intl.DateTimeFormat(currentLocaleTag(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function formatDay(value: string | Date): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(value))
}

export function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function formatFullDate(value: string | Date): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), { dateStyle: 'full' }).format(new Date(value))
}

export function formatKgs(value: number): string {
  const locale = currentLocale()
  return `${new Intl.NumberFormat(currentLocaleTag(), { maximumFractionDigits: 0 }).format(value)} ${translate(locale, 'common.currency')}`
}

export function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 6) return translate(currentLocale(), 'greeting.night')
  if (hour < 12) return translate(currentLocale(), 'greeting.morning')
  if (hour < 18) return translate(currentLocale(), 'greeting.day')
  return translate(currentLocale(), 'greeting.evening')
}
