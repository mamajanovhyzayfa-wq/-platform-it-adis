import { Link } from 'react-router-dom'
import { coinRules, features, plans, roles, stack } from '../data.js'
import { Icon } from '../components/ui.jsx'

/** Главная страница: продукт, роли, возможности, тарифы, IT Coins и стек. */
export function Home({ onSelectPlan }) {
  return (
    <main id="main">
      <section className="hero" id="top">
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Образовательная платформа</p>
            <h1>
              Учиться, преподавать и расти — <span className="accent">в одном приложении</span>
            </h1>
            <p className="lead">
              ITadis собирает курсы, домашние задания, тесты, расписание и живые занятия в одном месте. Отдельные
              кабинеты для ученика, преподавателя, родителя, администратора и менеджера — с общей базой данных и
              понятной статистикой.
            </p>

            <ul className="hero-facts">
              <li>Android и iOS</li>
              <li>Русский · Кыргызский · English</li>
              <li>Светлая и тёмная темы</li>
            </ul>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-glow" />
            <img src="/app-icon.svg" width="512" height="512" alt="" className="hero-logo" />
          </div>
        </div>
      </section>

      <section className="section" id="roles">
        <div className="container">
          <header className="section-head">
            <p className="eyebrow">Роли</p>
            <h2>Каждому — свой кабинет</h2>
            <p className="section-text">
              Доступ строится на ролях и правах: ученик видит свои курсы, преподаватель — свои группы, родитель —
              успеваемость ребёнка, менеджер — заявки и поддержку. Проверка доступа выполняется на сервере.
            </p>
          </header>

          <div className="grid grid-roles">
            {roles.map((role) => (
              <Link className="card role-card" key={role.slug} to={`/roles/${role.slug}`}>
                <span className="card-icon">
                  <Icon name={role.icon} />
                </span>
                <h3>{role.title}</h3>
                <p>{role.short}</p>
                <span className="card-more">
                  Подробнее <span aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted" id="features">
        <div className="container">
          <header className="section-head">
            <p className="eyebrow">Возможности</p>
            <h2>Учебный процесс целиком</h2>
            <p className="section-text">
              От каталога курсов до проверки работы: всё связано между собой, поэтому прогресс, оценки и монеты
              считаются автоматически.
            </p>
          </header>

          <div className="grid grid-4">
            {features.map((feature) => (
              <article className="card card-compact" key={feature.title}>
                <span className="card-icon">
                  <Icon name={feature.icon} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="container">
          <header className="section-head section-head-center">
            <p className="eyebrow">Тарифы и оплата</p>
            <h2>Выберите свой формат обучения</h2>
            <p className="section-text">
              Начните с одного курса или откройте весь учебный процесс с проверкой работ и личным ментором. Оплата —
              помесячно, без скрытых платежей.
            </p>
          </header>

          <div className="pricing-grid">
            {plans.map((plan) => (
              <article className={`pricing-card${plan.popular ? ' pricing-card-popular' : ''}`} key={plan.slug}>
                {plan.popular ? <span className="pricing-badge">Популярный</span> : null}

                <div className="pricing-head">
                  <h3>{plan.name}</h3>
                  <p>{plan.summary}</p>
                </div>

                <p className="pricing-price">
                  {plan.price} <span>{plan.period}</span>
                </p>

                <ul className="pricing-features">
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <Icon name="check" className="pricing-check" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  className={`button${plan.popular ? ' button-accent' : ' button-outline'}`}
                  onClick={() => onSelectPlan(plan)}
                >
                  Оплатить
                </button>
              </article>
            ))}
          </div>

          <p className="pricing-note">
            Цены указаны за месяц обучения одного человека. Для школ и учебных центров есть отдельные условия —
            оставьте заявку, и мы подготовим расчёт.
          </p>
        </div>
      </section>

      <section className="section section-muted" id="coins">
        <div className="container coins-inner">
          <div className="coins-copy">
            <p className="eyebrow">Мотивация</p>
            <h2>IT Coins за реальные действия</h2>
            <p className="section-text">
              Монеты начисляются не за вход в приложение, а за учёбу. Каждое начисление проходит в транзакции базы
              данных: баланс и история не расходятся, а повторная проверка работы не начисляет монеты дважды.
            </p>
            <p className="section-text">
              Заработанные монеты тратятся в магазине наград, а баланс виден и ученику, и родителю.
            </p>
          </div>

          <ul className="coin-rules">
            {coinRules.map((rule) => (
              <li key={rule.label}>
                <span className="coin-amount">{rule.value}</span>
                <span className="coin-label">{rule.label}</span>
                <span className="coin-note">{rule.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" id="stack">
        <div className="container">
          <header className="section-head">
            <p className="eyebrow">Технологии</p>
            <h2>Собрано на проверенном стеке</h2>
            <p className="section-text">
              Мобильное приложение, сервер и административная панель написаны на TypeScript и работают с одной
              моделью данных.
            </p>
          </header>

          <div className="grid grid-3">
            {stack.map((group) => (
              <article className="card card-compact" key={group.title}>
                <h3>{group.title}</h3>
                <ul className="chips">
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
