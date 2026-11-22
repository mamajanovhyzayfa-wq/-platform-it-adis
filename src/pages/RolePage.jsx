import { Link, useParams } from 'react-router-dom'
import { roles } from '../data.js'
import { Icon } from '../components/ui.jsx'
import { NotFound } from './NotFound.jsx'

/** Детальная страница роли: описание, возможности и вход в кабинет. */
export function RolePage() {
  const { slug } = useParams()
  const role = roles.find((item) => item.slug === slug)

  if (!role) return <NotFound />

  return (
    <main id="main" className="role-page">
      <div className="container">
        <nav className="breadcrumbs" aria-label="Навигация">
          <Link to="/#roles">
            <Icon name="arrowLeft" className="breadcrumbs-icon" />
            Все роли
          </Link>
        </nav>

        <header className="role-hero">
          <span className="role-icon">
            <Icon name={role.icon} />
          </span>

          <div className="role-copy">
            <p className="eyebrow">Кабинет роли</p>
            <h1>{role.title}</h1>
            <p className="lead">{role.description}</p>

            <div className="role-actions">
              <Link className="button" to={`/login?role=${role.slug}`}>
                Перейти в кабинет
              </Link>
            </div>
          </div>
        </header>

        <section className="role-body" aria-labelledby="role-features-title">
          <h2 id="role-features-title">Что внутри кабинета</h2>
          <div className="grid grid-2">
            {role.features.map((feature) => (
              <article className="card role-feature" key={feature.title}>
                <span className="card-icon">
                  <Icon name={feature.icon} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="role-cta">
          <div>
            <h2>Готовы попробовать?</h2>
            <p>Оставьте заявку — менеджер поможет подключить нужный кабинет.</p>
          </div>
          <Link className="button button-accent" to="/#roles">
            Выбрать другую роль
          </Link>
        </section>
      </div>
    </main>
  )
}
