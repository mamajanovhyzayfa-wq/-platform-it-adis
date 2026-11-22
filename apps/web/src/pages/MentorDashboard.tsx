import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getSession } from '../api/client'
import { portalApi } from '../api/portal'
import { useI18n } from '../i18n'
import {
  Avatar,
  Empty,
  Icon,
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

/** Главная панель наставника: только собственные группы и ученики. */
export function MentorDashboard() {
  const session = getSession()
  const { t } = useI18n()
  const query = useQuery({ queryKey: ['portal-mentor'], queryFn: portalApi.mentor })

  if (query.isLoading) return <div className="state">{t('mentor.loading')}</div>
  if (query.error) return <div className="alert alert-error">{t('mentor.loadError')}</div>
  if (!query.data) return null

  const data = query.data
  const nextLesson = data.upcoming[0]
  const maxGroup = Math.max(...data.groups.map((group) => group.students), 1)

  return (
    <div className="dashboard">
      <section className="hero dashboard-hero">
        <div className="hero-main">
          <div className="hero-topline">
            <span className="eyebrow">{t('mentor.eyebrow')}</span>
            <span className="hero-date">{formatFullDate(new Date())}</span>
          </div>
          <h1>
            {greeting()}, {session?.firstName ?? t('mentor.fallbackName')}
            <span className="hero-dot">.</span>
          </h1>
          <p className="hero-copy">{t('mentor.hero')}</p>

          <div className="hero-inline-stats">
            <div>
              <span>{t('dashboard.nextLesson')}</span>
              <strong>{nextLesson ? formatTime(nextLesson.startsAt) : '—'}</strong>
              <small>{nextLesson?.title ?? t('mentor.noLessons')}</small>
            </div>
            <div>
              <span>{t('mentor.pending')}</span>
              <strong>{data.pendingReviews.count}</strong>
              <small>{t('mentor.pendingSubtitle')}</small>
            </div>
            <div>
              <span>{t('mentor.unreadMessages')}</span>
              <strong>{data.messages.unread}</strong>
              <small>{t('dashboard.messages')}</small>
            </div>
          </div>

          <div className="quick-actions">
            <Link className="button" to="/review">
              <Icon name="check" size={17} /> {t('mentor.review')}
            </Link>
            <Link className="button button-ghost" to="/schedule">
              <Icon name="calendar" size={17} /> {t('mentor.schedule')}
            </Link>
            <Link className="button button-ghost" to="/community">
              <Icon name="message" size={17} /> {t('dashboard.messages')}
            </Link>
            <Link className="button button-ghost" to="/security">
              <Icon name="shield" size={17} /> {t('mentor.security')}
            </Link>
          </div>
        </div>

        <div className="hero-side progress-hero-side">
          <div className="hero-side-head">
            <span className="eyebrow">{t('mentor.attendance')}</span>
            <span className="hero-live-dot" aria-hidden="true" />
          </div>
          <ProgressRing value={data.stats.attendanceRate} label={t('mentor.attendance')} size="lg" />
          <div className="hero-mini-metric">
            <span>{t('mentor.averageScore')}</span>
            <strong>{data.stats.averageScore}</strong>
            <small>{t('mentor.byReviewed')}</small>
          </div>
        </div>
      </section>

      <section className="stats dashboard-stats" aria-label={t('mentor.eyebrow')}>
        <StatCard label={t('mentor.groups')} value={data.stats.groups} icon="grid" hint={t('mentor.groupsSubtitle')} />
        <StatCard label={t('mentor.students')} value={data.stats.students} icon="users" tone="success" hint={t('mentor.studentsSubtitle')} />
        <StatCard label={t('mentor.pending')} value={data.pendingReviews.count} icon="check" tone="warning" hint={t('mentor.pendingSubtitle')} />
        <StatCard label={t('mentor.unreadMessages')} value={data.messages.unread} icon="message" tone="primary" hint={t('dashboard.messages')} />
      </section>

      <div className="bento">
        <Section
          className="span-7"
          title={t('mentor.pendingTitle')}
          subtitle={t('mentor.pendingSubtitle')}
          action={
            <Link className="link" to="/review">
              {t('mentor.allWorks')}
            </Link>
          }
        >
          {data.pendingReviews.items.length === 0 ? (
            <Empty>{t('mentor.queueEmpty')}</Empty>
          ) : (
            <ul className="review-queue">
              {data.pendingReviews.items.map((item) => (
                <li key={item.id} className="review-card">
                  <Avatar name={item.student} size="md" />
                  <div className="review-card-copy">
                    <strong>{item.title}</strong>
                    <span className="muted small">
                      {item.student} · {formatDateTime(item.submittedAt)}
                    </span>
                  </div>
                  <Link className="button button-small" to="/review">
                    {t('dashboard.review')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-5" title={t('mentor.myGroups')} subtitle={t('mentor.groupsSubtitle')}>
          {data.groups.length === 0 ? (
            <Empty>{t('mentor.noGroups')}</Empty>
          ) : (
            <ul className="group-stack">
              {data.groups.map((group) => (
                <li key={group.id} className="group-card">
                  <div className="group-card-head">
                    <div>
                      <Link to={`/courses/${group.id}/edit`}>
                        <strong>{group.title}</strong>
                      </Link>
                      <span className="muted small">{t('mentor.studentsCount', { count: group.students })}</span>
                    </div>
                    <StatusBadge status={group.status} />
                  </div>
                  <div className="group-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(8, Math.round((group.students / maxGroup) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          className="span-4"
          title={t('mentor.upcomingTitle')}
          subtitle={t('mentor.scheduleSubtitle')}
          action={
            <Link className="link" to="/schedule">
              {t('dashboard.schedule')}
            </Link>
          }
        >
          {data.upcoming.length === 0 ? (
            <Empty>{t('mentor.noLessons')}</Empty>
          ) : (
            <ul className="timeline">
              {data.upcoming.slice(0, 4).map((lesson) => (
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
          )}
        </Section>

        <Section className="span-4" title={t('mentor.myStudents')} subtitle={t('mentor.studentsSubtitle')}>
          {data.students.items.length === 0 ? (
            <Empty>{t('mentor.noStudents')}</Empty>
          ) : (
            <ul className="people">
              {data.students.items.map((student) => (
                <li key={student.id}>
                  <Avatar name={student.name} size="sm" />
                  <span>{student.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-4" title={t('dashboard.messages')} subtitle={t('dashboard.unreadMessages')}>
          <div className="message-card">
            <span className="message-card-icon" aria-hidden="true">
              <Icon name="message" size={24} />
            </span>
            <div>
              <strong>{data.messages.unread}</strong>
              <span className="muted small">{t('dashboard.unreadMessages')}</span>
            </div>
            <Link className="button button-small button-ghost" to="/community">
              {t('dashboard.openMessages')}
            </Link>
          </div>
          <p className="muted small message-card-hint">{t('dashboard.messagesHint')}</p>
        </Section>

        <Section className="span-12" title={t('mentor.notificationsTitle')} subtitle={t('mentor.notificationsSubtitle')}>
          {data.notifications.items.length === 0 ? (
            <Empty>{t('mentor.noNotifications')}</Empty>
          ) : (
            <ul className="notice-list activity-feed horizontal-feed">
              {data.notifications.items.slice(0, 6).map((item) => (
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
