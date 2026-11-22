import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getSession } from '../api/client'
import { portalApi } from '../api/portal'
import { useI18n } from '../i18n'
import {
  Avatar,
  Empty,
  Icon,
  Progress,
  ProgressRing,
  QuickTile,
  Section,
  StatCard,
  formatDateTime,
  formatDay,
  formatFullDate,
  formatTime,
  greeting,
} from '../components/ui'

/** Панель менеджера: организация и коммуникации, без финансовой аналитики. */
export function ManagerDashboard() {
  const session = getSession()
  const { t } = useI18n()
  const query = useQuery({ queryKey: ['portal-manager'], queryFn: portalApi.manager })

  if (query.isLoading) return <div className="state">{t('manager.loading')}</div>
  if (query.error) return <div className="alert alert-error">{t('manager.loadError')}</div>
  if (!query.data) return null

  const data = query.data
  const nextLesson = data.upcoming[0]
  const studentsPerTeacher = data.metrics.teachers
    ? (data.metrics.students / data.metrics.teachers).toFixed(1)
    : '—'

  return (
    <div className="dashboard">
      <section className="hero dashboard-hero">
        <div className="hero-main">
          <div className="hero-topline">
            <span className="eyebrow">{t('manager.eyebrow')}</span>
            <span className="hero-date">{formatFullDate(new Date())}</span>
          </div>
          <h1>
            {greeting()}, {session?.firstName ?? t('manager.fallbackName')}
            <span className="hero-dot">.</span>
          </h1>
          <p className="hero-copy">{t('manager.hero')}</p>

          <div className="hero-inline-stats">
            <div>
              <span>{t('dashboard.nextLesson')}</span>
              <strong>{nextLesson ? formatTime(nextLesson.startsAt) : '—'}</strong>
              <small>{nextLesson?.title ?? t('manager.noLessons')}</small>
            </div>
            <div>
              <span>{t('manager.newLeads')}</span>
              <strong>{data.metrics.newLeads}</strong>
              <small>{t('manager.leadsSubtitle')}</small>
            </div>
            <div>
              <span>{t('manager.activeGroups')}</span>
              <strong>{data.metrics.activeGroups}</strong>
              <small>{t('dashboard.groupsNow')}</small>
            </div>
          </div>

          <div className="quick-actions">
            <Link className="button" to="/courses">
              <Icon name="book" size={17} /> {t('nav.courses')}
            </Link>
            <Link className="button button-ghost" to="/cash">
              <Icon name="wallet" size={17} /> {t('manager.cash')}
            </Link>
            <Link className="button button-ghost" to="/schedule">
              <Icon name="calendar" size={17} /> {t('manager.schedule')}
            </Link>
            <Link className="button button-ghost" to="/reports">
              <Icon name="grid" size={17} /> {t('manager.reports')}
            </Link>
            <Link className="button button-ghost" to="/analytics">
              <Icon name="spark" size={17} /> {t('manager.analytics')}
            </Link>
            <Link className="button button-ghost" to="/community">
              <Icon name="message" size={17} /> {t('manager.communications')}
            </Link>
          </div>
        </div>

        <div className="hero-side progress-hero-side">
          <div className="hero-side-head">
            <span className="eyebrow">{t('manager.weekAttendance')}</span>
            <span className="hero-live-dot" aria-hidden="true" />
          </div>
          <ProgressRing value={Math.min(data.metrics.attendanceWeek, 100)} label={t('manager.attendance')} size="lg" />
          <p className="hero-progress-copy">{t('manager.attendanceHint')}</p>
          <div className="hero-mini-metric">
            <span>{t('dashboard.studentsPerTeacher')}</span>
            <strong>{studentsPerTeacher}</strong>
          </div>
        </div>
      </section>

      <section className="stats dashboard-stats" aria-label={t('manager.eyebrow')}>
        <StatCard label={t('manager.students')} value={data.metrics.students} icon="users" hint={t('manager.studentsSubtitle')} />
        <StatCard label={t('manager.teachers')} value={data.metrics.teachers} icon="book" tone="primary" hint={t('manager.teachersSubtitle')} />
        <StatCard label={t('manager.activeGroups')} value={data.metrics.activeGroups} icon="grid" tone="success" hint={t('manager.groupsSubtitle')} />
        <StatCard label={t('manager.newLeads')} value={data.metrics.newLeads} icon="bell" tone="warning" hint={t('manager.leadsSubtitle')} />
      </section>

      <div className="bento">
        <Section
          className="span-7"
          title={t('manager.leadsTitle')}
          subtitle={t('manager.leadsSubtitle')}
          action={<span className="chip chip-warning">{data.leads.length}</span>}
        >
          {data.leads.length === 0 ? (
            <Empty>{t('manager.noLeads')}</Empty>
          ) : (
            <ul className="lead-list">
              {data.leads.map((lead) => (
                <li key={lead.id} className="lead-card">
                  <Avatar name={lead.name} size="md" />
                  <div className="lead-copy">
                    <strong>{lead.name}</strong>
                    <a href={`tel:${lead.phone}`} className="muted small">
                      {lead.phone}
                    </a>
                  </div>
                  <div className="lead-meta">
                    <span className="chip chip-muted">{lead.audience}</span>
                    <time className="muted small">{formatDateTime(lead.createdAt)}</time>
                  </div>
                  <a className="button button-small button-ghost" href={`tel:${lead.phone}`}>
                    <Icon name="message" size={14} /> {t('dashboard.call')}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          className="span-5"
          title={t('manager.upcomingTitle')}
          subtitle={t('manager.upcomingSubtitle')}
          action={
            <Link className="link" to="/schedule">
              {t('dashboard.schedule')}
            </Link>
          }
        >
          {data.upcoming.length === 0 ? (
            <Empty>{t('manager.noLessons')}</Empty>
          ) : (
            <ul className="timeline">
              {data.upcoming.slice(0, 5).map((lesson) => (
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

        <Section className="span-7" title={t('manager.groupsTitle')} subtitle={t('manager.groupsSubtitle')}>
          {data.groups.length === 0 ? (
            <Empty>{t('manager.noGroups')}</Empty>
          ) : (
            <ul className="group-stack group-grid">
              {data.groups.map((group) => (
                <li key={group.id} className="group-card">
                  <div className="group-card-head">
                    <div>
                      <strong>{group.title}</strong>
                      <span className="muted small">{group.teacher}</span>
                    </div>
                    <span className="chip chip-primary">{group.students}</span>
                  </div>
                  <Progress value={Math.min((group.students / Math.max(data.metrics.students, 1)) * 100, 100)} label={group.title} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-5" title={t('manager.teachersTitle')} subtitle={t('manager.teachersSubtitle')}>
          {data.teachersList.length === 0 ? (
            <Empty>{t('manager.noTeachers')}</Empty>
          ) : (
            <ul className="people people-rich">
              {data.teachersList.map((teacher) => (
                <li key={teacher.id}>
                  <Avatar name={teacher.name} size="md" />
                  <div>
                    <strong>{teacher.name}</strong>
                    <span className="muted small">{teacher.email}</span>
                  </div>
                  <Icon name="arrow" size={15} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-6" title={t('manager.studentsTitle')} subtitle={t('manager.studentsSubtitle')}>
          {data.studentsList.length === 0 ? (
            <Empty>{t('manager.noStudents')}</Empty>
          ) : (
            <ul className="people-grid">
              {data.studentsList.map((student) => (
                <li key={student.id}>
                  <Avatar name={student.name} size="sm" />
                  <div>
                    <strong>{student.name}</strong>
                    <span className="muted small">{student.email}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-6" title={t('dashboard.operations')} subtitle={t('dashboard.operationsHint')}>
          <div className="operations-panel">
            <div className="operations-metric">
              <span>{t('dashboard.studentsPerTeacher')}</span>
              <strong>{studentsPerTeacher}</strong>
            </div>
            <div className="operations-metric">
              <span>{t('manager.weekAttendance')}</span>
              <strong>{data.metrics.attendanceWeek}</strong>
            </div>
            <div className="operations-metric">
              <span>{t('manager.activeGroups')}</span>
              <strong>{data.metrics.activeGroups}</strong>
            </div>
          </div>
          <div className="quick-grid">
            <QuickTile to="/reports" icon="grid" label={t('manager.reports')} hint={t('dashboard.reportsHint')} />
            <QuickTile to="/analytics" icon="spark" label={t('manager.analytics')} hint={t('dashboard.analyticsHint')} tone="success" />
            <QuickTile to="/schedule" icon="calendar" label={t('manager.schedule')} hint={t('dashboard.scheduleHint')} tone="warning" />
            <QuickTile to="/cash" icon="wallet" label={t('manager.cash')} hint={t('dashboard.cashHint')} tone="muted" />
          </div>
        </Section>

        <Section className="span-12" title={t('manager.notificationsTitle')} subtitle={t('manager.notificationsSubtitle')}>
          {data.notifications.items.length === 0 ? (
            <Empty>{t('manager.noNotifications')}</Empty>
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
