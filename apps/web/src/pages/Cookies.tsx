import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getToken } from '../api/client'
import { privacyApi } from '../api/privacy'
import {
  consentTypesForCookies,
  loadCookiePreferences,
  saveCookiePreferences,
  type CookieCategory,
} from '../cookies'

const categories: Array<{
  key: CookieCategory | 'necessary'
  title: string
  text: string
  examples: string
  required?: boolean
}> = [
  {
    key: 'necessary',
    title: 'Необходимые',
    text: 'Без них невозможны вход, защита сессии и корректная работа платформы.',
    examples: 'itadis.admin.token, защита от CSRF, домен филиала',
    required: true,
  },
  {
    key: 'analytics',
    title: 'Аналитические',
    text: 'Помогают понять, какими разделами пользуются, в обезличенном виде.',
    examples: 'статистика просмотров, ошибки интерфейса',
  },
  {
    key: 'functional',
    title: 'Функциональные',
    text: 'Запоминают настройки интерфейса, масштаб шрифта и язык.',
    examples: 'тема, размер шрифта, язык',
  },
  {
    key: 'marketing',
    title: 'Маркетинговые',
    text: 'Позволяют показывать персонализированные предложения и оценивать кампании.',
    examples: 'рекламные метки, кампании',
  },
]

export function CookiesPage() {
  const [preferences, setPreferences] = useState(() => loadCookiePreferences())
  const [draft, setDraft] = useState(() => {
    const current = loadCookiePreferences()
    return {
      analytics: current?.analytics ?? false,
      functional: current?.functional ?? false,
      marketing: current?.marketing ?? false,
    }
  })
  const [notice, setNotice] = useState('')

  async function save() {
    const saved = saveCookiePreferences(draft)
    setPreferences(saved)
    setNotice('Настройки сохранены. Необязательные cookie, которые вы отключили, больше не используются.')
    if (getToken()) {
      try {
        await privacyApi.recordBatch(consentTypesForCookies(saved))
      } catch {
        setNotice('Настройки сохранены на этом устройстве. История согласий синхронизируется при следующем входе.')
      }
    }
  }

  return (
    <div className="legal-page">
      <header className="legal-head">
        <Link to={getToken() ? '/' : '/login'} className="brand brand-small">
          <span className="brand-mark">IT</span>adis
        </Link>
        <nav>
          <Link to="/privacy">Конфиденциальность</Link>
          <Link to="/cookies">Cookie</Link>
          <Link to="/terms">Соглашение</Link>
          {getToken() ? <Link to="/">В кабинет</Link> : <Link to="/login">Войти</Link>}
        </nav>
      </header>

      <main className="legal-content">
        <p className="legal-eyebrow">Управление cookie · версия 1.1 · 22.11.2026</p>
        <h1>Настройки cookie</h1>
        <p>
          Необходимые cookie всегда включены. Остальные категории выключены по умолчанию и активируются только
          после вашего выбора. Вы можете изменить решение в любое время на этой странице.
        </p>

        {notice ? <div className="alert alert-success">{notice}</div> : null}

        <div className="cookie-category-list">
          {categories.map((category) => {
            const checked = category.required ? true : Boolean(draft[category.key as CookieCategory])
            return (
              <section className="legal-subpanel" key={category.key} id={category.key}>
                <div className="row-between">
                  <h2>{category.title}</h2>
                  <label className="cookie-switch">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={category.required}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [category.key]: event.target.checked,
                        }))
                      }
                    />
                    <span>{category.required ? 'Всегда включены' : checked ? 'Включены' : 'Выключены'}</span>
                  </label>
                </div>
                <p>{category.text}</p>
                <p className="muted small">Примеры: {category.examples}</p>
              </section>
            )
          })}
        </div>

        <div className="row gap">
          <button className="btn btn-primary" onClick={() => void save()}>
            Сохранить настройки
          </button>
          <button
            className="btn"
            onClick={() => {
              setDraft({ analytics: false, functional: false, marketing: false })
              setNotice('Выбраны только необходимые cookie. Нажмите «Сохранить настройки», чтобы применить.')
            }}
          >
            Только необходимые
          </button>
        </div>

        <p className="muted small">
          Текущее решение: {preferences ? `обновлено ${new Date(preferences.updatedAt).toLocaleString('ru-RU')}` : 'ещё не сохранено'}.
          История согласий с версиями документов доступна в разделе{' '}
          <Link to="/privacy">«Конфиденциальность»</Link>.
        </p>
      </main>
    </div>
  )
}
