import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getToken } from '../api/client'
import { privacyApi } from '../api/privacy'
import { useI18n } from '../i18n'
import {
  consentTypesForCookies,
  loadCookiePreferences,
  saveCookiePreferences,
  type CookiePreferences,
} from '../cookies'

type Choice = Pick<CookiePreferences, 'analytics' | 'functional' | 'marketing'>

const allOn: Choice = { analytics: true, functional: true, marketing: true }
const onlyNecessary: Choice = { analytics: false, functional: false, marketing: false }

/** Компактная панель первого посещения. Необязательные cookie выключены до согласия. */
export function CookieBanner() {
  const { t } = useI18n()
  const [preferences, setPreferences] = useState<CookiePreferences | null>(() => loadCookiePreferences())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<Choice>(onlyNecessary)
  const [saving, setSaving] = useState(false)

  // Если пользователь вошёл позже, сохраняем уже выбранные cookie в историю согласий.
  useEffect(() => {
    const sync = () => {
      const existing = loadCookiePreferences()
      if (!existing || !getToken() || sessionStorage.getItem('itadis.cookie.synced')) return
      sessionStorage.setItem('itadis.cookie.synced', '1')
      void privacyApi.recordBatch(consentTypesForCookies(existing)).catch(() => {
        sessionStorage.removeItem('itadis.cookie.synced')
      })
    }
    sync()
    window.addEventListener('itadis:login', sync)
    return () => window.removeEventListener('itadis:login', sync)
  }, [])

  if (preferences) return null

  const apply = async (choice: Choice) => {
    setSaving(true)
    const saved = saveCookiePreferences(choice)
    setPreferences(saved)
    setSaving(false)
    if (getToken()) {
      try {
        await privacyApi.recordBatch(consentTypesForCookies(saved))
      } catch {
        // Локальный выбор сохраняется; при следующем входе он будет синхронизирован.
      }
    }
  }

  return (
    <aside className="cookie-banner" aria-label={t('cookie.aria')}>
      <div className="cookie-banner-text">
        <strong>{t('cookie.title')}</strong>
        <p>
          {t('cookie.textBefore')}{' '}
          <Link to="/privacy">{t('cookie.privacy')}</Link> {t('cookie.and')}{' '}
          <Link to="/cookies">{t('cookie.cookiesLink')}</Link>.
        </p>
      </div>

      {settingsOpen ? (
        <div className="cookie-settings">
          <label className="cookie-switch">
            <input type="checkbox" checked disabled />
            <span>
              <strong>{t('cookie.necessary')}</strong>
              <small>{t('cookie.necessaryHint')}</small>
            </span>
          </label>
          <label className="cookie-switch">
            <input
              type="checkbox"
              checked={draft.analytics}
              onChange={(event) => setDraft((current) => ({ ...current, analytics: event.target.checked }))}
            />
            <span>
              <strong>{t('cookie.analytics')}</strong>
              <small>{t('cookie.analyticsHint')}</small>
            </span>
          </label>
          <label className="cookie-switch">
            <input
              type="checkbox"
              checked={draft.functional}
              onChange={(event) => setDraft((current) => ({ ...current, functional: event.target.checked }))}
            />
            <span>
              <strong>{t('cookie.functional')}</strong>
              <small>{t('cookie.functionalHint')}</small>
            </span>
          </label>
          <label className="cookie-switch">
            <input
              type="checkbox"
              checked={draft.marketing}
              onChange={(event) => setDraft((current) => ({ ...current, marketing: event.target.checked }))}
            />
            <span>
              <strong>{t('cookie.marketing')}</strong>
              <small>{t('cookie.marketingHint')}</small>
            </span>
          </label>
        </div>
      ) : null}

      <div className="cookie-banner-actions">
        {settingsOpen ? (
          <button className="btn btn-primary" disabled={saving} onClick={() => void apply(draft)}>
            {t('cookie.save')}
          </button>
        ) : (
          <>
            <button className="btn btn-primary" disabled={saving} onClick={() => void apply(allOn)}>
              {t('cookie.acceptAll')}
            </button>
            <button className="btn" disabled={saving} onClick={() => void apply(onlyNecessary)}>
              {t('cookie.onlyNecessary')}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setDraft(onlyNecessary)
                setSettingsOpen(true)
              }}
            >
              {t('cookie.configure')}
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
