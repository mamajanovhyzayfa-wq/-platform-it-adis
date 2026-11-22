import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSession, errorMessage } from '../api/client'
import { adminApi } from '../api/admin'
import { portalApi } from '../api/portal'
import { economyApi, type CoinRules, type QuestItem } from '../api/economy'
import { Empty, PageHeader, Progress, Section, StatCard, StatusBadge, formatDateTime } from '../components/ui'

const sourceLabels: Record<string, string> = {
  HOMEWORK: 'Домашняя работа',
  TEST: 'Тест',
  ATTENDANCE: 'Посещение',
  ACHIEVEMENT: 'Достижение',
  COURSE: 'Завершение курса',
  SHOP: 'Магазин',
  MANUAL: 'Вручную',
  QUEST: 'Задание',
  STREAK: 'Серия активности',
  SEASON: 'Сезон',
  EVENT: 'Мероприятие',
  PENALTY: 'Списание',
  REFUND: 'Возврат',
  REVERSAL: 'Отмена операции',
  LEVEL: 'Уровень',
  ADJUSTMENT: 'Корректировка',
}

const rarityLabels: Record<string, string> = {
  COMMON: 'Обычное',
  RARE: 'Редкое',
  EPIC: 'Эпическое',
  LEGENDARY: 'Легендарное',
}

const periodLabels: Record<string, string> = { DAILY: 'На сегодня', WEEKLY: 'На неделю', SEASON: 'Сезон' }

const conditionLabels: Record<string, string> = {
  lessons_completed: 'Завершённые уроки',
  homework_reviewed: 'Проверенные домашние работы',
  tests_completed: 'Пройденные тесты',
  perfect_tests: 'Тесты на 90% и выше',
  attendance: 'Посещённые занятия',
  courses_completed: 'Завершённые курсы',
  coins_earned: 'Заработанные IT Coins',
  active_days: 'Дни активности',
  quests_completed: 'Полученные награды за задания',
  event_participations: 'Участие в мероприятиях',
  contest_podiums: 'Призовые места в конкурсах',
  teacher_lessons: 'Проведённые уроки (наставник)',
  teacher_reviews: 'Проверенные работы (наставник)',
}

function Amount({ value }: { value: number }) {
  return <span className={value >= 0 ? 'amount-positive' : 'amount-negative'}>{value > 0 ? `+${value}` : value}</span>
}

function QuestCard({ quest, onClaim, busy }: { quest: QuestItem; onClaim: () => void; busy: boolean }) {
  return (
    <article className="card quest-card">
      <div className="quest-head">
        <div>
          <span className="badge badge-muted">{periodLabels[quest.period]}</span>
          <h3>{quest.title}</h3>
          <p className="muted small">{quest.description}</p>
        </div>
        <strong className="amount-positive">+{quest.rewardCoins}</strong>
      </div>
      <Progress value={Math.round((quest.progress / Math.max(1, quest.target)) * 100)} label={quest.title} />
      <div className="row-between">
        <span className="muted small">
          {quest.progress} из {quest.target} · +{quest.rewardXp} XP
        </span>
        {quest.claimedAt ? (
          <span className="badge badge-active">Получено</span>
        ) : (
          <button className="button button-small" type="button" disabled={!quest.completed || busy} onClick={onClaim}>
            {quest.completed ? 'Забрать награду' : 'В процессе'}
          </button>
        )}
      </div>
    </article>
  )
}

