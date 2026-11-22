import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../i18n'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

function ErrorScreen({ error }: { error: Error }) {
  const { t } = useI18n()

  return (
    <div className="auth-shell auth-shell-single">
      <main className="auth-panel">
        <section className="auth-card" role="alert" aria-live="assertive">
          <span className="brand-mark" aria-hidden="true">
            IA
          </span>
          <h1>{t('common.crashTitle')}</h1>
          <p className="muted">{t('common.crashBody')}</p>
          {import.meta.env.DEV ? <pre className="code-block">{error.message}</pre> : null}
          <button className="button" type="button" onClick={() => window.location.reload()}>
            {t('common.reload')}
          </button>
        </section>
      </main>
    </div>
  )
}

/**
 * Ловит ошибки отрисовки React, чтобы одна сломанная страница не оставляла
 * пользователя с пустым экраном. Ошибка не скрывается: в development виден
 * текст, в production — локализованное сообщение и перезагрузка.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] необработанная ошибка интерфейса', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) return <ErrorScreen error={this.state.error} />
    return this.props.children
  }
}
