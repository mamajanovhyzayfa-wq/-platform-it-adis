import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../api/client'
import {
  integrationsApi,
  type IntegrationAdapterView,
  type IntegrationCategory,
  type IntegrationHealthStatus,
} from '../api/integrations'
import { Empty, PageHeader, Section, StatCard, formatDateTime } from '../components/ui'

const categoryOrder: IntegrationCategory[] = [
  'video',
  'identity',
  'email',
  'sms',
  'push',
  'calendar',
  'payments',
  'accounting',
  'ai',
  'storage',
]

const categoryLabels: Record<IntegrationCategory, string> = {
  video: 'Видеозанятия',
  identity: 'Вход через провайдеров',
  email: 'Почта',
  sms: 'SMS',
  push: 'Push-уведомления',
  calendar: 'Календари',
  payments: 'Платежи',
  accounting: 'Бухгалтерия',
  ai: 'AI-провайдеры',
  storage: 'Облачное хранилище',
}

const statusLabels: Record<IntegrationHealthStatus, string> = {
  ok: 'Работает',
  degraded: 'Ограничено',
  not_configured: 'Не настроено',
  unreachable: 'Недоступно',
}

const statusTone: Record<IntegrationHealthStatus, string> = {
  ok: 'badge-ok',
  degraded: 'badge-degraded',
  not_configured: 'badge-muted',
  unreachable: 'badge-failed',
}

const actionLabels: Record<string, string> = {
  health_check: 'проверка',
  connect: 'подключение',
  request: 'запрос',
  webhook: 'вебхук',
  config: 'настройка',
}

function adapterStatus(adapter: IntegrationAdapterView): IntegrationHealthStatus | null {
  if (!adapter.enabled) return null
  if (!adapter.configured) return 'not_configured'
  const stored = adapter.lastStatus
  if (stored === 'ok' || stored === 'degraded' || stored === 'not_configured' || stored === 'unreachable') return stored
  return null
}

function Status({ status }: { status: IntegrationHealthStatus | null }) {
  if (!status) return <span className="muted small">не проверялось</span>
  return <span className={`badge ${statusTone[status]}`}>{statusLabels[status]}</span>
}

