import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getSession } from '../api/client'
import { portalApi } from '../api/portal'
import { useI18n } from '../i18n'
import {
  Empty,
  Icon,
  Progress,
  ProgressRing,
  Section,
  StatCard,
  StatusBadge,
  formatDateTime,
  formatDay,
  formatFullDate,
  formatTime,
  greeting,
} from '../components/ui'

/** Главная панель ученика: только собственные данные и общая информация группы. */
export function StudentDashboard() {
  const session = getSession()
  const { t } = useI18n()
  const query = useQuery({ queryKey: ['portal-student'], queryFn: portalApi.student })

  if (query.isLoading) return <div className="state">{t('student.loading')}</div>
  if (query.error) return <div className="alert alert-error">{t('student.loadError')}</div>
  if (!query.data) return null

  const data = query.data
  const nextLesson = data.upcoming[0]
  const nextHomework = data.homework[0]
  const today = formatFullDate(new Date())

  const dueLabel = (value: string) => {
    const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000)
    if (days < 0) return { label: t('dashboard.overdue'), tone: 'danger' }
    if (days <= 1) return { label: t('dashboard.dueSoon'), tone: 'warning' }
    return { label: t('student.due', { date: formatDateTime(value) }), tone: 'muted' }
  }

  return (
    <div className="dashboard">
      <section className="hero dashboard-hero">
        <div className="hero-main">
          <div className="hero-topline">
            <span className="eyebrow">{t('student.eyebrow')}</span>
            <span className="hero-date">{today}</span>
          </div>
          <h1>
            {greeting()}, {session?.firstName ?? t('student.fallbackName')}
            <span className="hero-dot">.</span>
          </h1>
          <p className="hero-copy">{t('student.hero')}</p>

          <div className="hero-inline-stats">
            <div>
              <span>{t('dashboard.nextLesson')}</span>
              <strong>{nextLesson ? formatTime(nextLesson.startsAt) : '—'}</strong>
              <small>{nextLesson?.title ?? t('student.noUpcoming')}</small>
            </div>
            <div>
              <span>{t('student.statHomework')}</span>
              <strong>{data.homework.length}</strong>
              <small>{nextHomework?.title ?? t('student.noHomework')}</small>
            </div>
            <div>
              <span>IT Coins</span>
              <strong>{data.coins.balance}</strong>
              <small>{t('student.statCoinsHint')}</small>
            </div>
          </div>

          <div className="quick-actions">
            <Link className="button" to="/homework">
              <Icon name="check" size={17} /> {t('student.quickHomework')}
            </Link>
            <Link className="button button-ghost" to="/calendar">
              <Icon name="calendar" size={17} /> {t('student.quickSchedule')}
            </Link>
            <Link className="button button-ghost" to="/coins#achievements">
              <Icon name="star" size={17} /> {t('student.quickAchievements')}
            </Link>
            <Link className="button button-ghost" to="/support">
              <Icon name="message" size={17} /> {t('student.quickSupport')}
            </Link>
          </div>
        </div>

        <div className="hero-side progress-hero-side">
          <div className="hero-side-head">
            <span className="eyebrow">{t('student.progressTitle')}</span>
            <span className="hero-live-dot" aria-hidden="true" />
          </div>
          <ProgressRing value={data.progress.percent} label={t('dashboard.learningProgress')} size="lg" />
          <p className="hero-progress-copy">
            {t('student.lessonsCompleted', {
              done: data.progress.lessonsCompleted,
              total: data.progress.lessonsTotal,
            })}
          </p>
          <div className="hero-streak">
            <Icon name="zap" size={16} />
            <span>{t('dashboard.keepGoing')}</span>
          </div>
        </div>
      </section>

      <section className="stats dashboard-stats" aria-label={t('student.progressTitle')}>
        <StatCard label={t('student.statCourses')} value={data.courses.length} icon="book" hint={t('student.statCoursesHint')} />
        <StatCard label={t('student.statHomework')} value={data.homework.length} icon="check" tone="warning" hint={t('student.statHomeworkHint')} />
        <StatCard label={t('student.statUpcoming')} value={data.upcoming.length} icon="calendar" tone="success" hint={t('student.statUpcomingHint')} />
        <StatCard label={t('student.statCoins')} value={data.coins.balance} icon="wallet" tone="primary" hint={t('student.statCoinsHint')} />
      </section>

      <div className="bento">
        <Section
          className="span-7"
          title={t('student.coursesTitle')}
          subtitle={t('student.coursesSubtitle')}
          action={
            <Link className="link" to="/library">
              {t('dashboard.openAll')} <span aria-hidden="true">→</span>
            </Link>
          }
        >
          {data.courses.length === 0 ? (
            <Empty>{t('student.noCourses')}</Empty>
          ) : (
            <ul className="course-showcase-list">
              {data.courses.map((course, index) => (
                <li key={course.id} className="course-showcase">
                  <div className={`course-cover course-tone-${index % 4}`} aria-hidden="true">
                    <span>{course.title.slice(0, 2).toUpperCase()}</span>
                    <Icon name="book" size={20} />
                  </div>
                  <div className="course-showcase-body">
                    <div className="course-showcase-head">
                      <div>
                        <Link to={`/learn/${course.id}`}>
                          <strong>{course.title}</strong>
                        </Link>
                        <span className="muted small">{course.level}</span>
                      </div>
                      <StatusBadge status={course.status} />
                    </div>
                    <Progress value={course.progress} label={t('student.courseProgress', { title: course.title })} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          className="span-5"
          title={t('student.upcomingTitle')}
          subtitle={t('student.upcomingSubtitle')}
          id="schedule"
          action={
            <Link className="link" to="/calendar">
              {t('dashboard.schedule')}
            </Link>
          }
        >
          {data.upcoming.length === 0 ? (
            <Empty>{t('student.noUpcoming')}</Empty>
          ) : (
            <>
              {nextLesson ? (
                <div className="lesson-feature">
                  <div className="date-tile">
                    <strong>{formatTime(nextLesson.startsAt)}</strong>
                    <span>{formatDay(nextLesson.startsAt)}</span>
                  </div>
                  <div className="lesson-feature-copy">
                    <span className="eyebrow">{t('dashboard.nextLesson')}</span>
                    <strong>{nextLesson.title}</strong>
                    <p>{nextLesson.course}</p>
                  </div>
                  <Link className="button button-small" to={`/lesson/${nextLesson.id}`}>
                    {t('dashboard.join')}
                  </Link>
                </div>
              ) : null}
              <ul className="timeline compact-timeline">
                {data.upcoming.slice(1).map((lesson) => (
                  <li key={lesson.id}>
                    <div className="timeline-date">
                      <strong>{formatDay(lesson.startsAt)}</strong>
                      <span>{formatTime(lesson.startsAt)}</span>
                    </div>
                    <div>
                      <strong>{lesson.title}</strong>
                      <p className="muted small">{lesson.course}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section
          className="span-4"
          title={t('student.homeworkTitle')}
          subtitle={t('student.homeworkSubtitle')}
          id="homework"
          action={
            <Link className="link" to="/homework">
              {t('dashboard.openAll')}
            </Link>
          }
        >
          {data.homework.length === 0 ? (
            <Empty>{t('student.noHomework')}</Empty>
          ) : (
            <ul className="task-list">
              {data.homework.map((item) => {
                const due = dueLabel(item.dueAt)
                return (
                  <li key={item.id} className="task-row">
                    <span className={`task-marker task-marker-${due.tone}`} aria-hidden="true">
                      <Icon name="clock" size={16} />
                    </span>
                    <div className="task-copy">
                      <strong>{item.title}</strong>
                      <span className="muted small">{item.course}</span>
                    </div>
                    <span className={`chip chip-${due.tone}`}>{due.label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section className="span-4" title={t('student.testsTitle')} subtitle={t('student.testsSubtitle')}>
          {data.tests.length === 0 ? (
            <Empty>{t('student.noTests')}</Empty>
          ) : (
            <ul className="test-list">
              {data.tests.map((test) => (
                <li key={test.id} className="test-row">
                  <div>
                    <strong>{test.title}</strong>
                    <span className="muted small">{test.course}</span>
                  </div>
                  {test.attempts > 0 ? (
                    <span className="score-pill">
                      {test.lastScore ?? '—'}
                      <small>/100</small>
                    </span>
                  ) : (
                    <span className="chip chip-muted">{t('student.notStarted')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-4" title={t('student.resultsTitle')} subtitle={t('student.resultsSubtitle')}>
          {data.results.length === 0 ? (
            <Empty>{t('student.noResults')}</Empty>
          ) : (
            <ul className="result-list">
              {data.results.map((result) => {
                const percent = Math.round((result.score / Math.max(result.max, 1)) * 100)
                return (
                  <li key={`${result.kind}-${result.id}`} className="result-row">
                    <div className="result-main">
                      <strong>{result.title}</strong>
                      <span className="muted small">
                        {result.kind} · {result.date ? formatDateTime(result.date) : t('common.notSet')}
                      </span>
                    </div>
                    <div className="result-score">
                      <strong>{percent}%</strong>
                      <div className="mini-progress" aria-hidden="true">
                        <span style={{ width: `${Math.min(percent, 100)}%` }} />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section className="span-4" title={t('student.coinsTitle')} subtitle={t('student.coinsSubtitle')} id="coins">
          <div className="wallet-card">
            <div>
              <span className="eyebrow">IT Coins</span>
              <strong>{data.coins.balance}</strong>
              <span className="wallet-caption">{t('student.balance')}</span>
            </div>
            <span className="wallet-orbit" aria-hidden="true">
              <Icon name="wallet" size={28} />
            </span>
          </div>
          {data.coins.recent.length === 0 ? (
            <Empty>{t('student.noCoins')}</Empty>
          ) : (
            <ul className="wallet-list">
              {data.coins.recent.map((item) => (
                <li key={item.id}>
                  <span>{item.reason}</span>
                  <strong className={item.amount > 0 ? 'amount-positive' : 'amount-negative'}>
                    {item.amount > 0 ? '+' : ''}
                    {item.amount}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-4" title={t('student.achievementsTitle')} subtitle={t('student.achievementsSubtitle')} id="achievements">
          {data.achievements.length === 0 ? (
            <Empty>{t('student.noAchievements')}</Empty>
          ) : (
            <ul className="achievement-grid">
              {data.achievements.map((achievement) => (
                <li key={achievement.title} className="achievement">
                  <span className="achievement-icon" aria-hidden="true">
                    <Icon name="star" size={20} />
                  </span>
                  <div>
                    <strong>{achievement.title}</strong>
                    <p className="muted small">{achievement.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-4" title={t('student.notificationsTitle')} subtitle={t('student.notificationsSubtitle')}>
          {data.notifications.items.length === 0 ? (
            <Empty>{t('student.noNotifications')}</Empty>
          ) : (
            <ul className="notice-list activity-feed">
              {data.notifications.items.map((item) => (
                <li key={item.id} className={item.readAt ? 'notice' : 'notice notice-unread'}>
                  <span className="activity-dot" aria-hidden="true" />
                  <div>
                    <strong>{item.title}</strong>
                    <p className="muted small">{item.body}</p>
                    <time className="muted small">{formatDateTime(item.createdAt)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
