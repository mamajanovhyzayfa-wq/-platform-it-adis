import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <main id="main" className="not-found">
      <div className="container not-found-inner">
        <p className="eyebrow">404</p>
        <h1>Страница не найдена</h1>
        <p className="lead">Возможно, ссылка устарела. Вернитесь на главную и выберите роль.</p>
        <Link className="button" to="/">
          На главную
        </Link>
      </div>
    </main>
  )
}
