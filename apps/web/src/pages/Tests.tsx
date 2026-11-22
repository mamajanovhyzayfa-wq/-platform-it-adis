import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  attemptsApi,
  gradingApi,
  testsApi,
  type QuestionInput,
  type QuestionType,
  type TestDetail,
  type TestQuestion,
} from '../api/assessment'
import { lmsApi } from '../api/lms'
import { errorMessage, getSession } from '../api/client'
import { Empty, PageHeader, Section, formatDateTime } from '../components/ui'

const typeLabels: Record<string, string> = {
  SINGLE: 'Один ответ',
  MULTIPLE: 'Несколько ответов',
  TEXT: 'Текстовый ответ',
  MATCHING: 'Сопоставление',
  NUMBER: 'Число',
  BOOLEAN: 'Да/Нет',
}

const attemptStatusLabels: Record<string, string> = {
  IN_PROGRESS: 'продолжается',
  SUBMITTED: 'отправлена',
  EXPIRED: 'время истекло',
}

/** Экран тестов: у ученика — прохождение, у сотрудников — список и создание. */
export function TestsPage() {
  const role = getSession()?.role
  return role === 'STUDENT' ? <StudentTests /> : <StaffTests />
}

function StudentTests() {
  const tests = useQuery({ queryKey: ['tests-list'], queryFn: testsApi.list })
  return (
    <div className="stack">
      <PageHeader title="Тесты" subtitle="Все тесты доступных курсов: попытки, баллы и разбор ошибок." />
      {tests.isLoading ? <p className="muted">Загрузка…</p> : null}
      {tests.data && tests.data.length === 0 ? <Empty>Доступных тестов пока нет.</Empty> : null}
      <div className="saved-grid">
        {tests.data?.map((test) => {
          const canStart = test.questions > 0 && (test.hasActiveAttempt || test.myAttempts < test.attemptsAllowed)
          return (
            <article className="saved-card" key={test.id}>
              <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                <span className="badge">{test.questions} вопросов</span>
                <span className="muted small">{test.timeLimitMinutes} мин</span>
              </div>
              <strong>{test.title}</strong>
              <p className="muted small">{test.course.title}</p>
              {test.lesson ? <p className="muted small">Урок: {test.lesson.title}</p> : null}
              <p className="muted small">
                Попыток: {test.myAttempts} из {test.attemptsAllowed} · лучший результат {test.bestPercent}% · проходной {test.passingScore}%
              </p>
              {canStart ? (
                <Link className="button" to={`/tests/${test.id}/take`}>
                  {test.hasActiveAttempt ? 'Продолжить попытку' : 'Начать тест'}
                </Link>
              ) : (
                <span className="badge">{test.questions === 0 ? 'В тесте нет вопросов' : 'Попытки исчерпаны'}</span>
              )}
              {test.attemptHistory?.length ? (
                <div className="stack-sm" style={{ marginTop: 10 }}>
                  <span className="muted small">История попыток</span>
                  <ul className="list">
                    {test.attemptHistory.map((attempt, index) => (
                      <li key={attempt.id}>
                        <span className="muted small">
                          Попытка {test.attemptHistory.length - index} · {attemptStatusLabels[attempt.status] ?? attempt.status}
                          {attempt.percent !== null ? ` · ${attempt.percent}%` : ''}
                          {attempt.needsManualReview ? ' · ждёт проверки' : ''}
                        </span>
                        <Link className="link" to={attempt.status === 'IN_PROGRESS' ? `/tests/${test.id}/take` : `/attempts/${attempt.id}/result`}>
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

function StaffTests() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const tests = useQuery({ queryKey: ['tests-list'], queryFn: testsApi.list })
  const courses = useQuery({ queryKey: ['lms-courses'], queryFn: lmsApi.courses })
  const scales = useQuery({ queryKey: ['grading-scales'], queryFn: gradingApi.list })
  const [form, setForm] = useState({
    courseId: '',
    lessonId: '',
    title: '',
    description: '',
    timeLimitMinutes: 30,
    questionTimeLimitSeconds: '',
    passingScore: 60,
    attemptsAllowed: 3,
    shuffleQuestions: true,
    shuffleOptions: true,
    showExplanations: true,
    showCorrectAnswers: true,
    gradingScaleId: '',
  })

  const preview = useQuery({
    queryKey: ['lms-preview', form.courseId],
    queryFn: () => lmsApi.preview(form.courseId),
    enabled: Boolean(form.courseId),
  })

  const create = useMutation({
    mutationFn: () =>
      testsApi.create({
        courseId: form.courseId,
        ...(form.lessonId ? { lessonId: form.lessonId } : {}),
        title: form.title,
        description: form.description,
        timeLimitMinutes: form.timeLimitMinutes,
        questionTimeLimitSeconds: form.questionTimeLimitSeconds ? Number(form.questionTimeLimitSeconds) : null,
        passingScore: form.passingScore,
        attemptsAllowed: form.attemptsAllowed,
        shuffleQuestions: form.shuffleQuestions,
        shuffleOptions: form.shuffleOptions,
        showExplanations: form.showExplanations,
        showCorrectAnswers: form.showCorrectAnswers,
        gradingScaleId: form.gradingScaleId || null,
      }),
    onSuccess: (test) => {
      queryClient.invalidateQueries({ queryKey: ['tests-list'] })
      navigate(`/tests/${test.id}/edit`)
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось создать тест')),
  })

  const lessons = preview.data?.modules.flatMap((module) => module.lessons) ?? []

  return (
    <div className="stack">
      <PageHeader
        title="Тесты и экзамены"
        subtitle="Конструктор вопросов, банк вопросов наставника, таймеры и автоматическая проверка."
        actions={
          <div className="row-actions">
            <Link className="button button-ghost" to="/exams">Экзамены</Link>
            <button className="button" type="button" onClick={() => setCreating((value) => !value)}>
              {creating ? 'Свернуть' : 'Новый тест'}
            </button>
          </div>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      {creating ? (
        <Section title="Новый тест" subtitle="Тест создаётся внутри курса и может быть привязан к уроку">
          <form
            className="stack-sm"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            <div className="form-row">
              <label className="field">
                <span>Курс</span>
                <select value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value, lessonId: '' })} required>
                  <option value="">Выберите курс</option>
                  {courses.data?.map((course) => (
                    <option key={course.id} value={course.id}>{course.title}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Урок (необязательно)</span>
                <select value={form.lessonId} onChange={(event) => setForm({ ...form, lessonId: event.target.value })}>
                  <option value="">Тест на весь курс</option>
                  {lessons.map((lesson) => (
                    <option key={lesson.id} value={lesson.id}>{lesson.title}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Название</span>
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={3} />
            </label>
            <label className="field">
              <span>Описание</span>
              <textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Общий таймер, минут</span>
                <input type="number" min={1} max={600} value={form.timeLimitMinutes} onChange={(event) => setForm({ ...form, timeLimitMinutes: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Таймер на вопрос, секунд</span>
                <input type="number" min={5} max={3600} value={form.questionTimeLimitSeconds} placeholder="без ограничения" onChange={(event) => setForm({ ...form, questionTimeLimitSeconds: event.target.value })} />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Проходной балл, %</span>
                <input type="number" min={0} max={100} value={form.passingScore} onChange={(event) => setForm({ ...form, passingScore: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Попыток</span>
                <input type="number" min={1} max={20} value={form.attemptsAllowed} onChange={(event) => setForm({ ...form, attemptsAllowed: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Шкала оценивания</span>
                <select value={form.gradingScaleId} onChange={(event) => setForm({ ...form, gradingScaleId: event.target.value })}>
                  <option value="">Без шкалы</option>
                  {scales.data?.map((scale) => (
                    <option key={scale.id} value={scale.id}>{scale.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row-actions">
              <label className="switch"><input type="checkbox" checked={form.shuffleQuestions} onChange={(event) => setForm({ ...form, shuffleQuestions: event.target.checked })} /><span>Случайный порядок вопросов</span></label>
              <label className="switch"><input type="checkbox" checked={form.shuffleOptions} onChange={(event) => setForm({ ...form, shuffleOptions: event.target.checked })} /><span>Случайный порядок ответов</span></label>
              <label className="switch"><input type="checkbox" checked={form.showExplanations} onChange={(event) => setForm({ ...form, showExplanations: event.target.checked })} /><span>Показывать объяснения</span></label>
              <label className="switch"><input type="checkbox" checked={form.showCorrectAnswers} onChange={(event) => setForm({ ...form, showCorrectAnswers: event.target.checked })} /><span>Показывать верные ответы</span></label>
            </div>
            <button className="button" type="submit" disabled={create.isPending}>Создать тест</button>
          </form>
        </Section>
      ) : null}

      <Section title="Все тесты" subtitle="Черновики и опубликованные тесты">
        {tests.isLoading ? <p className="muted">Загрузка…</p> : null}
        {tests.data && tests.data.length === 0 ? <Empty>Тестов пока нет.</Empty> : null}
        <div className="course-table">
          {tests.data?.map((test) => (
            <article className="course-row" key={test.id}>
              <div className="course-row-main">
                <div className="course-row-title">
                  <Link to={`/tests/${test.id}/edit`}><strong>{test.title}</strong></Link>
                  <span className={test.isPublished ? 'badge badge-active' : 'badge badge-draft'}>
                    {test.isPublished ? 'опубликован' : 'черновик'}
                  </span>
                </div>
                <p className="muted small">
                  {test.course.title} · вопросов: {test.questions} · попыток: {test.submissions} · таймер {test.timeLimitMinutes} мин
                  {test.questionTimeLimitSeconds ? ` · вопрос ${test.questionTimeLimitSeconds} с` : ''}
                </p>
              </div>
              <div className="row-actions">
                <Link className="button button-small" to={`/tests/${test.id}/edit`}>Открыть</Link>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <BankSection />
    </div>
  )
}

function BankSection() {
  const queryClient = useQueryClient()
  const banks = useQuery({ queryKey: ['question-banks'], queryFn: testsApi.banks })
  const [selectedBank, setSelectedBank] = useState<string>('')
  const [title, setTitle] = useState('')
  const [showQuestionForm, setShowQuestionForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bank = useQuery({
    queryKey: ['question-bank', selectedBank],
    queryFn: () => testsApi.bank(selectedBank),
    enabled: Boolean(selectedBank),
  })

  const create = useMutation({
    mutationFn: () => testsApi.createBank({ title }),
    onSuccess: (created) => {
      setTitle('')
      setSelectedBank(created.id)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['question-banks'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось создать банк')),
  })

  const addQuestion = useMutation({
    mutationFn: (payload: QuestionInput) => testsApi.addBankQuestion(selectedBank, payload),
    onSuccess: () => {
      setShowQuestionForm(false)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['question-bank', selectedBank] })
      queryClient.invalidateQueries({ queryKey: ['question-banks'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось добавить вопрос в банк')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => testsApi.removeBankQuestion(id),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['question-bank', selectedBank] })
      queryClient.invalidateQueries({ queryKey: ['question-banks'] })
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось удалить вопрос')),
  })

  return (
    <Section title="Банк вопросов наставника" subtitle="Собственные вопросы для повторного использования в тестах">
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="row-actions">
        <select
          value={selectedBank}
          onChange={(event) => {
            setSelectedBank(event.target.value)
            setShowQuestionForm(false)
          }}
          aria-label="Банк вопросов"
        >
          <option value="">Выберите банк</option>
          {banks.data?.map((item) => (
            <option key={item.id} value={item.id}>{item.title} · {item.questions}</option>
          ))}
        </select>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название нового банка" />
        <button className="button button-small" type="button" onClick={() => title.trim().length >= 2 && create.mutate()} disabled={create.isPending}>
          Создать банк
        </button>
      </div>

      {bank.data ? (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          <div className="row-actions" style={{ justifyContent: 'space-between' }}>
            <p className="muted small">{bank.data.questions.length} вопросов в банке «{bank.data.title}»</p>
            <button className="button button-small" type="button" onClick={() => setShowQuestionForm((value) => !value)}>
              {showQuestionForm ? 'Свернуть форму' : 'Добавить вопрос'}
            </button>
          </div>
          {showQuestionForm ? (
            <QuestionForm
              key="bank-new"
              initial={null}
              pending={addQuestion.isPending}
              onSave={(payload) => addQuestion.mutate(payload)}
            />
          ) : null}
          <ul className="list">
            {bank.data.questions.map((question) => (
              <li key={question.id}>
                <div>
                  <strong>{question.prompt}</strong>
                  <p className="muted small">{typeLabels[question.type]} · {question.points} б.</p>
                </div>
                <button className="button button-ghost button-small" type="button" onClick={() => remove.mutate(question.id)}>
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  )
}

// ---------- редактор теста ----------

export function TestEditorPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const detail = useQuery({ queryKey: ['test-detail', id], queryFn: () => testsApi.detail(id), enabled: Boolean(id) })
  const scales = useQuery({ queryKey: ['grading-scales'], queryFn: gradingApi.list })
  const results = useQuery({ queryKey: ['test-results', id], queryFn: () => testsApi.results(id), enabled: Boolean(id) })
  const [editing, setEditing] = useState<TestQuestion | null>(null)
  const [showQuestionForm, setShowQuestionForm] = useState(false)
  const [reviewAttempt, setReviewAttempt] = useState<string | null>(null)
  const [bankId, setBankId] = useState('')
  const [bankSelection, setBankSelection] = useState<string[]>([])
  const banks = useQuery({ queryKey: ['question-banks'], queryFn: testsApi.banks })
  const bank = useQuery({
    queryKey: ['question-bank', bankId],
    queryFn: () => testsApi.bank(bankId),
    enabled: Boolean(bankId),
  })

  const [ai, setAi] = useState({
    topic: '',
    material: '',
    difficulty: 'MEDIUM',
    count: 5,
    types: ['SINGLE'] as QuestionType[],
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['test-detail', id] })
    queryClient.invalidateQueries({ queryKey: ['tests-list'] })
    queryClient.invalidateQueries({ queryKey: ['test-results', id] })
  }

  const addQuestion = useMutation({
    mutationFn: (payload: QuestionInput) => testsApi.addQuestion(id, payload),
    onSuccess: () => {
      setShowQuestionForm(false)
      setEditing(null)
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить вопрос')),
  })

  const updateQuestion = useMutation({
    mutationFn: ({ questionId, payload }: { questionId: string; payload: QuestionInput }) =>
      testsApi.updateQuestion(questionId, payload),
    onSuccess: () => {
      setShowQuestionForm(false)
      setEditing(null)
      refresh()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить вопрос')),
  })

  const removeQuestion = useMutation({
    mutationFn: (questionId: string) => testsApi.removeQuestion(questionId),
    onSuccess: refresh,
  })

  const publish = useMutation({
    mutationFn: (published: boolean) => testsApi.publish(id, published),
    onSuccess: refresh,
  })

  const importQuestions = useMutation({
    mutationFn: () => testsApi.importQuestions(id, bankSelection),
    onSuccess: (result) => {
      setBankSelection([])
      setError(null)
      refresh()
      void result
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось импортировать вопросы')),
  })

  const generate = useMutation({
    mutationFn: () =>
      testsApi.aiGenerate({
        ...(ai.topic.trim().length >= 3 ? { topic: ai.topic.trim() } : {}),
        ...(ai.material.trim() ? { material: ai.material } : {}),
        difficulty: ai.difficulty,
        count: ai.count,
        types: ai.types,
        testId: id,
      }),
    onSuccess: (result) => {
      setError(null)
      refresh()
      void result
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'AI-генерация недоступна')),
  })

  if (detail.isLoading) return <div className="state">Загрузка теста…</div>
  if (detail.error) return <div className="alert alert-error">{errorMessage(detail.error)}</div>
  if (!detail.data) return null
  const test: TestDetail = detail.data

  const saveQuestion = (payload: QuestionInput) => {
    if (editing) updateQuestion.mutate({ questionId: editing.id, payload })
    else addQuestion.mutate(payload)
  }

  return (
    <div className="stack">
      <PageHeader
        title={test.title}
        subtitle={`${test.course.title} · вопросов: ${test.questions.length} · попыток: ${test.attempts ?? 0}`}
        actions={
          <div className="row-actions">
            <Link className="button button-ghost" to="/tests">← Все тесты</Link>
            <button className="button button-ghost" type="button" onClick={() => publish.mutate(!test.isPublished)}>
              {test.isPublished ? 'Снять с публикации' : 'Опубликовать'}
            </button>
            <button className="button" type="button" onClick={() => { setEditing(null); setShowQuestionForm(true) }}>
              Добавить вопрос
            </button>
          </div>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {publish.isError ? <div className="alert alert-error">{errorMessage(publish.error)}</div> : null}

      <Section title="Настройки" subtitle="Таймеры, порядок, проверка и шкала">
        <TestSettings test={test} scales={scales.data ?? []} onSaved={refresh} onError={setError} />
      </Section>

      <Section title="Вопросы" subtitle="Четыре основных типа: один ответ, несколько, текст и сопоставление">
        {test.questions.length === 0 ? <Empty>Вопросов пока нет.</Empty> : null}
        <div className="block-editor-list">
          {test.questions.map((question, index) => (
            <article className="block-card" key={question.id}>
              <div className="block-card-head">
                <div>
                  <span className="badge">{typeLabels[question.type]} · {question.points} б.</span>
                  {question.topic ? <span className="badge">{question.topic}</span> : null}
                  <p><strong>{index + 1}. {question.prompt}</strong></p>
                </div>
                <div className="row-actions">
                  <button className="button button-ghost button-small" type="button" onClick={() => { setEditing(question); setShowQuestionForm(true) }}>
                    Изменить
                  </button>
                  <button className="button button-ghost button-small" type="button" onClick={() => removeQuestion.mutate(question.id)}>
                    Удалить
                  </button>
                </div>
              </div>
              {question.options && question.options.length > 0 ? (
                <ul className="list">
                  {question.options.map((option) => (
                    <li key={option.id}>
                      <span className={option.isCorrect ? 'interactive-correct' : ''}>{option.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {question.matchPairs && question.matchPairs.length > 0 ? (
                <p className="muted small">
                  Пары: {question.matchPairs.map((pair) => `${pair.left} → ${pair.right}`).join('; ')}
                </p>
              ) : null}
              {question.correctText ? <p className="muted small">Эталон: {question.correctText}</p> : null}
              {question.explanation ? <p className="muted small">Объяснение: {question.explanation}</p> : null}
            </article>
          ))}
        </div>
      </Section>

      {showQuestionForm ? (
        <Section
          title={editing ? 'Редактирование вопроса' : 'Новый вопрос'}
          subtitle="Правильные ответы и объяснение сохраняются на сервере"
          action={<button className="button button-ghost button-small" type="button" onClick={() => { setShowQuestionForm(false); setEditing(null) }}>Отмена</button>}
        >
          <QuestionForm
            key={editing?.id ?? 'new-question'}
            initial={editing}
            pending={addQuestion.isPending || updateQuestion.isPending}
            onSave={saveQuestion}
          />
        </Section>
      ) : null}

      <Section title="AI-генерация вопросов" subtitle="По теме, материалам, сложности и типам вопросов">
        <div className="form-row">
          <label className="field">
            <span>Тема</span>
            <input value={ai.topic} onChange={(event) => setAi({ ...ai, topic: event.target.value })} placeholder="Например: массивы в JavaScript" />
            <span className="muted small">Можно оставить пустой, если ниже указан учебный материал.</span>
          </label>
          <label className="field">
            <span>Сложность</span>
            <select value={ai.difficulty} onChange={(event) => setAi({ ...ai, difficulty: event.target.value })}>
              <option value="EASY">Лёгкая</option>
              <option value="MEDIUM">Средняя</option>
              <option value="HARD">Сложная</option>
            </select>
          </label>
          <label className="field">
            <span>Вопросов</span>
            <input type="number" min={1} max={30} value={ai.count} onChange={(event) => setAi({ ...ai, count: Number(event.target.value) })} />
          </label>
        </div>
        <label className="field">
          <span>Учебные материалы (необязательно)</span>
          <textarea rows={4} value={ai.material} onChange={(event) => setAi({ ...ai, material: event.target.value })} />
        </label>
        <div className="row-actions">
          {(['SINGLE', 'MULTIPLE', 'TEXT', 'MATCHING'] as QuestionType[]).map((type) => (
            <label className="switch" key={type}>
              <input
                type="checkbox"
                checked={ai.types.includes(type)}
                onChange={(event) =>
                  setAi((current) => ({
                    ...current,
                    types: event.target.checked ? [...current.types, type] : current.types.filter((item) => item !== type),
                  }))
                }
              />
              <span>{typeLabels[type]}</span>
            </label>
          ))}
        </div>
        <button
          className="button"
          type="button"
          disabled={
            generate.isPending ||
            (ai.topic.trim().length < 3 && !ai.material.trim()) ||
            ai.types.length === 0
          }
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? 'Генерируем…' : 'Сгенерировать и добавить вопросы'}
        </button>
        <p className="muted small">AI создаёт черновик вопросов; проверьте формулировки и правильные ответы перед публикацией.</p>
      </Section>

      <Section title="Импорт из банка" subtitle="Свои вопросы наставника">
        <div className="row-actions">
          <select value={bankId} onChange={(event) => { setBankId(event.target.value); setBankSelection([]) }}>
            <option value="">Выберите банк</option>
            {banks.data?.map((item) => (
              <option key={item.id} value={item.id}>{item.title} · {item.questions}</option>
            ))}
          </select>
          <button className="button button-small" type="button" onClick={() => importQuestions.mutate()} disabled={bankSelection.length === 0 || importQuestions.isPending}>
            Импортировать ({bankSelection.length})
          </button>
        </div>
        {bank.data ? (
          <ul className="list">
            {bank.data.questions.map((question) => (
              <li key={question.id}>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={bankSelection.includes(question.id)}
                    onChange={(event) =>
                      setBankSelection((current) =>
                        event.target.checked ? [...current, question.id] : current.filter((item) => item !== question.id),
                      )
                    }
                  />
                  {question.prompt}
                </label>
                <span className="muted small">{typeLabels[question.type]}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Результаты и ручная проверка" subtitle="Текстовые ответы проверяет преподаватель">
        {results.isLoading ? <p className="muted">Загрузка…</p> : null}
        {results.data && results.data.length === 0 ? <Empty>Попыток пока нет.</Empty> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Ученик</th><th>Статус</th><th>Результат</th><th>Сдано</th><th /></tr>
            </thead>
            <tbody>
              {results.data?.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{attempt.student.name}<p className="muted small">{attempt.student.email}</p></td>
                  <td><span className="badge">{attempt.status}</span>{attempt.needsManualReview ? <span className="badge badge-warning">проверить</span> : null}</td>
                  <td>{attempt.percent !== null ? `${attempt.score} / ${attempt.maxScore} · ${attempt.percent}%` : '—'}</td>
                  <td className="muted small">{formatDateTime(attempt.submittedAt)}</td>
                  <td className="row-actions">
                    <Link className="button button-ghost button-small" to={`/attempts/${attempt.id}/result`}>Разбор</Link>
                    <button className="button button-ghost button-small" type="button" onClick={() => setReviewAttempt(attempt.id)}>
                      Проверить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reviewAttempt ? <AttemptReviewPanel attemptId={reviewAttempt} onClose={() => setReviewAttempt(null)} onSaved={refresh} /> : null}
      </Section>
    </div>
  )
}

function TestSettings({
  test,
  scales,
  onSaved,
  onError,
}: {
  test: TestDetail
  scales: Array<{ id: string; name: string }>
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [form, setForm] = useState({
    title: test.title,
    description: test.description ?? '',
    timeLimitMinutes: test.timeLimitMinutes,
    questionTimeLimitSeconds: test.questionTimeLimitSeconds?.toString() ?? '',
    passingScore: test.passingScore,
    attemptsAllowed: test.attemptsAllowed,
    shuffleQuestions: Boolean(test.shuffleQuestions),
    shuffleOptions: Boolean(test.shuffleOptions),
    showExplanations: test.showExplanations !== false,
    showCorrectAnswers: test.showCorrectAnswers !== false,
    gradingScaleId: test.gradingScaleId ?? '',
  })

  const save = useMutation({
    mutationFn: () =>
      testsApi.update(test.id, {
        title: form.title,
        description: form.description,
        timeLimitMinutes: form.timeLimitMinutes,
        questionTimeLimitSeconds: form.questionTimeLimitSeconds ? Number(form.questionTimeLimitSeconds) : null,
        passingScore: form.passingScore,
        attemptsAllowed: form.attemptsAllowed,
        shuffleQuestions: form.shuffleQuestions,
        shuffleOptions: form.shuffleOptions,
        showExplanations: form.showExplanations,
        showCorrectAnswers: form.showCorrectAnswers,
        gradingScaleId: form.gradingScaleId || null,
      }),
    onSuccess: onSaved,
    onError: (mutationError) => onError(errorMessage(mutationError, 'Не удалось сохранить настройки')),
  })

  return (
    <form
      className="stack-sm"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <div className="form-row">
        <label className="field"><span>Название</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className="field"><span>Общий таймер, мин</span><input type="number" min={1} max={600} value={form.timeLimitMinutes} onChange={(event) => setForm({ ...form, timeLimitMinutes: Number(event.target.value) })} /></label>
        <label className="field"><span>Таймер на вопрос, с</span><input type="number" min={5} max={3600} value={form.questionTimeLimitSeconds} onChange={(event) => setForm({ ...form, questionTimeLimitSeconds: event.target.value })} placeholder="нет" /></label>
      </div>
      <label className="field"><span>Описание</span><textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <div className="form-row">
        <label className="field"><span>Проходной, %</span><input type="number" min={0} max={100} value={form.passingScore} onChange={(event) => setForm({ ...form, passingScore: Number(event.target.value) })} /></label>
        <label className="field"><span>Попыток</span><input type="number" min={1} max={20} value={form.attemptsAllowed} onChange={(event) => setForm({ ...form, attemptsAllowed: Number(event.target.value) })} /></label>
        <label className="field">
          <span>Шкала</span>
          <select value={form.gradingScaleId} onChange={(event) => setForm({ ...form, gradingScaleId: event.target.value })}>
            <option value="">Без шкалы</option>
            {scales.map((scale) => <option key={scale.id} value={scale.id}>{scale.name}</option>)}
          </select>
        </label>
      </div>
      <div className="row-actions">
        <label className="switch"><input type="checkbox" checked={form.shuffleQuestions} onChange={(event) => setForm({ ...form, shuffleQuestions: event.target.checked })} /><span>Случайные вопросы</span></label>
        <label className="switch"><input type="checkbox" checked={form.shuffleOptions} onChange={(event) => setForm({ ...form, shuffleOptions: event.target.checked })} /><span>Случайные ответы</span></label>
        <label className="switch"><input type="checkbox" checked={form.showExplanations} onChange={(event) => setForm({ ...form, showExplanations: event.target.checked })} /><span>Объяснения</span></label>
        <label className="switch"><input type="checkbox" checked={form.showCorrectAnswers} onChange={(event) => setForm({ ...form, showCorrectAnswers: event.target.checked })} /><span>Верные ответы</span></label>
      </div>
      <button className="button" type="submit" disabled={save.isPending}>Сохранить настройки</button>
    </form>
  )
}

function QuestionForm({
  initial,
  pending,
  onSave,
}: {
  initial: TestQuestion | null
  pending: boolean
  onSave: (payload: QuestionInput) => void
}) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'SINGLE')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [points, setPoints] = useState(initial?.points ?? 1)
  const [explanation, setExplanation] = useState(initial?.explanation ?? '')
  const [topic, setTopic] = useState(initial?.topic ?? '')
  const [timeLimit, setTimeLimit] = useState(initial?.timeLimitSeconds?.toString() ?? '')
  const [options, setOptions] = useState<Array<{ text: string; isCorrect: boolean }>>(
    initial?.options?.map((option) => ({ text: option.text, isCorrect: option.isCorrect })) ?? [
      { text: '', isCorrect: true },
      { text: '', isCorrect: false },
    ],
  )
  const [pairs, setPairs] = useState<Array<{ left: string; right: string }>>(
    (initial?.matchPairs as Array<{ left: string; right: string }> | undefined) ?? [
      { left: '', right: '' },
      { left: '', right: '' },
    ],
  )
  const [correctText, setCorrectText] = useState(initial?.correctText ?? '')
  const [correctNumber, setCorrectNumber] = useState(initial?.correctNumber?.toString() ?? '')
  const [correctBoolean, setCorrectBoolean] = useState(initial?.correctBoolean ?? true)

  const submit = () => {
    onSave({
      type,
      prompt,
      points,
      ...(explanation ? { explanation } : {}),
      ...(topic ? { topic } : {}),
      ...(timeLimit ? { timeLimitSeconds: Number(timeLimit) } : {}),
      ...(type === 'SINGLE' || type === 'MULTIPLE' ? { options } : {}),
      ...(type === 'TEXT' && correctText ? { correctText } : {}),
      ...(type === 'MATCHING' ? { matchPairs: pairs } : {}),
      ...(type === 'NUMBER' ? { correctNumber: Number(correctNumber) } : {}),
      ...(type === 'BOOLEAN' ? { correctBoolean } : {}),
    })
  }

  return (
    <form className="stack-sm" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <div className="form-row">
        <label className="field">
          <span>Тип вопроса</span>
          <select value={type} onChange={(event) => setType(event.target.value as QuestionType)}>
            {(['SINGLE', 'MULTIPLE', 'TEXT', 'MATCHING', 'NUMBER', 'BOOLEAN'] as QuestionType[]).map((item) => (
              <option key={item} value={item}>{typeLabels[item]}</option>
            ))}
          </select>
        </label>
        <label className="field"><span>Баллы</span><input type="number" min={1} max={100} value={points} onChange={(event) => setPoints(Number(event.target.value))} /></label>
        <label className="field"><span>Таймер вопроса, с</span><input type="number" min={5} max={3600} value={timeLimit} onChange={(event) => setTimeLimit(event.target.value)} placeholder="как в тесте" /></label>
      </div>

      <label className="field"><span>Вопрос</span><textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} required /></label>

      {type === 'SINGLE' || type === 'MULTIPLE' ? (
        <div className="field">
          <span>Варианты и правильные ответы</span>
          {options.map((option, index) => (
            <div className="row-actions" key={`option-${index}`}>
              <input value={option.text} placeholder={`Вариант ${index + 1}`} onChange={(event) => setOptions((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, text: event.target.value } : row)))} />
              <label className="check-inline">
                <input
                  type={type === 'SINGLE' ? 'radio' : 'checkbox'}
                  name="correct-option"
                  checked={option.isCorrect}
                  onChange={(event) =>
                    setOptions((current) =>
                      current.map((row, rowIndex) => {
                        if (type === 'SINGLE') return { ...row, isCorrect: rowIndex === index }
                        return rowIndex === index ? { ...row, isCorrect: event.target.checked } : row
                      }),
                    )
                  }
                />
                верный
              </label>
              <button className="button button-ghost button-small" type="button" onClick={() => setOptions((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button>
            </div>
          ))}
          <button className="button button-ghost button-small" type="button" onClick={() => setOptions((current) => [...current, { text: '', isCorrect: false }])}>+ вариант</button>
        </div>
      ) : null}

      {type === 'TEXT' ? (
        <label className="field">
          <span>Эталонный ответ (если нужна автопроверка; пусто — проверит преподаватель)</span>
          <input value={correctText} onChange={(event) => setCorrectText(event.target.value)} />
        </label>
      ) : null}

      {type === 'MATCHING' ? (
        <div className="field">
          <span>Пары для сопоставления</span>
          {pairs.map((pair, index) => (
            <div className="row-actions" key={`pair-${index}`}>
              <input value={pair.left} placeholder="Левая часть" onChange={(event) => setPairs((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, left: event.target.value } : row)))} />
              <span>→</span>
              <input value={pair.right} placeholder="Правая часть" onChange={(event) => setPairs((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, right: event.target.value } : row)))} />
              <button className="button button-ghost button-small" type="button" onClick={() => setPairs((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button>
            </div>
          ))}
          <button className="button button-ghost button-small" type="button" onClick={() => setPairs((current) => [...current, { left: '', right: '' }])}>+ пара</button>
        </div>
      ) : null}

      {type === 'NUMBER' ? (
        <label className="field"><span>Правильное число</span><input type="number" step="any" value={correctNumber} onChange={(event) => setCorrectNumber(event.target.value)} /></label>
      ) : null}

      {type === 'BOOLEAN' ? (
        <label className="field">
          <span>Правильный ответ</span>
          <select value={String(correctBoolean)} onChange={(event) => setCorrectBoolean(event.target.value === 'true')}>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </label>
      ) : null}

      <label className="field"><span>Тема (для рекомендаций)</span><input value={topic} onChange={(event) => setTopic(event.target.value)} /></label>
      <label className="field"><span>Объяснение правильного ответа</span><textarea rows={2} value={explanation} onChange={(event) => setExplanation(event.target.value)} /></label>
      <button className="button" type="submit" disabled={pending}>{pending ? 'Сохраняем…' : 'Сохранить вопрос'}</button>
    </form>
  )
}

function AttemptReviewPanel({ attemptId, onClose, onSaved }: { attemptId: string; onClose: () => void; onSaved: () => void }) {
  const result = useQuery({ queryKey: ['attempt-result', attemptId], queryFn: () => attemptsApi.result(attemptId) })
  const [scores, setScores] = useState<Record<string, { points: number; comment: string }>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (result.data) {
      const next: Record<string, { points: number; comment: string }> = {}
      for (const question of result.data.questions) {
        next[question.id] = { points: question.pointsAwarded, comment: question.comment ?? '' }
      }
      setScores(next)
    }
  }, [result.data])

  const review = useMutation({
    mutationFn: () =>
      attemptsApi.review(
        attemptId,
        Object.entries(scores).map(([questionId, value]) => ({
          questionId,
          pointsAwarded: value.points,
          ...(value.comment ? { comment: value.comment } : {}),
        })),
      ),
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (mutationError) => setError(errorMessage(mutationError, 'Не удалось сохранить проверку')),
  })

  return (
    <div className="ai-panel" style={{ marginTop: 12 }}>
      <div className="row-actions" style={{ justifyContent: 'space-between' }}>
        <strong>Проверка попытки</strong>
        <button className="button button-ghost button-small" type="button" onClick={onClose}>Закрыть</button>
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {result.isLoading ? <p className="muted">Загрузка…</p> : null}
      {result.data ? (
        <div className="stack-sm">
          <p className="muted small">
            {result.data.student.name} · {result.data.score} / {result.data.maxScore} · {result.data.percent}%
            {result.data.needsManualReview ? ' · есть непроверенные текстовые ответы' : ''}
          </p>
          {result.data.questions.map((question) => (
            <article className="version-card" key={question.id}>
              <div className="row-actions" style={{ justifyContent: 'space-between' }}>
                <strong>{question.prompt}</strong>
                <span className="badge">{typeLabels[question.type]} · макс {question.points}</span>
              </div>
              <p className="muted small">Ответ: {typeof question.answer === 'string' ? question.answer : JSON.stringify(question.answer)}</p>
              {question.correctAnswer ? <p className="muted small">Верно: {typeof question.correctAnswer === 'string' ? question.correctAnswer : JSON.stringify(question.correctAnswer)}</p> : null}
              <div className="row-actions">
                <label className="field">
                  <span>Баллы</span>
                  <input
                    type="number"
                    min={0}
                    max={question.points}
                    value={scores[question.id]?.points ?? 0}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [question.id]: { points: Number(event.target.value), comment: current[question.id]?.comment ?? '' },
                      }))
                    }
                  />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>Комментарий</span>
                  <input
                    value={scores[question.id]?.comment ?? ''}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [question.id]: { points: current[question.id]?.points ?? 0, comment: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            </article>
          ))}
          <button className="button" type="button" onClick={() => review.mutate()} disabled={review.isPending}>
            Сохранить проверку и пересчитать итог
          </button>
        </div>
      ) : null}
    </div>
  )
}
