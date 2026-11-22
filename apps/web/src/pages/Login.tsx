import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { accessApi, type LoginResult } from '../api/access'
import { appUrl, errorCode, errorMessage, http, saveSession, type SessionRole } from '../api/client'
import { localeLabels, locales, useI18n, type Locale } from '../i18n'
import { cabinetByRole } from '../app/navigation'
import { oauthConfigured, signInWithApple, signInWithGoogle } from '../oauth'

interface BranchDirection {
  title: string
  description?: string
}

interface BranchInfo {
  name: string
  isPrimary?: boolean
  mainSiteUrl?: string | null
  logoUrl: string | null
  description: string | null
  contacts: { phone?: string; email?: string; address?: string } | null
  directions: BranchDirection[] | null
}

type Mode = 'login' | 'register' | 'recovery'

const emptyRegistration = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  password: '',
  passwordRepeat: '',
  role: 'STUDENT' as 'STUDENT' | 'TEACHER' | 'PARENT',
  message: '',
  birthDate: '',
  guardianName: '',
  guardianPhone: '',
  guardianConsent: false,
  acceptTerms: false,
  acceptPrivacy: false,
  acceptDataProcessing: false,
  acceptMarketing: false,
}

export function LoginPage({ initialMode = 'login' }: { initialMode?: Mode }) {
  const navigate = useNavigate()
  const { t, locale, setLocale } = useI18n()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [branch, setBranch] = useState<BranchInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const directions: BranchDirection[] = branch?.directions?.length
    ? branch.directions
    : [
        { title: t('login.directionIt') },
        { title: t('login.directionExams') },
        { title: t('login.directionLanguages') },
      ]
  const contactLabels: Record<string, string> = {
    phone: t('login.contactPhone'),
    email: t('login.contactEmail'),
    address: t('login.contactAddress'),
  }

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactor, setTwoFactor] = useState<{ challengeToken: string; code: string } | null>(null)
  const [captcha, setCaptcha] = useState<{ id: string; question: string; answer: string } | null>(null)

  const [registration, setRegistration] = useState(emptyRegistration)
  const registrationAge = registration.birthDate
    ? Math.floor((Date.now() - new Date(`${registration.birthDate}T00:00:00Z`).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null
  const registrationIsMinor = registrationAge !== null && registrationAge < 18

  const [recoveryStep, setRecoveryStep] = useState<1 | 2>(1)
  const [recoveryChannel, setRecoveryChannel] = useState<'email' | 'sms'>('email')
  const [recovery, setRecovery] = useState({ code: '', password: '', passwordRepeat: '' })

  useEffect(() => {
    http
      .get<BranchInfo>('/branding')
      .then((response) => setBranch(response.data))
      .catch(() => setBranch(null))
  }, [])

  useEffect(() => {
    if (!branch?.name) return undefined
    const previous = document.title
    document.title = `${branch.name} — вход`
    return () => {
      document.title = previous
    }
  }, [branch?.name])

  const finish = (result: LoginResult) => {
    if (!result.user || !result.tokens) {
      setError(t('login.errorGeneric'))
      return
    }
    saveSession(result.tokens.accessToken, {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role as SessionRole,
      ...(result.user.locale ? { locale: result.user.locale } : {}),
    })
    navigate(cabinetByRole[result.user.role as SessionRole] ?? '/forbidden', { replace: true })
  }

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      if (captcha && !captcha.answer.trim()) {
        setError(t('login.errorCaptchaEmpty'))
        return
      }
      const result = await accessApi.login(
        identifier.trim(),
        password,
        captcha ? { captchaId: captcha.id, captchaAnswer: captcha.answer.trim() } : undefined,
      )
      if (result.twoFactorRequired && result.challengeToken) {
        setTwoFactor({ challengeToken: result.challengeToken, code: '' })
        return
      }
      finish(result)
    } catch (loginError) {
      const code = errorCode(loginError)
      if (code === 'CAPTCHA_REQUIRED') {
        const challenge = await accessApi.captcha().catch(() => null)
        setCaptcha(challenge ? { ...challenge, answer: '' } : null)
        setError(t('login.errorCaptchaRequired'))
      } else if (code === 'INVALID_CREDENTIALS' || code === 'UNAUTHORIZED') {
        setError(t('login.errorInvalid'))
      } else {
        setError(errorMessage(loginError, t('login.errorInvalid')))
      }
    } finally {
      setLoading(false)
    }
  }

  const submitTwoFactor = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!twoFactor) return
    setError(null)
    setLoading(true)
    try {
      finish(await accessApi.verifyTwoFactor(twoFactor.challengeToken, twoFactor.code.trim()))
    } catch (codeError) {
      const code = errorCode(codeError)
      setError(code === 'INVALID_TWO_FACTOR' || code === 'UNAUTHORIZED' ? t('login.errorTwoFactor') : errorMessage(codeError, t('login.errorTwoFactor')))
    } finally {
      setLoading(false)
    }
  }

  const submitRegistration = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      await accessApi.register({
        firstName: registration.firstName,
        lastName: registration.lastName,
        email: registration.email,
        ...(registration.phone ? { phone: registration.phone } : {}),
        password: registration.password,
        passwordRepeat: registration.passwordRepeat,
        role: registration.role,
        ...(registration.message ? { message: registration.message } : {}),
        birthDate: registration.birthDate,
        ...(registrationIsMinor
          ? {
              guardianName: registration.guardianName,
              guardianPhone: registration.guardianPhone,
              guardianConsent: registration.guardianConsent as true,
            }
          : {}),
        acceptTerms: registration.acceptTerms as true,
        acceptPrivacy: registration.acceptPrivacy as true,
        acceptDataProcessing: registration.acceptDataProcessing as true,
        acceptMarketing: registration.acceptMarketing,
      })
      setNotice(t('login.registerSuccess'))
      setRegistration(emptyRegistration)
      setMode('login')
    } catch (registrationError) {
      setError(errorMessage(registrationError, t('login.errorRegister')))
    } finally {
      setLoading(false)
    }
  }

  const requestRecovery = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await accessApi.requestRecovery(identifier.trim())
      setRecoveryChannel(result.channel)
      setRecoveryStep(2)
      setNotice(result.channel === 'sms' ? t('login.recoverySentSms') : t('login.recoverySentEmail'))
    } catch (recoveryError) {
      setError(errorMessage(recoveryError, t('login.errorRecovery')))
    } finally {
      setLoading(false)
    }
  }

  const confirmRecovery = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await accessApi.confirmRecovery({
        identifier: identifier.trim(),
        code: recovery.code.trim(),
        password: recovery.password,
        passwordRepeat: recovery.passwordRepeat,
      })
      setRecoveryStep(1)
      setRecovery({ code: '', password: '', passwordRepeat: '' })
      setPassword('')
      setMode('login')
      setNotice(t('login.recoveryChanged'))
    } catch (recoveryError) {
      setError(errorMessage(recoveryError, t('login.errorChange')))
    } finally {
      setLoading(false)
    }
  }

  const oauth = async (provider: 'google' | 'apple') => {
    setError(null)
    setLoading(true)
    try {
      const idToken = provider === 'google' ? await signInWithGoogle() : await signInWithApple()
      const result = await accessApi.oauthLogin(provider, idToken)
      if (result.registrationRequired) {
        setRegistration((current) => ({
          ...current,
          email: result.email ?? '',
          firstName: result.firstName ?? '',
          lastName: result.lastName ?? '',
        }))
        setMode('register')
        setNotice(t('login.oauthRegisterNotice'))
        return
      }
      // Если у аккаунта включена 2FA, OAuth-вход проходит тот же второй фактор.
      if (result.twoFactorRequired && result.challengeToken) {
        setTwoFactor({ challengeToken: result.challengeToken, code: '' })
        return
      }
      finish(result)
    } catch (providerError) {
      setError(errorMessage(providerError, t('login.errorOauth')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="brand brand-large">
          {branch?.logoUrl ? (
            <img
              className="branch-logo"
              src={branch.logoUrl}
              alt={branch?.name ? `Логотип ${branch.name}` : ''}
              width={48}
              height={48}
            />
          ) : (
            <span className="brand-mark">IA</span>
          )}
          <span>
            <strong>{branch?.name ?? 'ITadis'}</strong>
            <span className="brand-sub">{t('app.subtitle')}</span>
          </span>
        </div>

        <div className="auth-aside-body">
          <h1>{t('login.asideTitle')}</h1>
          <p>{branch?.description ?? t('login.asideFallback')}</p>

          <div>
            <span className="auth-aside-label">{t('login.directionsTitle')}</span>
            <div className="chip-row">
              {directions.map((direction) => (
                <span className="chip" key={direction.title} title={direction.description}>
                  {direction.title}
                </span>
              ))}
            </div>
          </div>

          {branch?.contacts && Object.values(branch.contacts).some(Boolean) ? (
            <dl className="contact-list">
              {Object.entries(branch.contacts)
                .filter(([, value]) => Boolean(value))
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{contactLabels[key] ?? key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <p className="muted small">{t('login.contactsFallback')}</p>
          )}
        </div>

        {branch?.mainSiteUrl ? (
          <a className="auth-back" href={branch.mainSiteUrl}>
            ← {t('login.backSite')}
          </a>
        ) : branch?.isPrimary ? (
          <a className="auth-back" href="/">
            ← {t('login.backSite')}
          </a>
        ) : null}
      </aside>

      <main className="auth-panel">
        <div className="auth-lang" role="group" aria-label={t('common.languageInterface')}>
          {locales.map((value: Locale) => (
            <button
              key={value}
              type="button"
              className={locale === value ? 'auth-lang-item auth-lang-active' : 'auth-lang-item'}
              aria-pressed={locale === value}
              onClick={() => setLocale(value)}
            >
              {localeLabels[value]}
            </button>
          ))}
        </div>

        <div className="auth-card">
          {twoFactor ? (
            <form className="stack-sm" onSubmit={submitTwoFactor}>
              <span className="eyebrow">{t('login.twoFactorEyebrow')}</span>
              <h2>{t('login.twoFactorTitle')}</h2>
              <p className="muted">{t('login.twoFactorHint')}</p>
              <label className="field">
                <span>{t('login.twoFactorCode')}</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactor.code}
                  onChange={(event) => setTwoFactor({ ...twoFactor, code: event.target.value })}
                  autoFocus
                  required
                />
              </label>
              {error ? <div className="alert alert-error">{error}</div> : null}
              <button className="button" type="submit" disabled={loading}>
                {loading ? t('login.twoFactorChecking') : t('login.twoFactorSubmit')}
              </button>
              <button className="link-button" type="button" onClick={() => setTwoFactor(null)}>
                {t('login.twoFactorBack')}
              </button>
            </form>
          ) : (
            <>
              <div className="auth-tabs" role="tablist" aria-label={t('login.tabsAria')}>
                {(
                  [
                    ['login', t('login.tabLogin')],
                    ['register', t('login.tabRegister')],
                    ['recovery', t('login.tabRecovery')],
                  ] as Array<[Mode, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={mode === value}
                    className={mode === value ? 'auth-tab auth-tab-active' : 'auth-tab'}
                    onClick={() => {
                      setMode(value)
                      setError(null)
                      setNotice(null)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {notice ? <div className="alert">{notice}</div> : null}
              {error ? <div className="alert alert-error">{error}</div> : null}

              {mode === 'login' ? (
                <form className="stack-sm" onSubmit={submitLogin}>
                  <h2>{t('login.title')}</h2>
                  <p className="muted small">{t('login.subtitle')}</p>

                  <label className="field">
                    <span>{t('login.identifier')}</span>
                    <input
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      autoComplete="username"
                      required
                    />
                  </label>

                  <label className="field">
                    <span>{t('login.password')}</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </label>

                  {captcha ? (
                    <div className="captcha-box">
                      <span>{captcha.question}</span>
                      <input
                        inputMode="numeric"
                        value={captcha.answer}
                        onChange={(event) => setCaptcha((current) => (current ? { ...current, answer: event.target.value } : current))}
                        placeholder={t('login.captchaAnswer')}
                        required
                      />
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => void accessApi.captcha().then((challenge) => setCaptcha({ ...challenge, answer: '' }))}
                      >
                        {t('login.anotherQuestion')}
                      </button>
                    </div>
                  ) : null}

                  <button className="button" type="submit" disabled={loading}>
                    {loading ? t('login.submitting') : t('login.submit')}
                  </button>

                  <button className="link-button" type="button" onClick={() => setMode('recovery')}>
                    {t('login.forgot')}
                  </button>

                  <div className="divider">
                    <span>{t('login.or')}</span>
                  </div>

                  <div className="oauth-row">
                    <button
                      className="button button-ghost"
                      type="button"
                      disabled={!oauthConfigured.google || loading}
                      onClick={() => oauth('google')}
                      title={oauthConfigured.google ? t('login.googleConfigured') : t('login.oauthSetup', { provider: 'Google' })}
                    >
                      {t('login.google')}
                    </button>
                    <button
                      className="button button-ghost"
                      type="button"
                      disabled={!oauthConfigured.apple || loading}
                      onClick={() => oauth('apple')}
                      title={oauthConfigured.apple ? t('login.appleConfigured') : t('login.oauthSetup', { provider: 'Apple' })}
                    >
                      {t('login.apple')}
                    </button>
                  </div>

                  <p className="muted small">
                    {t('login.inviteQuestion')} <Link to="/join">{t('login.activateInvite')}</Link>
                  </p>
                </form>
              ) : null}

              {mode === 'register' ? (
                <form className="stack-sm" onSubmit={submitRegistration}>
                  <h2>{t('login.registerTitle')}</h2>
                  <p className="muted small">{t('login.registerHint')}</p>

                  <div className="form-row">
                    <label className="field">
                      <span>{t('login.firstName')}</span>
                      <input
                        value={registration.firstName}
                        onChange={(event) => setRegistration({ ...registration, firstName: event.target.value })}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t('login.lastName')}</span>
                      <input
                        value={registration.lastName}
                        onChange={(event) => setRegistration({ ...registration, lastName: event.target.value })}
                        required
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>{t('login.email')}</span>
                    <input
                      type="email"
                      value={registration.email}
                      onChange={(event) => setRegistration({ ...registration, email: event.target.value })}
                      autoComplete="email"
                      required
                    />
                  </label>

                  <label className="field">
                    <span>{t('login.phone')}</span>
                    <input
                      value={registration.phone}
                      onChange={(event) => setRegistration({ ...registration, phone: event.target.value })}
                      autoComplete="tel"
                      placeholder="+996700000000"
                    />
                  </label>

                  <label className="field">
                    <span>{t('login.birthDate')}</span>
                    <input
                      type="date"
                      value={registration.birthDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(event) => setRegistration({ ...registration, birthDate: event.target.value })}
                      required
                    />
                  </label>

                  {registrationIsMinor ? (
                    <fieldset className="consent-fieldset">
                      <legend>Законный представитель</legend>
                      <p className="muted small">
                        Для обучающегося младше 18 лет укажите родителя или опекуна. Администратор проверит данные при
                        рассмотрении заявки.
                      </p>
                      <label className="field">
                        <span>ФИО представителя</span>
                        <input
                          value={registration.guardianName}
                          onChange={(event) => setRegistration({ ...registration, guardianName: event.target.value })}
                          required
                        />
                      </label>
                      <label className="field">
                        <span>Телефон представителя</span>
                        <input
                          value={registration.guardianPhone}
                          onChange={(event) => setRegistration({ ...registration, guardianPhone: event.target.value })}
                          placeholder="+996700000000"
                          required
                        />
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={registration.guardianConsent}
                          onChange={(event) =>
                            setRegistration({ ...registration, guardianConsent: event.target.checked })
                          }
                          required
                        />
                        <span>
                          Я законный представитель и подтверждаю обработку данных ребёнка на условиях{' '}
                          <a href={appUrl('/privacy#children')} target="_blank" rel="noreferrer">
                            политики конфиденциальности
                          </a>
                          .
                        </span>
                      </label>
                    </fieldset>
                  ) : null}

                  <label className="field">
                    <span>{t('login.role')}</span>
                    <select
                      value={registration.role}
                      onChange={(event) =>
                        setRegistration({ ...registration, role: event.target.value as 'STUDENT' | 'TEACHER' | 'PARENT' })
                      }
                    >
                      <option value="STUDENT">{t('login.roleStudent')}</option>
                      <option value="TEACHER">{t('login.roleTeacher')}</option>
                      <option value="PARENT">{t('login.roleParent')}</option>
                    </select>
                  </label>

                  <div className="form-row">
                    <label className="field">
                      <span>{t('login.password')}</span>
                      <input
                        type="password"
                        value={registration.password}
                        onChange={(event) => setRegistration({ ...registration, password: event.target.value })}
                        autoComplete="new-password"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>{t('login.passwordRepeat')}</span>
                      <input
                        type="password"
                        value={registration.passwordRepeat}
                        onChange={(event) => setRegistration({ ...registration, passwordRepeat: event.target.value })}
                        autoComplete="new-password"
                        required
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>{t('login.comment')}</span>
                    <input
                      value={registration.message}
                      onChange={(event) => setRegistration({ ...registration, message: event.target.value })}
                      maxLength={500}
                    />
                  </label>

                  <fieldset className="consent-fieldset">
                    <legend>{t('login.consents')}</legend>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={registration.acceptTerms}
                        onChange={(event) =>
                          setRegistration({ ...registration, acceptTerms: event.target.checked })
                        }
                        required
                      />
                      <span>
                        {t('login.acceptTerms')} <a href={appUrl('/terms')} target="_blank" rel="noreferrer">{t('login.termsLink')}</a>
                      </span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={registration.acceptPrivacy}
                        onChange={(event) =>
                          setRegistration({ ...registration, acceptPrivacy: event.target.checked })
                        }
                        required
                      />
                      <span>
                        {t('login.acceptPrivacy')} <a href={appUrl('/privacy')} target="_blank" rel="noreferrer">{t('login.privacyLink')}</a>
                      </span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={registration.acceptDataProcessing}
                        onChange={(event) =>
                          setRegistration({ ...registration, acceptDataProcessing: event.target.checked })
                        }
                        required
                      />
                      <span>{t('login.acceptData')}</span>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={registration.acceptMarketing}
                        onChange={(event) =>
                          setRegistration({ ...registration, acceptMarketing: event.target.checked })
                        }
                      />
                      <span>{t('login.acceptMarketing')}</span>
                    </label>
                    <p className="muted small">{t('login.minorNote')}</p>
                  </fieldset>

                  <button
                    className="button"
                    type="submit"
                    disabled={
                      loading ||
                      !registration.birthDate ||
                      !registration.acceptTerms ||
                      !registration.acceptPrivacy ||
                      !registration.acceptDataProcessing ||
                      (registrationIsMinor &&
                        (!registration.guardianName.trim() ||
                          !registration.guardianPhone.trim() ||
                          !registration.guardianConsent))
                    }
                  >
                    {loading ? t('login.registerSending') : t('login.registerSubmit')}
                  </button>
                </form>
              ) : null}

              {mode === 'recovery' ? (
                <div className="stack-sm">
                  <h2>{t('login.recoveryTitle')}</h2>
                  {recoveryStep === 1 ? (
                    <form className="stack-sm" onSubmit={requestRecovery}>
                      <p className="muted small">{t('login.recoveryHint')}</p>
                      <label className="field">
                        <span>{t('login.identifier')}</span>
                        <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
                      </label>
                      <button className="button" type="submit" disabled={loading}>
                        {loading ? t('login.registerSending') : t('login.recoveryGetCode')}
                      </button>
                    </form>
                  ) : (
                    <form className="stack-sm" onSubmit={confirmRecovery}>
                      <p className="muted small">
                        {recoveryChannel === 'sms' ? t('login.recoverySentSms') : t('login.recoverySentEmail')}
                      </p>
                      <label className="field">
                        <span>{t('login.recoveryCode')}</span>
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={recovery.code}
                          onChange={(event) => setRecovery({ ...recovery, code: event.target.value })}
                          required
                        />
                      </label>
                      <label className="field">
                        <span>{t('login.recoveryNewPassword')}</span>
                        <input
                          type="password"
                          value={recovery.password}
                          onChange={(event) => setRecovery({ ...recovery, password: event.target.value })}
                          autoComplete="new-password"
                          required
                        />
                      </label>
                      <label className="field">
                        <span>{t('login.recoveryRepeat')}</span>
                        <input
                          type="password"
                          value={recovery.passwordRepeat}
                          onChange={(event) => setRecovery({ ...recovery, passwordRepeat: event.target.value })}
                          autoComplete="new-password"
                          required
                        />
                      </label>
                      <button className="button" type="submit" disabled={loading}>
                        {loading ? t('login.recoverySaving') : t('login.recoveryChange')}
                      </button>
                      <button className="link-button" type="button" onClick={() => setRecoveryStep(1)}>
                        {t('login.recoveryResend')}
                      </button>
                    </form>
                  )}
                  <p className="muted small">{t('login.recoveryAdminHint')}</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
