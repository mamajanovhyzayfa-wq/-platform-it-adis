import { useEffect, useState } from 'react'
import { Icon, Modal } from './ui.jsx'

const emptyCard = { number: '', expiry: '', cvc: '', holder: '' }

function digitsOnly(value) {
  return value.replace(/\D/g, '')
}

function formatCard(value) {
  return digitsOnly(value).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ')
}

function formatExpiry(value) {
  const digits = digitsOnly(value).slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

function validate(card) {
  const errors = {}
  if (digitsOnly(card.number).length !== 16) errors.number = 'Введите 16 цифр карты'
  const expiry = card.expiry.match(/^(\d{2})\/(\d{2})$/)
  if (!expiry || Number(expiry[1]) < 1 || Number(expiry[1]) > 12) errors.expiry = 'ММ/ГГ'
  if (digitsOnly(card.cvc).length < 3) errors.cvc = 'CVC'
  if (card.holder.trim().length < 3) errors.holder = 'ФИО владельца'
  return errors
}

/** Имитация платёжного шлюза: проверяет поля и показывает подтверждение. */
export function PaymentModal({ plan, onClose }) {
  const [card, setCard] = useState(emptyCard)
  const [errors, setErrors] = useState({})
  const [processing, setProcessing] = useState(false)
  const [paid, setPaid] = useState(false)

  useEffect(() => {
    if (!plan) return
    setCard(emptyCard)
    setErrors({})
    setProcessing(false)
    setPaid(false)
  }, [plan])

  if (!plan) return null

  const update = (field, format) => (event) => {
    const value = format ? format(event.target.value) : event.target.value
    setCard((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = (event) => {
    event.preventDefault()
    const nextErrors = validate(card)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setProcessing(true)
    window.setTimeout(() => {
      setProcessing(false)
      setPaid(true)
    }, 900)
  }

  return (
    <Modal
      open={Boolean(plan)}
      onClose={onClose}
      title={paid ? undefined : `Оплата тарифа «${plan.name}»`}
      subtitle={paid ? undefined : 'Демонстрационный платёж: деньги не списываются.'}
      size="sm"
    >
      {paid ? (
        <div className="form-success">
          <span className="form-success-icon">
            <Icon name="check" />
          </span>
          <h2>Платёж подтверждён</h2>
          <p>
            Тариф «{plan.name}» активирован на демо-аккаунте. Сумма к оплате — {plan.price} {plan.period.split(' ')[0]}.
          </p>
          <button type="button" className="button" onClick={onClose}>
            Вернуться к тарифам
          </button>
        </div>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <div className="pay-summary">
            <span>{plan.name}</span>
            <strong>
              {plan.price} <small>{plan.period}</small>
            </strong>
          </div>

          <label className="field">
            <span>Номер карты</span>
            <input
              value={card.number}
              onChange={update('number', formatCard)}
              placeholder="0000 0000 0000 0000"
              inputMode="numeric"
              autoComplete="cc-number"
              aria-invalid={Boolean(errors.number)}
              required
            />
            {errors.number ? <em className="field-error">{errors.number}</em> : null}
          </label>

          <div className="form-row">
            <label className="field">
              <span>Срок действия</span>
              <input
                value={card.expiry}
                onChange={update('expiry', formatExpiry)}
                placeholder="ММ/ГГ"
                inputMode="numeric"
                autoComplete="cc-exp"
                aria-invalid={Boolean(errors.expiry)}
                required
              />
              {errors.expiry ? <em className="field-error">{errors.expiry}</em> : null}
            </label>

            <label className="field">
              <span>CVC</span>
              <input
                value={card.cvc}
                onChange={update('cvc', (value) => digitsOnly(value).slice(0, 4))}
                placeholder="•••"
                inputMode="numeric"
                autoComplete="cc-csc"
                aria-invalid={Boolean(errors.cvc)}
                required
              />
              {errors.cvc ? <em className="field-error">{errors.cvc}</em> : null}
            </label>
          </div>

          <label className="field">
            <span>ФИО владельца</span>
            <input
              value={card.holder}
              onChange={update('holder', (value) => value.toUpperCase())}
              placeholder="IVAN IVANOV"
              autoComplete="cc-name"
              aria-invalid={Boolean(errors.holder)}
              required
            />
            {errors.holder ? <em className="field-error">{errors.holder}</em> : null}
          </label>

          <button type="submit" className="button button-accent" disabled={processing}>
            {processing ? 'Проводим платёж…' : 'Подтвердить платёж'}
          </button>
          <p className="form-note">
            <Icon name="shield" className="form-note-icon" /> Данные карты не сохраняются. Реальный шлюз подключается позже.
          </p>
        </form>
      )}
    </Modal>
  )
}
