import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { clearSession, switchSessionRole, type SessionRole } from '../api/client'
import { useSession } from '../hooks/useSession'
import { cabinetByRole } from '../app/navigation'
import { rolesApi } from '../api/roles'
import { portalApi } from '../api/portal'
import { localeLabels, locales, useI18n, type Locale, type MessageKey } from '../i18n'
import { applyPreferences, loadPreferences, type FontScale, type Preferences } from '../theme'
import { Icon, formatTime, type IconName } from '../components/ui'

type NavGroup = 'main' | 'learning' | 'people' | 'operations' | 'system'

interface NavItem {
  to: string
  labelKey: MessageKey
  group: NavGroup
  end?: boolean
  roles: SessionRole[]
  icon: IconName
}

const navGroupOrder: Array<{ id: NavGroup; labelKey: MessageKey }> = [
  { id: 'main', labelKey: 'nav.group.main' },
  { id: 'learning', labelKey: 'nav.group.learning' },
  { id: 'people', labelKey: 'nav.group.people' },
  { id: 'operations', labelKey: 'nav.group.operations' },
  { id: 'system', labelKey: 'nav.group.system' },
]

const navItems: NavItem[] = [
  { to: '/admin', labelKey: 'nav.overview', group: 'main', end: true, roles: ['ADMIN'], icon: 'grid' },
  { to: '/manager', labelKey: 'nav.manager', group: 'main', end: true, roles: ['MANAGER'], icon: 'grid' },
  { to: '/mentor', labelKey: 'nav.mentor', group: 'main', end: true, roles: ['TEACHER'], icon: 'grid' },
  { to: '/student', labelKey: 'nav.student', group: 'main', end: true, roles: ['STUDENT'], icon: 'grid' },
  { to: '/parent', labelKey: 'nav.parent', group: 'main', end: true, roles: ['PARENT'], icon: 'grid' },

  { to: '/courses', labelKey: 'nav.courses', group: 'learning', roles: ['ADMIN', 'MANAGER', 'TEACHER'], icon: 'book' },
  { to: '/library', labelKey: 'nav.library', group: 'learning', roles: ['STUDENT'], icon: 'book' },
  { to: '/files', labelKey: 'nav.files', group: 'learning', roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'], icon: 'folder' },
  { to: '/homework', labelKey: 'nav.homework', group: 'learning', roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT'], icon: 'check' },
  { to: '/tests', labelKey: 'nav.tests', group: 'learning', roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT'], icon: 'book' },
  { to: '/exams', labelKey: 'nav.exams', group: 'learning', roles: ['ADMIN', 'TEACHER', 'STUDENT'], icon: 'calendar' },
  { to: '/review', labelKey: 'nav.review', group: 'learning', roles: ['ADMIN', 'TEACHER'], icon: 'check' },
  { to: '/recordings', labelKey: 'nav.recordings', group: 'learning', roles: ['ADMIN', 'TEACHER', 'STUDENT'], icon: 'play' },
  { to: '/my-certificates', labelKey: 'nav.myCertificates', group: 'learning', roles: ['STUDENT'], icon: 'shield' },
  { to: '/coins#achievements', labelKey: 'nav.achievements', group: 'learning', roles: ['STUDENT', 'TEACHER'], icon: 'star' },
  { to: '/calendar', labelKey: 'nav.schedule', group: 'learning', roles: ['STUDENT'], icon: 'calendar' },
  { to: '/ai', labelKey: 'nav.ai', group: 'learning', roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT'], icon: 'spark' },

  { to: '/users', labelKey: 'nav.users', group: 'people', roles: ['ADMIN'], icon: 'users' },
  { to: '/access', labelKey: 'nav.access', group: 'people', roles: ['ADMIN'], icon: 'key' },
  { to: '/community', labelKey: 'nav.community', group: 'people', roles: ['ADMIN', 'MANAGER'], icon: 'users' },
  { to: '/community', labelKey: 'nav.messages', group: 'people', roles: ['TEACHER', 'STUDENT', 'PARENT'], icon: 'message' },
  { to: '/support', labelKey: 'nav.support', group: 'people', roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'], icon: 'message' },
  { to: '/notifications', labelKey: 'nav.notifications', group: 'people', roles: ['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT', 'PARENT'], icon: 'bell' },

  { to: '/schedule', labelKey: 'nav.schedule', group: 'operations', roles: ['ADMIN', 'MANAGER', 'TEACHER'], icon: 'calendar' },
  { to: '/grading', labelKey: 'nav.grading', group: 'operations', roles: ['ADMIN', 'MANAGER'], icon: 'trend' },
  { to: '/certificates', labelKey: 'nav.certificates', group: 'operations', roles: ['ADMIN'], icon: 'shield' },
  { to: '/finance', labelKey: 'nav.finance', group: 'operations', roles: ['ADMIN'], icon: 'wallet' },
  { to: '/cash', labelKey: 'nav.cash', group: 'operations', roles: ['ADMIN', 'MANAGER'], icon: 'wallet' },
  { to: '/reports', labelKey: 'nav.reports', group: 'operations', roles: ['ADMIN', 'MANAGER'], icon: 'grid' },
  { to: '/analytics', labelKey: 'nav.analytics', group: 'operations', roles: ['ADMIN', 'MANAGER', 'TEACHER'], icon: 'spark' },
  { to: '/analytics', labelKey: 'nav.results', group: 'operations', roles: ['STUDENT'], icon: 'spark' },
  { to: '/my-payments', labelKey: 'nav.myPayments', group: 'operations', roles: ['STUDENT', 'PARENT'], icon: 'wallet' },
  { to: '/coins', labelKey: 'nav.coins', group: 'operations', roles: ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'], icon: 'wallet' },
  { to: '/shop', labelKey: 'nav.shop', group: 'operations', roles: ['ADMIN', 'TEACHER', 'STUDENT'], icon: 'spark' },

  { to: '/backups', labelKey: 'nav.backups', group: 'system', roles: ['ADMIN'], icon: 'shield' },
  { to: '/integrations', labelKey: 'nav.integrations', group: 'system', roles: ['ADMIN'], icon: 'key' },
  { to: '/audit', labelKey: 'nav.audit', group: 'system', roles: ['ADMIN'], icon: 'clock' },
  { to: '/privacy-admin', labelKey: 'nav.privacyAdmin', group: 'system', roles: ['ADMIN'], icon: 'shield' },
  { to: '/security', labelKey: 'nav.security', group: 'system', roles: ['ADMIN', 'MANAGER', 'TEACHER'], icon: 'shield' },
  { to: '/security', labelKey: 'nav.profile', group: 'system', roles: ['STUDENT', 'PARENT'], icon: 'user' },
]

const fontLabels: Record<FontScale, string> = { sm: 'А', md: 'А', lg: 'А' }
const fontLabelKeys: Record<FontScale, MessageKey> = {
  sm: 'common.fontSmall',
  md: 'common.fontMedium',
  lg: 'common.fontLarge',
}

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const role: SessionRole = session?.role ?? 'STUDENT'
  const { t, locale, sectionLocale, setLocale, setSectionLocale, syncState } = useI18n()
  const myRoles = useQuery({
    queryKey: ['roles', 'me', session?.id],
    queryFn: rolesApi.me,
    enabled: Boolean(session),
    staleTime: 30_000,
    retry: false,
  })

  const [navOpen, setNavOpen] = useState(false)
  const [menu, setMenu] = useState<'search' | 'notifications' | 'user' | null>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences)
  const menusRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => applyPreferences(prefs), [prefs])
  useEffect(() => {
    setNavOpen(false)
    setMenu(null)
  }, [location.pathname])
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menusRef.current && !menusRef.current.contains(event.target as Node)) setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (!typing && (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'))) {
        event.preventDefault()
        searchRef.current?.focus()
        setMenu('search')
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: portalApi.notifications,
    refetchInterval: 60_000,
  })
  const search = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => portalApi.search(debounced),
    enabled: debounced.length >= 2,
  })

  const unread = notifications.data?.unread ?? 0
  // Навигация строится только по активной роли. Дополнительные роли доступны
  // через переключатель ниже, а не смешиваются в одном меню.
  const visibleNav = navItems.filter((item) => item.roles.includes(role))
  const visibleGroups = navGroupOrder
    .map((group) => ({ ...group, items: visibleNav.filter((item) => item.group === group.id) }))
    .filter((group) => group.items.length > 0)
  const approvedRoles: SessionRole[] = myRoles.data
    ? myRoles.data.roles.filter((item, index, list) => list.indexOf(item) === index)
    : [role]
  const roleLabel = t(`role.${role}` as MessageKey)

  // Если активная роль больше не подтверждена (отозвана администратором),
  // возвращаем пользователя в его основную роль.
  useEffect(() => {
    if (!myRoles.data || myRoles.data.roles.includes(role)) return
    const fallback = myRoles.data.primary
    switchSessionRole(fallback)
    navigate(cabinetByRole[fallback], { replace: true })
  }, [myRoles.data, role, navigate])

  const logout = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  const update = (patch: Partial<Preferences>) => setPrefs((current) => ({ ...current, ...patch }))

  const syncMessage =
    syncState === 'saving'
      ? t('common.saving')
      : syncState === 'saved'
        ? t('common.languageSaved')
        : syncState === 'local'
          ? t('common.languageLocalOnly')
          : syncState === 'error'
            ? t('common.languageError')
            : t('common.languageHint')

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('common.skip')}
      </a>

      {navOpen ? <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" /> : null}

      <aside className={navOpen ? 'sidebar sidebar-open' : 'sidebar'} aria-label={t('common.mainNavigation')}>
        <div className="sidebar-head">
          <Link className="brand" to="/">
            <span className="brand-mark">IA</span>
            <span>
              <strong>ITadis</strong>
              <span className="brand-sub">{t('app.subtitle')}</span>
            </span>
          </Link>
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label={t('common.closeMenu')}
          >
            <Icon name="close" />
          </button>
        </div>

        <nav className="nav" aria-label={t('common.mainNavigation')}>
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.id}>
              <span className="nav-group-label">{t(group.labelKey)}</span>
              {group.items.map((item) => (
                <NavLink
                  key={`${item.to}-${item.labelKey}`}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
                >
                  <Icon name={item.icon} /> <span>{t(item.labelKey)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {approvedRoles.length > 1 ? (
            <div className="role-switcher">
              <span className="menu-label">{t('common.activeRole')}</span>
              <div className="role-switcher-list" role="group" aria-label={t('common.activeRole')}>
                {approvedRoles.map((item) => (
                  <button
                    key={item}
                    className={item === role ? 'role-switch role-switch-active' : 'role-switch'}
                    type="button"
                    aria-pressed={item === role}
                    onClick={() => {
                      switchSessionRole(item)
                      navigate(cabinetByRole[item])
                    }}
                  >
                    {t(`role.${item}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="user">
            <strong>
              {session ? `${session.firstName} ${session.lastName}` : t('common.userFallback')}
            </strong>
            <span>{roleLabel}</span>
          </div>
          <button className="button button-ghost" type="button" onClick={logout}>
            <Icon name="logout" /> {t('common.logout')}
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button nav-toggle"
            type="button"
            onClick={() => setNavOpen((open) => !open)}
            aria-label={t('common.openMenu')}
            aria-expanded={navOpen}
          >
            <Icon name="menu" />
          </button>

          <div className="topbar-actions" ref={menusRef}>
            <div className="menu-wrap search-wrap">
              <form
                className="search"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (query.trim().length >= 2) {
                    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
                    setMenu(null)
                  }
                }}
              >
                <Icon name="search" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setMenu('search')
                  }}
                  onFocus={() => setMenu('search')}
                  placeholder={t('common.searchPlaceholder')}
                  aria-label={t('common.globalSearch')}
                  autoComplete="off"
                />
                <kbd aria-hidden="true">⌘ K</kbd>
              </form>

              {menu === 'search' && debounced.length >= 2 ? (
                <div className="menu search-menu" role="region" aria-label={t('common.searchResults')}>
                  {search.isLoading ? <p className="menu-note">{t('common.searching')}</p> : null}
                  {search.error ? <p className="menu-note">{t('common.searchUnavailable')}</p> : null}
                  {search.data && search.data.results.length === 0 ? (
                    <p className="menu-note">{t('common.nothingFound')}</p>
                  ) : null}
                  {search.data?.results.slice(0, 6).map((item) => (
                    <Link
                      key={`${item.type}-${item.id}`}
                      className="menu-item"
                      to={`/search?q=${encodeURIComponent(debounced)}`}
                      onClick={() => setMenu(null)}
                    >
                      <span className="menu-item-type">{item.type}</span>
                      <span className="menu-item-title">{item.title}</span>
                      {item.subtitle ? <span className="menu-item-sub">{item.subtitle}</span> : null}
                    </Link>
                  ))}
                  {search.data && search.data.results.length > 0 ? (
                    <Link className="menu-link" to={`/search?q=${encodeURIComponent(debounced)}`} onClick={() => setMenu(null)}>
                      {t('common.allResults')} →
                    </Link>
                  ) : null}
                  <p className="sr-only" aria-live="polite">
                    {search.data ? t('common.found', { count: search.data.results.length }) : ''}
                  </p>
                </div>
              ) : null}
            </div>

            <button
              className="icon-button accessibility-toggle"
              type="button"
              onClick={() => setMenu(menu === 'user' ? null : 'user')}
              aria-label={t('common.interfaceSettings')}
              title={t('common.interfaceSettings')}
              aria-expanded={menu === 'user'}
            >
              <Icon name="settings" />
            </button>

            <button
              className="icon-button theme-quick-toggle"
              type="button"
              onClick={() => update({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
              aria-label={t('common.theme')}
              title={t('common.theme')}
            >
              <Icon name={prefs.theme === 'dark' ? 'sun' : 'moon'} />
            </button>

            <div className="menu-wrap">
              <button
                className="icon-button"
                type="button"
                onClick={() => setMenu(menu === 'notifications' ? null : 'notifications')}
                aria-label={
                  unread
                    ? `${t('common.notifications')}, ${t('common.unread')}: ${unread}`
                    : t('common.notifications')
                }
                aria-expanded={menu === 'notifications'}
              >
                <Icon name="bell" />
                {unread > 0 ? <span className="badge-dot">{unread > 9 ? '9+' : unread}</span> : null}
              </button>

              {menu === 'notifications' ? (
                <div className="menu notifications-menu">
                  <div className="menu-head">
                    <strong>{t('common.notifications')}</strong>
                    {unread > 0 ? (
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => notifications.refetch()}
                      >
                        {t('common.refresh')}
                      </button>
                    ) : null}
                  </div>
                  {notifications.data?.items.length ? (
                    notifications.data.items.map((item) => (
                      <article key={item.id} className={item.readAt ? 'notice' : 'notice notice-unread'}>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                        <time className="muted small">{formatTime(item.createdAt)}</time>
                      </article>
                    ))
                  ) : (
                    <p className="menu-note">{t('common.noNotifications')}</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="menu-wrap">
              <button
                className="avatar-button"
                type="button"
                onClick={() => setMenu(menu === 'user' ? null : 'user')}
                aria-label={t('common.profileMenu')}
                aria-expanded={menu === 'user'}
              >
                <span className="avatar" aria-hidden="true">
                  {session ? `${session.firstName[0] ?? ''}${session.lastName[0] ?? ''}` : 'IA'}
                </span>
              </button>

              {menu === 'user' ? (
                <div className="menu user-menu">
                  <div className="menu-head">
                    <div>
                      <strong>{session ? `${session.firstName} ${session.lastName}` : t('common.userFallback')}</strong>
                      <p className="muted small">{session?.email}</p>
                    </div>
                  </div>

                  <div className="menu-group">
                    <span className="menu-label">{t('common.language')}</span>
                    <div className="segmented" role="group" aria-label={t('common.languageInterface')}>
                      {locales.map((value: Locale) => (
                        <button
                          key={value}
                          type="button"
                          className={locale === value ? 'segmented-item segmented-active' : 'segmented-item'}
                          aria-pressed={locale === value}
                          onClick={() => setLocale(value)}
                        >
                          {localeLabels[value]}
                        </button>
                      ))}
                    </div>
                    <p className="muted small language-note">{syncMessage}</p>
                  </div>

                  <div className="menu-group">
                    <span className="menu-label">{t('common.languageSection')}</span>
                    <div className="segmented" role="group" aria-label={t('common.languageSection')}>
                      <button
                        type="button"
                        className={!sectionLocale ? 'segmented-item segmented-active' : 'segmented-item'}
                        aria-pressed={!sectionLocale}
                        onClick={() => setSectionLocale(null)}
                      >
                        {t('common.languageInherit')}
                      </button>
                      {locales.map((value: Locale) => (
                        <button
                          key={value}
                          type="button"
                          className={sectionLocale === value ? 'segmented-item segmented-active' : 'segmented-item'}
                          aria-pressed={sectionLocale === value}
                          onClick={() => setSectionLocale(value)}
                        >
                          {localeLabels[value]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="menu-group">
                    <span className="menu-label">{t('common.theme')}</span>
                    <div className="segmented" role="group" aria-label={t('common.theme')}>
                      <button
                        type="button"
                        className={prefs.theme === 'light' ? 'segmented-item segmented-active' : 'segmented-item'}
                        aria-pressed={prefs.theme === 'light'}
                        onClick={() => update({ theme: 'light' })}
                      >
                        <Icon name="sun" size={15} /> {t('common.themeLight')}
                      </button>
                      <button
                        type="button"
                        className={prefs.theme === 'dark' ? 'segmented-item segmented-active' : 'segmented-item'}
                        aria-pressed={prefs.theme === 'dark'}
                        onClick={() => update({ theme: 'dark' })}
                      >
                        <Icon name="moon" size={15} /> {t('common.themeDark')}
                      </button>
                    </div>
                  </div>

                  <div className="menu-group">
                    <span className="menu-label">{t('common.fontSize')}</span>
                    <div className="segmented" role="group" aria-label={t('common.fontSize')}>
                      {(['sm', 'md', 'lg'] as FontScale[]).map((size) => (
                        <button
                          key={size}
                          type="button"
                          className={prefs.font === size ? 'segmented-item segmented-active' : 'segmented-item'}
                          aria-pressed={prefs.font === size}
                          aria-label={t(fontLabelKeys[size])}
                          title={t(fontLabelKeys[size])}
                          style={{ fontSize: size === 'sm' ? 13 : size === 'lg' ? 17 : 15 }}
                          onClick={() => update({ font: size })}
                        >
                          {fontLabels[size]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={prefs.contrast}
                      onChange={(event) => update({ contrast: event.target.checked })}
                    />
                    <span>{t('common.contrast')}</span>
                  </label>

                  <Link className="menu-link" to="/security" onClick={() => setMenu(null)}>
                    {t('common.security')}
                  </Link>
                  <Link className="menu-link" to="/privacy" onClick={() => setMenu(null)}>
                    {t('common.privacy')}
                  </Link>
                  <Link className="menu-link" to="/cookies" onClick={() => setMenu(null)}>
                    {t('common.cookies')}
                  </Link>
                  <button className="menu-link menu-danger" type="button" onClick={logout}>
                    {t('common.logoutAccount')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
