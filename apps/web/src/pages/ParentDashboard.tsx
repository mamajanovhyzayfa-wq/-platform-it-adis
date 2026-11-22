import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getSession } from '../api/client'
import { portalApi } from '../api/portal'
import { useI18n } from '../i18n'
import { Empty, Progress, Section, StatCard, formatDateTime, formatDay, formatFullDate, formatKgs, formatTime, greeting } from '../components/ui'

/** Кабинет родителя: данные только подтверждённых администратором детей. */
export function ParentDashboard() {
  const session = getSession()
  const { t } = useI18n()
  const query = useQuery({ queryKey: ['portal-parent'], queryFn: portalApi.parent })

  if (query.isLoading) return <div className="state">{t('parent.loading')}</div>
  if (query.error) return <div className="alert alert-error">{t('parent.loadError')}</div>
  if (!query.data) return null

  const data = query.data
  const relationLabels: Record<string, string> = {
    MOTHER: t('parent.relationMOTHER'),
    FATHER: t('parent.relationFATHER'),
    GUARDIAN: t('parent.relationGUARDIAN'),
    OTHER: t('parent.relationOTHER'),
  }

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-main">
          <p className="eyebrow">{t('parent.eyebrow')} · {formatFullDate(new Date())}</p>
          <h1>
            {greeting()}, {session?.firstName ?? t('parent.fallbackName')}!
          </h1>
          <p className="muted">{t('parent.hero')}</p>
          <div className="quick-actions">
            <Link className="button" to="/support">
              {t('parent.support')}
            </Link>
            <Link className="button button-ghost" to="/my-payments">
              {t('parent.payments')}
            </Link>
          </div>
        </div>
        <div className="hero-side">
          <span className="eyebrow">{t('parent.childrenTitle')}</span>
          <strong className="hero-value">{data.children.length}</strong>
          <span className="muted small">{t('parent.linkConfirmed')}</span>
        </div>
      </section>

      {data.children.length === 0 ? (
        <Section title={t('parent.children')} subtitle={t('parent.linkSubtitle')}>
          <Empty>{t('parent.noChildren')}</Empty>
        </Section>
      ) : (
        data.children.map((child) => (
          <div className="stack" key={child.id}>
            <section className="child-head">
              <div>
                <h2>{child.name}</h2>
                <p className="muted small">
                  {relationLabels[child.relation] ?? child.relation} · {child.email}
                </p>
              </div>
              <div className="child-metrics">
                <StatCard label={t('parent.coins')} value={child.coins} tone="primary" icon="wallet" />
                <StatCard label={t('parent.attendance')} value={`${child.attendanceRate}%`} tone="success" icon="calendar" />
                <StatCard label={t('parent.paid')} value={formatKgs(child.paidTotalKgs)} tone="muted" icon="wallet" />
                <StatCard label={t('parent.achievements')} value={child.achievements} tone="warning" icon="spark" />
              </div>
            </section>

            <div className="grid two">
              <Section title={t('parent.coursesTitle')} subtitle={t('parent.coursesSubtitle')}>
                {child.courses.length === 0 ? (
                  <Empty>{t('parent.noCourses')}</Empty>
                ) : (
                  <ul className="course-list">
                    {child.courses.map((course) => (
                      <li key={course.id} className="course-item">
                        <div className="course-item-head">
                          <strong>{course.title}</strong>
                        </div>
                        <Progress value={course.progress} label={t('student.courseProgress', { title: course.title })} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t('parent.upcomingTitle')} subtitle={t('parent.upcomingSubtitle')}>
                {child.upcoming.length === 0 ? (
                  <Empty>{t('parent.noUpcoming')}</Empty>
                ) : (
                  <ul className="timeline">
                    {child.upcoming.map((lesson) => (
                      <li key={lesson.id}>
                        <div className="timeline-date">
                          <strong>{formatDay(lesson.startsAt)}</strong>
                          <span>{formatTime(lesson.startsAt)}</span>
                        </div>
                        <div>
                          <strong>{lesson.title}</strong>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            <div className="grid two">
              <Section title={t('parent.homeworkTitle')} subtitle={t('parent.homeworkSubtitle')}>
                {child.homework.length === 0 ? (
                  <Empty>{t('parent.noHomework')}</Empty>
                ) : (
                  <ul className="list">
                    {child.homework.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          <p className="muted small">{item.course}</p>
                        </div>
                        <span className="muted small">{formatDateTime(item.dueAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={t('parent.resultsTitle')} subtitle={t('parent.resultsSubtitle')}>
                {child.results.length === 0 ? (
                  <Empty>{t('parent.noResults')}</Empty>
                ) : (
                  <ul className="list">
                    {child.results.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          {item.submittedAt ? (
                            <p className="muted small">{formatDateTime(item.submittedAt)}</p>
                          ) : null}
                        </div>
                        <span className="badge">
                          {item.percent !== null ? `${item.percent}%` : item.score ?? '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

          </div>
        ))
      )}

      <Section title={t('parent.notificationsTitle')} subtitle={t('parent.notificationsSubtitle')}>
        {data.notifications.items.length === 0 ? (
          <Empty>{t('parent.noNotifications')}</Empty>
        ) : (
          <ul className="notice-list">
            {data.notifications.items.map((item) => (
              <li key={item.id} className={item.readAt ? 'notice' : 'notice notice-unread'}>
                <strong>{item.title}</strong>
                <p className="muted small">{item.body}</p>
                <time className="muted small">{formatDateTime(item.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
