import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { attemptsApi, examsApi, testsApi, type AttemptPayload, type TestResult } from '../api/assessment'
import { errorMessage } from '../api/client'
import { Empty, PageHeader, Section } from '../components/ui'

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function answerText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'object' && item ? JSON.stringify(item) : String(item)))
      .join(', ')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Прохождение теста и экзамена: таймеры, автосохранение прогресса и разбор результата. */
export function TestTakePage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const examId = params.get('exam')
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [matching, setMatching] = useState<Record<string, Record<string, string>>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [questionExpiry, setQuestionExpiry] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [submitting, setSubmitting] = useState(false)
  const submittedRef = useRef(false)
  const expiredRef = useRef<string | null>(null)

  const start = useQuery({
    queryKey: ['attempt-start', id, examId],
    queryFn: () => (examId ? examsApi.start(examId) : testsApi.start(id)),
    retry: false,
    enabled: Boolean(id),
  })

  const payload: AttemptPayload | undefined = start.data

  useEffect(() => {
    if (!payload) return
    const next: Record<string, unknown> = {}
    const matchNext: Record<string, Record<string, string>> = {}
    for (const saved of payload.savedAnswers) {
      next[saved.questionId] = saved.value
      if (Array.isArray(saved.value)) {
        const map: Record<string, string> = {}
        for (const pair of saved.value) {
          if (pair && typeof pair === 'object') {
            const { left, right } = pair as { left?: string; right?: string }
            if (left && right) map[left] = right
          }
        }
        matchNext[saved.questionId] = map
      }
    }
    setAnswers(next)
    setMatching(matchNext)
    setQuestionExpiry(payload.questionExpiresAt)
    const firstUnanswered = payload.questions.findIndex((question) => next[question.id] === undefined)
    setCurrent(firstUnanswered >= 0 ? firstUnanswered : 0)
  }, [payload?.attemptId])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const question = payload?.questions[current]
  const answerFor = (questionId: string) => {
    const questionData = payload?.questions.find((item) => item.id === questionId)
    if (questionData?.type === 'MATCHING') {
      const map = matching[questionId] ?? {}
      const pairs = questionData.matchPairsLeft
        .filter((left) => map[left])
        .map((left) => ({ left, right: map[left] }))
      return pairs.length > 0 ? pairs : undefined
    }
    return answers[questionId]
  }

  const overallLeft = payload ? Math.max(0, Math.floor((new Date(payload.expiresAt).getTime() - now) / 1000)) : 0
  const questionLeft = questionExpiry
    ? Math.max(0, Math.floor((new Date(questionExpiry).getTime() - now) / 1000))
    : null

  const buildAnswers = () =>
    (payload?.questions ?? [])
      .map((item) => ({ questionId: item.id, value: answerFor(item.id) ?? null }))
      .filter((item) => item.value !== null)

  const submit = async () => {
    if (!payload || submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true)
    try {
      const saved = await attemptsApi.submit(payload.attemptId, buildAnswers())
      setResult(saved)
    } catch (submitError) {
      submittedRef.current = false
      setError(errorMessage(submitError, 'Не удалось отправить тест'))
    } finally {
      setSubmitting(false)
    }
  }

  // Автосохранение прогресса: ученик может закрыть вкладку и продолжить позже.
  useEffect(() => {
    if (!payload || result) return
    setSaveState('saving')
    const timer = setTimeout(() => {
      attemptsApi
        .progress(payload.attemptId, buildAnswers())
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'))
    }, 1200)
    return () => clearTimeout(timer)
  }, [answers, matching, payload?.attemptId, result])

  // Общий таймер: по истечении отправляем попытку автоматически.
  useEffect(() => {
    if (!payload || result || overallLeft > 0 || submittedRef.current) return
    void submit()
  }, [overallLeft])

  // Таймер вопроса: по истечении переходим дальше, а на последнем вопросе отправляем работу.
  useEffect(() => {
    if (!question || questionLeft === null || questionLeft > 0) return
    if (expiredRef.current === question.id) return
    expiredRef.current = question.id
    if (payload && current < payload.questions.length - 1) setCurrent((index) => index + 1)
    else void submit()
  }, [questionLeft, question?.id, current])

  useEffect(() => {
    if (!payload || !question) return
    setQuestionExpiry(null)
    attemptsApi
      .focus(payload.attemptId, question.id)
      .then((saved) => setQuestionExpiry(saved.questionExpiresAt))
      .catch(() => undefined)
  }, [payload?.attemptId, question?.id])

  if (start.isLoading) return <div className="state">Готовим попытку…</div>
  if (start.error) return <div className="alert alert-error">{errorMessage(start.error, 'Не удалось начать тест')}</div>
  if (!payload) return null

  if (result) return <TestResultView result={result} />

  const answeredCount = payload.questions.filter((item) => answerFor(item.id) !== undefined).length
  const backLink = examId ? '/exams' : '/tests'

  return (
    <div className="stack">
      <PageHeader
        title={examId ? 'Экзамен' : 'Тест'}
        subtitle={`Вопросов: ${payload.questions.length} · отвечено: ${answeredCount} · прогресс сохраняется автоматически`}
        actions={
          <div className="row-actions">
            <span className={overallLeft < 60 ? 'badge badge-rejected' : 'badge'}>Всего: {formatClock(overallLeft)}</span>
            {questionLeft !== null ? (
              <span className={questionLeft < 10 ? 'badge badge-rejected' : 'badge'}>
                Вопрос: {formatClock(questionLeft)}
              </span>
            ) : null}
            <span className="badge">
              {saveState === 'saving' ? 'Сохранение…' : saveState === 'error' ? 'Не сохранено' : saveState === 'saved' ? 'Сохранено' : ''}
            </span>
          </div>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {payload.resumed ? <div className="alert">Продолжаем сохранённую попытку.</div> : null}

      {payload.questions.length === 0 ? <Empty>В тесте нет вопросов.</Empty> : null}

      {question ? (
        <div className="take-layout">
          <aside className="card take-nav" aria-label="Навигация по вопросам">
            {payload.questions.map((item, index) => {
              const answered = answerFor(item.id) !== undefined
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`take-dot${index === current ? ' take-dot-active' : ''}${answered ? ' take-dot-answered' : ''}`}
                  onClick={() => setCurrent(index)}
                  aria-label={`Вопрос ${index + 1}${answered ? ', отвечен' : ''}`}
                >
                  {index + 1}
                </button>
              )
            })}
          </aside>

          <div className="card take-question">
            <div className="row-actions" style={{ justifyContent: 'space-between' }}>
              <span className="eyebrow">Вопрос {current + 1} из {payload.questions.length}</span>
              <span className="badge">{question.points} б.</span>
            </div>
            <h2>{question.prompt}</h2>

            {question.type === 'SINGLE' ? (
              <div className="interactive-options">
                {question.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={answers[question.id] === option.id ? 'interactive-option interactive-picked' : 'interactive-option'}
                    onClick={() => setAnswers((state) => ({ ...state, [question.id]: option.id }))}
                  >
                    {option.text}
                  </button>
                ))}
              </div>
            ) : null}

            {question.type === 'MULTIPLE' ? (
              <div className="stack-sm">
                {question.options.map((option) => {
                  const selected = Array.isArray(answers[question.id]) ? (answers[question.id] as string[]) : []
                  return (
                    <label className="check-inline" key={option.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(option.id)}
                        onChange={(event) =>
                          setAnswers((state) => ({
                            ...state,
                            [question.id]: event.target.checked
                              ? [...selected, option.id]
                              : selected.filter((id) => id !== option.id),
                          }))
                        }
                      />
                      {option.text}
                    </label>
                  )
                })}
              </div>
            ) : null}

            {question.type === 'TEXT' ? (
              <textarea
                rows={5}
                value={typeof answers[question.id] === 'string' ? (answers[question.id] as string) : ''}
                onChange={(event) => setAnswers((state) => ({ ...state, [question.id]: event.target.value }))}
                placeholder="Ваш ответ"
              />
            ) : null}

            {question.type === 'MATCHING' ? (
              <div className="stack-sm">
                {question.matchPairsLeft.map((left) => (
                  <div className="row-actions" key={left}>
                    <span style={{ minWidth: 140 }}>{left}</span>
                    <select
                      value={matching[question.id]?.[left] ?? ''}
                      aria-label={`Сопоставление для ${left}`}
                      onChange={(event) =>
                        setMatching((state) => ({
                          ...state,
                          [question.id]: { ...(state[question.id] ?? {}), [left]: event.target.value },
                        }))
                      }
                    >
                      <option value="">Выберите</option>
                      {question.matchPairsRight.map((right) => (
                        <option key={right} value={right}>{right}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : null}

            {question.type === 'NUMBER' ? (
              <input
                type="number"
                step="any"
                value={answers[question.id] === undefined ? '' : String(answers[question.id])}
                onChange={(event) => setAnswers((state) => ({ ...state, [question.id]: Number(event.target.value) }))}
              />
            ) : null}

            {question.type === 'BOOLEAN' ? (
              <div className="row-actions">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    className={answers[question.id] === value ? 'interactive-option interactive-picked' : 'interactive-option'}
                    onClick={() => setAnswers((state) => ({ ...state, [question.id]: value }))}
                  >
                    {value ? 'Да' : 'Нет'}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="row-actions" style={{ justifyContent: 'space-between', marginTop: 16 }}>
              <button className="button button-ghost" type="button" disabled={current === 0} onClick={() => setCurrent((index) => index - 1)}>
                ← Назад
              </button>
              {current < payload.questions.length - 1 ? (
                <button className="button" type="button" onClick={() => setCurrent((index) => index + 1)}>
                  Далее →
                </button>
              ) : (
                <button
                  className="button"
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    if (window.confirm('Завершить тест и отправить ответы?')) void submit()
                  }}
                >
                  {submitting ? 'Отправляем…' : 'Завершить тест'}
                </button>
              )}
            </div>
          </div>

          <aside className="card take-side">
            <h3>Итог</h3>
            <p className="muted small">Отвечено {answeredCount} из {payload.questions.length}.</p>
            <button
              className="button"
              type="button"
              disabled={submitting}
              onClick={() => {
                if (window.confirm('Завершить тест и отправить ответы?')) void submit()
              }}
            >
              Завершить
            </button>
            <Link className="link" to={backLink}>Выйти без отправки</Link>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

function TestResultView({ result }: { result: TestResult }) {
  const correct = result.questions.filter((question) => question.isCorrect).length
  const backLink = result.examId ? '/exams' : '/tests'

  return (
    <div className="stack">
      <PageHeader
        title={
          result.needsManualReview
            ? `${result.examId ? 'Экзамен' : 'Тест'} отправлен на проверку`
            : result.examId
              ? 'Результат экзамена'
              : 'Результат теста'
        }
        subtitle={`${result.test.title} · ${result.test.course.title}`}
        actions={<Link className="button button-ghost" to={backLink}>← К списку</Link>}
      />

      <Section title="Итог" subtitle={result.needsManualReview ? 'Текстовые ответы проверит преподаватель: итог может измениться' : 'Автоматическая проверка завершена'}>
        <div className="metrics">
          <div><dt>Баллы</dt><dd>{result.score} / {result.maxScore}</dd></div>
          <div><dt>Процент</dt><dd>{result.percent}%</dd></div>
          <div><dt>Порог</dt><dd>{result.passingScore}%</dd></div>
          <div><dt>Верно</dt><dd>{correct} / {result.questions.length}</dd></div>
          {result.grade ? <div><dt>Оценка</dt><dd>{result.grade.label}</dd></div> : null}
        </div>
        <p className={result.needsManualReview ? 'badge badge-warning' : result.passed ? 'badge badge-passed' : 'badge badge-failed'}>
          {result.needsManualReview ? 'Ожидает ручной проверки' : result.passed ? 'Тест пройден' : 'Порог не достигнут'}
        </p>
        {result.scale ? (
          <p className="muted small">
            Шкала «{result.scale.name}»: {result.scale.bands.map((band) => `${band.label} ${band.minPercent}–${band.maxPercent}%`).join(' · ')}
          </p>
        ) : null}
      </Section>

      {result.recommendations.length > 0 ? (
        <Section title="Рекомендации по темам" subtitle="На что обратить внимание">
          <ul className="list">
            {result.recommendations.map((item) => (
              <li key={item.topic}>
                <div>
                  <strong>{item.topic}</strong>
                  <p className="muted small">{item.advice}</p>
                </div>
                <span className="badge badge-rejected">{item.errors} ошибок</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Разбор ошибок" subtitle="Ответы, правильные варианты и объяснения">
        <div className="stack">
          {result.questions.map((question, index) => (
            <article className={question.isCorrect ? 'block block-correct' : 'block block-wrong'} key={question.id}>
              <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                <strong>{index + 1}. {question.prompt}</strong>
                <span className={question.isCorrect ? 'badge badge-passed' : question.isCorrect === null ? 'badge' : 'badge badge-failed'}>
                  {question.isCorrect === null ? 'на проверке' : question.isCorrect ? 'верно' : 'неверно'} · {question.pointsAwarded} / {question.points}
                </span>
              </div>
              <p className="muted small">Ваш ответ: {answerText(question.answer)}</p>
              {question.correctAnswer ? <p className="muted small">Правильно: {answerText(question.correctAnswer)}</p> : null}
              {question.explanation ? <p>{question.explanation}</p> : null}
              {question.comment ? <p className="muted small">Комментарий преподавателя: {question.comment}</p> : null}
              {question.topic ? <span className="badge">{question.topic}</span> : null}
            </article>
          ))}
        </div>
      </Section>
    </div>
  )
}

/** Постоянная страница результата: доступна из истории попыток после перезагрузки. */
export function AttemptResultPage() {
  const { id = '' } = useParams()
  const result = useQuery({
    queryKey: ['attempt-result', id],
    queryFn: () => attemptsApi.result(id),
    enabled: Boolean(id),
  })

  if (result.isLoading) return <div className="state">Загрузка результата…</div>
  if (result.error) return <div className="alert alert-error">{errorMessage(result.error, 'Не удалось загрузить результат')}</div>
  if (!result.data) return null
  return <TestResultView result={result.data} />
}
