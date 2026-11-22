import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { financeApi, type ProviderAccount } from '../../api/finance'

interface FormState {
  id?: string
  provider: 'freedompay' | 'elsom'
  label: string
  merchantId: string
  tenantId: string
  secretEnvVar: string
  baseUrl: string
  enabled: boolean
  isDefault: boolean
  testing: boolean
}

const emptyForm: FormState = {
  provider: 'freedompay',
  label: 'FreedomPay Кыргызстан',
  merchantId: '',
  tenantId: '',
  secretEnvVar: 'FREEDOMPAY_SECRET_KEY',
  baseUrl: 'https://api.freedompay.kg',
  enabled: true,
  isDefault: true,
  testing: false,
}

export function ProvidersTab() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [notice, setNotice] = useState<string | null>(null)
  const accounts = useQuery({ queryKey: ['finance-provider-accounts'], queryFn: financeApi.providerAccounts })

  const save = useMutation({
    mutationFn: () =>
      financeApi.saveProviderAccount({
        ...(form.id ? { id: form.id } : {}),
        provider: form.provider,
        label: form.label,
        merchantId: form.merchantId.trim(),
        ...(form.tenantId ? { tenantId: form.tenantId.trim() } : {}),
        secretEnvVar: form.secretEnvVar.trim(),
        ...(form.baseUrl ? { baseUrl: form.baseUrl.trim() } : {}),
        enabled: form.enabled,
        isDefault: form.isDefault,
        settings: { testing: form.testing },
      }),
    onSuccess: () => {
      setNotice('Платёжный аккаунт сохранён. Секрет должен быть задан в переменной окружения сервера.')
      setForm(emptyForm)
      void queryClient.invalidateQueries({ queryKey: ['finance-provider-accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['finance-overview'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const edit = (account: ProviderAccount) => {
    setForm({
      id: account.source === 'database' ? account.id : undefined,
      provider: account.provider,
      label: account.label,
      merchantId: account.merchantId,
      tenantId: account.tenantId ?? '',
      secretEnvVar: account.secretEnvVar,
      baseUrl: account.baseUrl ?? '',
      enabled: account.enabled,
      isDefault: account.isDefault,
      testing: account.settings?.testing === true,
    })
  }

  return (
    <div className="stack">
      {notice ? <div className="alert">{notice}</div> : null}
      <p className="muted">
        Каждый филиал использует собственный платёжный аккаунт. Секреты не хранятся в базе: укажите имя переменной
        окружения сервера. Поддерживаются только официально документированные методы FreedomPay и Elsom.
      </p>

      {accounts.error ? <div className="alert alert-error">{errorMessage(accounts.error)}</div> : null}
      {accounts.isLoading ? <div className="state">Загрузка платёжных аккаунтов…</div> : null}

      {accounts.data ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Провайдер</th>
                <th>Аккаунт</th>
                <th>Секрет</th>
                <th>Вебхук</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.data.items.map((account) => {
                const provider = accounts.data.providers.find((item) => item.value === account.provider)
                return (
                  <tr key={account.id}>
                    <td>
                      <strong>{account.label}</strong>
                      <div className="muted small">
                        <a href={provider?.docsUrl ?? account.docsUrl ?? '#'} target="_blank" rel="noreferrer">Документация</a>
                      </div>
                    </td>
                    <td>
                      <div>{account.merchantId || '—'}</div>
                      {account.tenantId ? <div className="muted small">tenant {account.tenantId}</div> : null}
                    </td>
                    <td>
                      <code>{account.secretEnvVar}</code>
                      <div className={`small ${account.secretConfigured ? 'amount-positive' : 'amount-negative'}`}>
                        {account.secretConfigured ? 'задан' : 'не задан'}
                      </div>
                    </td>
                    <td className="small">{provider?.webhookPath ?? '—'}</td>
                    <td>
                      {account.enabled ? <span className="badge badge-approved">Включён</span> : <span className="badge badge-rejected">Выключен</span>}
                      {account.isDefault ? <div className="muted small">по умолчанию</div> : null}
                      <div className="muted small">{account.source === 'env' ? 'из окружения' : 'в БД филиала'}</div>
                    </td>
                    <td>
                      <button className="button button-ghost button-small" type="button" onClick={() => edit(account)}>
                        Изменить
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <h2>{form.id ? 'Изменить аккаунт' : 'Добавить аккаунт'}</h2>
        <div className="form-grid">
          <label className="field">
            <span>Провайдер</span>
            <select
              value={form.provider}
              onChange={(event) => {
                const provider = event.target.value as FormState['provider']
                setForm({
                  ...form,
                  provider,
                  label: provider === 'freedompay' ? 'FreedomPay Кыргызстан' : 'Elsom / КИКБ',
                  secretEnvVar: provider === 'freedompay' ? 'FREEDOMPAY_SECRET_KEY' : 'ELSOM_PASSWORD',
                  baseUrl: provider === 'freedompay' ? 'https://api.freedompay.kg' : '',
                })
              }}
            >
              <option value="freedompay">FreedomPay Кыргызстан</option>
              <option value="elsom">Elsom / КИКБ</option>
            </select>
          </label>
          <label className="field">
            <span>Название</span>
            <input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} required />
          </label>
          <label className="field">
            <span>Merchant ID / PartnerCode</span>
            <input value={form.merchantId} onChange={(event) => setForm({ ...form, merchantId: event.target.value })} required />
          </label>
          <label className="field">
            <span>Tenant ID (Elsom)</span>
            <input value={form.tenantId} onChange={(event) => setForm({ ...form, tenantId: event.target.value })} />
          </label>
          <label className="field">
            <span>Переменная окружения с секретом</span>
            <input value={form.secretEnvVar} onChange={(event) => setForm({ ...form, secretEnvVar: event.target.value.toUpperCase() })} required />
          </label>
          <label className="field">
            <span>Базовый URL (Elsom — адрес партнёра)</span>
            <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
          </label>
          <label className="field">
            <span>Тестовый режим</span>
            <input type="checkbox" checked={form.testing} onChange={(event) => setForm({ ...form, testing: event.target.checked })} />
          </label>
          <label className="field">
            <span>Включён</span>
            <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          </label>
          <label className="field">
            <span>По умолчанию</span>
            <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} />
          </label>
        </div>
        <div className="row-actions">
          <button className="button" type="submit" disabled={save.isPending}>Сохранить аккаунт</button>
          {form.id ? <button className="button button-ghost" type="button" onClick={() => setForm(emptyForm)}>Отменить редактирование</button> : null}
        </div>
      </form>
    </div>
  )
}
