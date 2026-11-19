import { useEffect, useState } from 'react'
import { roleOptions } from '../data.js'
import { Icon, Modal } from './ui.jsx'

const emptyForm = { name: '', phone: '', email: '', audience: 'Ученик' }

function validate(form) {
  const errors = {}
  if (form.name.trim().length < 2) errors.name = 'Укажите имя'
  if (form.phone.replace(/\D/g, '').length < 7) errors.phone = 'Укажите номер телефона'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Проверьте email'
  return errors
}

/** Форма заявки на обучение: заявка сохраняется локально и подтверждается на экране. */
export function ApplicationModal({ open, onClose }) {
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    setForm(emptyForm)
    setErrors({})
    setSending(false)
    setSent(false)
    return undefined
  }, [open])

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = (event) => {
    event.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSending(true)
    window.setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem('itadis-applications') ?? '[]')
        localStorage.setItem(
          'itadis-applications',
          JSON.stringify([...stored, { ...form, createdAt: new Date().toISOString() }]),
        )
      } catch {
        /* приватный режим: заявка не сохранится локально, но экран подтверждения покажем */
      }
      setSending(false)
      setSent(true)
    }, 650)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={sent ? undefined : 'Подать заявку'}
      subtitle={sent ? undefined : 'Расскажите о себе — менеджер свяжется и подберёт формат обучения.'}
      size="sm"
    >
      {sent ? (
        <div className="form-success">
          <span className="form-success-icon">
            <Icon name="check" />
          </span>
          <h2>Заявка отправлена</h2>
          <p>Спасибо, {form.name.trim().split(' ')[0]}. Мы свяжемся по номеру {form.phone.trim()} в течение рабочего дня.</p>
          <button type="button" className="button" onClick={onClose}>
            Хорошо
          </button>
        </div>
      ) : (
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
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="button" disabled={sending}>
            {sending ? 'Отправляем…' : 'Отправить'}
          </button>
          <p className="form-note">Нажимая «Отправить», вы соглашаетесь на обработку персональных данных.</p>
        </form>
      )}
    </Modal>
  )
}
