import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { getSession, getToken, switchSessionRole, type SessionRole } from '../api/client'
import { rolesApi } from '../api/roles'
import { useSession } from '../hooks/useSession'
import { Layout } from '../layouts/AppLayout'
import { CookieBanner } from '../components/CookieBanner'
import { homeForRole } from './navigation'
import { AccessAdminPage } from '../pages/AccessAdmin'
import { AiCenterPage } from '../pages/AiCenter'
import { AnalyticsPage } from '../pages/Analytics'
import { AuditPage } from '../pages/Audit'
import { BackupsPage } from '../pages/Backups'
import { CalendarPage } from '../pages/Calendar'
import { CashPage } from '../pages/Cash'
import { CertificatesPage } from '../pages/Certificates'
import { CertificateVerifyPage } from '../pages/CertificateVerify'
import { CommunityPage } from '../features/community'
import { MyCertificatesPage } from '../pages/MyCertificates'
import { NotificationSettingsPage } from '../pages/NotificationSettings'
import { CoinsPage } from '../pages/Coins'
import { CourseEditorPage } from '../pages/CourseEditor'
import { CoursePreviewPage } from '../pages/CoursePreview'
import { CoursesManagePage } from '../pages/CoursesManage'
import { DashboardPage } from '../pages/Dashboard'
import { ExamsPage } from '../pages/Exams'
import { FinancePage } from '../pages/finance/FinancePage'
import { FilesPage } from '../pages/FilesPage'
import { GradingPage } from '../pages/Grading'
import { IntegrationsPage } from '../pages/Integrations'
import { ReportsPage } from '../pages/Reports'
import { SupportPage } from '../pages/Support'
import { HomeworkPage } from '../pages/Homework'
import { ForbiddenPage } from '../pages/Forbidden'
import { JoinPage } from '../pages/Join'
import { LearnCoursePage } from '../pages/LearnCourse'
import { LessonBuilderPage } from '../pages/LessonBuilder'
import { LibraryPage } from '../pages/Library'
import { LoginPage } from '../pages/Login'
import { ManagerDashboard } from '../pages/ManagerDashboard'
import { MentorDashboard } from '../pages/MentorDashboard'
import { ParentDashboard } from '../pages/ParentDashboard'
import { PlatformPage } from '../pages/Platform'
import { PrivacyPage } from '../pages/Privacy'
import { CookiesPage } from '../pages/Cookies'
import { TermsPage } from '../pages/Terms'
import { PrivacyAdminPage } from '../pages/PrivacyAdmin'
import { RecordingsPage } from '../pages/Recordings'
import { ReviewPage } from '../pages/Review'
import { SchedulePage } from '../features/scheduling'
import { SearchPage } from '../pages/SearchPage'
import { SecurityPage } from '../pages/Security'
import { ShopPage } from '../pages/Shop'
import { StudentDashboard } from '../pages/StudentDashboard'
import { TestEditorPage, TestsPage } from '../pages/Tests'
import { AttemptResultPage, TestTakePage } from '../pages/TestTake'
import { UsersPage } from '../pages/Users'
import { VideoRoomPage } from '../pages/VideoRoom'
import { MyPaymentsPage } from '../pages/MyPayments'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Раздел доступен только перечисленным ролям; остальные видят экран отказа с запросом роли. */
function AllowRoles({ roles, children }: { roles: SessionRole[]; children: React.ReactNode }) {
  const location = useLocation()
  const session = useSession()
  const role = session?.role
  const myRoles = useQuery({
    queryKey: ['roles', 'me', session?.id],
    queryFn: rolesApi.me,
    enabled: Boolean(getToken()) && Boolean(role),
    staleTime: 30_000,
    retry: false,
  })

  // Переход по прямой ссылке на раздел другой подтверждённой роли должен
  // сначала переключить интерфейс, иначе запросы уйдут с прежним X-Active-Role.
  const grantedTarget = myRoles.data?.roles.find((granted) => roles.includes(granted))
  const needsRoleSwitch = Boolean(role && !roles.includes(role) && grantedTarget)
  useEffect(() => {
    if (needsRoleSwitch && grantedTarget) switchSessionRole(grantedTarget)
  }, [needsRoleSwitch, grantedTarget])

  if (!role) return <Navigate to="/login" replace />
  if (roles.includes(role)) return <>{children}</>
  if (myRoles.isLoading || needsRoleSwitch) return <div className="state">Проверяем доступ…</div>
  if (!grantedTarget) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

function HomeRedirect() {
  return <Navigate to={homeForRole(getSession()?.role)} replace />
}

export function App() {
  return (
    <>
    <CookieBanner />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<LoginPage initialMode="register" />} />
      <Route path="/join" element={<JoinPage />} />
      {/* Консоль главного администратора вне панели филиала: без его навигации и данных. */}
      <Route path="/platform" element={<PlatformPage />} />
      <Route path="/verify/:code" element={<CertificateVerifyPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/cookies" element={<CookiesPage />} />
      <Route path="/terms" element={<TermsPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRedirect />} />

        <Route path="admin" element={<AllowRoles roles={['ADMIN']}><DashboardPage /></AllowRoles>} />
        <Route path="manager" element={<AllowRoles roles={['MANAGER']}><ManagerDashboard /></AllowRoles>} />
        <Route path="mentor" element={<AllowRoles roles={['TEACHER']}><MentorDashboard /></AllowRoles>} />
        <Route path="student" element={<AllowRoles roles={['STUDENT']}><StudentDashboard /></AllowRoles>} />
        <Route path="parent" element={<AllowRoles roles={['PARENT']}><ParentDashboard /></AllowRoles>} />

        <Route path="search" element={<SearchPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="forbidden" element={<ForbiddenPage />} />

        <Route path="access" element={<AllowRoles roles={['ADMIN']}><AccessAdminPage /></AllowRoles>} />
        <Route path="users" element={<AllowRoles roles={['ADMIN']}><UsersPage /></AllowRoles>} />
        <Route path="courses" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><CoursesManagePage /></AllowRoles>} />
        <Route path="courses/:id/edit" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><CourseEditorPage /></AllowRoles>} />
        <Route path="courses/:id/preview" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><CoursePreviewPage /></AllowRoles>} />
        <Route path="courses/:id/lessons/:lessonId" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><LessonBuilderPage /></AllowRoles>} />
        <Route path="learn/:courseId" element={<AllowRoles roles={['STUDENT']}><LearnCoursePage /></AllowRoles>} />
        <Route path="library" element={<AllowRoles roles={['STUDENT']}><LibraryPage /></AllowRoles>} />
        <Route path="files" element={<FilesPage />} />
        <Route path="homework" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><HomeworkPage /></AllowRoles>} />
        <Route path="tests" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><TestsPage /></AllowRoles>} />
        <Route path="tests/:id/edit" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><TestEditorPage /></AllowRoles>} />
        <Route path="tests/:id/take" element={<AllowRoles roles={['STUDENT']}><TestTakePage /></AllowRoles>} />
        <Route path="attempts/:id/result" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><AttemptResultPage /></AllowRoles>} />
        <Route path="exams" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><ExamsPage /></AllowRoles>} />
        <Route path="grading" element={<AllowRoles roles={['ADMIN', 'MANAGER']}><GradingPage /></AllowRoles>} />
        <Route path="schedule" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER']}><SchedulePage /></AllowRoles>} />
        <Route path="calendar" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT']}><CalendarPage /></AllowRoles>} />
        <Route path="recordings" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT']}><RecordingsPage /></AllowRoles>} />
        <Route path="lesson/:id" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT']}><VideoRoomPage /></AllowRoles>} />
        <Route path="review" element={<AllowRoles roles={['ADMIN', 'TEACHER']}><ReviewPage /></AllowRoles>} />
        <Route path="certificates" element={<AllowRoles roles={['ADMIN']}><CertificatesPage /></AllowRoles>} />
        <Route path="my-certificates" element={<AllowRoles roles={['STUDENT']}><MyCertificatesPage /></AllowRoles>} />
        <Route path="community" element={<CommunityPage />} />
        <Route path="notifications" element={<NotificationSettingsPage />} />
        <Route path="finance" element={<AllowRoles roles={['ADMIN']}><FinancePage /></AllowRoles>} />
        <Route path="analytics" element={<AllowRoles roles={['STUDENT', 'TEACHER', 'MANAGER', 'ADMIN']}><AnalyticsPage /></AllowRoles>} />
        <Route path="my-payments" element={<AllowRoles roles={['STUDENT', 'PARENT']}><MyPaymentsPage /></AllowRoles>} />
        <Route path="cash" element={<AllowRoles roles={['ADMIN', 'MANAGER']}><CashPage /></AllowRoles>} />
        <Route path="shop" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT']}><ShopPage /></AllowRoles>} />
        <Route path="coins" element={<AllowRoles roles={['ADMIN', 'TEACHER', 'STUDENT', 'PARENT']}><CoinsPage /></AllowRoles>} />
        <Route path="ai" element={<AllowRoles roles={['ADMIN', 'MANAGER', 'TEACHER', 'STUDENT']}><AiCenterPage /></AllowRoles>} />
        <Route path="reports" element={<AllowRoles roles={['ADMIN', 'MANAGER']}><ReportsPage /></AllowRoles>} />
        <Route path="support" element={<SupportPage />} />
        <Route path="backups" element={<AllowRoles roles={['ADMIN']}><BackupsPage /></AllowRoles>} />
        <Route path="integrations" element={<AllowRoles roles={['ADMIN']}><IntegrationsPage /></AllowRoles>} />
        <Route path="audit" element={<AllowRoles roles={['ADMIN']}><AuditPage /></AllowRoles>} />
        <Route path="privacy-admin" element={<AllowRoles roles={['ADMIN']}><PrivacyAdminPage /></AllowRoles>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
