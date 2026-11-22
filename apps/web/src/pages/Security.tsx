import { useEffect, useState } from 'react'
import { accessApi } from '../api/access'
import { clearSession, errorMessage, getSession, http } from '../api/client'
import { PageHeader, Section } from '../components/ui'
import { Link } from 'react-router-dom'

/** Безопасность аккаунта: 2FA, повторное подтверждение пароля, привязка ребёнка. */
export function SecurityPage() {
  const session = getSession()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [secret, setSecret] = useState<string | null>(null)
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null)
  const [enableForm, setEnableForm] = useState({ password: '', code: '' })
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [disableView, setDisableView] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [busy, setBusy] = useState(false)

  const [stepUpPassword, setStepUpPassword] = useState('')

  const [childCode, setChildCode] = useState('')
  const [sessions, setSessions] = useState<
    Array<{ id: string; ip: string | null; userAgent: string | null; createdAt: string; expiresAt: string }>
  >([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  const loadSessions = async () => {
    setSessionsLoading(true)
    try {
      setSessions(await accessApi.sessions())
    } catch (sessionError) {
      setError(errorMessage(sessionError, 'Не удалось загрузить сессии'))
    } finally {
      setSessionsLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions()
  }, [])

  const run = async (action: () => Promise<string>) => {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      setNotice(await action())
    } catch (actionError) {
      setError(errorMessage(actionError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="Безопасность"
        subtitle="Двухфакторный вход, подтверждение важных операций и привязка ребёнка."
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {notice ? <div className="alert">{notice}</div> : null}

      <div className="grid two">
        <Section title="Двухфакторная аутентификация" subtitle="Код из приложения-аутентификатора при входе">
          {backupCodes ? (
            <div className="stack-sm">
              <p>Сохраните резервные коды: каждый срабатывает один раз.</p>
              <ul className="backup-codes">
                {backupCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ul>
              <button className="button button-ghost" type="button" onClick={() => setBackupCodes(null)}>
                Готово
              </button>
            </div>
          ) : secret ? (
            <form
              className="stack-sm"
              onSubmit={(event) => {
                event.preventDefault()
                run(async () => {
                  const result = await accessApi.enableTwoFactor(enableForm.password, enableForm.code)
                  setBackupCodes(result.backupCodes)
                  setSecret(null)
                  setOtpauthUrl(null)
                  setEnableForm({ password: '', code: '' })
                  return result.message
                })
              }}
            >
              <p className="muted small">Добавьте секрет в приложение и введите код подтверждения.</p>
              <label className="field">
                <span>Секрет</span>
                <input readOnly value={secret} />
              </label>
              {otpauthUrl ? <p className="code-block">otpauth: {otpauthUrl}</p> : null}
              <label className="field">
                <span>Пароль</span>
                <input
                  type="password"
                  value={enableForm.password}
                  onChange={(event) => setEnableForm({ ...enableForm, password: event.target.value })}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="field">
                <span>Код из приложения</span>
                <input
                  inputMode="numeric"
                  value={enableForm.code}
                  onChange={(event) => setEnableForm({ ...enableForm, code: event.target.value })}
                  required
                />
              </label>
              <button className="button" type="submit" disabled={busy}>
                Включить 2FA
              </button>
            </form>
          ) : disableView ? (
            <form
              className="stack-sm"
              onSubmit={(event) => {
                event.preventDefault()
                run(async () => {
                  await accessApi.disableTwoFactor(disablePassword)
                  setDisableView(false)
                  setDisablePassword('')
                  return 'Двухфакторная аутентификация отключена.'
                })
              }}
            >
              <p className="muted small">Для отключения подтвердите пароль.</p>
              <label className="field">
                <span>Пароль</span>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(event) => setDisablePassword(event.target.value)}
                  required
                />
              </label>
              <button className="button" type="submit" disabled={busy}>
                Отключить 2FA
              </button>
            </form>
          ) : (
            <div className="stack-sm">
              <p className="muted small">
                2FA защищает кабинет, даже если пароль попал к постороннему. Резервные коды выдаются при включении.
              </p>
              <div className="row-actions">
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await accessApi.setupTwoFactor()
                      setSecret(result.secret)
                      setOtpauthUrl(result.otpauthUrl)
                      return 'Секрет создан. Введите код из приложения.'
                    })
                  }
                >
                  Включить 2FA
                </button>
                <button className="button button-ghost" type="button" onClick={() => setDisableView(true)}>
                  Отключить 2FA
                </button>
              </div>
            </div>
          )}
        </Section>

        <Section title="Подтверждение важных операций" subtitle="Повторный ввод пароля действует 10 минут">
          <form
            className="stack-sm"
            onSubmit={(event) => {
              event.preventDefault()
              run(async () => {
                await accessApi.stepUp(stepUpPassword)
                setStepUpPassword('')
                return 'Личность подтверждена. Важные операции доступны 10 минут.'
              })
            }}
          >
            <p className="muted small">
              Сброс доступа другого пользователя и другие чувствительные действия требуют повторного пароля.
            </p>
            <label className="field">
              <span>Пароль</span>
              <input
                type="password"
                value={stepUpPassword}
                onChange={(event) => setStepUpPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button className="button" type="submit" disabled={busy}>
              Подтвердить
            </button>
          </form>
        </Section>
      </div>

      {session?.role === 'PARENT' ? (
        <Section title="Привязка ребёнка" subtitle="Код выдаёт администратор; связь подтверждается им же">
          <form
            className="stack-sm"
            onSubmit={(event) => {
              event.preventDefault()
              run(async () => {
                await http.post('/roles/parent-links/redeem', { code: childCode.trim() })
                setChildCode('')
                return 'Запрос отправлен. Администратор подтвердит привязку.'
              })
            }}
          >
            <label className="field">
              <span>Код привязки</span>
              <input value={childCode} onChange={(event) => setChildCode(event.target.value)} required />
            </label>
            <button className="button" type="submit" disabled={busy}>
              Привязать ребёнка
            </button>
          </form>
        </Section>
      ) : null}

      <Section title="Подозрительные входы" subtitle="Мы предупреждаем о новых устройствах и IP">
        <p className="muted">
          При входе с нового устройства или IP в кабинет приходит уведомление, а на email — письмо. Если вход был не
          ваш, смените пароль и сообщите администратору филиала.
        </p>
        <p className="muted small">
          Восстановление пароля доступно на <Link to="/login">странице входа</Link> по email или SMS.
        </p>
      </Section>

      <Section
        title="Активные сессии"
        subtitle="Завершите сессию, которую не узнаёте"
        action={
          <button className="button button-ghost button-small" type="button" disabled={sessionsLoading} onClick={() => void loadSessions()}>
            {sessionsLoading ? 'Обновляем…' : 'Обновить'}
          </button>
        }
      >
        {sessions.length === 0 ? <p className="muted">Активных сессий нет.</p> : null}
        {sessions.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Начало</th>
                  <th>IP</th>
                  <th>Устройство</th>
                  <th>Действует до</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{new Date(session.createdAt).toLocaleString('ru-RU')}</td>
                    <td className="mono small">{session.ip ?? 'неизвестен'}</td>
                    <td className="muted small">{session.userAgent ?? 'неизвестно'}</td>
                    <td className="muted small">{new Date(session.expiresAt).toLocaleString('ru-RU')}</td>
                    <td>
                      <button
                        className="button button-ghost button-small"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await accessApi.revokeSession(session.id)
                            await loadSessions()
                            return 'Сессия завершена.'
                          })
                        }
                      >
                        Завершить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <button
          className="button button-danger"
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm('Завершить все сессии? Потребуется войти заново.')) return
            void run(async () => {
              await accessApi.logoutAll()
              clearSession()
              window.location.assign('/login')
              return 'Все сессии завершены.'
            })
          }}
        >
          Завершить все сессии
        </button>
      </Section>
    </div>
  )
}