/** IT Coins: единая страница ученика, наставника, родителя и администратора филиала. */
export function CoinsPage() {
  const role = getSession()?.role ?? 'STUDENT'
  const isAdmin = role === 'ADMIN' || role === 'MANAGER'
  const canManageEconomy = role === 'ADMIN'
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('overview')

  // Пункт «Достижения» в навигации открывает соответствующий раздел страницы.
  useEffect(() => {
    if (window.location.hash === '#achievements') setTab('achievements')
  }, [])
  const [page, setPage] = useState(1)
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [targetId, setTargetId] = useState('')
  const [amount, setAmount] = useState('10')
  const [reason, setReason] = useState('')
  const [penaltyAmount, setPenaltyAmount] = useState('10')
  const [penaltyReason, setPenaltyReason] = useState('')
  const [rules, setRules] = useState<Partial<CoinRules>>({})
  const [achievement, setAchievement] = useState({ title: '', description: '', rarity: 'COMMON', category: 'Активность', collection: 'Пользовательские', conditionType: 'coins_earned', targetValue: '5', rewardCoins: '20' })
  const [childId, setChildId] = useState('')
  const [parentPage, setParentPage] = useState(1)

  const overview = useQuery({ queryKey: ['economy-overview'], queryFn: economyApi.overview })
  const achievements = useQuery({ queryKey: ['economy-achievements'], queryFn: economyApi.achievements })
  const quests = useQuery({ queryKey: ['economy-quests'], queryFn: economyApi.quests })
  const season = useQuery({ queryKey: ['economy-season'], queryFn: economyApi.season })
  const leaderboard = useQuery({ queryKey: ['economy-leaderboard'], queryFn: () => economyApi.leaderboard(), enabled: role !== 'PARENT' })
  const users = useQuery({
    queryKey: ['economy-users'],
    queryFn: () => adminApi.users({ page: 1, limit: 100, role: 'STUDENT' }),
    enabled: role === 'ADMIN' || role === 'MANAGER',
  })
  const teachers = useQuery({
    queryKey: ['economy-teachers'],
    queryFn: () => adminApi.users({ page: 1, limit: 100, role: 'TEACHER' }),
    enabled: role === 'ADMIN' || role === 'MANAGER',
  })
  const mentor = useQuery({ queryKey: ['economy-mentor-students'], queryFn: portalApi.mentor, enabled: role === 'TEACHER' })
  const parent = useQuery({ queryKey: ['portal-parent'], queryFn: portalApi.parent, enabled: role === 'PARENT' })
  const parentView = useQuery({
    queryKey: ['economy-parent', childId, parentPage],
    queryFn: () => economyApi.parent(childId, parentPage),
    enabled: role === 'PARENT' && Boolean(childId),
  })
  const transactions = useQuery({
    queryKey: ['economy-transactions', page, source, search, isAdmin],
    queryFn: () => economyApi.transactions({ page, limit: 25, ...(source ? { sourceType: source } : {}), ...(search ? { search } : {}) }),
    enabled: tab === 'history' || tab === 'journal' || tab === 'penalties',
  })
  const pending = useQuery({ queryKey: ['economy-pending'], queryFn: economyApi.pending, enabled: isAdmin })
  const appeals = useQuery({ queryKey: ['economy-appeals'], queryFn: economyApi.appeals, enabled: isAdmin })
  const coinRules = useQuery({ queryKey: ['economy-rules'], queryFn: economyApi.rules, enabled: isAdmin })

  useEffect(() => {
    if (coinRules.data) setRules(coinRules.data)
  }, [coinRules.data])

  useEffect(() => {
    if (!childId && parent.data?.children[0]) setChildId(parent.data.children[0].id)
  }, [parent.data, childId])

  useEffect(() => {
    setParentPage(1)
  }, [childId])

  const students = useMemo(() => {
    if (role === 'TEACHER') return mentor.data?.students.items ?? []
    return [
      ...(users.data?.items ?? []).map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName}`.trim() })),
      ...(teachers.data?.items ?? []).map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName} (наставник)` })),
    ]
  }, [mentor.data, role, users.data, teachers.data])

  useEffect(() => {
    if (!targetId && students[0]) setTargetId(students[0].id)
  }, [students, targetId])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['economy-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['economy-transactions'] })
    void queryClient.invalidateQueries({ queryKey: ['economy-pending'] })
    void queryClient.invalidateQueries({ queryKey: ['economy-quests'] })
    void queryClient.invalidateQueries({ queryKey: ['economy-appeals'] })
    void queryClient.invalidateQueries({ queryKey: ['economy-achievements'] })
  }

  const award = useMutation({
    mutationFn: () => economyApi.award({ userId: targetId, amount: Number(amount), reason }),
    onSuccess: (data) => {
      setNotice(data.requiresApproval ? 'Начисление отправлено на подтверждение администратору.' : `Начислено ${amount} IT Coins.`)
      setReason('')
      refresh()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const penalty = useMutation({
    mutationFn: () => economyApi.penalty({ userId: targetId, amount: Number(penaltyAmount), reason: penaltyReason }),
    onSuccess: () => {
      setNotice('Списание создано. Ученик может обжаловать его в истории операций.')
      setPenaltyReason('')
      refresh()
    },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const approve = useMutation({
    mutationFn: (id: string) => economyApi.approve(id),
    onSuccess: () => { setNotice('Операция подтверждена.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const reject = useMutation({
    mutationFn: (id: string) => economyApi.reject(id),
    onSuccess: () => { setNotice('Операция отклонена.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const reverse = useMutation({
    mutationFn: (id: string) => economyApi.reverse(id),
    onSuccess: () => { setNotice('Ошибочная операция отменена обратной проводкой.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const claim = useMutation({
    mutationFn: (id: string) => economyApi.claimQuest(id),
    onSuccess: () => { setNotice('Награда за задание получена.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const appeal = useMutation({
    mutationFn: (payload: { id: string; reason: string }) => economyApi.appeal(payload.id, payload.reason),
    onSuccess: () => { setNotice('Обращение отправлено администратору.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const check = useMutation({
    mutationFn: () => economyApi.checkAchievements(),
    onSuccess: (data) => { setNotice(data.awarded.length ? `Новые достижения: ${data.awarded.join(', ')}` : 'Новых достижений пока нет.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const saveRules = useMutation({
    mutationFn: () => economyApi.updateRules(rules),
    onSuccess: () => { setNotice('Правила начислений и списаний сохранены.'); void queryClient.invalidateQueries({ queryKey: ['economy-rules'] }) },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const createAchievement = useMutation({
    mutationFn: () =>
      economyApi.createAchievement({
        title: achievement.title,
        description: achievement.description,
        rarity: achievement.rarity,
        category: achievement.category,
        collection: achievement.collection || undefined,
        conditionType: achievement.conditionType,
        targetValue: Number(achievement.targetValue),
        rewardCoins: Number(achievement.rewardCoins),
      }),
    onSuccess: () => {
      setNotice('Достижение добавлено в коллекцию.')
      setAchievement({ title: '', description: '', rarity: 'COMMON', category: 'Активность', collection: 'Пользовательские', conditionType: 'coins_earned', targetValue: '5', rewardCoins: '20' })
      void queryClient.invalidateQueries({ queryKey: ['economy-achievements'] })
    },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const reviewAppeal = useMutation({
    mutationFn: (payload: { id: string; approve: boolean }) => economyApi.reviewAppeal(payload.id, { approve: payload.approve }),
    onSuccess: () => { setNotice('Обращение рассмотрено.'); refresh() },
    onError: (error) => setNotice(errorMessage(error)),
  })

  const tabs = role === 'PARENT'
    ? [{ id: 'overview', label: 'Дети' }]
    : isAdmin
      ? [
          { id: 'overview', label: 'Обзор' },
          { id: 'journal', label: 'Журнал операций' },
          { id: 'awards', label: 'Начисления' },
          { id: 'pending', label: 'Подтверждения' },
          ...(canManageEconomy ? [
            { id: 'penalties', label: 'Списания и обжалования' },
            { id: 'rules', label: 'Правила' },
          ] : []),
          { id: 'achievements', label: 'Достижения' },
          { id: 'ranking', label: 'Рейтинг групп' },
        ]
      : [
          { id: 'overview', label: 'Обзор' },
          { id: 'history', label: 'История' },
          { id: 'quests', label: 'Задания' },
          { id: 'achievements', label: 'Достижения' },
          { id: 'season', label: 'Сезон' },
          { id: 'ranking', label: 'Моя группа' },
          ...(role === 'TEACHER' ? [{ id: 'awards', label: 'Наградить ученика' }] : []),
        ]

  const currentBalance = role === 'PARENT' ? parentView.data?.balance ?? 0 : overview.data?.balance ?? 0
  const allQuests = useMemo(() => {
    const unique = new Map<string, QuestItem>()
    for (const quest of [...(quests.data?.quests ?? []), ...(season.data?.quests ?? [])]) {
      unique.set(`${quest.id}:${quest.periodKey}`, quest)
    }
    return [...unique.values()]
  }, [quests.data, season.data])

  return (
    <div className="stack">
      <PageHeader
        title="IT Coins"
        subtitle="Внутренняя валюта ITadis за учебные результаты, активность и достижения. Она не является деньгами и не влияет на оценки."
      />

      {notice ? <div className="alert">{notice}</div> : null}

      <section className="grid three">
        <StatCard label={role === 'PARENT' ? 'Баланс ребёнка' : 'Мой баланс'} value={currentBalance} tone="primary" icon="wallet" />
        <StatCard label="Уровень" value={role === 'PARENT' ? (parentView.data?.level ?? '—') : overview.data ? `${overview.data.level} · ${overview.data.levelTitle}` : '—'} tone="success" icon="spark" />
        <StatCard label="Серия активности" value={role === 'PARENT' ? `${parentView.data?.streak ?? 0} дн.` : overview.data ? `${overview.data.streak.current} дн.` : '—'} hint={role !== 'PARENT' && overview.data ? `Лучшая: ${overview.data.streak.best} дн.` : undefined} tone="warning" icon="calendar" />
      </section>

      {overview.data ? (
        <div className="card">
          <div className="row-between">
            <div>
              <strong>{overview.data.xp} XP</strong>
              <span className="muted small"> · опыт за учёбу, активность, задания и достижения</span>
            </div>
            <span className="muted small">{overview.data.nextLevel ? `До «${overview.data.nextLevel.title}»: ${overview.data.nextLevel.thresholdXp} XP` : 'Максимальный уровень'}</span>
          </div>
          <Progress value={overview.data.levelProgress} label="Прогресс уровня" />
        </div>
      ) : null}

      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'tab tab-active' : 'tab'} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {overview.isLoading ? <div className="state">Загрузка экономики…</div> : null}
      {overview.error ? <div className="alert alert-error">{errorMessage(overview.error)}</div> : null}

      {tab === 'overview' && role !== 'PARENT' ? (
        <>
          <div className="grid two">
            <Section title="Последние операции" subtitle="Каждое движение монет с причиной и автором">
              {overview.data?.recent.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Дата</th><th>Операция</th><th>Сумма</th><th>Баланс</th><th>Статус</th></tr></thead>
                    <tbody>
                      {overview.data.recent.map((item) => (
                        <tr key={item.id}>
                          <td className="muted small">{formatDateTime(item.createdAt)}</td>
                          <td>{item.reason}<div className="muted small">{item.sourceType ? sourceLabels[item.sourceType] : 'Операция'}</div></td>
                          <td><Amount value={item.amount} /></td>
                          <td>{item.balanceAfter ?? '—'}</td>
                          <td><StatusBadge status={item.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>Операций пока нет. Начните с занятия или задания.</Empty>}
            </Section>
            <Section title="Достижения" subtitle="Коллекция и ближайшие цели">
              {overview.data?.achievements.length ? (
                <ul className="notice-list">
                  {overview.data.achievements.map((item) => (
                    <li className="notice" key={item.title}>
                      <strong>{item.title}</strong>
                      <p className="muted small">{item.description}</p>
                      <span className="muted small">{rarityLabels[item.rarity] ?? item.rarity} · {formatDateTime(item.awardedAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>Достижений пока нет. Они появятся автоматически.</Empty>}
              <button className="button button-small" type="button" disabled={check.isPending} onClick={() => check.mutate()}>Проверить достижения</button>
            </Section>
          </div>
          {allQuests.filter((item) => !item.claimedAt).length ? (
            <Section title="Активные задания" subtitle="Ежедневные, недельные и сезонные цели">
              <div className="quest-grid">
                {allQuests.filter((item) => !item.claimedAt).slice(0, 6).map((quest) => (
                  <QuestCard key={`${quest.id}-${quest.periodKey}`} quest={quest} busy={claim.isPending} onClaim={() => claim.mutate(quest.id)} />
                ))}
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      {tab === 'overview' && role === 'PARENT' ? (
        <Section title="Дети" subtitle="Баланс и полная история операций ребёнка">
          {parent.data?.children.length ? (
            <>
              <div className="filters">
                <select value={childId} onChange={(event) => { setChildId(event.target.value); setParentPage(1) }} aria-label="Выберите ребёнка">
                  {parent.data.children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}
                </select>
              </div>
              {parentView.data ? (
                <>
                  <div className="grid three">
                    <StatCard label="Баланс" value={parentView.data.balance} tone="primary" icon="wallet" />
                    <StatCard label="Уровень" value={parentView.data.level} tone="success" icon="spark" />
                    <StatCard label="Достижения" value={parentView.data.achievements} tone="warning" icon="check" />
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Дата</th><th>Операция</th><th>Источник</th><th>Причина</th><th>Автор</th><th>Изменение</th><th>Итог</th><th>Статус</th></tr></thead>
                      <tbody>
                        {parentView.data.transactions.map((item) => (
                          <tr key={item.id}>
                            <td className="muted small">{formatDateTime(item.createdAt)}</td>
                            <td>{item.amount >= 0 ? 'Начисление' : 'Списание'}</td>
                            <td>{item.sourceType ? sourceLabels[item.sourceType] : '—'}</td>
                            <td>{item.reason}</td>
                            <td className="muted small">{item.awardedBy ? `${item.awardedBy.firstName} ${item.awardedBy.lastName}` : 'Система'}</td>
                            <td><Amount value={item.amount} /></td>
                            <td>{item.balanceAfter ?? '—'}</td>
                            <td><StatusBadge status={item.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination">
                    <button className="button button-ghost" type="button" disabled={parentPage <= 1} onClick={() => setParentPage((value) => value - 1)}>Назад</button>
                    <span className="muted small">Страница {parentView.data.page} · всего {parentView.data.total}</span>
                    <button className="button button-ghost" type="button" disabled={parentPage * 25 >= parentView.data.total} onClick={() => setParentPage((value) => value + 1)}>Вперёд</button>
                  </div>
                </>
              ) : parentView.isLoading ? <div className="state">Загрузка истории…</div> : null}
            </>
          ) : <Empty>Нет подтверждённых детей. Привяжите ребёнка в разделе «Безопасность».</Empty>}
        </Section>
      ) : null}

      {tab === 'history' || tab === 'journal' ? (
        <>
          <div className="filters">
            <input placeholder="Поиск по причине или ученику" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
            <select value={source} onChange={(event) => { setSource(event.target.value); setPage(1) }}>
              <option value="">Все источники</option>
              {Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {transactions.isLoading ? <div className="state">Загрузка операций…</div> : null}
          {transactions.error ? <div className="alert alert-error">{errorMessage(transactions.error)}</div> : null}
          {transactions.data ? (
            <>
              <div className="table-wrap card">
                <table className="table">
                  <thead><tr><th>Дата</th>{isAdmin ? <th>Участник</th> : null}<th>Операция</th><th>Источник</th><th>Причина</th><th>Автор</th><th>Изменение</th><th>Итог</th><th>Статус</th>{tab === 'journal' ? <th /> : null}</tr></thead>
                  <tbody>
                    {transactions.data.items.map((item) => (
                      <tr key={item.id}>
                        <td className="muted small">{formatDateTime(item.createdAt)}</td>
                        {isAdmin ? <td>{item.user ? `${item.user.firstName} ${item.user.lastName}` : '—'}</td> : null}
                        <td>{item.amount >= 0 ? 'Начисление' : 'Списание'}</td>
                        <td>{item.sourceType ? sourceLabels[item.sourceType] : '—'}</td>
                        <td>{item.reason}</td>
                        <td className="muted small">{item.awardedBy ? `${item.awardedBy.firstName} ${item.awardedBy.lastName}` : 'Система'}</td>
                        <td><Amount value={item.amount} /></td>
                        <td>{item.balanceAfter ?? '—'}</td>
                        <td>
                          <StatusBadge status={item.status} />
                          {role === 'STUDENT' && item.amount < 0 && item.status === 'POSTED' && !item.appeal ? (
                            <button
                              className="button button-small button-ghost"
                              type="button"
                              onClick={() => {
                                const value = window.prompt('Причина обжалования списания')
                                if (value && value.trim().length >= 5) appeal.mutate({ id: item.id, reason: value.trim() })
                              }}
                            >
                              Обжаловать
                            </button>
                          ) : null}
                        </td>
                        {tab === 'journal' ? (
                          <td>
                            {role === 'ADMIN' && item.status === 'POSTED' ? (
                              <button className="button button-small button-ghost" type="button" disabled={reverse.isPending} onClick={() => { if (window.confirm('Отменить операцию обратной проводкой?')) reverse.mutate(item.id) }}>
                                Отменить
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <button className="button button-ghost" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Назад</button>
                <span className="muted small">Страница {page} · всего {transactions.data.total}</span>
                <button className="button button-ghost" type="button" disabled={page * 25 >= transactions.data.total} onClick={() => setPage((value) => value + 1)}>Вперёд</button>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'awards' && (role === 'ADMIN' || role === 'MANAGER' || role === 'TEACHER') ? (
        <Section title="Наградить за успехи" subtitle="Наставник — в пределах своих полномочий, администратор — по общим правилам">
          <div className="form-grid">
            <label>Получатель<select value={targetId} onChange={(event) => setTargetId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
            <label>Сумма<input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
            <label className="span-2">Причина<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например: отличная защита проекта" /></label>
          </div>
          <button className="button" type="button" disabled={!targetId || reason.trim().length < 3 || award.isPending} onClick={() => award.mutate()}>Начислить IT Coins</button>
          {role === 'TEACHER' ? <p className="muted small">Если сумма превышает лимит наставника или выглядит подозрительной, система попросит подтверждение администратора.</p> : null}
        </Section>
      ) : null}

      {tab === 'pending' && (isAdmin || role === 'TEACHER') ? (
        <Section title="Подтверждения" subtitle="Лимиты, подозрительные суммы и крупные списания">
          {pending.data?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Ученик</th><th>Сумма</th><th>Причина</th><th>Дата</th><th>Действия</th></tr></thead>
                <tbody>
                  {pending.data.map((item) => (
                    <tr key={item.id}>
                      <td>{item.user ? `${item.user.firstName} ${item.user.lastName}` : '—'}</td>
                      <td><Amount value={item.amount} /></td>
                      <td>{item.reason}</td>
                      <td className="muted small">{formatDateTime(item.createdAt)}</td>
                      <td>
                        {isAdmin ? (
                          <div className="row-actions">
                            <button className="button button-small" type="button" disabled={approve.isPending} onClick={() => approve.mutate(item.id)}>Подтвердить</button>
                            <button className="button button-small button-ghost" type="button" disabled={reject.isPending} onClick={() => reject.mutate(item.id)}>Отклонить</button>
                          </div>
                        ) : <span className="muted small">Нужен администратор</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Операций, ожидающих подтверждения, нет.</Empty>}
        </Section>
      ) : null}

      {tab === 'penalties' && canManageEconomy ? (
        <>
          <Section title="Списание за нарушение" subtitle="Причина, автор и дата сохраняются; ученик может обжаловать">
            <div className="form-grid">
              <label>Ученик<select value={targetId} onChange={(event) => setTargetId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
              <label>Сумма<input type="number" min="1" value={penaltyAmount} onChange={(event) => setPenaltyAmount(event.target.value)} /></label>
              <label className="span-2">Причина<input value={penaltyReason} onChange={(event) => setPenaltyReason(event.target.value)} placeholder="Например: нарушение правил занятия" /></label>
            </div>
            <button className="button" type="button" disabled={!targetId || penaltyReason.trim().length < 3 || penalty.isPending} onClick={() => penalty.mutate()}>Списать IT Coins</button>
          </Section>
          <Section title="Обжалования" subtitle="Решение администратора филиала">
            {appeals.data?.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Дата</th><th>Ученик</th><th>Списание</th><th>Причина обращения</th><th>Статус</th><th>Действия</th></tr></thead>
                  <tbody>
                    {appeals.data.map((item) => (
                      <tr key={item.id}>
                        <td className="muted small">{formatDateTime(item.createdAt)}</td>
                        <td>{item.transaction.user ? `${item.transaction.user.firstName} ${item.transaction.user.lastName}` : '—'}</td>
                        <td>{item.transaction.amount} · {item.transaction.reason}</td>
                        <td>{item.reason}</td>
                        <td><StatusBadge status={item.status} /></td>
                        <td>
                          {item.status === 'PENDING' ? (
                            <div className="row-actions">
                              <button className="button button-small" type="button" onClick={() => reviewAppeal.mutate({ id: item.id, approve: true })}>Вернуть монеты</button>
                              <button className="button button-small button-ghost" type="button" onClick={() => reviewAppeal.mutate({ id: item.id, approve: false })}>Оставить</button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>Обжалований нет.</Empty>}
          </Section>
          <Section title="Последние списания" subtitle="Полная история с итоговым балансом">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Дата</th><th>Ученик</th><th>Причина</th><th>Изменение</th><th>Итог</th><th>Статус</th></tr></thead>
                <tbody>
                  {transactions.data?.items.filter((item) => item.amount < 0).map((item) => (
                    <tr key={item.id}>
                      <td className="muted small">{formatDateTime(item.createdAt)}</td>
                      <td>{item.user ? `${item.user.firstName} ${item.user.lastName}` : '—'}</td>
                      <td>{item.reason}</td>
                      <td><Amount value={item.amount} /></td>
                      <td>{item.balanceAfter ?? '—'}</td>
                      <td><StatusBadge status={item.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      ) : null}

      {tab === 'rules' && canManageEconomy ? (
        <Section title="Правила экономики" subtitle="Общие лимиты начислений и антифрод-порог">
          <div className="form-grid">
            {([
              ['dailyAwardLimit', 'Дневной лимит ученика'],
              ['weeklyAwardLimit', 'Недельный лимит ученика'],
              ['teacherDailyLimit', 'Дневной лимит наставника'],
              ['maxManualAward', 'Максимум одного ручного начисления'],
              ['suspiciousAmount', 'Подозрительная сумма'],
              ['penaltyApprovalThreshold', 'Порог подтверждения списания'],
              ['streakMinDailyActions', 'Действий в день для серии'],
              ['streakBonusEvery', 'Бонус за каждые N дней серии'],
              ['streakBonusCoins', 'Монет за бонус серии'],
            ] as Array<[keyof CoinRules, string]>).map(([key, label]) => (
              <label key={key}>{label}<input type="number" min="0" value={rules[key] ?? ''} onChange={(event) => setRules((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>
            ))}
          </div>
          <button className="button" type="button" disabled={saveRules.isPending} onClick={() => saveRules.mutate()}>Сохранить правила</button>
        </Section>
      ) : null}

      {tab === 'achievements' ? (
        <Section title="Коллекция достижений" subtitle="Название, редкость, условия, прогресс и дата получения">
          {achievements.data?.length ? (
            <div className="achievement-grid">
              {achievements.data.map((item) => (
                <article className={`card achievement-card ${item.earnedAt ? 'achievement-earned' : ''}`} key={item.id}>
                  <div className="row-between">
                    <span className={`badge badge-${item.rarity.toLowerCase()}`}>{rarityLabels[item.rarity] ?? item.rarity}</span>
                    {item.earnedAt ? <span className="badge badge-active">Получено</span> : null}
                  </div>
                  <h3>{item.title}</h3>
                  <p className="muted small">{item.description}</p>
                  <p className="muted small">{item.collection ?? item.category} · +{item.rewardCoins} IT Coins</p>
                  <Progress value={Math.round((item.current / Math.max(1, item.target)) * 100)} label={item.title} />
                  <span className="muted small">{item.current} из {item.target}{item.earnedAt ? ` · ${formatDateTime(item.earnedAt)}` : ''}</span>
                </article>
              ))}
            </div>
          ) : <Empty>Коллекция пока не заполнена.</Empty>}
          {role === 'ADMIN' ? (
            <div className="card stack">
              <h3>Новое достижение</h3>
              <div className="form-grid">
                <label>Название<input value={achievement.title} onChange={(event) => setAchievement((current) => ({ ...current, title: event.target.value }))} /></label>
                <label>Редкость<select value={achievement.rarity} onChange={(event) => setAchievement((current) => ({ ...current, rarity: event.target.value }))}><option value="COMMON">Обычное</option><option value="RARE">Редкое</option><option value="EPIC">Эпическое</option><option value="LEGENDARY">Легендарное</option></select></label>
                <label>Коллекция<input value={achievement.collection} onChange={(event) => setAchievement((current) => ({ ...current, collection: event.target.value }))} /></label>
                <label className="span-2">Описание<input value={achievement.description} onChange={(event) => setAchievement((current) => ({ ...current, description: event.target.value }))} /></label>
                <label>Условие<select value={achievement.conditionType} onChange={(event) => setAchievement((current) => ({ ...current, conditionType: event.target.value }))}>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>Порог<input type="number" min="1" value={achievement.targetValue} onChange={(event) => setAchievement((current) => ({ ...current, targetValue: event.target.value }))} /></label>
                <label>Награда<input type="number" min="0" value={achievement.rewardCoins} onChange={(event) => setAchievement((current) => ({ ...current, rewardCoins: event.target.value }))} /></label>
              </div>
              <button className="button" type="button" disabled={achievement.title.trim().length < 3 || createAchievement.isPending} onClick={() => createAchievement.mutate()}>Добавить в коллекцию</button>
            </div>
          ) : null}
        </Section>
      ) : null}

      {tab === 'quests' ? (
        <Section title="Задания" subtitle="Ежедневные и еженедельные цели с наградой">
          {allQuests.length ? (
            <div className="quest-grid">
              {allQuests.map((quest) => <QuestCard key={`${quest.id}-${quest.periodKey}`} quest={quest} busy={claim.isPending} onClaim={() => claim.mutate(quest.id)} />)}
            </div>
          ) : <Empty>Задания появятся после настройки филиала.</Empty>}
        </Section>
      ) : null}

      {tab === 'season' ? (
        season.data ? (
          <Section title={season.data.title} subtitle={`${season.data.theme} · осталось ${season.data.daysLeft} дн.`}>
            <div className="card">
              <p>{season.data.description}</p>
              <div className="grid three">
                <StatCard label="Сезонные очки" value={season.data.points} tone="primary" icon="spark" />
                <StatCard label="Начало" value={formatDateTime(season.data.startsAt)} tone="muted" />
                <StatCard label="Завершение" value={formatDateTime(season.data.endsAt)} tone="muted" />
              </div>
            </div>
            <div className="quest-grid">
              {season.data.quests.map((quest) => <QuestCard key={`${quest.id}-${quest.periodKey}`} quest={quest} busy={claim.isPending} onClaim={() => claim.mutate(quest.id)} />)}
            </div>
          </Section>
        ) : <Empty>Активного сезона сейчас нет.</Empty>
      ) : null}

      {tab === 'ranking' ? (
        <Section title="Рейтинг внутри группы" subtitle="Сравнение только с учениками своей группы">
          {leaderboard.data?.groups.length ? leaderboard.data.groups.map((group) => (
            <div className="card" key={group.courseId}>
              <h3>{group.title}</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Место</th><th>Ученик</th><th>Заработано за 30 дней</th><th>Баланс</th><th>Уровень</th></tr></thead>
                  <tbody>
                    {group.members.map((member) => (
                      <tr key={member.userId}>
                        <td>{member.rank}</td>
                        <td>{member.name}</td>
                        <td>{member.earned}</td>
                        <td>{member.balance}</td>
                        <td>{member.level}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )) : <Empty>Рейтинг появится, когда в группе будут ученики.</Empty>}
        </Section>
      ) : null}

    </div>
  )
}
