import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getToken } from '../api/client'
import { privacyApi, type ConsentRecord, type ConsentType } from '../api/privacy'

const consentLabels: Record<ConsentType, string> = {
  TERMS: 'Пользовательское соглашение',
  PRIVACY: 'Политика конфиденциальности',
  DATA_PROCESSING: 'Обработка персональных данных',
  MARKETING: 'Маркетинговые сообщения',
  COOKIES: 'Cookie',
  COOKIE_ANALYTICS: 'Аналитические cookie',
  COOKIE_FUNCTIONAL: 'Функциональные cookie',
  COOKIE_MARKETING: 'Маркетинговые cookie',
  GUARDIAN: 'Согласие законного представителя',
}

function ConsentBadge({ record }: { record?: ConsentRecord }) {
  if (!record) return <span className="badge">не предоставлено</span>
  return (
    <span className={record.granted ? 'badge badge-success' : 'badge badge-muted'}>
      {record.granted ? 'предоставлено' : 'отозвано'} · v{record.documentVersion} ·{' '}
      {new Date(record.createdAt).toLocaleDateString('ru-RU')}
    </span>
  )
}

export function PrivacyPage() {
  const loggedIn = Boolean(getToken())
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [guardianName, setGuardianName] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [guardianConfirmed, setGuardianConfirmed] = useState(false)
  const [notice, setNotice] = useState('')

  const state = useQuery({
    queryKey: ['privacy-state'],
    queryFn: privacyApi.state,
    enabled: loggedIn,
  })
  const deletion = useQuery({
    queryKey: ['privacy-deletion'],
    queryFn: privacyApi.deletionRequests,
    enabled: loggedIn,
  })

  const requestDeletion = useMutation({
    mutationFn: () => privacyApi.requestDeletion(reason.trim() || undefined),
    onSuccess: () => {
      setReason('')
      setNotice('Запрос отправлен. Администратор рассмотрит его, ответ появится в истории ниже.')
      void queryClient.invalidateQueries({ queryKey: ['privacy-deletion'] })
    },
  })
  const cancelDeletion = useMutation({
    mutationFn: (id: string) => privacyApi.cancelDeletion(id),
    onSuccess: () => {
      setNotice('Запрос отменён.')
      void queryClient.invalidateQueries({ queryKey: ['privacy-deletion'] })
    },
  })
  const guardianConsent = useMutation({
    mutationFn: () =>
      privacyApi.record('GUARDIAN', true, {
        guardianName: guardianName.trim(),
        guardianPhone: guardianPhone.trim(),
        confirmedByGuardian: true,
      }),
    onSuccess: () => {
      setNotice('Согласие законного представителя сохранено.')
      void queryClient.invalidateQueries({ queryKey: ['privacy-state'] })
    },
  })

  const latest = new Map((state.data?.latest ?? []).map((record) => [record.type, record]))
  const activeDeletion = (deletion.data ?? []).find((request) => request.status === 'PENDING')

  return (
    <div className="legal-page">
      <header className="legal-head">
        <Link to={loggedIn ? '/' : '/login'} className="brand brand-small">
          <span className="brand-mark">IT</span>adis
        </Link>
        <nav>
          <Link to="/privacy">Конфиденциальность</Link>
          <Link to="/cookies">Cookie</Link>
          <Link to="/terms">Соглашение</Link>
          {loggedIn ? <Link to="/">В кабинет</Link> : <Link to="/login">Войти</Link>}
        </nav>
      </header>

      <main className="legal-content">
        <p className="legal-eyebrow">Документ · редакция 1.2 · 22.11.2026</p>
        <h1>Политика конфиденциальности и обработки персональных данных</h1>
        <div className="alert alert-info">
          Это информационный документ платформы ITadis, а не юридическое заключение. Перед публикацией его
          должен проверить юрист Кыргызской Республики с учётом Цифрового кодекса КР от 31.07.2025 № 178,
          вступившего в силу 05.02.2026, и иных применимых актов. Это не юридическое заключение.
        </div>

        <h2>1. Кто обрабатывает данные</h2>
        <p>
          Оператор платформы ITadis (далее — «Платформа») обрабатывает данные обучающихся, преподавателей,
          родителей и сотрудников для организации обучения. Контакт по вопросам персональных данных:{' '}
          <a href="mailto:privacy@itadis.kg">privacy@itadis.kg</a>.
        </p>

        <h2>2. Какие данные собираются</h2>
        <ul>
          <li>имя, email, телефон, дата рождения, роль и аватар;</li>
          <li>данные обучения: курсы, уроки, задания, оценки, тесты, сертификаты;</li>
          <li>сообщения, обращения к AI-помощнику и материалы, загруженные пользователем;</li>
          <li>технические данные: IP-адрес, устройство, время входа и журналы безопасности;</li>
          <li>платежи и начисления IT Coins в объёме, необходимом для расчётов.</li>
        </ul>
        <p>
          Мы стремимся к минимизации: не запрашиваем данные, без которых нельзя оказать образовательную услугу,
          и не используем чувствительные данные без отдельного законного основания.
        </p>

        <h2 id="data-processing">3. Цели и основания обработки</h2>
        <p>
          Данные обрабатываются для заключения и исполнения договора об обучении, ведения учебного процесса,
          безопасности аккаунта, расчётов, выполнения требований законодательства и — только при отдельном
          согласии — для маркетинговых сообщений и необязательных cookie. Согласие можно отозвать; отзыв не
          влияет на законность обработки до отзыва.
        </p>

        <h2 id="children">4. Несовершеннолетние</h2>
        <p>
          Платформа используется несовершеннолетними, поэтому действуют усиленные гарантии. Для ребёнка младше
          14 лет обработка его персональных данных требует согласия законного представителя. С 14 лет
          обучающийся вправе самостоятельно давать согласие в пределах своей дееспособности; платформа
          дополнительно запрашивает подтверждение представителя до 18 лет, если это необходимо для договора
          об обучении. При регистрации указываются дата рождения, ФИО и телефон представителя, а также
          отдельное подтверждение согласия. Заявку проверяет администратор филиала, который может связаться с
          представителем. Мы ограничиваем видимость личных данных, не открываем ученикам личные диалоги друг
          с другом и применяем строгие права доступа. Родитель или законный представитель может запросить
          сведения об обработке данных ребёнка через <a href="mailto:privacy@itadis.kg">privacy@itadis.kg</a>.
        </p>

        <h2>5. Cookie и аналитика</h2>
        <p>
          Необходимые cookie обеспечивают вход, безопасность и работу интерфейса. Аналитические,
          функциональные и маркетинговые cookie не включаются до согласия. Управлять категориями можно на
          странице <Link to="/cookies">«Настройки cookie»</Link>.
        </p>

        <h2>6. Передача и хранение</h2>
        <p>
          Доступ к данным имеют только уполномоченные сотрудники и преподаватели в пределах их ролей.
          Поставщики инфраструктуры и платежей получают минимально необходимые данные по договору. Мы храним
          данные не дольше, чем нужно для целей обработки, если иной срок не требуется законом. При удалении
          аккаунта обезличиваются сообщения, комментарии, тексты и вложения заданий, заметки, AI-запросы,
          уведомления и устройства. Платёжные, налоговые, сертификатные и аудиторские записи сохраняются в
          обязательном объёме; документы, подтверждающие расчёты, могут храниться не менее 6 лет, а
          бухгалтерские документы — в сроки, установленные законодательством КР об архивном деле. Точный срок
          для конкретной организации должен определить юрист и бухгалтер.
        </p>

        <h2>7. Ваши права</h2>
        <ul>
          <li>получить информацию об обработке и копию своих данных;</li>
          <li>исправить неточные данные;</li>
          <li>отозвать необязательное согласие и возразить против маркетинга;</li>
          <li>запросить удаление аккаунта и данных, которые не требуется сохранять по закону;</li>
          <li>обжаловать обработку в уполномоченном органе по защите персональных данных.</li>
        </ul>

        <h2>8. Безопасность</h2>
        <p>
          Пароли хранятся только в виде криптографических хешей. Сессии защищены, подозрительные входы
          блокируются, для важных операций запрашивается повторное подтверждение. Загружаемые файлы проходят
          проверку типа, размера и безопасности; ведётся журнал загрузок и скачиваний. Чувствительные поля
          шифруются.
        </p>

        <h2 id="marketing">9. Маркетинговые сообщения</h2>
        <p>
          Рекламные и информационные рассылки отправляются только при отдельном согласии. Отказ не мешает
          получать сервисные сообщения о занятиях, оценках и безопасности.
        </p>

        <h2>10. Изменения документа</h2>
        <p>
          Новая редакция публикуется с новой версией и датой. История согласий с версиями документов хранится
          в аккаунте и доступна ниже.
        </p>

        {loggedIn ? (
          <section className="legal-panel">
            <h2>Ваши согласия</h2>
            {state.isLoading ? <div className="state">Загрузка…</div> : null}
            {state.error ? <div className="alert alert-error">{errorMessage(state.error)}</div> : null}
            {state.data ? (
              <>
                <ul className="consent-list">
                  {state.data.documents.map((document) => (
                    <li key={document.type}>
                      <div>
                        <strong>{document.title}</strong>
                        <div className="muted small">
                          Версия {document.version} · {document.required ? 'обязательное' : 'необязательное'}
                        </div>
                      </div>
                      <ConsentBadge record={latest.get(document.type)} />
                    </li>
                  ))}
                </ul>

                {state.data.guardianRequired ? (
                  <div className="legal-subpanel">
                    <h3>Подтверждение законного представителя</h3>
                    <p className="muted">
                      Для обучающегося младше 18 лет укажите родителя или опекуна. Для ребёнка младше 14 лет
                      согласие представителя обязательно; с 14 до 18 лет платформа запрашивает подтверждение для
                      договора об обучении. Сохраняются дата и версия согласия.
                    </p>
                    {state.data.guardian?.confirmedAt ? (
                      <p className="badge badge-success">
                        Подтверждено: {state.data.guardian.name} ·{' '}
                        {new Date(state.data.guardian.confirmedAt).toLocaleDateString('ru-RU')}
                      </p>
                    ) : (
                      <div className="form-grid">
                        <label>
                          ФИО представителя
                          <input value={guardianName} onChange={(event) => setGuardianName(event.target.value)} />
                        </label>
                        <label>
                          Телефон
                          <input value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} />
                        </label>
                        <label className="span-2 checkbox-row">
                          <input
                            type="checkbox"
                            checked={guardianConfirmed}
                            onChange={(event) => setGuardianConfirmed(event.target.checked)}
                          />
                          Подтверждаю, что являюсь законным представителем и согласен на обработку данных ребёнка
                        </label>
                        <button
                          className="btn btn-primary"
                          disabled={!guardianConfirmed || guardianConsent.isPending}
                          onClick={() => guardianConsent.mutate()}
                        >
                          Сохранить согласие
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                <details>
                  <summary>История согласий</summary>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Дата</th>
                          <th>Тип</th>
                          <th>Версия</th>
                          <th>Статус</th>
                          <th>IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.data.history.map((record) => (
                          <tr key={record.id}>
                            <td>{new Date(record.createdAt).toLocaleString('ru-RU')}</td>
                            <td>{consentLabels[record.type]}</td>
                            <td>{record.documentVersion}</td>
                            <td>{record.granted ? 'предоставлено' : 'отозвано'}</td>
                            <td>{record.ip ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : null}

            <h2>Удаление аккаунта</h2>
            <p>
              Запрос рассматривает администратор. Разрешённые данные удаляются, а сведения, которые необходимо
              хранить по закону (например, расчёты и налоговые документы), сохраняются. История обработки
              запроса остаётся в системе.
            </p>
            {notice ? <div className="alert alert-success">{notice}</div> : null}
            {requestDeletion.error ? (
              <div className="alert alert-error">{errorMessage(requestDeletion.error)}</div>
            ) : null}
            {activeDeletion ? (
              <div className="legal-subpanel">
                <p>
                  <strong>Запрос от {new Date(activeDeletion.requestedAt).toLocaleString('ru-RU')}</strong> —
                  рассматривается администратором.
                </p>
                <button
                  className="btn"
                  disabled={cancelDeletion.isPending}
                  onClick={() => cancelDeletion.mutate(activeDeletion.id)}
                >
                  Отменить запрос
                </button>
              </div>
            ) : (
              <div className="form-grid">
                <label className="span-2">
                  Причина (необязательно)
                  <textarea
                    rows={3}
                    value={reason}
                    maxLength={2000}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Почему вы хотите удалить аккаунт"
                  />
                </label>
                <button
                  className="btn btn-danger"
                  disabled={requestDeletion.isPending}
                  onClick={() => requestDeletion.mutate()}
                >
                  Подать запрос на удаление
                </button>
              </div>
            )}

            {deletion.data?.length ? (
              <details open>
                <summary>История запросов на удаление</summary>
                <div className="stack">
                  {deletion.data.map((request) => (
                    <div className="legal-subpanel" key={request.id}>
                      <div className="row-between">
                        <strong>{new Date(request.requestedAt).toLocaleString('ru-RU')}</strong>
                        <span className="badge">{request.status}</span>
                      </div>
                      {request.reason ? <p className="muted">Причина: {request.reason}</p> : null}
                      <ul className="timeline">
                        {request.events.map((event) => (
                          <li key={event.id}>
                            <span>{new Date(event.createdAt).toLocaleString('ru-RU')}</span> — {event.status}
                            {event.comment ? `: ${event.comment}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </section>
        ) : (
          <div className="legal-panel">
            <h2>Управление данными</h2>
            <p>Войдите, чтобы увидеть историю согласий и подать запрос на удаление аккаунта.</p>
            <Link className="btn btn-primary" to="/login">
              Войти
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}