export function IntegrationsPage() {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState('')
  const [eventStatus, setEventStatus] = useState<'' | 'OK' | 'FAILED' | 'SKIPPED'>('')
  const [page, setPage] = useState(1)

  const integrations = useQuery({ queryKey: ['integrations'], queryFn: integrationsApi.list })
  const events = useQuery({
    queryKey: ['integration-events', page, provider, eventStatus],
    queryFn: () =>
      integrationsApi.events({
        page,
        limit: 20,
        ...(provider.trim() ? { provider: provider.trim() } : {}),
        ...(eventStatus ? { status: eventStatus } : {}),
      }),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['integrations'] })
    void queryClient.invalidateQueries({ queryKey: ['integration-events'] })
  }

  const check = useMutation({ mutationFn: integrationsApi.check, onSuccess: refresh })
  const checkAll = useMutation({ mutationFn: integrationsApi.checkAll, onSuccess: refresh })
  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => integrationsApi.update(input.id, { enabled: input.enabled }),
    onSuccess: refresh,
  })

  const adapters = integrations.data?.adapters ?? []
  const grouped = useMemo(() => {
    const map = new Map<IntegrationCategory, IntegrationAdapterView[]>()
    for (const adapter of adapters) {
      const list = map.get(adapter.category) ?? []
      list.push(adapter)
      map.set(adapter.category, list)
    }
    return [...map.entries()].sort(
      ([left], [right]) => categoryOrder.indexOf(left) - categoryOrder.indexOf(right),
    )
  }, [adapters])

  const unreachable = adapters.filter((adapter) => adapterStatus(adapter) === 'unreachable').length
  const eventsTotalPages = events.data ? Math.max(1, events.data.pages) : 1
  const mutationError = check.error ?? checkAll.error ?? toggle.error

  return (
    <div className="stack">
      <PageHeader
        title="Интеграции"
        subtitle="Внешние сервисы филиала: видео, вход, почта, SMS, push, календари, платежи, бухгалтерия, AI и хранилище."
        actions={
          <>
            <button className="button button-ghost" type="button" onClick={refresh}>
              Обновить
            </button>
            <button
              className="button"
              type="button"
              disabled={checkAll.isPending}
              onClick={() => checkAll.mutate()}
            >
              {checkAll.isPending ? 'Проверяем…' : 'Проверить все'}
            </button>
          </>
        }
      />

      <div className="alert alert-info">
        Ключи и токены задаются только на сервере в переменных окружения (в production — секреты платформы).
        Панель показывает имена отсутствующих переменных и результат проверки, но никогда не значения.
      </div>

      {integrations.isLoading ? <div className="state">Загрузка интеграций…</div> : null}
      {integrations.error ? <div className="alert alert-error">{errorMessage(integrations.error)}</div> : null}
      {mutationError ? <div className="alert alert-error">{errorMessage(mutationError)}</div> : null}

      {integrations.data ? (
        <div className="stats">
          <StatCard label="Адаптеров" value={integrations.data.total} hint="всего в реестре" icon="spark" />
          <StatCard
            label="Настроено"
            value={integrations.data.configured}
            hint="готовы к работе"
            tone="success"
            icon="check"
          />
          <StatCard
            label="Недоступно"
            value={unreachable}
            hint="последняя проверка не прошла"
            tone={unreachable > 0 ? 'danger' : 'muted'}
            icon="shield"
          />
          <StatCard
            label="Проверено"
            value={adapters.filter((adapter) => adapter.lastCheckedAt).length}
            hint={formatDateTime(integrations.data.checkedAt)}
            tone="muted"
            icon="calendar"
          />
        </div>
      ) : null}

      {grouped.map(([category, list]) => (
        <Section key={category} title={categoryLabels[category]} subtitle={`${list.length} адаптер(ов)`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Интеграция</th>
                  <th>Переменные окружения</th>
                  <th>Статус</th>
                  <th>Последняя проверка</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((adapter) => (
                  <tr key={adapter.id}>
                    <td>
                      <strong>{adapter.name}</strong>
                      <div className="muted small">{adapter.description}</div>
                      <div className="muted small">
                        <code>{adapter.id}</code> ·{' '}
                        <a className="link" href={adapter.docsUrl} target="_blank" rel="noreferrer">
                          документация API
                        </a>
                      </div>
                    </td>
                    <td className="small">
                      {adapter.configured ? (
                        <span className="muted">настроено</span>
                      ) : (
                        <span>
                          не заданы: <code>{adapter.missingEnv.join(', ') || '—'}</code>
                        </span>
                      )}
                      <div className="muted small">
                        нужны: {adapter.envVars.map((name) => (
                          <code key={name} className="code-block">
                            {name}{' '}
                          </code>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Status status={adapterStatus(adapter)} />
                      {!adapter.enabled ? <div className="muted small">отключена в настройках</div> : null}
                      {adapter.lastMessage ? <div className="muted small">{adapter.lastMessage}</div> : null}
                    </td>
                    <td className="small">
                      {adapter.lastCheckedAt ? formatDateTime(adapter.lastCheckedAt) : '—'}
                      {check.data?.id === adapter.id ? (
                        <div className="muted small">
                          {check.data.latencyMs === null ? 'без сети' : `${check.data.latencyMs} мс`}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="button button-ghost"
                          type="button"
                          disabled={check.isPending}
                          onClick={() => check.mutate(adapter.id)}
                        >
                          {check.isPending && check.variables === adapter.id ? 'Проверяем…' : 'Проверить'}
                        </button>
                        <button
                          className="button button-ghost"
                          type="button"
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate({ id: adapter.id, enabled: !adapter.enabled })}
                        >
                          {adapter.enabled ? 'Отключить' : 'Включить'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}

      <Section
        title="Журнал событий"
        subtitle="Проверки, подключения, запросы и вебхуки. Секреты и тела запросов в журнал не пишутся."
      >
        <div className="filters">
          <select
            aria-label="Фильтр по статусу"
            value={eventStatus}
            onChange={(event) => {
              setEventStatus(event.target.value as '' | 'OK' | 'FAILED' | 'SKIPPED')
              setPage(1)
            }}
          >
            <option value="">Все статусы</option>
            <option value="OK">OK</option>
            <option value="FAILED">FAILED</option>
            <option value="SKIPPED">SKIPPED</option>
          </select>
          <input
            aria-label="Фильтр по провайдеру"
            placeholder="Провайдер, например accounting"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value)
              setPage(1)
            }}
          />
        </div>

        {events.isLoading ? <div className="state">Загрузка журнала…</div> : null}
        {events.error ? <div className="alert alert-error">{errorMessage(events.error)}</div> : null}

        {events.data && events.data.items.length === 0 ? <Empty>Событий пока нет</Empty> : null}

        {events.data && events.data.items.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Провайдер</th>
                    <th>Действие</th>
                    <th>Статус</th>
                    <th>Длительность</th>
                    <th>Сообщение</th>
                  </tr>
                </thead>
                <tbody>
                  {events.data.items.map((event) => (
                    <tr key={event.id}>
                      <td className="small">{formatDateTime(event.createdAt)}</td>
                      <td>
                        <code>{event.provider}</code>
                      </td>
                      <td className="small">{actionLabels[event.action] ?? event.action}</td>
                      <td>
                        <span
                          className={
                            event.status === 'OK'
                              ? 'badge badge-ok'
                              : event.status === 'FAILED'
                                ? 'badge badge-failed'
                                : 'badge badge-muted'
                          }
                        >
                          {event.status}
                        </span>
                      </td>
                      <td className="small">{event.durationMs === null ? '—' : `${event.durationMs} мс`}</td>
                      <td className="small">{event.message ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                className="button button-ghost"
                type="button"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Назад
              </button>
              <span className="muted">
                Страница {events.data.page} из {eventsTotalPages} · всего {events.data.total}
              </span>
              <button
                className="button button-ghost"
                type="button"
                disabled={page >= eventsTotalPages}
                onClick={() => setPage(page + 1)}
              >
                Вперёд
              </button>
            </div>
          </>
        ) : null}
      </Section>
    </div>
  )
}
