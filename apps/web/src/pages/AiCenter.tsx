import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, getSession } from '../api/client'
import { adminApi } from '../api/admin'
import { portalApi } from '../api/portal'
import { aiApi, type AiAutomation, type AiHistoryItem, type AiSource, type AiTool } from '../api/ai'
import { Empty, PageHeader, Section, StatusBadge, formatDateTime } from '../components/ui'

// Web Speech API не описан в lib.dom в нужном объёме: объявляем только те члены,
// которые использует компонент, вместо `any` на конструкторе.
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
type SpeechWindow = {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

const sourceLabels: Record<string, string> = {
  COURSE: 'Курс',
  LESSON: 'Урок',
  MATERIAL: 'Материал',
  DOCUMENT: 'Загруженный документ',
  PLATFORM: 'Платформа',
  EXTERNAL: 'Внешняя ссылка',
  MODEL: 'Общие знания модели',
}

const featureGroups = (tools: AiTool[]) => {
  const groups = new Map<string, AiTool[]>()
  for (const tool of tools) groups.set(tool.group, [...(groups.get(tool.group) ?? []), tool])
  return [...groups.entries()]
}

function SourceList({ sources }: { sources: AiSource[] }) {
  if (!sources.length) return <p className="muted small">Источники не указаны.</p>
  return (
    <ul className="ai-sources">
      {sources.map((source, index) => (
        <li key={`${source.title}-${index}`}>
          <span className="badge badge-muted">{sourceLabels[source.kind] ?? source.kind}</span>{' '}
          {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : <span>{source.title}</span>}
          {source.note ? <div className="muted small">{source.note}</div> : null}
        </li>
      ))}
    </ul>
  )
}

function AiAnswer({ result }: { result: { answer: string; sources: AiSource[]; assumptions: string[]; confidence: number; disclaimer: string; model: string; provider: string; durationMs: number } }) {
  return (
    <article className="card ai-answer">
      <div className="row-between">
        <span className="badge badge-ai">Сгенерировано ИИ</span>
        <span className="muted small">{result.provider === 'local' ? 'Локальный режим' : result.model} · {Math.round(result.durationMs)} мс · уверенность {result.confidence}%</span>
      </div>
      <div className="ai-answer-text">{result.answer}</div>
      <div className="ai-answer-grid">
        <div>
          <h4>Источники</h4>
          <SourceList sources={result.sources} />
        </div>
        <div>
          <h4>Что является предположением</h4>
          {result.assumptions.length ? <ul className="ai-assumptions">{result.assumptions.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted small">Явных предположений нет.</p>}
        </div>
      </div>
      <p className="ai-disclaimer">{result.disclaimer}</p>
    </article>
  )
}

/** AI-центр: инструменты для каждой роли, история, лимиты и визуальные автоматизации. */
export function AiCenterPage() {
  const role = getSession()?.role ?? 'STUDENT'
  const isAdmin = role === 'ADMIN'
  const isStaff = role === 'ADMIN' || role === 'MANAGER'
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'tools' | 'history' | 'automation' | 'settings' | 'errors'>('tools')
  const [tool, setTool] = useState('')
  const [message, setMessage] = useState('')
  const [language, setLanguage] = useState('ru')
  const [courseId, setCourseId] = useState('')
  const [homeworkId, setHomeworkId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [submissionId, setSubmissionId] = useState('')
  const [leadId, setLeadId] = useState('')
  const [externalUrls, setExternalUrls] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<typeof aiApi.run>> | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [errorsNote, setErrorsNote] = useState('')
  const [settingsForm, setSettingsForm] = useState<Record<string, unknown>>({})
  const [roleEdits, setRoleEdits] = useState<Record<string, { dailyRequests: number; monthlyTokens: number; model: string; allowedFeatures: string }>>({})
  const [userLimit, setUserLimit] = useState({ userId: '', dailyRequests: '', monthlyTokens: '', model: '', allowedFeatures: '' })
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null)
  const [automationForm, setAutomationForm] = useState({
    name: '', description: '', triggerType: 'MANUAL', schedule: '', requiresApproval: true,
    conditions: [{ type: 'ALWAYS', value: '' }],
    actions: [{ type: 'NOTIFY_ROLE', role: 'MANAGER', text: 'Проверьте новые события в филиале', userId: '' }],
  })
  const recognitionRef = useRef<{ stop: () => void } | null>(null)

  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status })
  const history = useQuery({ queryKey: ['ai-history', historyPage], queryFn: () => aiApi.history({ page: historyPage, limit: 20 }), enabled: tab === 'history' })
  const errors = useQuery({ queryKey: ['ai-errors'], queryFn: aiApi.errors, enabled: isStaff && tab === 'errors' })
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: aiApi.settings, enabled: isAdmin && tab === 'settings' })
  const automations = useQuery({ queryKey: ['ai-automations'], queryFn: aiApi.automations, enabled: isStaff && tab === 'automation' })
  const adminUsers = useQuery({ queryKey: ['ai-users-list'], queryFn: () => adminApi.users({ page: 1, limit: 100 }), enabled: isAdmin && tab === 'settings' })
  const studentPortal = useQuery({ queryKey: ['ai-student-portal'], queryFn: portalApi.student, enabled: role === 'STUDENT' })
  const mentorPortal = useQuery({ queryKey: ['ai-mentor-portal'], queryFn: portalApi.mentor, enabled: role === 'TEACHER' })
  const managerPortal = useQuery({ queryKey: ['ai-manager-portal'], queryFn: portalApi.manager, enabled: role === 'ADMIN' })

  const tools = status.data?.tools ?? []
  const selected = tools.find((item) => item.id === tool) ?? tools[0]
  const groups = useMemo(() => featureGroups(tools), [tools])

  useEffect(() => {
    if (!tool && tools[0]) setTool(tools[0].id)
  }, [tool, tools])

  useEffect(() => {
    if (settings.data) {
      setSettingsForm({
        enabled: settings.data.setting.enabled,
        provider: settings.data.setting.provider,
        model: settings.data.setting.model,
        dailyDefault: settings.data.setting.dailyDefault,
        maxTokens: settings.data.setting.maxTokens,
        allowExternalSources: settings.data.setting.allowExternalSources,
      })
      setRoleEdits(Object.fromEntries(settings.data.roleLimits.map((row) => [row.role, {
        dailyRequests: row.dailyRequests,
        monthlyTokens: row.monthlyTokens,
        model: row.model ?? '',
        allowedFeatures: (row.allowedFeatures ?? settings.data.catalog[row.role]?.map((tool) => tool.id) ?? []).join(', '),
      }])))
    }
  }, [settings.data])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    void queryClient.invalidateQueries({ queryKey: ['ai-history'] })
    void queryClient.invalidateQueries({ queryKey: ['ai-errors'] })
  }

  const run = useMutation({
    mutationFn: () => aiApi.run({
      feature: selected?.id,
      ...(message.trim() ? { message: message.trim() } : {}),
      ...(courseId ? { courseId } : {}),
      ...(homeworkId ? { homeworkId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(submissionId ? { submissionId } : {}),
      ...(leadId ? { leadId } : {}),
      ...(externalUrls.trim() ? { externalUrls: externalUrls.split(/[\n,]+/).map((url) => url.trim()).filter(Boolean) } : {}),
      language,
    }),
    onSuccess: (data) => { setResult(data); setNotice(null); refresh() },
    onError: (error) => { setNotice(errorMessage(error)); setResult(null) },
  })
  const removeHistory = useMutation({
    mutationFn: (id: string) => aiApi.deleteHistory(id),
    onSuccess: () => { setNotice('Запись удалена.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const clearHistory = useMutation({
    mutationFn: () => aiApi.clearHistory(),
    onSuccess: () => { setNotice('История AI очищена.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const flagHistory = useMutation({
    mutationFn: (payload: { id: string; feedback: string }) => aiApi.flagHistory(payload.id, payload.feedback),
    onSuccess: () => { setNotice('Спасибо! Ошибка отправлена ответственным сотрудникам.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const resolveError = useMutation({
    mutationFn: (payload: { id: string; resolution: string }) => aiApi.resolveError(payload.id, payload.resolution),
    onSuccess: () => { setNotice('Ошибка AI закрыта.'); void queryClient.invalidateQueries({ queryKey: ['ai-errors'] }) },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const saveSettings = useMutation({
    mutationFn: () => aiApi.updateSettings(settingsForm),
    onSuccess: () => { setNotice('Настройки AI сохранены.'); void queryClient.invalidateQueries({ queryKey: ['ai-settings'] }); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const saveRoleLimits = useMutation({
    mutationFn: () => Promise.all(Object.entries(roleEdits).map(([roleName, value]) => aiApi.updateRoleLimit(roleName, {
      dailyRequests: value.dailyRequests,
      monthlyTokens: value.monthlyTokens,
      ...(value.model ? { model: value.model } : {}),
      ...(value.allowedFeatures.trim() ? { allowedFeatures: value.allowedFeatures.split(',').map((item) => item.trim()).filter(Boolean) } : {}),
    }))),
    onSuccess: () => { setNotice('Лимиты ролей сохранены.'); void queryClient.invalidateQueries({ queryKey: ['ai-settings'] }); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const saveUserLimit = useMutation({
    mutationFn: () => aiApi.updateUserLimit(userLimit.userId, {
      dailyRequests: userLimit.dailyRequests,
      monthlyTokens: userLimit.monthlyTokens,
      model: userLimit.model,
      ...(userLimit.allowedFeatures.trim() ? { allowedFeatures: userLimit.allowedFeatures.split(',').map((item) => item.trim()).filter(Boolean) } : {}),
    }),
    onSuccess: () => { setNotice('Индивидуальный лимит сохранён.'); void queryClient.invalidateQueries({ queryKey: ['ai-settings'] }) },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const saveAutomation = useMutation({
    mutationFn: () => {
      const payload = {
        name: automationForm.name,
        description: automationForm.description,
        triggerType: automationForm.triggerType,
        schedule: automationForm.schedule,
        requiresApproval: automationForm.requiresApproval,
        conditions: automationForm.conditions.map((condition) => ({ type: condition.type, value: condition.value })),
        actions: automationForm.actions.map((action) => ({ type: action.type, config: { role: action.role, text: action.text, userId: action.userId } })),
      }
      return editingAutomationId ? aiApi.updateAutomation(editingAutomationId, payload) : aiApi.createAutomation(payload)
    },
    onSuccess: () => {
      setNotice(editingAutomationId ? 'Автоматизация обновлена.' : 'Автоматизация создана.')
      setEditingAutomationId(null)
      setAutomationForm({ name: '', description: '', triggerType: 'MANUAL', schedule: '', requiresApproval: true, conditions: [{ type: 'ALWAYS', value: '' }], actions: [{ type: 'NOTIFY_ROLE', role: 'MANAGER', text: 'Проверьте новые события в филиале', userId: '' }] })
      void queryClient.invalidateQueries({ queryKey: ['ai-automations'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const toggleAutomation = useMutation({
    mutationFn: (row: AiAutomation) => aiApi.updateAutomation(row.id, { enabled: !row.enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ai-automations'] }),
    onError: (error) => setNotice(errorMessage(error)),
  })
  const runAutomation = useMutation({
    mutationFn: (id: string) => aiApi.runAutomation(id),
    onSuccess: (data) => {
      setNotice(data.requiresApproval ? 'Действие ожидает подтверждения администратора.' : 'Автоматизация выполнена. Действия записаны в журнал.')
      void queryClient.invalidateQueries({ queryKey: ['ai-automations'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const approveRun = useMutation({
    mutationFn: (runId: string) => aiApi.approveRun(runId),
    onSuccess: () => { setNotice('Запуск подтверждён и выполнен.'); void queryClient.invalidateQueries({ queryKey: ['ai-automations'] }) },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const startVoice = () => {
    const speechWindow = window as unknown as SpeechWindow
    const Speech = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Speech) { setNotice('Голосовой ввод не поддерживается этим браузером.'); return }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    const recognition = new Speech()
    recognition.lang = language === 'ky' ? 'ky-KG' : language === 'en' ? 'en-US' : 'ru-RU'
    recognition.interimResults = false
    recognition.onresult = (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => {
      const text = Array.from(event.results).map((item) => item[0].transcript).join(' ')
      setMessage((current) => `${current} ${text}`.trim())
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => { setListening(false); setNotice('Не удалось распознать речь. Проверьте микрофон.') }
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  const speak = () => {
    if (!result || !('speechSynthesis' in window)) return
    const utterance = new SpeechSynthesisUtterance(result.answer)
    utterance.lang = language === 'ky' ? 'ky-KG' : language === 'en' ? 'en-US' : 'ru-RU'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

  const tabs = [
    { id: 'tools' as const, label: 'Инструменты' },
    { id: 'history' as const, label: 'Моя история' },
    ...(isStaff ? [{ id: 'automation' as const, label: 'Автоматизации' }, { id: 'errors' as const, label: 'Ошибки AI' }] : []),
    ...(isAdmin ? [{ id: 'settings' as const, label: 'Лимиты и доступ' }] : []),
  ]

  return (
    <div className="stack">
      <PageHeader
        title="AI-центр"
        subtitle="Отдельные AI-инструменты для учёбы, преподавания и управления. Ответы ИИ помечены и требуют проверки человеком."
      />
      {notice ? <div className="alert">{notice}</div> : null}

      <section className="ai-banner">
        <div>
          <span className="badge badge-ai">AI</span>
          <strong>{status.data?.configured ? `Модель: ${status.data.model}` : 'Локальный режим без генеративной модели'}</strong>
          <p className="muted small">
            {status.data?.configured
              ? 'Генеративные функции используют настроенную модель. Проверяйте важные сведения.'
              : 'Аналитические функции работают по данным платформы. Для генерации текста добавьте OPENAI_API_KEY в переменные окружения сервера.'}
          </p>
        </div>
        <div className="ai-usage">
          <span>Запросов сегодня</span>
          <strong>{status.data?.usage.today ?? 0} / {status.data?.limits.dailyRequests ?? '—'}</strong>
          <span>Токенов за месяц</span>
          <strong>{status.data?.usage.tokensThisMonth ?? 0}</strong>
        </div>
      </section>

      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'tab tab-active' : 'tab'} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'tools' ? (
        <div className="ai-layout">
          <aside className="ai-tools">
            {groups.map(([group, items]) => (
              <div key={group} className="ai-tool-group">
                <h3>{group}</h3>
                {items.map((item) => (
                  <button key={item.id} type="button" className={`ai-tool ${selected?.id === item.id ? 'ai-tool-active' : ''}`} onClick={() => { setTool(item.id); setResult(null); setNotice(null) }}>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                    {item.requiresProvider && !status.data?.configured ? <em>Нужен ключ модели</em> : null}
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <div className="stack">
            <Section title={selected?.title ?? 'Выберите инструмент'} subtitle={selected?.description}>
              <div className="ai-compose">
                <textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Опишите вопрос, тему или задание…" />
                <div className="ai-controls">
                  <label>Язык
                    <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                      <option value="ru">Русский</option>
                      <option value="ky">Кыргызча</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                  {role === 'STUDENT' && studentPortal.data?.courses.length ? (
                    <label>Курс
                      <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                        <option value="">Все курсы</option>
                        {studentPortal.data.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {role === 'STUDENT' && studentPortal.data?.homework.length ? (
                    <label>Задание
                      <select value={homeworkId} onChange={(event) => setHomeworkId(event.target.value)}>
                        <option value="">Без конкретного задания</option>
                        {studentPortal.data.homework.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.course}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {role === 'TEACHER' && mentorPortal.data?.students.items.length ? (
                    <label>Ученик
                      <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                        <option value="">Группа целиком</option>
                        {mentorPortal.data.students.items.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {role === 'ADMIN' && managerPortal.data?.leads.length ? (
                    <label>Заявка
                      <select value={leadId} onChange={(event) => setLeadId(event.target.value)}>
                        <option value="">Без конкретной заявки</option>
                        {managerPortal.data.leads.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>) }
                      </select>
                    </label>
                  ) : null}
                  {role === 'TEACHER' && mentorPortal.data?.pendingReviews.items.length ? (
                    <label>Работа на проверку
                      <select value={submissionId} onChange={(event) => setSubmissionId(event.target.value)}>
                        <option value="">Без конкретной работы</option>
                        {mentorPortal.data.pendingReviews.items.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.student}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <button className={`button button-small ${listening ? '' : 'button-ghost'}`} type="button" onClick={startVoice}>{listening ? 'Остановить голос' : 'Голосом'}</button>
                </div>
                {status.data?.allowExternalSources ? (
                  <label className="ai-external">Внешние источники (по одному URL в строке)
                    <input value={externalUrls} onChange={(event) => setExternalUrls(event.target.value)} placeholder="https://…" />
                  </label>
                ) : null}
                <div className="row-between">
                  <span className="muted small">AI помогает учиться и не выдаёт готовое решение задания.</span>
                  <div className="row-actions">
                    {result ? <button className="button button-small button-ghost" type="button" onClick={speak}>Озвучить</button> : null}
                    <button className="button" type="button" disabled={!selected || run.isPending} onClick={() => run.mutate()}>{run.isPending ? 'AI думает…' : 'Спросить AI'}</button>
                  </div>
                </div>
              </div>
            </Section>
            {result ? <AiAnswer result={result} /> : <Empty>Выберите инструмент и задайте вопрос. Ответ будет помечен как сгенерированный ИИ.</Empty>}
          </div>
        </div>
      ) : null}

      {tab === 'history' ? (
        <Section title="Моя история AI" subtitle="Вы управляете своей историей: можно удалить ответ или пожаловаться на ошибку" action={<button className="button button-small button-ghost" type="button" onClick={() => { if (window.confirm('Очистить всю историю AI?')) clearHistory.mutate() }}>Очистить всё</button>}>
          {history.data?.items.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Дата</th><th>Инструмент</th><th>Запрос</th><th>Ответ</th><th>Статус</th><th /></tr></thead>
                <tbody>
                  {history.data.items.map((item: AiHistoryItem) => (
                    <tr key={item.id}>
                      <td className="muted small">{formatDateTime(item.createdAt)}</td>
                      <td>{tools.find((entry) => entry.id === item.feature)?.title ?? item.feature}<div className="muted small">{item.model ?? '—'}</div></td>
                      <td className="small">{item.prompt.slice(0, 160) || '—'}</td>
                      <td className="small"><span className="badge badge-ai">AI</span> {(item.response ?? item.feedback ?? '—').slice(0, 220)}</td>
                      <td><StatusBadge status={item.status} />{item.isFlagged ? <span className="badge badge-warning">Жалоба</span> : null}</td>
                      <td>
                        <div className="row-actions">
                          <button className="button button-small button-ghost" type="button" onClick={() => {
                            const feedback = window.prompt('Что не так с ответом AI?')
                            if (feedback && feedback.trim().length >= 5) flagHistory.mutate({ id: item.id, feedback: feedback.trim() })
                          }}>Ошибка</button>
                          <button className="button button-small button-ghost" type="button" onClick={() => removeHistory.mutate(item.id)}>Удалить</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>История пока пуста.</Empty>}
          {history.data ? (
            <div className="pagination">
              <button className="button button-ghost" type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((value) => value - 1)}>Назад</button>
              <span className="muted small">Страница {historyPage} · всего {history.data.total}</span>
              <button className="button button-ghost" type="button" disabled={historyPage * 20 >= history.data.total} onClick={() => setHistoryPage((value) => value + 1)}>Вперёд</button>
            </div>
          ) : null}
        </Section>
      ) : null}

      {tab === 'automation' && isStaff ? (
        <>
          <Section title="Визуальный редактор автоматизаций" subtitle="Событие → условия → действия. Критические действия требуют подтверждения">
            {automations.data ? (
              <>
                <div className="automation-flow">
                  <div className="automation-node"><span>1 · Событие</span><select value={automationForm.triggerType} onChange={(event) => setAutomationForm((current) => ({ ...current, triggerType: event.target.value }))}>{automations.data.triggers.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
                  <span className="automation-arrow">→</span>
                  <div className="automation-node"><span>2 · Условия</span><strong>{automationForm.conditions.length}</strong><small className="muted">проверяются перед действием</small></div>
                  <span className="automation-arrow">→</span>
                  <div className="automation-node"><span>3 · Действия</span><strong>{automationForm.actions.length}</strong><small className="muted">безопасные операции</small></div>
                </div>
                <div className="form-grid">
                  <label>Название<input value={automationForm.name} onChange={(event) => setAutomationForm((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label>Расписание<input value={automationForm.schedule} onChange={(event) => setAutomationForm((current) => ({ ...current, schedule: event.target.value }))} placeholder="Например: каждый понедельник 09:00" /></label>
                  <label className="span-2">Описание<input value={automationForm.description} onChange={(event) => setAutomationForm((current) => ({ ...current, description: event.target.value }))} /></label>
                  <label className="checkbox-label"><input type="checkbox" checked={automationForm.requiresApproval} onChange={(event) => setAutomationForm((current) => ({ ...current, requiresApproval: event.target.checked }))} /> Подтверждать запуск</label>
                </div>
                <div className="stack">
                  {automationForm.conditions.map((condition, index) => (
                    <div className="automation-action" key={`condition-${index}`}>
                      <strong>Условие {index + 1}</strong>
                      <select value={condition.type} onChange={(event) => setAutomationForm((current) => ({ ...current, conditions: current.conditions.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) }))}>
                        {automations.data?.conditions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                      <input value={condition.value} onChange={(event) => setAutomationForm((current) => ({ ...current, conditions: current.conditions.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} placeholder="Значение условия" />
                      {automationForm.conditions.length > 1 ? <button className="button button-small button-ghost" type="button" onClick={() => setAutomationForm((current) => ({ ...current, conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index) }))}>Убрать</button> : null}
                    </div>
                  ))}
                  <button className="button button-small button-ghost" type="button" onClick={() => setAutomationForm((current) => ({ ...current, conditions: [...current.conditions, { type: 'ROLE_IS', value: 'STUDENT' }] }))}>+ Добавить условие</button>
                </div>
                <div className="stack">
                  {automationForm.actions.map((action, index) => (
                    <div className="automation-action" key={`${action.type}-${index}`}>
                      <strong>Действие {index + 1}</strong>
                      <select value={action.type} onChange={(event) => setAutomationForm((current) => ({ ...current, actions: current.actions.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) }))}>
                        {automations.data?.actions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                      <select value={action.role} onChange={(event) => setAutomationForm((current) => ({ ...current, actions: current.actions.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value } : item) }))}>
                        {['STUDENT', 'TEACHER', 'MANAGER', 'ADMIN'].map((roleName) => <option key={roleName} value={roleName}>{roleName}</option>)}
                      </select>
                      <input value={action.text} onChange={(event) => setAutomationForm((current) => ({ ...current, actions: current.actions.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) }))} placeholder="Текст уведомления" />
                      <input value={action.userId} onChange={(event) => setAutomationForm((current) => ({ ...current, actions: current.actions.map((item, itemIndex) => itemIndex === index ? { ...item, userId: event.target.value } : item) }))} placeholder="ID получателя для NOTIFY_USER" />
                      {automationForm.actions.length > 1 ? <button className="button button-small button-ghost" type="button" onClick={() => setAutomationForm((current) => ({ ...current, actions: current.actions.filter((_, itemIndex) => itemIndex !== index) }))}>Убрать</button> : null}
                    </div>
                  ))}
                  <button className="button button-small button-ghost" type="button" onClick={() => setAutomationForm((current) => ({ ...current, actions: [...current.actions, { type: 'REMINDER', role: 'STUDENT', text: 'Проверьте расписание', userId: '' }] }))}>+ Добавить действие</button>
                </div>
                {isAdmin ? (
                  <div className="row-actions">
                    <button className="button" type="button" disabled={automationForm.name.trim().length < 2 || saveAutomation.isPending} onClick={() => saveAutomation.mutate()}>{editingAutomationId ? 'Сохранить изменения' : 'Создать автоматизацию'}</button>
                    {editingAutomationId ? <button className="button button-ghost" type="button" onClick={() => { setEditingAutomationId(null); setAutomationForm({ name: '', description: '', triggerType: 'MANUAL', schedule: '', requiresApproval: true, conditions: [{ type: 'ALWAYS', value: '' }], actions: [{ type: 'NOTIFY_ROLE', role: 'MANAGER', text: 'Проверьте новые события в филиале', userId: '' }] }) }}>Отменить редактирование</button> : null}
                  </div>
                ) : <p className="muted small">Создавать автоматизации может администратор филиала.</p>}
              </>
            ) : null}
          </Section>

          <Section title="Сценарии" subtitle="Каждый запуск и действие записываются в журнал">
            {automations.data?.automations.length ? automations.data.automations.map((row) => (
              <article className="card automation-card" key={row.id}>
                <div className="row-between">
                  <div><h3>{row.name}</h3><p className="muted small">{row.description ?? 'Без описания'}</p></div>
                  <div className="row-actions">
                    <span className={`badge ${row.enabled ? 'badge-active' : 'badge-muted'}`}>{row.enabled ? 'Включена' : 'Выключена'}</span>
                    {isAdmin ? <button className="button button-small button-ghost" type="button" onClick={() => toggleAutomation.mutate(row)}>{row.enabled ? 'Выключить' : 'Включить'}</button> : null}
                    {isAdmin ? <button className="button button-small button-ghost" type="button" onClick={() => {
                      setEditingAutomationId(row.id)
                      setAutomationForm({
                        name: row.name,
                        description: row.description ?? '',
                        triggerType: row.triggerType,
                        schedule: row.schedule ?? '',
                        requiresApproval: row.requiresApproval,
                        conditions: (row.conditions ?? []).map((condition) => ({ type: String(condition.type ?? 'ALWAYS'), value: String(condition.value ?? '') })),
                        actions: (row.actions ?? []).map((action) => {
                          const config = (action.config ?? {}) as Record<string, unknown>
                          return { type: String(action.type ?? 'NOTIFY_ROLE'), role: String(config.role ?? 'MANAGER'), text: String(config.text ?? ''), userId: String(config.userId ?? '') }
                        }),
                      })
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}>Изменить</button> : null}
                  </div>
                </div>
                <div className="automation-meta">
                  <span>Событие: <strong>{row.triggerType}</strong></span>
                  <span>Расписание: <strong>{row.schedule ?? 'вручную'}</strong></span>
                  <span>Условий: <strong>{row.conditions?.length ?? 0}</strong></span>
                  <span>Действий: <strong>{row.actions?.length ?? 0}</strong></span>
                  <span>Подтверждение: <strong>{row.requiresApproval ? 'да' : 'нет'}</strong></span>
                  <span>Последний запуск: <strong>{row.lastRunAt ? formatDateTime(row.lastRunAt) : '—'}</strong></span>
                </div>
                <div className="row-actions">
                  <button className="button button-small" type="button" disabled={runAutomation.isPending} onClick={() => runAutomation.mutate(row.id)}>Запустить</button>
                  {automations.data?.runs.filter((item) => item.automationId === row.id && item.status === 'PENDING_APPROVAL').map((item) => (
                    <button className="button button-small button-ghost" type="button" key={item.id} onClick={() => approveRun.mutate(item.id)}>Подтвердить запуск</button>
                  ))}
                </div>
              </article>
            )) : <Empty>Автоматизаций пока нет. Соберите первый сценарий выше.</Empty>}
          </Section>
        </>
      ) : null}

      {tab === 'errors' && isStaff ? (
        <Section title="Ошибки AI" subtitle="Автоматические ошибки и жалобы пользователей">
          {errors.data?.length ? errors.data.map((item) => (
            <article className="card" key={item.id}>
              <div className="row-between">
                <strong>{item.feature} · {item.user ? `${item.user.firstName} ${item.user.lastName}` : item.userId}</strong>
                <span className={`badge ${item.status === 'OPEN' ? 'badge-danger' : 'badge-active'}`}>{item.status === 'OPEN' ? 'Открыта' : 'Закрыта'}</span>
              </div>
              <p className="small">{item.message}</p>
              <p className="muted small">{formatDateTime(item.createdAt)}</p>
              {item.status === 'OPEN' ? (
                <div className="filters">
                  <input value={errorsNote} onChange={(event) => setErrorsNote(event.target.value)} placeholder="Что сделано / причина" />
                  <button className="button button-small" type="button" disabled={errorsNote.trim().length < 3} onClick={() => { resolveError.mutate({ id: item.id, resolution: errorsNote }); setErrorsNote('') }}>Закрыть обращение</button>
                </div>
              ) : <p className="muted small">{item.resolution}</p>}
            </article>
          )) : <Empty>Открытых ошибок AI нет.</Empty>}
        </Section>
      ) : null}

      {tab === 'settings' && isAdmin ? (
        <Section title="Лимиты и доступ AI" subtitle="Настройки действуют на филиал: роли, пользователи, функции и модели">
          <div className="form-grid">
            <label className="checkbox-label"><input type="checkbox" checked={Boolean(settingsForm.enabled)} onChange={(event) => setSettingsForm((current) => ({ ...current, enabled: event.target.checked }))} /> AI включён</label>
            <label className="checkbox-label"><input type="checkbox" checked={Boolean(settingsForm.allowExternalSources)} onChange={(event) => setSettingsForm((current) => ({ ...current, allowExternalSources: event.target.checked }))} /> Разрешать внешние ссылки</label>
            <label>Модель по умолчанию<input value={String(settingsForm.model ?? '')} onChange={(event) => setSettingsForm((current) => ({ ...current, model: event.target.value }))} /></label>
            <label>Дневной лимит по умолчанию<input type="number" min="1" value={Number(settingsForm.dailyDefault ?? 30)} onChange={(event) => setSettingsForm((current) => ({ ...current, dailyDefault: Number(event.target.value) }))} /></label>
            <label>Максимум токенов ответа<input type="number" min="100" value={Number(settingsForm.maxTokens ?? 900)} onChange={(event) => setSettingsForm((current) => ({ ...current, maxTokens: Number(event.target.value) }))} /></label>
          </div>
          <button className="button" type="button" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}>Сохранить настройки</button>

          <h3>Лимиты по ролям</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Роль</th><th>Запросов/день</th><th>Токенов/месяц</th><th>Модель</th><th>Доступные функции (через запятую)</th></tr></thead>
              <tbody>
                {Object.entries(roleEdits).map(([roleName, value]) => (
                  <tr key={roleName}>
                    <td><strong>{roleName}</strong></td>
                    <td><input type="number" min="0" value={value.dailyRequests} onChange={(event) => setRoleEdits((current) => ({ ...current, [roleName]: { ...value, dailyRequests: Number(event.target.value) } }))} /></td>
                    <td><input type="number" min="0" value={value.monthlyTokens} onChange={(event) => setRoleEdits((current) => ({ ...current, [roleName]: { ...value, monthlyTokens: Number(event.target.value) } }))} /></td>
                    <td><input value={value.model} onChange={(event) => setRoleEdits((current) => ({ ...current, [roleName]: { ...value, model: event.target.value } }))} placeholder="как у филиала" /></td>
                    <td><input value={value.allowedFeatures} onChange={(event) => setRoleEdits((current) => ({ ...current, [roleName]: { ...value, allowedFeatures: event.target.value } }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="button" type="button" disabled={saveRoleLimits.isPending} onClick={() => saveRoleLimits.mutate()}>Сохранить лимиты ролей</button>

          <h3>Индивидуальный лимит пользователя</h3>
          <div className="form-grid">
            <label>Пользователь<select value={userLimit.userId} onChange={(event) => setUserLimit((current) => ({ ...current, userId: event.target.value }))}><option value="">Выберите</option>{adminUsers.data?.items.map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName} · {user.role}</option>)}</select></label>
            <label>Запросов/день<input type="number" min="0" value={userLimit.dailyRequests} onChange={(event) => setUserLimit((current) => ({ ...current, dailyRequests: event.target.value }))} placeholder="как у роли" /></label>
            <label>Токенов/месяц<input type="number" min="0" value={userLimit.monthlyTokens} onChange={(event) => setUserLimit((current) => ({ ...current, monthlyTokens: event.target.value }))} placeholder="как у роли" /></label>
            <label>Модель<input value={userLimit.model} onChange={(event) => setUserLimit((current) => ({ ...current, model: event.target.value }))} placeholder="как у роли" /></label>
            <label>Доступные функции<input value={userLimit.allowedFeatures} onChange={(event) => setUserLimit((current) => ({ ...current, allowedFeatures: event.target.value }))} placeholder="student.explain, student.chat" /></label>
          </div>
          <button className="button" type="button" disabled={!userLimit.userId || saveUserLimit.isPending} onClick={() => saveUserLimit.mutate()}>Сохранить индивидуальный лимит</button>
          {settings.data?.userLimits.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Пользователь</th><th>Запросов/день</th><th>Токенов/месяц</th><th>Модель</th><th>Функции</th></tr></thead>
                <tbody>
                  {settings.data.userLimits.map((row) => (
                    <tr key={row.id}>
                      <td>{row.user.firstName} {row.user.lastName}<div className="muted small">{row.user.role}</div></td>
                      <td>{row.dailyRequests ?? 'как у роли'}</td>
                      <td>{row.monthlyTokens ?? 'как у роли'}</td>
                      <td>{row.model ?? 'как у роли'}</td>
                      <td>{row.allowedFeatures?.join(', ') || 'все функции роли'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  )
}
