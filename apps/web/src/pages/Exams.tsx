import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { examsApi, gradingApi, testsApi, type ExamDetail } from '../api/assessment'
import { errorMessage, getSession } from '../api/client'
import { Empty, PageHeader, Section, formatDateTime } from '../components/ui'

const phaseLabels: Record<string, string> = {
  UPCOMING: 'Скоро',
  ACTIVE: 'Идёт',
  FINISHED: 'Завершён',
}

const attemptStatusLabels: Record<string, string> = {
  IN_PROGRESS: 'продолжается',
  SUBMITTED: 'отправлена',
  EXPIRED: 'время истекло',
}

function toLocalInput(value: Date) {
  const offset = value.getTimezoneOffset()
  return new Date(value.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

/** Экзамены: расписание, регистрация, попытки, результаты и уведомления. */
export function ExamsPage() {
  const role = getSession()?.role
  return role === 'STUDENT' ? <StudentExams /> : <StaffExams />
}

function StudentExams() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const exams = useQuery({ queryKey: ['exams-list'], queryFn: examsApi.list })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['exams-list'] })
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const register = useMutation({
    mutationFn: (id: string) => examsApi.register(id),
    onSuccess: refresh,
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось зарегистрироваться')),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => examsApi.cancel(id),
    onSuccess: refresh,
  })

  return (
    <div className="stack">
      <PageHeader title="Экзамены" subtitle="Расписание, регистрация, попытки и результаты." />
      {error ? <div className="alert alert-error">{error}</div> : null}
      {exams.isLoading ? <p className="muted">Загрузка…</p> : null}
      {exams.data && exams.data.length === 0 ? <Empty>Опубликованных экзаменов пока нет.</Empty> : null}

      <div className="saved-grid">
        {exams.data?.map((exam) => {
          const registered = exam.myRegistration === 'REGISTERED'
          const attemptsLeft = Math.max(0, exam.maxAttempts - exam.myAttempts)
          const canStart = exam.phase === 'ACTIVE' && registered && (exam.hasActiveAttempt || attemptsLeft > 0)
          const canRegister = exam.registrationOpen && !registered
          return (
            <article className="saved-card" key={exam.id}>
              <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                <span className={`badge ${exam.phase === 'ACTIVE' ? 'badge-active' : ''}`}>{phaseLabels[exam.phase]}</span>
                <span className="muted small">{exam.durationMinutes} мин</span>
              </div>
              <strong>{exam.title}</strong>
              {exam.course ? <p className="muted small">{exam.course.title}</p> : null}
              <p className="muted small">
                {formatDateTime(exam.startsAt)} — {formatDateTime(exam.endsAt)}
              </p>
              <p className="muted small">
                Тест «{exam.test.title}» · вопросов {exam.test.questions} · порог {exam.passingScore}% · попыток {exam.maxAttempts}
              </p>
              {exam.myAttempts > 0 ? (
                <p className="muted small">Попыток: {exam.myAttempts} · лучший результат {exam.myBestPercent}%</p>
              ) : null}

              <div className="row-actions">
                {canStart ? (
                  <button className="button" type="button" onClick={() => navigate(`/tests/${exam.test.id}/take?exam=${exam.id}`)}>
                    {exam.hasActiveAttempt ? 'Продолжить' : 'Начать экзамен'}
                  </button>
                ) : null}
                {registered && !canStart && !exam.hasActiveAttempt ? (
                  <span className="badge">Попытки исчерпаны</span>
                ) : null}
                {canRegister ? (
                  <button className="button button-ghost" type="button" onClick={() => register.mutate(exam.id)} disabled={register.isPending}>
                    Зарегистрироваться
                  </button>
                ) : null}
                {!registered && !canRegister && exam.phase === 'ACTIVE' ? (
                  <span className="badge">Регистрация закрыта</span>
                ) : null}
                {registered && exam.phase === 'UPCOMING' ? (
                  <button className="button button-ghost button-small" type="button" onClick={() => cancel.mutate(exam.id)}>
                    Отменить регистрацию
                  </button>
                ) : null}
                {registered ? <span className="badge badge-active">вы зарегистрированы</span> : null}
              </div>
              {exam.myAttemptHistory?.length ? (
                <div className="stack-sm">
                  <span className="muted small">История попыток</span>
                  <ul className="list">
                    {exam.myAttemptHistory.map((attempt, index) => (
                      <li key={attempt.id}>
                        <span className="muted small">
                          Попытка {exam.myAttemptHistory.length - index} · {attemptStatusLabels[attempt.status] ?? attempt.status}
                          {attempt.percent !== null ? ` · ${attempt.percent}%` : ''}
                          {attempt.needsManualReview ? ' · ждёт проверки' : ''}
                        </span>
                        <Link className="link" to={attempt.status === 'IN_PROGRESS' ? `/tests/${exam.test.id}/take?exam=${exam.id}` : `/attempts/${attempt.id}/result`}>
                          {attempt.status === 'IN_PROGRESS' ? 'Продолжить' : 'Результат'}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function StaffExams() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const exams = useQuery({ queryKey: ['exams-list'], queryFn: examsApi.list })
  const tests = useQuery({ queryKey: ['tests-list'], queryFn: testsApi.list })
  const scales = useQuery({ queryKey: ['grading-scales'], queryFn: gradingApi.list })
  const detail = useQuery({
    queryKey: ['exam-detail', selected],
    queryFn: () => examsApi.detail(selected!),
    enabled: Boolean(selected),
  })

  const [form, setForm] = useState({
    testId: '',
    title: '',
    description: '',
    instructions: '',
    startsAt: toLocalInput(new Date(Date.now() + 86400_000)),
    endsAt: toLocalInput(new Date(Date.now() + 86400_000 + 3600_000)),
    durationMinutes: 60,
    maxAttempts: 1,
    passingScore: 60,
    allowLateRegistration: false,
    gradingScaleId: '',
  })

  const create = useMutation({
    mutationFn: () =>
      examsApi.create({
        testId: form.testId,
        title: form.title,
        description: form.description,
        instructions: form.instructions,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        durationMinutes: form.durationMinutes,
        maxAttempts: form.maxAttempts,
        passingScore: form.passingScore,
        allowLateRegistration: form.allowLateRegistration,
        ...(form.gradingScaleId ? { gradingScaleId: form.gradingScaleId } : {}),
      }),
    onSuccess: (exam) => {
      setCreating(false)
      setError(null)
      setSelected(exam.id)
      queryClient.invalidateQueries({ queryKey: ['exams-list'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось создать экзамен')),
  })

  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => examsApi.publish(id, published),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams-list'] })
      queryClient.invalidateQueries({ queryKey: ['exam-detail', selected] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось изменить публикацию')),
  })

  return (
    <div className="stack">
      <PageHeader
        title="Экзамены"
        subtitle="Расписание, регистрация учеников, ограничения, результаты и история попыток."
        actions={
          <div className="row-actions">
            <Link className="button button-ghost" to="/tests">Тесты</Link>
            <button className="button" type="button" onClick={() => setCreating((value) => !value)}>
              {creating ? 'Свернуть' : 'Новый экзамен'}
            </button>
          </div>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      {creating ? (
        <Section title="Новый экзамен" subtitle="Экзамен проводится по существующему тесту">
          <form className="stack-sm" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
            <label className="field">
              <span>Тест</span>
              <select value={form.testId} onChange={(event) => {
                const test = tests.data?.find((item) => item.id === event.target.value)
                setForm({ ...form, testId: event.target.value, title: form.title || (test ? `Экзамен: ${test.title}` : '') })
              }} required>
                <option value="">Выберите тест</option>
                {tests.data?.map((test) => (
                  <option key={test.id} value={test.id}>{test.title} · {test.course.title} · {test.questions} вопросов</option>
                ))}
              </select>
            </label>
            <label className="field"><span>Название экзамена</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={3} /></label>
            <label className="field"><span>Описание</span><textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label className="field"><span>Инструкции для ученика</span><textarea rows={2} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
            <div className="form-row">
              <label className="field"><span>Начало</span><input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required /></label>
              <label className="field"><span>Окончание</span><input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} required /></label>
            </div>
            <div className="form-row">
              <label className="field"><span>Длительность, минут</span><input type="number" min={1} max={600} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })} /></label>
              <label className="field"><span>Попыток</span><input type="number" min={1} max={10} value={form.maxAttempts} onChange={(event) => setForm({ ...form, maxAttempts: Number(event.target.value) })} /></label>
              <label className="field"><span>Проходной, %</span><input type="number" min={0} max={100} value={form.passingScore} onChange={(event) => setForm({ ...form, passingScore: Number(event.target.value) })} /></label>
            </div>
            <label className="field">
              <span>Шкала оценивания</span>
              <select value={form.gradingScaleId} onChange={(event) => setForm({ ...form, gradingScaleId: event.target.value })}>
                <option value="">Без шкалы</option>
                {scales.data?.map((scale) => <option key={scale.id} value={scale.id}>{scale.name}</option>)}
              </select>
            </label>
            <label className="switch">
              <input type="checkbox" checked={form.allowLateRegistration} onChange={(event) => setForm({ ...form, allowLateRegistration: event.target.checked })} />
              <span>Регистрация после начала</span>
            </label>
            <button className="button" type="submit" disabled={create.isPending}>Создать экзамен</button>
          </form>
        </Section>
      ) : null}

      <Section title="Расписание экзаменов" subtitle="Черновики и опубликованные экзамены">
        {exams.isLoading ? <p className="muted">Загрузка…</p> : null}
        {exams.data && exams.data.length === 0 ? <Empty>Экзаменов пока нет.</Empty> : null}
        <div className="course-table">
          {exams.data?.map((exam) => (
            <article className="course-row" key={exam.id}>
              <div className="course-row-main">
                <div className="course-row-title">
                  <strong>{exam.title}</strong>
                  <span className={`badge ${exam.isPublished ? 'badge-active' : 'badge-draft'}`}>{exam.isPublished ? 'опубликован' : 'черновик'}</span>
                  <span className="badge">{phaseLabels[exam.phase]}</span>
                </div>
                <p className="muted small">
                  {exam.course?.title ?? 'Без курса'} · {formatDateTime(exam.startsAt)} — {formatDateTime(exam.endsAt)} · {exam.durationMinutes} мин
                </p>
                <p className="muted small">Тест: {exam.test.title} · регистраций: {exam.registrations} · попыток: {exam.attempts}</p>
              </div>
              <div className="row-actions">
                <button className="button button-ghost button-small" type="button" onClick={() => setSelected(exam.id)}>Регистрации и результаты</button>
                <button className="button button-small" type="button" onClick={() => publish.mutate({ id: exam.id, published: !exam.isPublished })}>
                  {exam.isPublished ? 'Снять' : 'Опубликовать'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {selected ? (
        <Section title="Экзамен" subtitle="Кто зарегистрирован и как прошли попытки" action={<button className="button button-ghost button-small" type="button" onClick={() => setSelected(null)}>Закрыть</button>}>
          {detail.isLoading ? <p className="muted">Загрузка…</p> : null}
          {detail.error ? <div className="alert alert-error">{errorMessage(detail.error)}</div> : null}
          {detail.data ? <ExamDetails exam={detail.data} /> : null}
        </Section>
      ) : null}
    </div>
  )
}

function ExamDetails({ exam }: { exam: ExamDetail }) {
  return (
    <div className="stack">
      <p>{exam.description}</p>
      {exam.instructions ? <p className="muted small">{exam.instructions}</p> : null}
      <div className="metrics">
        <div><dt>Регистраций</dt><dd>{exam.registrations?.length ?? 0}</dd></div>
        <div><dt>Попыток</dt><dd>{exam.results?.length ?? 0}</dd></div>
        <div><dt>Порог</dt><dd>{exam.passingScore}%</dd></div>
      </div>

      <h3>Регистрации</h3>
      {exam.registrations && exam.registrations.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ученик</th><th>Статус</th><th>Зарегистрирован</th></tr></thead>
            <tbody>
              {exam.registrations.map((registration) => (
                <tr key={registration.id}>
                  <td>{registration.student.name}<p className="muted small">{registration.student.email}</p></td>
                  <td><span className="badge">{registration.status === 'REGISTERED' ? 'зарегистрирован' : 'отменена'}</span></td>
                  <td className="muted small">{formatDateTime(registration.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Регистраций пока нет.</Empty>}

      {exam.analysis && exam.analysis.attempts > 0 ? (
        <>
          <h3>Анализ ошибок</h3>
          <p className="muted small">Статистика по завершённым попыткам: сначала самые проблемные темы и вопросы.</p>
          <div className="metrics">
            <div><dt>Завершённых попыток</dt><dd>{exam.analysis.attempts}</dd></div>
            <div><dt>Тем</dt><dd>{exam.analysis.topics.length}</dd></div>
          </div>
          {exam.analysis.topics.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Тема</th><th>Верно</th><th>Процент</th></tr></thead>
                <tbody>
                  {exam.analysis.topics.map((topic) => (
                    <tr key={topic.topic}>
                      <td>{topic.topic}</td>
                      <td>{topic.correct} / {topic.total}</td>
                      <td><span className={topic.percent < 60 ? 'badge badge-rejected' : 'badge badge-active'}>{topic.percent}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {exam.analysis.questions.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Вопрос</th><th>Тема</th><th>Верно</th><th>Процент</th></tr></thead>
                <tbody>
                  {exam.analysis.questions.map((question) => (
                    <tr key={question.id}>
                      <td>{question.prompt}</td>
                      <td className="muted small">{question.topic}</td>
                      <td>{question.correct} / {question.answered}</td>
                      <td><span className={question.percent < 60 ? 'badge badge-rejected' : 'badge badge-active'}>{question.percent}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      <h3>Результаты</h3>
      {exam.results && exam.results.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ученик</th><th>Попытка</th><th>Результат</th><th>Сдано</th><th /></tr></thead>
            <tbody>
              {exam.results.map((result) => (
                <tr key={result.id}>
                  <td>{result.student.name}<p className="muted small">{result.student.email}</p></td>
                  <td><span className="badge">{result.status}</span>{result.needsManualReview ? <span className="badge badge-warning">проверить</span> : null}</td>
                  <td>{result.percent !== null ? `${result.score} / ${result.maxScore} · ${result.percent}%` : '—'}</td>
                  <td className="muted small">{formatDateTime(result.submittedAt)}</td>
                  <td className="row-actions">
                    <Link className="button button-ghost button-small" to={`/attempts/${result.id}/result`}>Разбор</Link>
                    <Link className="button button-ghost button-small" to={`/tests/${exam.test.id}/edit`}>Тест</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Попыток пока нет.</Empty>}
    </div>
  )
}
