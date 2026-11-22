import { useRef, useState } from 'react'
import { roleOptions } from '../data.js'
import { cabinetUrl } from '../config.js'
import { submitLead } from '../api/leads.js'
import { Icon } from './ui.jsx'

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  audience: 'STUDENT',
  message: '',
}

function validate(form) {
  const errors = {}
  if (form.name.trim().length < 2) errors.name = 'Укажите имя'
  const phoneDigits = form.phone.replace(/\D/g, '')
  if (phoneDigits.length < 9 || phoneDigits.length > 15) errors.phone = 'Укажите номер телефона'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Проверьте email'
  if (form.message.trim().length > 1000) errors.message = 'Не больше 1000 символов'
  return errors
}

/** Реальная заявка в CRM: сохраняется на сервере, а не в localStorage. */
export function LeadForm({ onDone }) {
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [requestError, setRequestError] = useState(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const inFlight = useRef(false)

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setRequestError(null)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    inFlight.current = true
    setSending(true)
    setRequestError(null)
    try {
      const message = form.message.trim()
      await submitLead({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        audience: form.audience,
        ...(message ? { message } : {}),
        consent: true,
      })
      setSent(true)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Не удалось отправить заявку')
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  if (sent) {
    const firstName = form.name.trim().split(/\s+/)[0]
    return (
      <div className="form-success">
        <span className="form-success-icon">
          <Icon name="check" />
        </span>
        <h2>Заявка отправлена</h2>
        <p>
          Спасибо, {firstName}. Мы свяжемся по номеру {form.phone.trim()} в течение рабочего дня.
        </p>
        <div className="form-success-actions">
          <button type="button" className="button" onClick={onDone}>
            Хорошо
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Имя</span>
        <input
          value={form.name}
          onChange={update('name')}
          placeholder="Как к вам обращаться"
          autoComplete="name"
          aria-invalid={Boolean(errors.name)}
          required
        />
        {errors.name ? <em className="field-error">{errors.name}</em> : null}
      </label>

      <label className="field">
        <span>Телефон</span>
        <input
          value={form.phone}
          onChange={update('phone')}
          placeholder="+996 700 000 000"
          inputMode="tel"
          autoComplete="tel"
          aria-invalid={Boolean(errors.phone)}
          required
        />
        {errors.phone ? <em className="field-error">{errors.phone}</em> : null}
      </label>

      <label className="field">
        <span>Email</span>
        <input
          value={form.email}
          onChange={update('email')}
          placeholder="name@example.com"
          inputMode="email"
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          required
        />
        {errors.email ? <em className="field-error">{errors.email}</em> : null}
      </label>

      <label className="field">
        <span>Кто вы</span>
        <select value={form.audience} onChange={update('audience')}>
          {roleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Комментарий (необязательно)</span>
        <textarea
          value={form.message}
          onChange={update('message')}
          placeholder="Что хотите изучать или какой формат рассматриваете"
          rows={3}
          maxLength={1000}
          aria-invalid={Boolean(errors.message)}
        />
        {errors.message ? <em className="field-error">{errors.message}</em> : null}
      </label>

      {requestError ? (
        <p className="form-error" role="alert">
          {requestError}
        </p>
      ) : null}

      <button type="submit" className="button" disabled={sending}>
        {sending ? 'Отправляем…' : 'Отправить заявку'}
      </button>
      <p className="form-note">
        Нажимая «Отправить заявку», вы соглашаетесь с{' '}
        <a href={cabinetUrl('/terms')} target="_blank" rel="noreferrer">
          условиями
        </a>{' '}
        и{' '}
        <a href={cabinetUrl('/privacy')} target="_blank" rel="noreferrer">
          политикой обработки данных
        </a>
        . Заявка попадает менеджеру в CRM.
      </p>
    </form>
  )
}
