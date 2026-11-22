import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { portalApi } from '../api/portal'
import { useSession } from '../hooks/useSession'
import { roleLabels } from '../app/navigation'
import { Empty, Icon, PageHeader, type IconName } from '../components/ui'
import { useI18n } from '../i18n'

function iconForType(type: string): IconName {
  const normalized = type.toLowerCase()
  if (normalized.includes('урок') || normalized.includes('lesson')) return 'play'
  if (normalized.includes('курс') || normalized.includes('course')) return 'book'
  if (normalized.includes('учен') || normalized.includes('student') || normalized.includes('user')) return 'users'
  if (normalized.includes('задан') || normalized.includes('homework')) return 'check'
  if (normalized.includes('групп') || normalized.includes('group')) return 'grid'
  if (normalized.includes('платеж') || normalized.includes('payment')) return 'wallet'
  return 'folder'
}

/** Глобальный поиск: результаты ограничены данными текущей роли на сервере. */
export function SearchPage() {
  const { t } = useI18n()
  const session = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const query = (params.get('q') ?? '').trim()
  const [input, setInput] = useState(query)
  const [type, setType] = useState<string>('ALL')

  useEffect(() => {
    setInput(query)
    setType('ALL')
  }, [query])

  const search = useQuery({
    queryKey: ['search-page', query],
    queryFn: () => portalApi.search(query),
    enabled: query.length >= 2,
  })

  const types = useMemo(() => {
    const unique = new Set((search.data?.results ?? []).map((item) => item.type))
    return ['ALL', ...Array.from(unique)]
  }, [search.data])

  const results = useMemo(
    () => (search.data?.results ?? []).filter((item) => type === 'ALL' || item.type === type),
    [search.data, type],
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = input.trim()
    if (next.length >= 2) navigate(`/search?q=${encodeURIComponent(next)}`)
  }

  return (
    <div className="stack search-page">
      <PageHeader
        title={t('common.globalSearch')}
        subtitle={
          query
            ? `${t('common.found', { count: search.data?.results.length ?? 0 })} · «${query}»`
            : t('dashboard.searchStart')
        }
        actions={
          <span className="search-scope">
            <Icon name="shield" size={15} />
            {session ? roleLabels[session.role] : t('common.userFallback')}
          </span>
        }
      />

      <form className="search-hero-form" role="search" onSubmit={submit}>
        <Icon name="search" size={20} />
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('common.searchPlaceholder')}
          aria-label={t('common.globalSearch')}
          autoFocus
        />
        <button className="button" type="submit" disabled={input.trim().length < 2}>
          {t('common.search')}
        </button>
      </form>

      {query.length < 2 ? (
        <div className="card search-empty">
          <Empty>{t('dashboard.searchEmpty')}</Empty>
        </div>
      ) : search.isLoading ? (
        <div className="state">{t('common.searching')}</div>
      ) : search.error ? (
        <div className="alert alert-error">{t('common.searchUnavailable')}</div>
      ) : !search.data || search.data.results.length === 0 ? (
        <div className="card search-empty">
          <span className="search-empty-icon" aria-hidden="true">
            <Icon name="search" size={26} />
          </span>
          <h2>{t('common.nothingFound')}</h2>
          <p className="muted">{t('dashboard.searchNoResults')}</p>
        </div>
      ) : (
        <>
          <div className="filter-chips" role="group" aria-label={t('dashboard.searchFilters')}>
            {types.map((item) => (
              <button
                key={item}
                className={type === item ? 'filter-chip filter-chip-active' : 'filter-chip'}
                type="button"
                aria-pressed={type === item}
                onClick={() => setType(item)}
              >
                {item === 'ALL' ? t('dashboard.allResults') : item}
                <span>{item === 'ALL' ? search.data.results.length : search.data.results.filter((result) => result.type === item).length}</span>
              </button>
            ))}
          </div>

          <div className="search-result-grid">
            {results.map((item) => (
              <Link key={`${item.type}-${item.id}`} className="search-result-card" to={item.href}>
                <span className="search-result-icon" aria-hidden="true">
                  <Icon name={iconForType(item.type)} size={20} />
                </span>
                <div>
                  <span className="eyebrow">{item.type}</span>
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span className="muted small">{item.subtitle}</span> : null}
                </div>
                <Icon name="arrow" size={16} />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
