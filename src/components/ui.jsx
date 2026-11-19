import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/** Иконки интерфейса: тонкие линии, наследуют цвет текста. */
const paths = {
  book: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5z',
  board: 'M3 4.5h18v11H3zM8 20l4-3 4 3M12 15.5V20',
  family:
    'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5M17 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM15 14.8c2.9-.4 5.5 1.9 5.5 5.2',
  shield: 'M12 3l7.5 3v6c0 4.2-3 7.6-7.5 9-4.5-1.4-7.5-4.8-7.5-9V6zM9.2 12.2l2 2 3.6-3.9',
  folder: 'M3.5 7.5V6.2c0-.9.7-1.7 1.6-1.7h4.2l1.9 2.2h8.1c.9 0 1.7.8 1.7 1.7v1.1M3.5 7.5h17.2l-1.4 11H4.9z',
  layers: 'M12 3.5 3.5 8 12 12.5 20.5 8zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5',
  check: 'M7.5 3.5h9v3h3v14h-15v-14h3zM9.5 6.5h5M8.5 12.5l2.2 2.2 4.3-4.4',
  quiz: 'M4.5 3.5h15v13h-9l-4 4v-4h-2zM9.6 7.4a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .9-1 1.7M12 14.2v.1',
  calendar: 'M4 6.5h16V20H4zM4 11h16M8.5 3.5v3.5M15.5 3.5v3.5M9 15.5h1M14 15.5h1',
  video: 'M3.5 6.5h11v11h-11zM14.5 11l6-3.2v8.4l-6-3.2z',
  chat: 'M4 4.5h16v11H12l-5 4v-4H4zM8 9h8M8 12h5',
  coin: 'M12 3.5c4.7 0 8.5 2 8.5 4.5S16.7 12.5 12 12.5 3.5 10.5 3.5 8 7.3 3.5 12 3.5zM3.5 8v8c0 2.5 3.8 4.5 8.5 4.5s8.5-2 8.5-4.5V8',
  shelf: 'M4 4.5h5v15H4zM11 4.5h9v7h-9zM11 13.5h9v6h-9z',
  users:
    'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6M16 5.3a3 3 0 0 1 0 5.5M17.6 14.5c2.2.6 3.9 2.5 3.9 5.5',
  ticket: 'M4 7.5h16v3a2.2 2.2 0 0 0 0 4.4v2.6H4v-2.6a2.2 2.2 0 0 0 0-4.4zM9.5 7.5v10',
  box: 'M4 8.5 12 4l8 4.5-8 4.5zM4 8.5V17l8 4 8-4V8.5M12 13v8',
  card: 'M3.5 6.5h17v11h-17zM3.5 10.5h17M7 14.5h4.5',
  crown: 'M4 17.5h16M5 17.5 3.8 8l4.9 3.2L12 5l3.3 6.2L20.2 8 19 17.5',
  star: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  rocket: 'M12 3.5c3.4 1.4 5.6 4.7 5.6 8.4L12 20.5 6.4 11.9c0-3.7 2.2-7 5.6-8.4zM9.6 11.2 12 17l2.4-5.8M12 13.5v3',
  close: 'M6 6l12 12M18 6 6 18',
  arrowLeft: 'M20 12H4M10 6l-6 6 6 6',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  spark: 'M12 3v4M12 17v4M4.9 7.5l2.8 2.8M16.3 13.7l2.8 2.8M3 12h4M17 12h4M4.9 16.5l2.8-2.8M16.3 10.3l2.8-2.8',
}

export function Icon({ name, className = 'icon' }) {
  const path = paths[name] ?? paths.spark
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Brand({ size = 40 }) {
  return (
    <span className="brand">
      <img src="/favicon.svg" width={size} height={size} alt="" className="brand-mark" />
      <span className="brand-name" aria-label="ITadis">
        <span className="brand-name-it">IT</span>
        <span className="brand-name-adis">adis</span>
      </span>
    </span>
  )
}

/**
 * Модальное окно: закрытие по Escape и клику по фону, блокировка прокрутки,
 * фокус переводится внутрь диалога.
 */
export function Modal({ open, onClose, title, subtitle, children, size = 'md' }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 40)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(focusTimer)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть окно">
          <Icon name="close" />
        </button>

        {title ? (
          <header className="modal-head">
            <h2 id="modal-title">{title}</h2>
            {subtitle ? <p className="modal-sub">{subtitle}</p> : null}
          </header>
        ) : null}

        {children}
      </div>
    </div>,
    document.body,
  )
}
