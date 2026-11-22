import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { adminApi } from '../api/admin'
import { errorMessage, getSession } from '../api/client'
import { BarChart, DonutChart } from '../components/Charts'
import { Icon, Progress, QuickTile, Section, StatCard, formatDateTime, greeting } from '../components/ui'
import { useI18n } from '../i18n'

/** Обзор филиала: показатели, графика, журнал и быстрые переходы в разделы. */
export function DashboardPage() {
  const { t } = useI18n()
  const session = getSession()
  const dashboard = useQuery({ queryKey: ['admin-dashboard'], queryFn: adminApi.dashboard })
  const analytics = useQuery({ queryKey: ['admin-analytics'], queryFn: adminApi.analytics })

  if (dashboard.isLoading) return <div className="state">{t('admin.loading')}</div>
  if (dashboard.error) return <div className="alert alert-error">{errorMessage(dashboard.error, t('admin.loadError'))}</div>
  if (!dashboard.data) return null

  const data = dashboard.data
  const metrics = analytics.data
  const enrollments = metrics?.enrollments ?? {}
  const submissions = metrics?.submissions ?? {}
  const enrollmentTotal = Object.values(enrollments).reduce((sum, value) => sum + value, 0)
  const reviewTotal = submissions.SUBMITTED ?? 0

  return (
    <div className="dashboard">
      <section className="hero dashboard-hero admin-hero">
        <div className="hero-main">
          <div className="hero-topline">
            <span className="eyebrow">{t('admin.eyebrow')}</span>
            <span className="hero-date">{t('dashboard.branchOverview')}</span>
          </div>
          <h1>
            {greeting()}, {session?.firstName ?? t('common.userFallback')}
            <span className="hero-dot">.</span>
          </h1>
          <p className="hero-copy">{t('admin.subtitle')}</p>

          <div className="hero-inline-stats">
            <div>
              <span>{t('dashboard.allUsers')}</span>
              <strong>{data.users.total}</strong>
              <small>{t('dashboard.inBranch')}</small>
            </div>
            <div>
              <span>{t('admin.activeStudents')}</span>
              <strong>{metrics?.activeStudents ?? '—'}</strong>
              <small>{t('dashboard.last30')}</small>
            </div>
            <div>
              <span>{t('mentor.pending')}</span>
              <strong>{reviewTotal}</strong>
              <small>{t('dashboard.needReview')}</small>
            </div>
          </div>

          <div className="quick-actions">
            <Link className="button" to="/users">
              <Icon name="users" size={17} /> {t('nav.users')}
            </Link>
            <Link className="button button-ghost" to="/access">
              <Icon name="key" size={17} /> {t('nav.access')}
            </Link>
            <Link className="button button-ghost" to="/reports">
              <Icon name="grid" size={17} /> {t('nav.reports')}
            </Link>
            <Link className="button button-ghost" to="/audit">
              <Icon name="clock" size={17} /> {t('nav.audit')}
            </Link>
          </div>
        </div>

        <div className="hero-side admin-hero-side">
          <span className="eyebrow">{t('dashboard.health')}</span>
          <div className="health-value">
            <span className="hero-live-dot" aria-hidden="true" />
            <strong>{t('dashboard.stable')}</strong>
          </div>
          <p className="hero-progress-copy">{t('dashboard.healthHint')}</p>
          <div className="health-list">
            <div>
              <span>{t('admin.students')}</span>
              <strong>{data.users.students}</strong>
            </div>
            <div>
              <span>{t('admin.teachers')}</span>
              <strong>{data.users.teachers}</strong>
            </div>
            <div>
              <span>{t('admin.activeCourses')}</span>
              <strong>{data.courses.active}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="stats dashboard-stats admin-stats" aria-label={t('admin.title')}>
        <StatCard label={t('admin.students')} value={data.users.students} icon="users" hint={t('dashboard.inBranch')} />
        <StatCard label={t('admin.teachers')} value={data.users.teachers} icon="book" tone="primary" hint={t('admin.teachers')} />
        <StatCard label={t('admin.activeCourses')} value={data.courses.active} icon="grid" tone="success" hint={t('admin.drafts', { count: data.courses.draft })} />
        <StatCard label={t('admin.upcomingLessons')} value={data.upcomingLessons} icon="calendar" tone="warning" hint={t('dashboard.next7')} />
        <StatCard label={t('admin.completedEnrollments')} value={data.courses.completedEnrollments} icon="check" tone="success" hint={t('dashboard.allTime')} />
        <StatCard label={t('admin.newUsers')} value={data.activity.newUsers} icon="trend" tone="primary" hint={t('admin.last7')} />
      </section>

      <div className="bento">
        <Section
          className="span-5"
          title={t('admin.enrollments')}
          subtitle={t('dashboard.enrollmentsHint')}
          action={<span className="chip chip-primary">{enrollmentTotal}</span>}
        >
          {analytics.isLoading ? <p className="muted">{t('admin.loading')}</p> : null}
          {analytics.error ? <p className="muted">{errorMessage(analytics.error)}</p> : null}
          {metrics ? (
            <DonutChart
              centerLabel={t('admin.records')}
              data={[
                { label: t('admin.enrollmentsActive'), value: enrollments.ACTIVE ?? 0, tone: 'success' },
                { label: t('admin.enrollmentsPending'), value: enrollments.PENDING ?? 0, tone: 'warning' },
                { label: t('admin.enrollmentsPaused'), value: enrollments.PAUSED ?? 0, tone: 'muted' },
                { label: t('admin.enrollmentsCompleted'), value: enrollments.COMPLETED ?? 0, tone: 'primary' },
              ]}
            />
          ) : null}
        </Section>

        <Section className="span-4" title={t('admin.homework')} subtitle={t('dashboard.submissionsHint')}>
          {metrics ? (
            <BarChart
              data={[
                { label: t('status.SUBMITTED'), value: submissions.SUBMITTED ?? 0, tone: 'warning' },
                { label: t('status.REVIEWED'), value: submissions.REVIEWED ?? 0, tone: 'success' },
                { label: t('status.RETURNED'), value: submissions.RETURNED ?? 0, tone: 'danger' },
              ]}
            />
          ) : (
            <p className="muted">{t('admin.loading')}</p>
          )}
          <Link className="action-link" to="/review">
            <Icon name="check" size={16} /> {t('admin.reviewLink')} <Icon name="arrow" size={15} />
          </Link>
        </Section>

        <Section className="span-3" title={t('dashboard.learningPulse')} subtitle={t('dashboard.pulseHint')}>
          {metrics ? (
            <div className="pulse-card">
              <div className="pulse-main">
                <span className="eyebrow">{t('admin.averageScore')}</span>
                <strong>{metrics.testAttempts.averageScore}</strong>
              </div>
              <div className="pulse-row">
                <span>{t('admin.testAttempts')}</span>
                <strong>{metrics.testAttempts.total}</strong>
              </div>
              <div className="pulse-row">
                <span>{t('admin.attendanceMinutes')}</span>
                <strong>{metrics.attendance.totalMinutes}</strong>
              </div>
              <Progress
                value={Math.min((metrics.activeStudents / Math.max(data.users.students, 1)) * 100, 100)}
                label={t('admin.activeStudents')}
              />
              <span className="muted small">{t('dashboard.activeShare')}</span>
            </div>
          ) : (
            <p className="muted">{t('admin.loading')}</p>
          )}
        </Section>

        <Section
          className="span-7"
          title={t('admin.recentActions')}
          subtitle={t('dashboard.auditHint')}
          action={
            <Link className="link" to="/audit">
              {t('admin.allAudit')}
            </Link>
          }
        >
          {data.recentAudit.length === 0 ? (
            <p className="empty">{t('admin.noRecords')}</p>
          ) : (
            <ul className="audit-feed">
              {data.recentAudit.slice(0, 7).map((entry) => (
                <li key={entry.id}>
                  <span className="audit-icon" aria-hidden="true">
                    <Icon name="clock" size={15} />
                  </span>
                  <div>
                    <strong>{entry.action}</strong>
                    <span className="muted small">
                      {entry.entity} · {entry.actor}
                    </span>
                  </div>
                  <time className="muted small">{formatDateTime(entry.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section className="span-5" title={t('dashboard.adminTools')} subtitle={t('dashboard.adminToolsHint')}>
          <div className="quick-grid">
            <QuickTile to="/users" icon="users" label={t('nav.users')} hint={t('dashboard.usersHint')} />
            <QuickTile to="/access" icon="key" label={t('nav.access')} hint={t('dashboard.accessHint')} tone="warning" />
            <QuickTile to="/finance" icon="wallet" label={t('nav.finance')} hint={t('dashboard.financeHint')} tone="success" />
            <QuickTile to="/integrations" icon="settings" label={t('nav.integrations')} hint={t('dashboard.integrationsHint')} tone="muted" />
          </div>
        </Section>

        <Section className="span-7" title={t('admin.popularCourses')} subtitle={t('dashboard.popularHint')}>
          {metrics && metrics.popularCourses.length > 0 ? (
            <ol className="ranked-list">
              {metrics.popularCourses.map((course, index) => (
                <li key={course.id}>
                  <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="rank-copy">
                    <strong>{course.title}</strong>
                    <span className={`badge badge-${course.status.toLowerCase()}`}>{course.status}</span>
                  </div>
                  <div className="rank-value">
                    <strong>{course.enrollments}</strong>
                    <span>{t('admin.enrollmentsCount')}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty">{t('admin.popularCourses')}</p>
          )}
        </Section>

        <Section className="span-5" title={t('dashboard.systemSettings')} subtitle={t('dashboard.systemSettingsHint')}>
          <div className="settings-list">
            <Link to="/audit">
              <Icon name="clock" size={18} />
              <div>
                <strong>{t('nav.audit')}</strong>
                <span>{t('dashboard.auditHint')}</span>
              </div>
              <Icon name="arrow" size={15} />
            </Link>
            <Link to="/backups">
              <Icon name="shield" size={18} />
              <div>
                <strong>{t('nav.backups')}</strong>
                <span>{t('dashboard.backupsHint')}</span>
              </div>
              <Icon name="arrow" size={15} />
            </Link>
            <Link to="/privacy-admin">
              <Icon name="settings" size={18} />
              <div>
                <strong>{t('nav.privacyAdmin')}</strong>
                <span>{t('dashboard.privacyHint')}</span>
              </div>
              <Icon name="arrow" size={15} />
            </Link>
          </div>
        </Section>
      </div>
    </div>
  )
}
